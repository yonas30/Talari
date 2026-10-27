import { create } from 'zustand';

import { dismissReconcileMismatch, readOwnNamesData, readPairRejectionKeys, readReconcileDismissalMap, readSmsData, removeOwnName, saveOwnName, saveOwnNameText, saveSuggestionChoices, savePairRejection, saveSuggestions } from '../db/database';
import { OwnName, PairRejectionReason } from '../db/smsRepo';
import { RecipientRule, SmsSuggestion } from '../types/sms';
import { defaultCtx } from '../utils/accounts/context';
import { AccountsError } from '../utils/accounts/errors';
import { todayKey } from '../utils/dates';
import { linkDetails } from '../utils/sms/accountMatch';
import { cleanOwnNameInput, ownNameProblem } from '../utils/sms/ownNames';
import { buildChains, chainTimestamps, heldForMissing } from '../utils/sms/chain';
import { findPairs, pairedSuggestionIds, searchPairs } from '../utils/sms/pairing';
import { PairMode, planPairSave } from '../utils/sms/pairSave';
import { BulkProgress, BulkResult, runBulkSave } from '../utils/sms/bulkRun';
import { OpeningOffer, OpeningOptions, planOpeningChange } from '../utils/sms/opening';
import { planSuggestionSave, SuggestionSavePlan } from '../utils/sms/saveSuggestion';
import { BatchPreview, handledHashes, stageBatch } from '../utils/sms/staging';
import { getAccountsState, useFinanceStore } from './finance';

interface SmsStoreState {
  suggestions: SmsSuggestion[];
  rules: RecipientRule[];
  // The pairs the owner said are not transfers ("not a pair" or "keep separate"): never offered again.
  rejectedPairs: Set<string>;
  // account id -> hash of the message whose "balance doesn't match" banner was dismissed.
  reconcileDismissals: Record<string, string>;
  // "Your name as banks write it" (Phase 6D-3): used only by pairing rule 3.
  ownNames: OwnName[];
  isReady: boolean;
  // "Saving 3 of 12": set while "Save all that are clean" runs, null otherwise.
  bulkProgress: BulkProgress | null;
  load: () => void;
  // Adds, renames and removes one of the owner's names. add and rename throw an Error with the reason (nothing is saved) when the name cannot be used.
  addOwnName: (name: string) => void;
  renameOwnName: (id: string, name: string) => void;
  removeOwnName: (id: string) => void;
  // Every hash the table knows (pending, confirmed, ignored): a message is never suggested twice.
  knownHashes: () => Set<string>;
  // Saves the new messages of a paste as pending suggestions, one transaction for the batch. Returns how many were added.
  addBatch: (preview: BatchPreview, batchDate: string) => number;
  // The owner's choices on a card (account, category, fee, date). Kept so closing the app does not lose them.
  editSuggestion: (id: string, patch: { accountId?: string | null; category?: string; feeAmount?: number | null; date?: string }) => void;
  // "Skip": the message stays out of the queue and is never suggested again (its hash is kept) unless it is restored.
  ignoreSuggestion: (id: string) => void;
  // Brings a skipped message back to the queue, with the choices it had.
  restoreSuggestion: (id: string) => void;
  // Links the card's account to the message's service (sets the account's SMS sender and digits), then uses it for the card.
  linkAccount: (suggestionId: string, accountId: string) => Promise<void>;
  // Saves a pair as one transfer (or converts the existing entry) and confirms both messages, all or nothing. Throws an AccountsError, with
  // nothing written, if it would not work.
  acceptPair: (key: string, mode: PairMode, fee?: number | null) => Promise<void>;
  rejectPair: (key: string, reason: PairRejectionReason) => void;
  dismissReconcile: (accountId: string, hash: string) => void;
  // What the opening-balance proposals need from the store: the messages held for a pair answer, and the chain times for saved messages.
  openingOptions: (mask?: (text: string) => string) => OpeningOptions;
  // Confirm on an opening-balance preview: the change is worked out again, then the opening and its messages are saved in one transaction.
  // Throws an AccountsError, with nothing written, if it is refused or no longer the one shown.
  applyOpeningChange: (offer: OpeningOffer) => Promise<void>;
  // Throws an AccountsError (nothing written) if the entries would not work.
  confirmSuggestion: (id: string, remember: boolean) => Promise<void>;
  // Never throws: the result lists every message that was not saved and why.
  saveAllClean: () => Promise<BulkResult>;
}

