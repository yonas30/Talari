import { AccountEntry, AccountsState } from '../../types/accounts';
import { SmsSuggestion } from '../../types/sms';
import { getAccountBalances, validateEntries } from '../accounts/balances';
import { Ctx, defaultCtx, todayOf } from '../accounts/context';
import { planAddEntries } from '../accounts/entries';
import { AccountsError } from '../accounts/errors';
import { formatAmount, fromCents, toCents } from '../accounts/money';
import { enforceReserved } from '../accounts/reserve';
import { eligibleAccounts, SERVICE_LABEL } from './accountMatch';
import { buildChains, ChainItem, chainItemOf, effectCents, gapSentences, oldestOf } from './chain';
import { categoryOf, cleanOrder, suggestionInputs } from './saveSuggestion';
import { SmsService } from './types';

// The opening balance worked out from messages, moved back, replaced or typed (V2_SPEC Part Z, Phase 6C-3). Pure: nothing here writes. An
// account with no `opening` entry is normal (its balance is zero); this module is how one is created, moved or replaced, always through a
// preview (an OpeningOffer) that the owner confirms, and always as ONE set of rows with the messages that go with it.

export type OpeningMode = 'create' | 'move' | 'replace';
export type OpeningSource = 'messages' | 'typed';

export type RefusalCode =
  | 'no_account'
  | 'no_messages'
  | 'no_balance'
  | 'undecided'
  | 'skipped'
  | 'figures'
  | 'negative'
  | 'conflict'
  | 'mismatch'
  | 'ledger'
  | 'reserved'
  | 'held'
  | 'same'
  | 'invalid'
  | 'changed';

export interface OpeningRefusal {
  kind: 'refused';
  accountId: string;
  code: RefusalCode;
  // Plain words for the owner; every figure in it already went through `mask`.
  message: string;
  // True when the opening could not be worked out from the messages and the owner should type it instead.
  askToType: boolean;
}

export interface OpeningSave {
  id: string;
  service: SmsService;
  date: string;
  direction: 'in' | 'out';
  amount: number;
  fee: number;
}

export interface OpeningOffer {
  kind: 'offer';
  accountId: string;
  accountName: string;
  mode: OpeningMode;
  source: OpeningSource;
  // The opening after the change. amount 0 means NO opening entry (the account started empty, or the owner removed it).
  after: { date: string; amount: number; note: string | null };
  // The opening now, or null when the account has none.
  before: { date: string; amount: number } | null;
  balanceNow: number;
  balanceAfter: number;
  // The waiting messages saved in the same step, oldest first.
  saves: OpeningSave[];
  // The message the opening was worked out from (messages only).
  basis: { id: string; service: SmsService; date: string } | null;
  // Set when that message's date is only the batch date: the preview warns before anything is created.
  estimatedWarning: string | null;
  // What the newest message's balance was compared with, or null when no comparison was needed.
  check: { date: string; bankBalance: number; service: SmsService } | null;
  // What the owner typed (typed only), so the change can be worked out again on confirm.
  typed: { amount: number; date: string } | null;
}

export type OpeningProposal = OpeningOffer | OpeningRefusal | { kind: 'none' };

export interface OpeningConfirmation {
  suggestionId: string;
  entryId: string;
}

export interface OpeningPlan {
  // The whole ledger after the change: the opening, the saved messages' entries and fees.
  state: AccountsState;
  openingEntryId: string | null;
  confirmations: OpeningConfirmation[];
  offer: OpeningOffer;
}

export interface OpeningOptions {
  // Messages that must not be saved here (for example one side of a transfer pair), with the reason.
  held?: ReadonlyMap<string, string>;
  // A time inside its day for a saved message that printed none (from the chain), as in an ordinary save.
  timestampFor?: (s: SmsSuggestion) => string | null;
  // Shows an amount (or hides it while balances are hidden). Every figure in a message goes through it.
  mask?: (text: string) => string;
  ctx?: Ctx;
}

