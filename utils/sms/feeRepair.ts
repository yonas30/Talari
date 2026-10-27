import { FEES_CATEGORY } from '../../constants/categories';
import { AccountEntry, AccountsState } from '../../types/accounts';
import { SmsSuggestion } from '../../types/sms';
import { Ctx, defaultCtx } from '../accounts/context';
import { planEditEntry } from '../accounts/entries';
import { AccountsError } from '../accounts/errors';
import { formatAmount, fromCents, toCents } from '../accounts/money';
import { effectiveFee, printedCharges } from './saveSuggestion';

// Repairing "a fee counted twice" (V2_SPEC Part Z). An earlier version saved a message that printed the TOTAL debited as its amount with that
// total as the entry's amount AND the charges again as a separate Fees expense, so the account is lower than the bank by the fee. Pure.

export interface FeeRepairItem {
  suggestionId: string;
  // The expense that holds the total, and the Fees expense saved beside it.
  entryId: string;
  feeEntryId: string;
  accountId: string;
  date: string;
  currentAmount: number;
  // The total minus the fee entry's amount: what went to the other party.
  newAmount: number;
  // What the account goes up by (the fee entry's amount).
  fee: number;
}

// The entry and its fee were made by one save, a few milliseconds apart at most (two rows, two clock readings). Anything further apart is
// not "the fee saved with it".
const SAVED_TOGETHER_MS = 10_000;
const isEdited = (entry: AccountEntry): boolean => entry.updatedAt !== entry.createdAt;

// Every entry that matches ALL of the conditions (nothing is guessed: if the entry cannot be tied to exactly one fee entry it is left out, and
// the owner can still correct it by hand):
//  - a CONFIRMED message whose printed amount equals its printed total, with charges above zero;
//  - the entry it was saved as still exists, is an expense, and still has that total as its amount;
//  - exactly one fee entry saved with it: same account and date, category Fees, not linked to a transfer, created together with it, a note that
//    starts with "Fee", and the amount that was saved as the fee;
//  - neither the entry nor the fee entry has been edited since it was saved.
// A transfer (a pair), a deleted entry, an entry the owner changed and an entry that is already right never match.
export function findFeeCountedTwice(state: AccountsState, suggestions: SmsSuggestion[]): FeeRepairItem[] {
  const entries = new Map(state.entries.map((entry) => [entry.id, entry]));
  const usableAccounts = new Set(state.accounts.filter((account) => !account.archived && account.currency === 'ETB').map((account) => account.id));
  const claimed = new Set<string>();
  const items: FeeRepairItem[] = [];

  for (const s of suggestions) {
    if (s.status !== 'confirmed' || s.confirmedEntryId === null || s.direction !== 'out' || s.totalDeducted === null) continue;
    if (toCents(s.amount) !== toCents(s.totalDeducted) || toCents(printedCharges(s)) <= 0) continue;
    const entry = entries.get(s.confirmedEntryId);
    if (!entry || entry.type !== 'expense' || entry.accountId === null || !usableAccounts.has(entry.accountId)) continue;
    if (toCents(entry.amount) !== toCents(s.totalDeducted) || isEdited(entry)) continue;

    const fee = effectiveFee(s);
    if (toCents(fee) <= 0) continue;
    const candidates = state.entries.filter(
      (other) =>
        other.type === 'expense' &&
        other.category === FEES_CATEGORY.name &&
        other.linkedTransferId === null &&
        other.accountId === entry.accountId &&
        other.date === entry.date &&
        toCents(other.amount) === toCents(fee) &&
        (other.note ?? '').startsWith('Fee') &&
        !isEdited(other) &&
        Math.abs(Date.parse(other.createdAt) - Date.parse(entry.createdAt)) <= SAVED_TOGETHER_MS,
    );
    if (candidates.length === 0) continue;
    // The nearest in time is the one saved with it; if two are equally near we cannot tell, so nothing is offered.
    const distance = (other: AccountEntry) => Math.abs(Date.parse(other.createdAt) - Date.parse(entry.createdAt));
    const nearest = Math.min(...candidates.map(distance));
    const best = candidates.filter((other) => distance(other) === nearest);
    if (best.length !== 1 || claimed.has(best[0].id)) continue;

    const newAmount = fromCents(toCents(entry.amount) - toCents(best[0].amount));
    if (newAmount <= 0) continue;
    claimed.add(best[0].id);
    items.push({ suggestionId: s.id, entryId: entry.id, feeEntryId: best[0].id, accountId: entry.accountId, date: entry.date, currentAmount: entry.amount, newAmount, fee: best[0].amount });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.entryId.localeCompare(b.entryId));
}

// "ETB 3,001.20 → ETB 3,000.00; your CBE balance goes up by ETB 1.20". `mask` hides each amount while balances are hidden.
export function repairLine(item: FeeRepairItem, accountName: string, mask: (text: string) => string = (text) => text): string {
  return `${mask(`ETB ${formatAmount(item.currentAmount)}`)} → ${mask(`ETB ${formatAmount(item.newAmount)}`)}; your ${accountName} balance goes up by ${mask(`ETB ${formatAmount(item.fee)}`)}`;
}

export interface RepairEffect {
  byAccount: Array<{ accountId: string; name: string; change: number }>;
  total: number;
}

// What fixing these will do to each account: it goes up by the fee of each entry.
export function repairEffect(state: AccountsState, items: FeeRepairItem[]): RepairEffect {
  const byAccount = new Map<string, number>();
  for (const item of items) {
    byAccount.set(item.accountId, (byAccount.get(item.accountId) ?? 0) + toCents(item.fee));
  }
  const rows = [...byAccount].map(([accountId, cents]) => ({ accountId, name: state.accounts.find((account) => account.id === accountId)?.name ?? 'Account', change: fromCents(cents) }));
  return { byAccount: rows, total: fromCents([...byAccount.values()].reduce((sum, cents) => sum + cents, 0)) };
}

export interface FeeRepairPlan {
  // The whole ledger after the fixes. Written in ONE database transaction by the caller, so Fix all is all or nothing.
  state: AccountsState;
  fixed: FeeRepairItem[];
}

// Fixes the given entries, and ONLY their amount, through the normal edit (so the whole ledger is validated). Checked again here, against the
// ledger as it is now: if any listed entry no longer matches (it was edited, deleted or fixed since the list was shown) nothing at all is
// changed and an AccountsError says so. Throws before anything is written, so it is all or nothing.
export function planFeeRepair(state: AccountsState, suggestions: SmsSuggestion[], entryIds: string[], ctx: Ctx = defaultCtx): FeeRepairPlan {
  const current = new Map(findFeeCountedTwice(state, suggestions).map((item) => [item.entryId, item]));
  const fixed: FeeRepairItem[] = [];
  for (const id of entryIds) {
    const item = current.get(id);
    if (!item) {
      throw new AccountsError('INVALID_ENTRY', 'This entry no longer needs the repair (it was changed, deleted or already fixed). Nothing was changed.');
    }
    fixed.push(item);
  }
  let next = state;
  for (const item of fixed) {
    const entry = next.entries.find((candidate) => candidate.id === item.entryId) as AccountEntry;
    // Everything else about the entry is passed back as it is: its date (so its date source stays), category, source and note. The time stays
    // because an edit never moves it. Only the amount changes.
    next = planEditEntry(
      next,
      item.entryId,
      { type: 'expense', accountId: entry.accountId as string, amount: item.newAmount, currency: entry.currency, category: entry.category, source: entry.source, date: entry.date, note: entry.note },
      ctx,
    ).state;
  }
  return { state: next, fixed };
}
