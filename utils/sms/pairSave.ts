import { AccountEntry, AccountsState, DateSource } from '../../types/accounts';
import { getAccountBalances } from '../accounts/balances';
import { SmsSuggestion } from '../../types/sms';
import { Ctx, defaultCtx } from '../accounts/context';
import { EntryInput, planAddEntries, planEditEntry } from '../accounts/entries';
import { AccountsError } from '../accounts/errors';
import { formatAmount } from '../accounts/money';
import { WriteResult } from '../accounts/reserve';
import { timestampFromOccurredAt } from './dateSource';
import { decidePairDate, findPairs, PairCandidate, PairDate } from './pairing';
import { beforeOpeningProblem, effectiveFee } from './saveSuggestion';

// Saving a pair (V2_SPEC Part Z, Phase 6C-1). Pure: it PLANS the save, and the caller writes the plan in one database transaction
// (db/smsRepo.ts commitPairSave). Nothing here records anything by itself.

export type PairMode = 'new' | 'convert';

export interface PairWarning {
  kind: 'dates_disagree' | 'reserved';
  message: string;
}

export interface PairSavePlan {
  // The whole resulting ledger: the transfer, its linked fee, and any goal shrink with its notification.
  result: WriteResult & { added?: AccountEntry[] };
  transferId: string;
  feeEntryId: string | null;
  decided: PairDate;
  confirmation: {
    suggestions: Array<{ id: string; date: string; dateSource: DateSource; pairedWithId: string | null }>;
    entryId: string;
  };
}

const accountName = (state: AccountsState, id: string): string => state.accounts.find((account) => account.id === id)?.name ?? 'the account';

// The fee the outgoing message printed (fee + VAT + any other charge, as edited on its card). An existing entry as the outgoing side has none.
function feeOf(candidate: PairCandidate, suggestions: SmsSuggestion[]): number {
  if (candidate.out.kind !== 'suggestion') {
    return 0;
  }
  const s = suggestions.find((item) => item.id === candidate.out.id);
  return s ? effectiveFee(s) : 0;
}

// The pair as it is NOW. A candidate shown earlier may be stale (a message was saved, an entry changed), so every save starts from this.
function freshCandidate(state: AccountsState, suggestions: SmsSuggestion[], key: string, ownNames: readonly string[]): PairCandidate {
  const fresh = findPairs(state, suggestions, new Set(), ownNames).find((candidate) => candidate.key === key);
  if (!fresh) {
    throw new AccountsError('INVALID_ENTRY', 'These messages no longer look like one transfer, so nothing was saved.');
  }
  return fresh;
}

export interface PairSaveOptions {
  // The fee the owner typed on the card, replacing the one worked out (the difference of an entry that includes its fee, or the one the
  // sending message printed). null / undefined: use the worked-out one.
  fee?: number | null;
  // The owner's own names (Phase 6D-3), so a pair found by rule 3 is found again at the moment of saving.
  ownNames?: readonly string[];
}

const AMBIGUOUS_MESSAGE = 'More than one of your entries could be this movement, so none is offered: converting the wrong one would record a different movement as a transfer. Remove or change the extra one first.';

