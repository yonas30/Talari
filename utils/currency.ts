import { Budget, CurrencyCode, ExchangeRate, Goal, Transaction } from '../types';
import { getBalances, getNetSavingsChange, LedgerError, roundETB } from './balances';
import { parseDateKey, toLocalDateKey } from './dates';

export const BASE_CURRENCY = 'ETB';

// The stored default rate (X -> ETB). Only a direct row counts: no reverse/triangulated guesses,
// and no silent 1:1 fallback - a missing rate must block entry (V2 Part D).
export function getRateToETB(currency: CurrencyCode, rates: ExchangeRate[]): number | null {
  if (currency === BASE_CURRENCY) {
    return 1;
  }
  const direct = rates.find((rate) => rate.fromCurrency === currency && rate.toCurrency === BASE_CURRENCY);
  return direct && Number.isFinite(direct.rate) && direct.rate > 0 ? direct.rate : null;
}

// Converts an entered amount to ETB once, at entry time. The result is stored as amountETB and is
// the only value later used in any sum, so later rate changes never rewrite history.
// `rateOverride` applies to this single conversion only; it is never written to the rate table.
export function toETB(
  amount: number,
  currency: CurrencyCode,
  rates: ExchangeRate[],
  rateOverride?: number | null,
): { amountETB: number; rate: number } {
  if (currency === BASE_CURRENCY) {
    return { amountETB: roundETB(amount), rate: 1 };
  }

  let rate: number | null;
  if (rateOverride !== undefined && rateOverride !== null) {
    if (!Number.isFinite(rateOverride) || rateOverride <= 0) {
      throw new LedgerError('INVALID_RATE', 'Exchange rate must be a number greater than zero.');
    }
    rate = rateOverride;
  } else {
    rate = getRateToETB(currency, rates);
  }

  if (rate === null) {
    throw new LedgerError('MISSING_RATE', `Set an exchange rate for ${currency} → ETB before adding this transaction.`);
  }

  return { amountETB: roundETB(amount * rate), rate };
}

function sumETB(transactions: Transaction[]): number {
  return transactions.reduce((cents, item) => cents + Math.round(item.amountETB * 100), 0) / 100;
}

export function getCurrentPeriodSummary(transactions: Transaction[], referenceDate = new Date()) {
  const monthPrefix = toLocalDateKey(referenceDate).slice(0, 7);
  const periodTransactions = transactions.filter((transaction) => transaction.date.startsWith(monthPrefix));

  const income = sumETB(periodTransactions.filter((transaction) => transaction.type === 'income'));
  const expenses = sumETB(periodTransactions.filter((transaction) => transaction.type === 'expense'));

  return {
    income,
    expenses,
    // Net change in Saved + Goals this month (income->Saved, transfers in, minus what left).
    savings: getNetSavingsChange(periodTransactions),
    net: roundETB(income - expenses),
    transactions: periodTransactions,
  };
}

// Any recorded financial activity (income, expense, transfer, goal contribution) counts for its
// calendar day. Day keys are local - see utils/dates.ts for the UTC bug this replaces.
export function calculateBuilderStreak(transactions: Transaction[], today = new Date()): number {
  if (transactions.length === 0) {
    return 0;
  }

  const activeDays = new Set(transactions.map((transaction) => transaction.date));
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // Today may not be logged yet; the streak is still alive if yesterday was.
  if (!activeDays.has(toLocalDateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let streak = 0;
  while (activeDays.has(toLocalDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

export function getMotivationalMessage(recentSavings: number, dayIndex = new Date().getDate()): string {
  const lines = [
    'Your money story is still being written — one consistent decision at a time.',
    'Small wins stack into a stronger financial future.',
    'You are not behind; you are building momentum.',
    'Consistency beats intensity when the goal is long-term freedom.',
  ];

  if (recentSavings > 0) {
    return lines[dayIndex % lines.length];
  }

  return lines[(dayIndex + Math.abs(Math.round(recentSavings)) + 1) % lines.length];
}

// A goal's amount is whatever the ledger says was transferred in minus out (V2 Part C).
export function getGoalProgress(
  goal: Goal,
  transactions: Transaction[],
): { savedAmount: number; percent: number } {
  const savedAmount = Math.max(getBalances(transactions).goals[goal.id] ?? 0, 0);
  const percent = goal.targetAmount > 0 ? Math.min((savedAmount / goal.targetAmount) * 100, 100) : 0;

  return { savedAmount, percent };
}

// Projects a completion date from the average monthly pace of money moved into the goal so far.
export function getProjectedCompletionDate(
  goal: Goal,
  transactions: Transaction[],
  referenceDate = new Date(),
): Date | null {
  const contributions = transactions
    .filter((transaction) => transaction.type === 'transfer' && transaction.toAccount === 'goal' && transaction.toGoalId === goal.id)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (contributions.length === 0) {
    return null;
  }

  const { savedAmount } = getGoalProgress(goal, transactions);
  const remaining = goal.targetAmount - savedAmount;
  if (remaining <= 0) {
    return referenceDate;
  }

  const firstDate = parseDateKey(contributions[0].date);
  const monthsElapsed = Math.max(
    1,
    (referenceDate.getFullYear() - firstDate.getFullYear()) * 12 + (referenceDate.getMonth() - firstDate.getMonth()) + 1,
  );

  const monthlyPace = savedAmount / monthsElapsed;
  if (monthlyPace <= 0) {
    return null;
  }

  const monthsRemaining = Math.ceil(remaining / monthlyPace);
  const projected = new Date(referenceDate);
  projected.setMonth(projected.getMonth() + monthsRemaining);
  return projected;
}

// Spending is summed from amountETB. The limit is entered in budget.currency, so it is converted
// at the current stored rate; a limit with no rate can't be compared and is reported as such.
export function getBudgetProgress(
  budget: Budget,
  transactions: Transaction[],
  rates: ExchangeRate[],
  referenceDate = new Date(),
): { spentAmount: number; limitETB: number | null; percent: number; isOverBudget: boolean } {
  const monthPrefix = toLocalDateKey(referenceDate).slice(0, 7);

  const spentAmount = sumETB(
    transactions.filter(
      (transaction) =>
        transaction.type === 'expense' &&
        transaction.category === budget.category &&
        transaction.date.startsWith(monthPrefix),
    ),
  );

  const rate = getRateToETB(budget.currency, rates);
  const limitETB = rate === null ? null : roundETB(budget.monthlyLimit * rate);

  if (limitETB === null || limitETB <= 0) {
    return { spentAmount, limitETB, percent: 0, isOverBudget: false };
  }

  return {
    spentAmount,
    limitETB,
    percent: Math.min((spentAmount / limitETB) * 100, 100),
    isOverBudget: spentAmount > limitETB,
  };
}
