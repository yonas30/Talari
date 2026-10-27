import { AccountsState } from '../../types/accounts';
import { SmsSuggestion } from '../../types/sms';
import { Ctx, defaultCtx, todayOf } from '../accounts/context';
import { AccountsError } from '../accounts/errors';
import { planAddEntries } from '../accounts/entries';
import { getAccountBalances } from '../accounts/balances';
import { fromCents, toCents } from '../accounts/money';
import { WriteResult } from '../accounts/reserve';
import { eligibleAccounts, SERVICE_LABEL } from './accountMatch';
import { buildChains, LikelyGap, likelyGaps } from './chain';
import { beforeOpeningProblem } from './saveSuggestion';
import { SmsService } from './types';

// "Your balance doesn't match your bank" (V2_SPEC Part Z, Phase 6C-2). Pure.

export interface ReconcileStatus {
  accountId: string;
  // The newest message that prints a balance, and that balance.
  messageId: string;
  rawHash: string;
  service: SmsService;
  date: string;
  bankBalance: number;
  // What Talari has for the account as of that message's DAY (every entry dated on or before it).
  talariBalance: number;
  // Bank minus Talari. Positive: the bank has more than Talari. This is the adjustment that would make them agree.
  difference: number;
  // The two largest gaps in the account's message chain: where the difference most likely comes from (may be empty).
  gaps: LikelyGap[];
}

// Compares the newest message's balance with Talari's, or returns null when there is nothing to say: no such message, the newest one has not
// been imported yet (a newer message still waiting, or skipped, would make the comparison unfair), the balances agree to the cent, or the
// owner dismissed this message's mismatch.
export function reconcileStatus(state: AccountsState, suggestions: SmsSuggestion[], accountId: string, dismissedHash: string | null): ReconcileStatus | null {
  if (!eligibleAccounts(state.accounts).some((account) => account.id === accountId)) {
    return null;
  }
  const chain = buildChains(suggestions, state.accounts).get(accountId);
  if (!chain) {
    return null;
  }
  const withBalance = chain.ordered.filter((item) => item.balanceAfter !== null);
  const newest = withBalance[withBalance.length - 1];
  const message = newest ? suggestions.find((s) => s.id === newest.id) : undefined;
  if (!newest || !message || message.status !== 'confirmed' || newest.balanceAfter === null) {
    return null;
  }
  // Anything newer WITHOUT a balance that is still waiting also makes it unfair.
  const newerWaiting = chain.ordered.slice(chain.ordered.indexOf(newest) + 1).some((item) => suggestions.find((s) => s.id === item.id)?.status !== 'confirmed');
  if (newerWaiting) {
    return null;
  }
  if (dismissedHash !== null && dismissedHash === message.rawHash) {
    return null;
  }
  const talari = getAccountBalances(
    state.entries.filter((entry) => entry.date <= newest.date),
    state.accounts,
  )[accountId] ?? 0;
  const difference = toCents(newest.balanceAfter) - toCents(talari);
  if (difference === 0) {
    return null;
  }
  return {
    accountId,
    messageId: message.id,
    rawHash: message.rawHash,
    service: message.service,
    date: newest.date,
    bankBalance: newest.balanceAfter,
    talariBalance: fromCents(toCents(talari)),
    difference: fromCents(difference),
    gaps: likelyGaps(chain),
  };
}

export interface AdjustmentOptions {
  // The day the adjustment is for. Default: the newest message's day.
  date?: string;
  // What it was, in the owner's words (optional, kept short).
  note?: string | null;
}

export const MAX_ADJUSTMENT_NOTE = 120;

// "Add adjustment": ONE adjustment entry for the difference, on the chosen day (default the message's day), noted with the owner's text and the
// message it matches. It follows the usual rules: not before the account's opening balance, not in the future, and (through the ledger check) it
// cannot take an account below zero on any day. Throws an AccountsError, writing nothing, when it cannot be added.
export function planReconcileAdjustment(state: AccountsState, status: ReconcileStatus, options: AdjustmentOptions = {}, ctx: Ctx = defaultCtx): WriteResult & { adjustmentId: string } {
  const date = options.date ?? status.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new AccountsError('INVALID_ENTRY', 'Choose the day for the adjustment.');
  }
  if (date > todayOf(ctx)) {
    throw new AccountsError('INVALID_ENTRY', 'An adjustment cannot be dated in the future.');
  }
  const early = beforeOpeningProblem(state, status.accountId, date);
  if (early) {
    throw early;
  }
  const matches = `To match the ${SERVICE_LABEL[status.service]} message of ${status.date}`;
  const typed = (options.note ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_ADJUSTMENT_NOTE);
  const planned = planAddEntries(state, [{ type: 'adjustment', accountId: status.accountId, amount: status.difference, date, note: typed === '' ? matches : `${typed} · ${matches.charAt(0).toLowerCase()}${matches.slice(1)}` }], ctx);
  return { ...planned, adjustmentId: planned.added[0].id };
}