export function planPairSave(state: AccountsState, key: string, suggestions: SmsSuggestion[], mode: PairMode, ctx: Ctx = defaultCtx, options: PairSaveOptions = {}): PairSavePlan {
  const candidate = freshCandidate(state, suggestions, key, options.ownNames ?? []);
  if (candidate.ambiguousEntryIds.length > 1) {
    throw new AccountsError('INVALID_ENTRY', AMBIGUOUS_MESSAGE);
  }
  const { out, inn } = candidate;
  const existingId = candidate.existingEntryId;

  if (mode === 'convert' && existingId === null) {
    throw new AccountsError('INVALID_ENTRY', 'There is no existing entry to convert.');
  }
  // A side that is already an entry would be recorded twice by a NEW transfer. (If the entry only duplicates a message the owner may
  // still choose "add as new", and is warned.)
  if (mode === 'new' && existingId !== null && !candidate.existingDuplicatesAMessage) {
    throw new AccountsError('INVALID_ENTRY', 'One side of this is already in your entries. Convert that entry instead: a new transfer would record it twice.');
  }

  const decided = decidePairDate(out, inn);
  for (const side of [out, inn]) {
    const early = beforeOpeningProblem(state, side.accountId, decided.date);
    if (early) {
      // The same block as for a single message, naming the account because there are two.
      throw new AccountsError('BEFORE_OPENING', `${early.message.replace(/\.$/, '')} (${accountName(state, side.accountId)}).`);
    }
  }

  const worked = candidate.feeFromEntry > 0 ? candidate.feeFromEntry : feeOf(candidate, suggestions);
  const fee = options.fee !== undefined && options.fee !== null && Number.isFinite(options.fee) && options.fee >= 0 ? options.fee : worked;
  const timestamp = decided.from.kind === 'suggestion' && decided.source === 'message' ? timestampFromOccurredAt(decided.from.occurredAt) : null;
  const input: EntryInput = {
    type: 'transfer',
    fromAccountId: candidate.fromAccountId,
    toAccountId: candidate.toAccountId,
    fromAmount: candidate.amount,
    toAmount: candidate.amount,
    fee: fee > 0 ? { amount: fee, currency: 'ETB' } : null,
    date: decided.date,
    note: null,
    dateSource: decided.source,
    timestamp,
  };

  let result: PairSavePlan['result'];
  let transferId: string;
  if (mode === 'new') {
    const planned = planAddEntries(state, [input], ctx);
    result = planned;
    transferId = planned.added[0].id;
  } else {
    result = planEditEntry(state, existingId as string, input, ctx);
    transferId = existingId as string;
    // A conversion changes an entry that is already counted. If it would eat into money reserved for goals it is refused rather than
    // quietly shrinking a goal (a NEW transfer only warns, as any spending does).
    const used = result.reserveUsed.find((row) => row.shortfall > 0);
    if (used) {
      throw new AccountsError(
        'INVALID_ENTRY',
        `Converting your entry would use ETB ${formatAmount(used.shortfall)} of the ETB ${formatAmount(used.reservedBefore)} reserved for goals in ${accountName(state, used.accountId)}. Nothing was changed.`,
      );
    }
  }
  const feeRow = result.state.entries.find((entry) => entry.linkedTransferId === transferId) ?? null;

  const sideId = (side: typeof out) => side.id;
  const suggestionsOf = [out, inn].filter((side) => side.kind === 'suggestion');
  const confirmation = {
    suggestions: suggestionsOf.map((side) => {
      const other = side === out ? inn : out;
      const upgraded = decided.upgraded.includes(side);
      return {
        id: side.id,
        date: upgraded ? decided.date : side.date,
        dateSource: upgraded ? ('paired' as const) : side.dateSource,
        pairedWithId: sideId(other),
      };
    }),
    entryId: transferId,
  };
  return { result, transferId, feeEntryId: feeRow?.id ?? null, decided, confirmation };
}

// "Your CBE balance will go up by ETB 7.00." / "...go down by..." / "...will not change.". Cents of floating-point dust count as no change.
export function feeEffectText(accountName: string, change: number): string {
  const cents = Math.round(change * 100);
  if (cents === 0) return `Your ${accountName} balance will not change.`;
  return `Your ${accountName} balance will go ${cents > 0 ? 'up' : 'down'} by ETB ${formatAmount(Math.abs(cents) / 100)}.`;
}

// A fee typed on the card counts only if it is a real, non-negative number.
const typedFee = (options: PairSaveOptions): number | null =>
  options.fee !== undefined && options.fee !== null && Number.isFinite(options.fee) && options.fee >= 0 ? options.fee : null;

export interface PairCheck {
  decided: PairDate;
  fee: number;
  warnings: PairWarning[];
  // Adding a NEW transfer: allowed unless this says why not (and not offered at all when a side is already an entry).
  canAddNew: boolean;
  newBlocked: string | null;
  // Converting the existing entry: offered only when there is one.
  canConvert: boolean;
  convertBlocked: string | null;
  // What converting will change, in plain words.
  changes: string[];
  // What saving does to the SENDING account's balance with the fee as typed, in words: updated as the owner types. null when saving is refused.
  feeEffect: { change: number; text: string } | null;
  // An entry that includes its fee: what it is, what moves, and the difference that becomes the fee. null when there is none.
  feeDifference: { entry: number; transfer: number; difference: number } | null;
  // Why nothing is offered although two messages (or a message and an entry) match: more than one of the owner's entries could be one side.
  ambiguous: string | null;
  // The entry it would convert.
  existingEntry: AccountEntry | null;
}

