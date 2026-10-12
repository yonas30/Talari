import { TransactionType } from '../types';
import { formatETB, formatNumber } from './format';

// Pure presentation rules for the Home screen. Nothing here calculates money: balances, monthly totals and the category
// breakdown still come from the existing selectors (utils/balances, utils/currency, utils/reports); this file only decides how
// those numbers are grouped, rounded for display, signed and when a line is shown. Kept free of React Native so
// scripts/verify-home.ts can check it.

// ---- spending: top 3 + Others, percentages that add up to exactly 100 -----------------------------------------------------
export const TOP_CATEGORIES = 3;

export interface SpendingInput {
  /** Category name, as stored on the transactions. */
  label: string;
  amount: number;
  /** The colour the existing breakdown gave this category (shared with Insights). */
  color?: string;
}

export interface SpendingSlice {
  /** Stable React key. */
  key: string;
  label: string;
  amount: number;
  /** Whole percent; the percents of all slices add up to exactly 100. */
  percent: number;
  /** The aggregate of every category after the top three. */
  isOthers: boolean;
  /** Breakdown colour of a real category; "Others" has none (it is always the neutral grey). */
  color?: string;
}

/**
 * Whole-number percentages of `amounts` that sum to exactly 100 (largest-remainder method): take each share rounded down,
 * then hand the missing points to the largest fractional remainders. Ties go to the larger amount, then to the earlier
 * entry, so the result never depends on sort stability. All zeros (or an empty list) give all zeros.
 */
export function largestRemainderPercents(amounts: number[]): number[] {
  const cents = amounts.map((value) => Math.max(0, Math.round(value * 100)));
  const total = cents.reduce((sum, value) => sum + value, 0);
  if (total === 0) {
    return amounts.map(() => 0);
  }
  const exact = cents.map((value) => (value * 100) / total);
  const floors = exact.map((value) => Math.floor(value));
  let missing = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value), cents: cents[index] }))
    .sort((a, b) => b.remainder - a.remainder || b.cents - a.cents || a.index - b.index);
  const result = [...floors];
  for (const entry of order) {
    if (missing <= 0) break;
    result[entry.index] += 1;
    missing -= 1;
  }
  return result;
}

export function buildSpendingSlices(items: SpendingInput[], topCount = TOP_CATEGORIES): { slices: SpendingSlice[]; total: number } {
  // Biggest first; equal amounts are ordered by name so the legend never reshuffles between renders.
  const sorted = items
    .filter((item) => item.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
  const total = Math.round(sorted.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
  if (sorted.length === 0) {
    return { slices: [], total: 0 };
  }

  const top = sorted.slice(0, topCount);
  const rest = sorted.slice(topCount);
  const entries: { key: string; label: string; amount: number; isOthers: boolean; color?: string }[] = top.map((item) => ({
    key: `category:${item.label}`,
    label: item.label,
    amount: item.amount,
    isOthers: false,
    color: item.color,
  }));
  if (rest.length > 0) {
    entries.push({
      key: 'others',
      label: 'Others',
      amount: Math.round(rest.reduce((sum, item) => sum + item.amount, 0) * 100) / 100,
      isOthers: true,
    });
  }

  const percents = largestRemainderPercents(entries.map((entry) => entry.amount));
  return { slices: entries.map((entry, index) => ({ ...entry, percent: percents[index] })), total };
}

/** One sentence for screen readers: the legend text already carries the information, this summarises the whole ring. */
export function spendingAccessibilityLabel(slices: SpendingSlice[], total: number, hidden: boolean): string {
  if (slices.length === 0) {
    return 'No expenses logged yet this month.';
  }
  if (hidden) {
    return 'Spending this month. Amounts are hidden.';
  }
  const parts = slices.map((slice) => `${slice.label} ${slice.percent} percent`);
  return `Spending this month, ${formatETB(total)} in total: ${parts.join(', ')}.`;
}

// ---- signed amounts and colour roles ------------------------------------------------------------------------------------
const MINUS = '−';

export type AmountRole = 'income' | 'expense' | 'transfer';

/** Income and expense have their own colours; a transfer moves money between your own pots, so it is neutral. */
export function transactionAmountRole(type: TransactionType): AmountRole {
  return type === 'expense' ? 'expense' : type === 'transfer' ? 'transfer' : 'income';
}

/** "-ETB 200.00" for an expense, "+ETB 1,000.00" for income, plain "ETB 50.00" for a transfer. */
export function formatTransactionAmount(type: TransactionType, amountETB: number): string {
  const role = transactionAmountRole(type);
  const text = formatETB(Math.abs(amountETB));
  return role === 'expense' ? `${MINUS}${text}` : role === 'income' ? `+${text}` : text;
}

/** This month's Net with an explicit sign. It is always drawn in the Net (blue) colour; the sign carries the meaning. */
export function formatNet(net: number): string {
  const rounded = Math.round(net * 100) / 100;
  if (rounded > 0) return `+${formatNumber(rounded)}`;
  if (rounded < 0) return `${MINUS}${formatNumber(Math.abs(rounded))}`;
  return formatNumber(0);
}

// ---- hero card ----------------------------------------------------------------------------------------------------------
/** Money held in goals, from the per-goal balances the ledger already derives. Rounded to cents. */
export function goalsTotal(goals: Record<string, number>): number {
  const cents = Object.values(goals).reduce((sum, value) => sum + Math.round(value * 100), 0);
  return cents / 100;
}

/** The "Includes ETB x in goals" caption: only when goals hold money AND balances are visible. */
export function shouldShowGoalsLine(goalsAmount: number, balancesHidden: boolean): boolean {
  return goalsAmount > 0 && !balancesHidden;
}

export function goalsLineText(goalsAmount: number): string {
  return `Includes ${formatETB(goalsAmount)} in goals`;
}