const identity = (text: string): string => text;

// The day before `date` (YYYY-MM-DD), by calendar arithmetic only.
export function previousDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

const startOfDayIso = (date: string): string => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0).toISOString();
};

// "ETB 1,200.00" anywhere in an engine message becomes whatever `mask` says (used for the ledger's own error texts).
const FIGURE = /\b(?:ETB|USD|EUR|GBP) [\d,]+(?:\.\d+)?/g;
const maskFigures = (text: string, mask: (text: string) => string): string => text.replace(FIGURE, (found) => mask(found));

const money = (value: number, mask: (text: string) => string): string => mask(`ETB ${formatAmount(value)}`);

const KIND_LABEL: Record<AccountEntry['type'], string> = {
  income: 'income',
  expense: 'expense',
  transfer: 'transfer',
  opening: 'opening balance',
  adjustment: 'adjustment',
};

function describeEntry(entry: AccountEntry, mask: (text: string) => string): string {
  const kind = entry.type === 'expense' && entry.category === 'Fees' ? 'fee' : KIND_LABEL[entry.type];
  return `The ${kind} of ${money(entry.amount, mask)} on ${entry.date}`;
}

const touches = (entry: AccountEntry, accountId: string): boolean => entry.accountId === accountId || entry.fromAccountId === accountId || entry.toAccountId === accountId;

const refuse = (accountId: string, code: RefusalCode, message: string, askToType = false): OpeningRefusal => ({ kind: 'refused', accountId, code, message, askToType });

interface Derived {
  // The opening in cents (may be zero) and its day.
  cents: number;
  date: string;
  message: SmsSuggestion;
  item: ChainItem;
}

// The opening from the oldest message: printed balance minus what came in, or plus the TOTAL debited (amount and every fee) for what went out.
function derive(state: AccountsState, suggestions: SmsSuggestion[], accountId: string, mask: (text: string) => string): Derived | OpeningRefusal {
  const chain = buildChains(suggestions, state.accounts).get(accountId);
  if (!chain || chain.ordered.length === 0) {
    return refuse(accountId, 'no_messages', 'No messages have been imported for this account yet.');
  }
  const oldest = oldestOf(chain.ordered);
  if (oldest.kind !== 'oldest') {
    return refuse(accountId, 'undecided', 'Your messages do not show which one is the oldest (some are on the same day without a time, or have only a guessed date, and do not link up). Type the opening balance instead.', true);
  }
  const item = oldest.item;
  const message = suggestions.find((s) => s.id === item.id) as SmsSuggestion;
  const named = `${money(item.amount, mask)} message of ${item.date}`;
  if (message.status === 'ignored') {
    return refuse(accountId, 'skipped', `The oldest message (the ${named}) was skipped. Restore it first, or type the opening balance instead.`, true);
  }
  if (item.balanceAfter === null) {
    return refuse(accountId, 'no_balance', `The oldest message (the ${named}) does not print a balance, so the opening cannot be worked out from it. Type the opening balance instead.`, true);
  }
  if (message.flags.includes('total_mismatch')) {
    return refuse(accountId, 'figures', `The amount, the charges and the total in the oldest message (the ${named}) do not add up, so the opening is not worked out from it. Fix them on its card, or type the opening balance instead.`, true);
  }
  const cents = toCents(item.balanceAfter) - effectCents(item);
  if (cents < 0) {
    return refuse(accountId, 'negative', `The figures of the oldest message (the ${named}) are impossible: its balance is smaller than the money that came in. Type the opening balance instead.`, true);
  }
  return { cents, date: previousDay(item.date), message, item };
}

interface Target {
  amountCents: number;
  date: string;
  note: string | null;
  source: OpeningSource;
  basis: Derived | null;
  typed: { amount: number; date: string } | null;
}