// What the pair card says, by PLANNING each way of saving without writing anything, so it can never disagree with what Accept does.
export function checkPair(state: AccountsState, key: string, suggestions: SmsSuggestion[], ctx: Ctx = defaultCtx, options: PairSaveOptions = {}): PairCheck {
  const candidate = freshCandidate(state, suggestions, key, options.ownNames ?? []);
  const decided = decidePairDate(candidate.out, candidate.inn);
  const warnings: PairWarning[] = [];
  if (decided.disagrees) {
    warnings.push({ kind: 'dates_disagree', message: 'The dates disagree: the receipt date is more than a day from the date of the other message. The date of the better source is used.' });
  }
  const existing = candidate.existingEntryId ? (state.entries.find((entry) => entry.id === candidate.existingEntryId) ?? null) : null;
  if (candidate.ambiguousEntryIds.length > 1) {
    return {
      decided, fee: feeOf(candidate, suggestions), warnings, canAddNew: false, newBlocked: AMBIGUOUS_MESSAGE, canConvert: false, convertBlocked: AMBIGUOUS_MESSAGE,
      changes: [], feeDifference: null, feeEffect: null, ambiguous: AMBIGUOUS_MESSAGE, existingEntry: null,
    };
  }

  let canAddNew = existing === null || candidate.existingDuplicatesAMessage;
  let newBlocked: string | null = null;
  let newPlan: PairSavePlan | null = null;
  let convertPlan: PairSavePlan | null = null;
  if (canAddNew) {
    try {
      const plan = planPairSave(state, key, suggestions, 'new', ctx, options);
      newPlan = plan;
      const used = plan.result.reserveUsed.find((row) => row.shortfall > 0);
      if (used) {
        warnings.push({
          kind: 'reserved',
          message: `This uses ETB ${formatAmount(used.shortfall)} of the ETB ${formatAmount(used.reservedBefore)} reserved for goals in ${accountName(state, used.accountId)}.`,
        });
      }
    } catch (error) {
      if (!(error instanceof AccountsError)) throw error;
      canAddNew = false;
      newBlocked = error.message;
    }
  }

  let canConvert = false;
  let convertBlocked: string | null = null;
  const changes: string[] = [];
  if (existing) {
    try {
      convertPlan = planPairSave(state, key, suggestions, 'convert', ctx, options);
      canConvert = true;
    } catch (error) {
      if (!(error instanceof AccountsError)) throw error;
      convertBlocked = error.message;
    }
    const from = accountName(state, candidate.fromAccountId);
    const to = accountName(state, candidate.toAccountId);
    const other = existing.accountId === candidate.fromAccountId ? to : from;
    const otherSign = existing.accountId === candidate.fromAccountId ? '+' : '−';
    if (candidate.feeFromEntry > 0) {
      changes.push(`Your entry is ETB ${formatAmount(existing.amount)}. The transfer is ETB ${formatAmount(candidate.amount)}. The difference ETB ${formatAmount(candidate.feeFromEntry)} becomes the fee.`);
    }
    changes.push(`Your ${existing.type === 'expense' ? 'expense' : 'income'} of ETB ${formatAmount(existing.amount)} in ${accountName(state, existing.accountId as string)} on ${existing.date} becomes a transfer from ${from} to ${to}${candidate.feeFromEntry > 0 ? ` of ETB ${formatAmount(candidate.amount)}, with a fee of ETB ${formatAmount(candidate.feeFromEntry)}` : ''}.`);
    if (existing.date !== decided.date) changes.push(`Its date changes from ${existing.date} to ${decided.date}.`);
    changes.push(`${other} changes by ${otherSign}ETB ${formatAmount(candidate.amount)}; ${accountName(state, existing.accountId as string)} stays as it is.`);
    changes.push('It stops counting as income or spending, because it is a move between your own accounts.');
  }

  const feeDifference = existing && candidate.feeFromEntry > 0 ? { entry: existing.amount, transfer: candidate.amount, difference: candidate.feeFromEntry } : null;
  const worked = candidate.feeFromEntry > 0 ? candidate.feeFromEntry : feeOf(candidate, suggestions);
  const fee = typedFee(options) ?? worked;
  // What the owner will get: converting if there is an entry to convert, otherwise a new transfer. Worked out by PLANNING it with the fee as
  // typed, so the line on the card is exactly what saving does.
  const primary = existing ? convertPlan : newPlan;
  const before = getAccountBalances(state.entries, state.accounts)[candidate.fromAccountId] ?? 0;
  const after = primary ? (getAccountBalances(primary.result.state.entries, primary.result.state.accounts)[candidate.fromAccountId] ?? 0) : null;
  const change = after === null ? null : Math.round((after - before) * 100) / 100;
  const feeEffect = change === null ? null : { change, text: feeEffectText(accountName(state, candidate.fromAccountId), change) };
  return { decided, fee, warnings, canAddNew, newBlocked, canConvert, convertBlocked, changes, feeDifference, feeEffect, ambiguous: null, existingEntry: existing };
}
