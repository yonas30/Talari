import { Transaction } from '../types';
import { parseDateKey, toLocalDateKey } from './dates';

export type RangePreset = 'weekly' | 'monthly' | 'custom';

export interface BarDatum {
  label: string;
  amount: number;
  color: string;
}

export interface TrendPoint {
  label: string;
  income: number;
  expense: number;
}

// Local calendar day, not UTC (see utils/dates.ts).
export function toISODate(date: Date): string {
  return toLocalDateKey(date);
}

export function startOfWeek(date: Date): Date {
  const next = new Date(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function endOfWeek(date: Date): Date {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

export function getRangeDates(range: RangePreset, referenceDate = new Date()) {
  if (range === 'weekly') {
    return {
      start: toISODate(startOfWeek(referenceDate)),
      end: toISODate(endOfWeek(referenceDate)),
    };
  }

  if (range === 'monthly') {
    return {
      start: toISODate(startOfMonth(referenceDate)),
      end: toISODate(endOfMonth(referenceDate)),
    };
  }

  const end = new Date(referenceDate);
  const start = new Date(referenceDate);
  start.setDate(start.getDate() - 29);
  return {
    start: toISODate(start),
    end: toISODate(end),
  };
}

// Inclusive on both ends. Day keys are 'YYYY-MM-DD', so plain string comparison is exact and
// timezone-free.
export function getFilteredTransactionsByRange(
  transactions: Transaction[],
  startDate: string,
  endDate: string,
): Transaction[] {
  return transactions.filter((transaction) => transaction.date >= startDate && transaction.date <= endDate);
}

export function getCategoryBreakdown(transactions: Transaction[]): BarDatum[] {
  const totals = new Map<string, number>();

  for (const transaction of transactions) {
    if (transaction.type !== 'expense') {
      continue;
    }

    const amount = transaction.amountETB;
    totals.set(transaction.category, (totals.get(transaction.category) ?? 0) + amount);
  }

  const palette = ['#f97316', '#f59e0b', '#ef4444', '#8b5cf6', '#3b82f6', '#10b981', '#14b8a6'];

  return Array.from(totals.entries())
    .map(([label, amount], index) => ({
      label,
      amount,
      color: palette[index % palette.length],
    }))
    .sort((a, b) => b.amount - a.amount);
}

export function getSourceBreakdown(transactions: Transaction[]): BarDatum[] {
  const totals = new Map<string, number>();

  for (const transaction of transactions) {
    if (transaction.type !== 'income') {
      continue;
    }

    const amount = transaction.amountETB;
    totals.set(transaction.source || 'Unspecified', (totals.get(transaction.source || 'Unspecified') ?? 0) + amount);
  }

  const palette = ['#22c55e', '#16a34a', '#10b981', '#84cc16', '#60a5fa'];

  return Array.from(totals.entries())
    .map(([label, amount], index) => ({
      label,
      amount,
      color: palette[index % palette.length],
    }))
    .sort((a, b) => b.amount - a.amount);
}

export const TREND_TITLES: Record<RangePreset, string> = {
  weekly: 'Weekly Trend',
  monthly: 'Monthly Trend',
  custom: 'Custom Period',
};

// First day of the month `offset` months from `reference`. Built from day 1 on purpose: doing
// date.setMonth(m + offset) from the 31st overflows (31 Oct - 1 month = 1 Oct, not September),
// which made month navigation skip or repeat months.
export function shiftMonth(reference: Date, offset: number): Date {
  return new Date(reference.getFullYear(), reference.getMonth() + offset, 1);
}

export function shiftWeek(reference: Date, offset: number): Date {
  const next = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  next.setDate(next.getDate() + offset * 7);
  return next;
}

// Keeps a custom range valid as the user edits one end: start can never pass end or vice versa.
export function clampCustomRange(
  changed: 'start' | 'end',
  start: string,
  end: string,
): { start: string; end: string } {
  if (start <= end) {
    return { start, end };
  }
  return changed === 'start' ? { start, end: start } : { start: end, end };
}

export interface PeriodTotals {
  income: number;
  expenses: number;
  net: number;
}

// Income / Expenses / Net for a set of transactions, ETB only (V2 Part D). Transfers are neither.
export function getPeriodTotals(transactions: Transaction[]): PeriodTotals {
  let incomeCents = 0;
  let expenseCents = 0;
  for (const transaction of transactions) {
    if (transaction.type === 'income') {
      incomeCents += Math.round(transaction.amountETB * 100);
    } else if (transaction.type === 'expense') {
      expenseCents += Math.round(transaction.amountETB * 100);
    }
  }
  return { income: incomeCents / 100, expenses: expenseCents / 100, net: (incomeCents - expenseCents) / 100 };
}

type TrendGranularity = 'day' | 'week' | 'month';

// Long ranges are bucketed so the line stays readable (a year of daily points is unreadable noise).
export function getTrendGranularity(startDate: string, endDate: string): TrendGranularity {
  const days = Math.round((parseDateKey(endDate).getTime() - parseDateKey(startDate).getTime()) / 86400000) + 1;
  if (days <= 45) return 'day';
  if (days <= 240) return 'week';
  return 'month';
}

function bucketStart(date: Date, granularity: TrendGranularity): Date {
  if (granularity === 'week') return startOfWeek(date);
  if (granularity === 'month') return new Date(date.getFullYear(), date.getMonth(), 1);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function nextBucket(date: Date, granularity: TrendGranularity): Date {
  const next = new Date(date);
  if (granularity === 'month') {
    return new Date(date.getFullYear(), date.getMonth() + 1, 1);
  }
  next.setDate(next.getDate() + (granularity === 'week' ? 7 : 1));
  return next;
}

export function getTrendSeries(transactions: Transaction[], startDate: string, endDate: string): TrendPoint[] {
  const granularity = getTrendGranularity(startDate, endDate);
  const end = parseDateKey(endDate);
  const points = new Map<string, { label: string; income: number; expense: number }>();

  for (
    let cursor = bucketStart(parseDateKey(startDate), granularity);
    cursor <= end;
    cursor = nextBucket(cursor, granularity)
  ) {
    const key = toISODate(cursor);
    points.set(key, {
      label: granularity === 'month' ? key.slice(0, 7) : key.slice(5),
      income: 0,
      expense: 0,
    });
  }

  for (const transaction of transactions) {
    if (transaction.type === 'transfer' || transaction.date < startDate || transaction.date > endDate) {
      continue;
    }
    const point = points.get(toISODate(bucketStart(parseDateKey(transaction.date), granularity)));
    if (!point) {
      continue;
    }
    if (transaction.type === 'income') {
      point.income += transaction.amountETB;
    } else {
      point.expense += transaction.amountETB;
    }
  }

  return Array.from(points.values()).map((point) => ({
    label: point.label,
    income: Math.round(point.income * 100) / 100,
    expense: Math.round(point.expense * 100) / 100,
  }));
}

export function getBiggestSpendingCategory(transactions: Transaction[]) {
  const categories = getCategoryBreakdown(transactions);
  if (categories.length === 0) {
    return null;
  }

  return categories[0];
}