interface Evaluated {
  offer: OpeningOffer;
  state: AccountsState;
  confirmations: OpeningConfirmation[];
  openingEntryId: string | null;
}

// Works the whole change out WITHOUT writing: the rows, every refusal, and what the preview shows. The same function is what runs again when the
// owner confirms, so the preview and the save can never disagree.
function evaluate(state: AccountsState, suggestions: SmsSuggestion[], accountId: string, target: Target, options: OpeningOptions): Evaluated | OpeningRefusal {
  const ctx = options.ctx ?? defaultCtx;
  const mask = options.mask ?? identity;
  const account = eligibleAccounts(state.accounts).find((item) => item.id === accountId);
  if (!account) {
    return refuse(accountId, 'no_account', 'Only an ETB account that is not archived has messages.');
  }
  const openings = state.entries.filter((entry) => entry.type === 'opening' && entry.accountId === accountId);
  if (openings.length > 1) {
    return refuse(accountId, 'ledger', `${account.name} has more than one opening balance entry, so it cannot be changed here.`);
  }
  const current = openings[0] ?? null;
  const before = current ? { date: current.date, amount: current.amount } : null;
  const afterAmount = fromCents(target.amountCents);

  if (before === null ? target.amountCents === 0 : toCents(before.amount) === target.amountCents && (target.amountCents === 0 || before.date === target.date)) {
    return refuse(accountId, 'same', before === null ? 'No opening balance is needed: the account starts at zero.' : 'The opening balance is already this.');
  }
  const mode: OpeningMode = before === null ? 'create' : target.date < before.date ? 'move' : 'replace';

  // (1) nothing the account already has may come before the new opening: it would be counted twice, or not at all.
  if (target.amountCents > 0) {
    const early = state.entries
      .filter((entry) => entry.type !== 'opening' && touches(entry, accountId) && entry.date < target.date)
      .sort((a, b) => a.date.localeCompare(b.date) || a.timestamp.localeCompare(b.timestamp))[0];
    if (early) {
      return refuse(accountId, 'conflict', `${describeEntry(early, mask)} is dated before the new opening balance (${target.date}), so it cannot be moved there. Nothing was changed.`);
    }
  }

  // The waiting messages saved in the same step: the oldest one (messages only), and every waiting message older than the opening it replaces,
  // because the entries after it may rely on that money.
  const waiting = suggestions.filter((s) => s.status === 'pending' && s.accountId === accountId);
  const chosen = new Set<string>();
  if (target.basis && target.basis.message.status === 'pending') chosen.add(target.basis.message.id);
  if (target.source === 'messages' && before) {
    for (const s of waiting) if (s.date < before.date) chosen.add(s.id);
  }
  const saves = cleanOrder(waiting.filter((s) => chosen.has(s.id)));
  for (const s of saves) {
    const held = options.held?.get(s.id);
    const named = `${money(s.amount, mask)} on ${s.date}`;
    if (held !== undefined) {
      return refuse(accountId, 'held', `The message of ${named} would be saved with it, but it is waiting for your answer: it could be one side of a transfer between your own accounts. Answer its pair card first.`);
    }
    if (s.flags.includes('total_mismatch')) {
      return refuse(accountId, 'figures', `The message of ${named} would be saved with it, but its amount, charges and total do not add up. Fix it on its card first.`);
    }
    if (target.amountCents > 0 && s.date < target.date) {
      return refuse(accountId, 'undecided', `The message of ${named} is dated before the new opening balance (${target.date}). Type the opening balance instead.`, true);
    }
  }

  // The rows. The opening moves in place (same id) when there is one; entries the owner made are never touched.
  const nowIso = ctx.now().toISOString();
  let openingEntryId: string | null = null;
  let entries = state.entries;
  if (current) {
    entries = entries.flatMap((entry) => {
      if (entry.id !== current.id) return [entry];
      if (target.amountCents === 0) return [];
      openingEntryId = entry.id;
      return [{ ...entry, amount: afterAmount, amountETB: afterAmount, date: target.date, timestamp: startOfDayIso(target.date), note: target.note, updatedAt: nowIso }];
    });
  } else if (target.amountCents > 0) {
    openingEntryId = ctx.newId();
    entries = [
      ...entries,
      {
        id: openingEntryId,
        type: 'opening',
        accountId,
        amount: afterAmount,
        currency: 'ETB',
        amountETB: afterAmount,
        exchangeRate: 1,
        category: '',
        source: '',
        fromAccountId: null,
        toAccountId: null,
        toAmount: null,
        toAmountETB: null,
        linkedTransferId: null,
        date: target.date,
        timestamp: startOfDayIso(target.date),
        note: target.note,
        isAutomatic: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ];
  }
  let next: AccountsState = { ...state, entries };
  const confirmations: OpeningConfirmation[] = [];
  try {
    if (saves.length > 0) {
      const inputs = saves.flatMap((s) => suggestionInputs(s, accountId, categoryOf(s), options.timestampFor?.(s) ?? null));
      const planned = planAddEntries(next, inputs, ctx);
      let at = 0;
      for (const s of saves) {
        confirmations.push({ suggestionId: s.id, entryId: planned.added[at].id });
        at += suggestionInputs(s, accountId, categoryOf(s)).length;
      }
      next = planned.state;
      // (4) an opening change never shrinks a goal.
      const used = planned.reserveUsed.find((row) => row.accountId === accountId && row.shortfall > 0);
      if (used) {
        return refuse(accountId, 'reserved', `This would use ${money(used.shortfall, mask)} of the money reserved for goals in ${account.name}. Nothing was changed.`);
      }
    } else {
      // (3) the ledger as a whole must still be valid.
      const problem = validateEntries(next.entries, next.accounts);
      if (problem) throw problem;
      const used = enforceReserved(next, ctx).reserveUsed.find((row) => row.accountId === accountId && row.shortfall > 0);
      if (used) {
        return refuse(accountId, 'reserved', `This would use ${money(used.shortfall, mask)} of the money reserved for goals in ${account.name}. Nothing was changed.`);
      }
    }
  } catch (error) {
    if (!(error instanceof AccountsError)) throw error;
    return refuse(accountId, 'ledger', `${maskFigures(error.message, mask)} Nothing was changed.`);
  }

  // (2) the balance must still agree with the bank. Not for a brand-new account with nothing in it: its opening comes from the messages.
  const chain = buildChains(suggestions, state.accounts).get(accountId);
  const byId = new Map(suggestions.map((s) => [s.id, s]));
  const newest = chain ? [...chain.ordered].reverse().find((item) => item.balanceAfter !== null && byId.get(item.id)?.status !== 'ignored') : undefined;
  let check: OpeningOffer['check'] = null;
  if (newest && newest.balanceAfter !== null && state.entries.some((entry) => touches(entry, accountId))) {
    const savedIds = new Set(saves.map((s) => s.id));
    const ledgerCents = toCents(getAccountBalances(next.entries.filter((entry) => entry.date <= newest.date), next.accounts)[accountId] ?? 0);
    // Messages still waiting would be saved later: they count, unless they could never be saved (dated before the opening).
    const waitingCents = waiting
      .filter((s) => !savedIds.has(s.id) && s.date <= newest.date && (target.amountCents === 0 || s.date >= target.date))
      .reduce((sum, s) => sum + effectCents(chainItemOf(s, 0) as ChainItem), 0);
    const projected = ledgerCents + waitingCents;
    const service = (byId.get(newest.id) as SmsSuggestion).service;
    if (projected !== toCents(newest.balanceAfter)) {
      return refuse(
        accountId,
        'mismatch',
        [
          `Talari is ${money(fromCents(Math.abs(toCents(newest.balanceAfter) - projected)), mask)} away from your bank's balance on ${newest.date} (it would show ${money(fromCents(projected), mask)}, your ${SERVICE_LABEL[service]} message says ${money(newest.balanceAfter, mask)}), so the opening cannot be moved safely.`,
          ...gapSentences(chain, mask),
        ].join(' '),
      );
    }
    check = { date: newest.date, bankBalance: newest.balanceAfter, service };
  }

  const balances = (list: AccountEntry[]) => getAccountBalances(list, state.accounts)[accountId] ?? 0;
  const basis = target.basis ? { id: target.basis.message.id, service: target.basis.message.service, date: target.basis.item.date } : null;
  const offer: OpeningOffer = {
    kind: 'offer',
    accountId,
    accountName: account.name,
    mode,
    source: target.source,
    after: { date: target.date, amount: afterAmount, note: target.note },
    before,
    balanceNow: balances(state.entries),
    balanceAfter: balances(next.entries),
    saves: saves.map((s) => ({ id: s.id, service: s.service, date: s.date, direction: s.direction, amount: s.amount, fee: chainItemOf(s, 0)?.fees ?? 0 })),
    basis,
    estimatedWarning:
      target.basis && target.basis.item.estimated
        ? `This message's date is only a guess (the day it was imported). The opening would be dated ${target.date}, and entries before it are refused. Set the message's real date first if you know it.`
        : null,
    check,
    typed: target.typed,
  };
  return { offer, state: next, confirmations, openingEntryId };
}

const asProposal = (result: Evaluated | OpeningRefusal): OpeningOffer | OpeningRefusal => ('offer' in result ? result.offer : result);

function fromMessagesTarget(derived: Derived): Target {
  return {
    amountCents: derived.cents,
    date: derived.date,
    note: derived.cents > 0 ? `From the ${SERVICE_LABEL[derived.message.service]} message of ${derived.item.date}` : null,
    source: 'messages',
    basis: derived,
    typed: null,
  };
}

// "Get it from my messages". `explicit` is the owner asking (a refusal is the answer); otherwise it is the quiet card, which shows only when
// there is something to say: an account with no opening entry that has messages, or messages older than the opening it has.
export function proposeFromMessages(state: AccountsState, suggestions: SmsSuggestion[], accountId: string, options: OpeningOptions = {}, explicit = true): OpeningProposal {
  const mask = options.mask ?? identity;
  const account = eligibleAccounts(state.accounts).find((item) => item.id === accountId);
  if (!account) {
    return explicit ? refuse(accountId, 'no_account', 'Only an ETB account that is not archived has messages.') : { kind: 'none' };
  }
  const opening = state.entries.find((entry) => entry.type === 'opening' && entry.accountId === accountId) ?? null;
  const derived = derive(state, suggestions, accountId, mask);
  if (!explicit) {
    const chain = buildChains(suggestions, state.accounts).get(accountId);
    if (!chain || chain.ordered.length === 0) return { kind: 'none' };
    // With an opening, only messages older than it make a card.
    if (opening && !chain.ordered.some((item) => item.date < opening.date)) return { kind: 'none' };
  }
  if ('kind' in derived) {
    return derived;
  }
  // No opening, and the account started empty: there is nothing to create; the message imports normally.
  if (!explicit && !opening && derived.cents === 0) {
    return { kind: 'none' };
  }
  const result = asProposal(evaluate(state, suggestions, accountId, fromMessagesTarget(derived), options));
  // The quiet card says nothing when the opening is already what the messages give.
  if (!explicit && result.kind === 'refused' && result.code === 'same') return { kind: 'none' };
  return result;
}

// "Type it": the owner types the amount and the day. Zero removes the opening. Saves no messages.
export function proposeTyped(state: AccountsState, suggestions: SmsSuggestion[], accountId: string, input: { amount: number; date: string }, options: OpeningOptions = {}): OpeningProposal {
  const ctx = options.ctx ?? defaultCtx;
  if (!Number.isFinite(input.amount) || toCents(input.amount) < 0) {
    return refuse(accountId, 'invalid', 'Enter an amount that is zero or more.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(Date.parse(`${input.date}T00:00:00Z`))) {
    return refuse(accountId, 'invalid', 'Choose the day the opening balance is for.');
  }
  if (input.date > todayOf(ctx)) {
    return refuse(accountId, 'invalid', 'The opening balance cannot be dated in the future.');
  }
  const cents = toCents(input.amount);
  return asProposal(evaluate(state, suggestions, accountId, { amountCents: cents, date: input.date, note: null, source: 'typed', basis: null, typed: { amount: fromCents(cents), date: input.date } }, options));
}

const sameOffer = (a: OpeningOffer, b: OpeningOffer): boolean =>
  a.mode === b.mode &&
  a.after.date === b.after.date &&
  toCents(a.after.amount) === toCents(b.after.amount) &&
  (a.before === null ? b.before === null : b.before !== null && a.before.date === b.before.date && toCents(a.before.amount) === toCents(b.before.amount)) &&
  a.saves.map((s) => s.id).join() === b.saves.map((s) => s.id).join() &&
  toCents(a.balanceNow) === toCents(b.balanceNow) &&
  toCents(a.balanceAfter) === toCents(b.balanceAfter);

// What Confirm does: the change is worked out AGAIN from the ledger and messages as they are now and must still be the one that was shown.
// Throws an AccountsError, with nothing written by anyone, if it is refused or no longer the same.
export function planOpeningChange(state: AccountsState, suggestions: SmsSuggestion[], shown: OpeningOffer, options: OpeningOptions = {}): OpeningPlan {
  const target =
    shown.source === 'typed' && shown.typed
      ? ({ amountCents: toCents(shown.typed.amount), date: shown.typed.date, note: null, source: 'typed', basis: null, typed: shown.typed } as Target)
      : (() => {
          const derived = derive(state, suggestions, shown.accountId, options.mask ?? identity);
          return 'kind' in derived ? derived : fromMessagesTarget(derived);
        })();
  if ('kind' in target) {
    throw new AccountsError('INVALID_ENTRY', target.message);
  }
  const fresh = evaluate(state, suggestions, shown.accountId, target, options);
  if (!('offer' in fresh)) {
    throw new AccountsError('INVALID_ENTRY', fresh.message);
  }
  if (!sameOffer(shown, fresh.offer)) {
    throw new AccountsError('INVALID_ENTRY', 'Things changed since you looked. Nothing was changed; look at the new numbers and try again.');
  }
  return { state: fresh.state, openingEntryId: fresh.openingEntryId, confirmations: fresh.confirmations, offer: fresh.offer };
}

// The quiet cards: one proposal per account that has something to say (an offer, or a refusal the owner should read), keyed by account id.
export function openingCards(state: AccountsState, suggestions: SmsSuggestion[], options: OpeningOptions = {}): Map<string, OpeningOffer | OpeningRefusal> {
  const cards = new Map<string, OpeningOffer | OpeningRefusal>();
  for (const account of eligibleAccounts(state.accounts)) {
    const proposal = proposeFromMessages(state, suggestions, account.id, options, false);
    // A refusal is only shown quietly when it asks the owner to type the opening; a conflict or a mismatch appears when they ask.
    if (proposal.kind === 'offer' || (proposal.kind === 'refused' && proposal.askToType)) {
      cards.set(account.id, proposal);
    }
  }
  return cards;
}

// The "balance doesn't match your bank" banner steps aside while an account has no opening entry and the opening card is showing: the opening is
// the explanation, and an adjustment must not stand in for it.
export function reconcileSuppressed(state: AccountsState, accountId: string, cards: ReadonlyMap<string, unknown>): boolean {
  return cards.has(accountId) && !state.entries.some((entry) => entry.type === 'opening' && entry.accountId === accountId);
}