export const useSmsStore = create<SmsStoreState>((set, get) => ({
  suggestions: [],
  rules: [],
  rejectedPairs: new Set<string>(),
  reconcileDismissals: {},
  ownNames: [],
  isReady: false,
  bulkProgress: null,

  load: () => {
    const { suggestions, rules } = readSmsData();
    set({ suggestions, rules, rejectedPairs: readPairRejectionKeys(), reconcileDismissals: readReconcileDismissalMap(), ownNames: readOwnNamesData(), isReady: true });
  },

  addOwnName: (name) => {
    const problem = ownNameProblem(get().ownNames.map((row) => row.name), name);
    const text = cleanOwnNameInput(name);
    if (problem !== null || text === null) {
      throw new Error(problem ?? 'Type your name the way your bank prints it.');
    }
    const row: OwnName = { id: `own-${Date.now()}-${Math.random().toString(16).slice(2)}`, name: text, createdAt: new Date().toISOString() };
    saveOwnName(row);
    set({ ownNames: [...get().ownNames, row] });
  },

  renameOwnName: (id, name) => {
    const names = get().ownNames;
    const index = names.findIndex((row) => row.id === id);
    const problem = ownNameProblem(names.map((row) => row.name), name, index === -1 ? null : index);
    const text = cleanOwnNameInput(name);
    if (index === -1 || problem !== null || text === null) {
      throw new Error(problem ?? 'That name is no longer on your list.');
    }
    saveOwnNameText(id, text);
    set({ ownNames: names.map((row) => (row.id === id ? { ...row, name: text } : row)) });
  },

  removeOwnName: (id) => {
    removeOwnName(id);
    set({ ownNames: get().ownNames.filter((row) => row.id !== id) });
  },

  knownHashes: () => handledHashes(get().suggestions),

  addBatch: (preview, batchDate) => {
    const finance = useFinanceStore.getState();
    const rows = stageBatch(preview, batchDate, defaultCtx, { accounts: finance.accounts, rules: get().rules, categories: finance.categories });
    saveSuggestions(rows);
    set({ suggestions: [...get().suggestions, ...rows] });
    return rows.length;
  },

  editSuggestion: (id, patch) => {
    // A date the owner picks is theirs, not an estimate and not the message's: its source becomes 'manual'.
    const full = patch.date !== undefined ? { ...patch, dateSource: 'manual' as const } : patch;
    saveSuggestionChoices(id, full);
    set({ suggestions: get().suggestions.map((s) => (s.id === id ? { ...s, ...full } : s)) });
  },

  ignoreSuggestion: (id) => {
    saveSuggestionChoices(id, { status: 'ignored' });
    set({ suggestions: get().suggestions.map((s) => (s.id === id ? { ...s, status: 'ignored' } : s)) });
  },

  restoreSuggestion: (id) => {
    saveSuggestionChoices(id, { status: 'pending' });
    set({ suggestions: get().suggestions.map((s) => (s.id === id && s.status === 'ignored' ? { ...s, status: 'pending' } : s)) });
  },

  linkAccount: async (suggestionId, accountId) => {
    const suggestion = get().suggestions.find((s) => s.id === suggestionId);
    if (!suggestion) {
      return;
    }
    await useFinanceStore.getState().updateAccountSms(accountId, linkDetails(suggestion));
    get().editSuggestion(suggestionId, { accountId });
  },

  acceptPair: async (key, mode, fee) => {
    const plan = planPairSave(getAccountsState(), key, get().suggestions, mode, undefined, { fee, ownNames: get().ownNames.map((row) => row.name) });
    await useFinanceStore.getState().commitPairSave(plan);
    // Only after the database transaction succeeded: both messages are confirmed, and a weaker date is now the paired one.
    const done = new Map(plan.confirmation.suggestions.map((item) => [item.id, item]));
    set({
      suggestions: get().suggestions.map((s) => {
        const item = done.get(s.id);
        return item ? { ...s, status: 'confirmed', confirmedEntryId: plan.confirmation.entryId, date: item.date, dateSource: item.dateSource } : s;
      }),
    });
  },

  dismissReconcile: (accountId, hash) => {
    dismissReconcileMismatch(accountId, hash, new Date().toISOString());
    set({ reconcileDismissals: { ...get().reconcileDismissals, [accountId]: hash } });
  },

  openingOptions: (mask) => {
    const state = getAccountsState();
    const suggestions = get().suggestions;
    const inPair = pairedSuggestionIds(findPairs(state, suggestions, get().rejectedPairs, get().ownNames.map((row) => row.name)));
    const held = new Map([...inPair].map((id) => [id, 'Waiting for your answer: it could be one side of a transfer between your own accounts.'] as const));
    const times = chainTimestamps(buildChains(suggestions, state.accounts));
    return { held, timestampFor: (s) => times.get(s.id) ?? null, mask };
  },

  applyOpeningChange: async (offer) => {
    const plan = planOpeningChange(getAccountsState(), get().suggestions, offer, { ...get().openingOptions(), ctx: defaultCtx });
    await useFinanceStore.getState().commitOpeningChange(plan);
    // Only after the database transaction succeeded: those messages are confirmed.
    const done = new Map(plan.confirmations.map((item) => [item.suggestionId, item.entryId]));
    set({ suggestions: get().suggestions.map((s) => (done.has(s.id) ? { ...s, status: 'confirmed', confirmedEntryId: done.get(s.id) as string } : s)) });
  },

  rejectPair: (key, reason) => {
    savePairRejection(key, reason, new Date().toISOString());
    set({ rejectedPairs: new Set([...get().rejectedPairs, key]) });
  },

  confirmSuggestion: async (id, remember) => {
    const suggestion = get().suggestions.find((s) => s.id === id);
    if (!suggestion) {
      throw new AccountsError('INVALID_ENTRY', 'This message is no longer in the list.');
    }
    // A message that printed no time gets one from its place in the balance chain, so the day's entries keep the bank's order.
    const times = chainTimestamps(buildChains(get().suggestions, getAccountsState().accounts));
    const plan = planSuggestionSave(getAccountsState(), suggestion, { remember, timestamp: times.get(suggestion.id) ?? null });
    await useFinanceStore.getState().commitSmsSave(plan);
    // Only after the database transaction succeeded.
    const { rule } = plan.confirmation;
    set({
      suggestions: get().suggestions.map((s) => (s.id === id ? { ...s, status: 'confirmed', confirmedEntryId: plan.mainEntryId } : s)),
      rules: rule ? [...get().rules.filter((r) => r.key !== rule.key), rule] : get().rules,
    });
  },

  saveAllClean: async () => {
    const finance = useFinanceStore.getState();
    const startState = getAccountsState();
    const suggestions = get().suggestions;
    // A message that could be one side of a transfer is not saved on its own: that would record the same movement twice. It waits for the
    // owner's answer on its pair card, and the result says so instead of leaving it out silently.
    const ownNames = get().ownNames.map((row) => row.name);
    const inPair = pairedSuggestionIds(findPairs(startState, suggestions, get().rejectedPairs, ownNames));
    const held = new Map<string, string>([...inPair].map((id) => [id, 'Waiting for your answer: it could be one side of a transfer between your own accounts.'] as const));
    // A message that your own name could pair with more than one other movement is not offered as a pair, and is not saved on its own either:
    // saving it as an income or an expense could record the same movement twice.
    for (const notice of searchPairs(startState, suggestions, get().rejectedPairs, ownNames).notices) {
      for (const id of notice.heldIds ?? []) {
        if (!held.has(id)) held.set(id, 'It could be one side of a transfer between your own accounts, but more than one movement fits. Decide it yourself.');
      }
    }
    // Worked out ONCE for the whole batch, not per message.
    const times = chainTimestamps(buildChains(suggestions, startState.accounts));
    // A card that shows "something is missing before this message" is the owner's call (it asks before saving), so a batch leaves it alone.
    for (const [id, reason] of heldForMissing(suggestions, startState.accounts)) {
      if (!held.has(id)) held.set(id, reason);
    }
    const written: SuggestionSavePlan[] = [];

    set({ bulkProgress: { done: 0, total: 0 } });
    let result: BulkResult;
    try {
      result = await runBulkSave({
        state: startState,
        suggestions,
        held,
        timestampFor: (s) => times.get(s.id) ?? null,
        // The database gets each message in its own transaction, as before; the screens are NOT touched until the end.
        commit: (plan, before) => {
          finance.writeSmsSave(plan, before);
          written.push(plan);
        },
        onProgress: (progress) => set({ bulkProgress: progress }),
        yieldToUi: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
      });
    } catch (error) {
      // runBulkSave does not throw, but whatever happens the screens must end up showing what is really in the database.
      const text = error instanceof Error ? error.message : String(error);
      const last = written[written.length - 1];
      result = {
        saved: written.map((plan) => plan.confirmation.suggestionId),
        failures: [],
        state: last ? last.result.state : startState,
        total: written.length,
        stopped: text,
        error,
      };
    }

    // ONE update of what the screens show: the ledger, the confirmed messages, the remembered recipients.
    const done = new Map(written.map((plan) => [plan.confirmation.suggestionId, plan]));
    const newRules = written.flatMap((plan) => (plan.confirmation.rule ? [plan.confirmation.rule] : []));
    set({
      suggestions: get().suggestions.map((s) => {
        const plan = done.get(s.id);
        return plan ? { ...s, status: 'confirmed', confirmedEntryId: plan.mainEntryId } : s;
      }),
      rules: [...get().rules.filter((r) => !newRules.some((n) => n.key === r.key)), ...newRules],
      bulkProgress: null,
    });
    try {
      await finance.showSavedLedger(result.state);
    } catch (error) {
      result = { ...result, stopped: result.stopped ?? (error instanceof Error ? error.message : String(error)), error: result.error ?? error };
    }
    return result;
  },
}));

export const todayForBatch = (): string => todayKey();
