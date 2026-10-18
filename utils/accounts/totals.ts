import { BASE_CURRENCY, RATE_STALE_AFTER_DAYS } from '../../constants/accounts';
import { AccountEntry, AccountsState, GoalAllocation, MoneyAccount } from '../../types/accounts';
import { addDays, toLocalDateKey } from '../dates';
import { getAccountBalances } from './balances';
import { fromCents, round2, toCents } from './money';
import { getReservedByAccount } from './reserve';

const DAY_MS = 86400000;

export interface AccountSummary {
  account: MoneyAccount;
  // In the account's own currency.
  balance: number;
  // ETB value at today's stored rate. Null when a foreign account has no stored rate and so cannot be valued.
  valueETB: number | null;
  reserved: number;
  freeToSpend: number;
  rate: number | null;
  rateUpdatedAt: string | null;
  // Whole days since the rate was updated (foreign accounts only).
  rateAgeDays: number | null;
  rateIsStale: boolean;
}

export interface TotalsSummary {
  accounts: AccountSummary[];
  // ETB. Accounts that cannot be valued are left out and listed in unvaluedAccountIds; the UI must say so.
  total: number;
  unvaluedAccountIds: string[];
  // Foreign currencies whose rate is older than RATE_STALE_AFTER_DAYS ("Rate last updated X days ago").
  staleRates: Array<{ currency: string; ageDays: number }>;
}

// V2_SPEC Part C: Total = SUM(account balance x today's rate to ETB). A rate change therefore moves Total without any ledger entry.
// Reserved goal money is already inside its account's balance and is not added again.
export function getTotals(state: AccountsState, now: Date = new Date()): TotalsSummary {
  const balances = getAccountBalances(state.entries, state.accounts);
  const reserved = getReservedByAccount(state.allocations);
  const summaries: AccountSummary[] = [];
  const unvalued: string[] = [];
  const stale = new Map<string, number>();
  let totalCents = 0;

  for (const account of state.accounts.filter((item) => !item.archived)) {
    const balance = balances[account.id] ?? 0;
    const reservedHere = reserved[account.id] ?? 0;
    let rate: number | null = 1;
    let rateUpdatedAt: string | null = null;
    let ageDays: number | null = null;
    let isStale = false;

    if (account.currency !== BASE_CURRENCY) {
      const row = state.rates.find((item) => item.fromCurrency === account.currency && item.toCurrency === BASE_CURRENCY);
      rate = row && Number.isFinite(row.rate) && row.rate > 0 ? row.rate : null;
      rateUpdatedAt = row?.updatedAt ?? null;
      if (rate !== null && rateUpdatedAt) {
        const age = now.getTime() - Date.parse(rateUpdatedAt);
        ageDays = Math.max(Math.floor(age / DAY_MS), 0);
        isStale = age > RATE_STALE_AFTER_DAYS * DAY_MS;
        if (isStale) {
          stale.set(account.currency, ageDays);
        }
      }
    }

    const valueETB = rate === null ? null : round2(balance * rate);
    if (valueETB === null) {
      unvalued.push(account.id);
    } else {
      totalCents += toCents(valueETB);
    }

    summaries.push({
      account,
      balance,
      valueETB,
      reserved: reservedHere,
      freeToSpend: fromCents(toCents(balance) - toCents(reservedHere)),
      rate,
      rateUpdatedAt,
      rateAgeDays: ageDays,
      rateIsStale: isStale,
    });
  }

  return {
    accounts: summaries,
    total: fromCents(totalCents),
    unvaluedAccountIds: unvalued,
    staleRates: Array.from(stale, ([currency, ageDays]) => ({ currency, ageDays })),
  };
}

// Income and expense maths use amountETB only (V2_SPEC Part D). opening / adjustment / transfer rows are different kinds, so they are
// never in these sums; a transfer's fee is an ordinary expense row (category Fees) and does count.
function inMonth(entry: AccountEntry, monthPrefix: string): boolean {
  return entry.date.startsWith(monthPrefix);
}

function sumETB(entries: AccountEntry[]): number {
  return fromCents(entries.reduce((cents, entry) => cents + toCents(entry.amountETB), 0));
}

export function getPeriodSummary(entries: AccountEntry[], monthPrefix: string): { income: number; expenses: number; net: number } {
  const rows = entries.filter((entry) => inMonth(entry, monthPrefix));
  const income = sumETB(rows.filter((entry) => entry.type === 'income'));
  const expenses = sumETB(rows.filter((entry) => entry.type === 'expense'));
  return { income, expenses, net: round2(income - expenses) };
}

export function getCategoryTotals(entries: AccountEntry[], monthPrefix: string, type: 'income' | 'expense'): Record<string, number> {
  const cents = new Map<string, number>();
  for (const entry of entries) {
    if (entry.type === type && inMonth(entry, monthPrefix)) {
      cents.set(entry.category, (cents.get(entry.category) ?? 0) + toCents(entry.amountETB));
    }
  }
  return Object.fromEntries(Array.from(cents, ([category, value]) => [category, fromCents(value)]));
}

// The monthly "savings" figure: the net change in reserved goal money in the period (adds minus withdrawals, including the
// automatic reductions). It replaces the old "net change in Saved + Goals" (V2_SPEC Part R).
export function getNetSavingsChange(allocations: GoalAllocation[], monthPrefix: string): number {
  return fromCents(allocations.filter((row) => row.date.startsWith(monthPrefix)).reduce((sum, row) => sum + toCents(row.amount), 0));
}

// Days on which the owner recorded something (V2_SPEC Part N). Counts: income, expense, transfer and manual goal adds/withdrawals.
// Does not count: opening, adjustment, automatic reductions, recurring-generated rows, or a fee (its transfer already counts).
export function getActivityDays(entries: AccountEntry[], allocations: GoalAllocation[]): Set<string> {
  const days = new Set<string>();
  for (const entry of entries) {
    const recorded = entry.type === 'income' || entry.type === 'expense' || entry.type === 'transfer';
    if (recorded && !entry.isAutomatic && entry.linkedTransferId === null) {
      days.add(entry.date);
    }
  }
  for (const row of allocations) {
    if (row.kind === 'manual') {
      days.add(row.date);
    }
  }
  return days;
}

export function calculateStreak(entries: AccountEntry[], allocations: GoalAllocation[], today: Date = new Date()): number {
  const days = getActivityDays(entries, allocations);
  if (days.size === 0) {
    return 0;
  }
  let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // Today may not be logged yet; the streak is still alive if yesterday was.
  if (!days.has(toLocalDateKey(cursor))) {
    cursor = addDays(cursor, -1);
  }
  let streak = 0;
  while (days.has(toLocalDateKey(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}
