import { CurrencyCode, ExchangeRate, Transaction } from '../types';
import { convertCurrency } from './currency';

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

export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
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

export function getFilteredTransactionsByRange(
  transactions: Transaction[],
  startDate: string,
  endDate: string,
): Transaction[] {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T23:59:59`);

  return transactions.filter((transaction) => {
    const date = new Date(`${transaction.date}T00:00:00`);
    return date >= start && date <= end;
  });
}

export function getCategoryBreakdown(
  transactions: Transaction[],
  homeCurrency: CurrencyCode,
  rates: ExchangeRate[],
): BarDatum[] {
  const totals = new Map<string, number>();

  for (const transaction of transactions) {
    if (transaction.type !== 'expense') {
      continue;
    }

    const amount = convertCurrency(transaction.amount, transaction.currency, homeCurrency, rates);
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

export function getSourceBreakdown(
  transactions: Transaction[],
  homeCurrency: CurrencyCode,
  rates: ExchangeRate[],
): BarDatum[] {
  const totals = new Map<string, number>();

  for (const transaction of transactions) {
    if (transaction.type !== 'income') {
      continue;
    }

    const amount = convertCurrency(transaction.amount, transaction.currency, homeCurrency, rates);
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

export function getTrendSeries(
  transactions: Transaction[],
  homeCurrency: CurrencyCode,
  rates: ExchangeRate[],
  startDate: string,
  endDate: string,
): TrendPoint[] {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const allDays: TrendPoint[] = [];

  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const key = toISODate(cursor);
    const dayTransactions = transactions.filter((transaction) => transaction.date === key);

    const income = dayTransactions
      .filter((transaction) => transaction.type === 'income')
      .reduce((sum, transaction) => sum + convertCurrency(transaction.amount, transaction.currency, homeCurrency, rates), 0);

    const expense = dayTransactions
      .filter((transaction) => transaction.type === 'expense')
      .reduce((sum, transaction) => sum + convertCurrency(transaction.amount, transaction.currency, homeCurrency, rates), 0);

    allDays.push({
      label: key.slice(5),
      income,
      expense,
    });
  }

  return allDays;
}

export function getBiggestSpendingCategory(
  transactions: Transaction[],
  homeCurrency: CurrencyCode,
  rates: ExchangeRate[],
) {
  const categories = getCategoryBreakdown(transactions, homeCurrency, rates);
  if (categories.length === 0) {
    return null;
  }

  return categories[0];
}
