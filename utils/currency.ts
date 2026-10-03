import { Budget, CurrencyCode, ExchangeRate, Goal, Transaction } from '../types';

export function convertCurrency(
  amount: number,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  rates: ExchangeRate[],
): number {
  if (!Number.isFinite(amount)) {
    return 0;
  }

  if (fromCurrency === toCurrency) {
    return amount;
  }

  const direct = rates.find(
    (rate) => rate.fromCurrency === fromCurrency && rate.toCurrency === toCurrency,
  );

  if (direct) {
    return amount * direct.rate;
  }

  const reverse = rates.find(
    (rate) => rate.fromCurrency === toCurrency && rate.toCurrency === fromCurrency,
  );

  if (reverse) {
    return amount / reverse.rate;
  }

  const fromToHome = rates.find(
    (rate) => rate.fromCurrency === fromCurrency && rate.toCurrency === 'ETB',
  );
  const homeToTarget = rates.find(
    (rate) => rate.fromCurrency === 'ETB' && rate.toCurrency === toCurrency,
  );

  if (fromToHome && homeToTarget) {
    return amount * fromToHome.rate * homeToTarget.rate;
  }

  return amount;
}

export function getCurrentPeriodSummary(
  transactions: Transaction[],
  homeCurrency: CurrencyCode,
  rates: ExchangeRate[],
  referenceDate = new Date(),
) {
  const startOfMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1, 0, 0, 0, 0);
  const endOfMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0, 23, 59, 59, 999);

  const periodTransactions = transactions.filter((transaction) => {
    const transactionDate = new Date(`${transaction.date}T00:00:00`);
    return transactionDate >= startOfMonth && transactionDate <= endOfMonth;
  });

  const income = periodTransactions
    .filter((transaction) => transaction.type === 'income')
    .reduce((sum, transaction) => sum + convertCurrency(transaction.amount, transaction.currency, homeCurrency, rates), 0);

  const expenses = periodTransactions
    .filter((transaction) => transaction.type === 'expense')
    .reduce((sum, transaction) => sum + convertCurrency(transaction.amount, transaction.currency, homeCurrency, rates), 0);

  const savings = periodTransactions
    .filter((transaction) => transaction.type === 'savings')
    .reduce((sum, transaction) => sum + convertCurrency(transaction.amount, transaction.currency, homeCurrency, rates), 0);

  return {
    income,
    expenses,
    savings,
    net: income - expenses,
    transactions: periodTransactions,
  };
}

export function calculateBuilderStreak(transactions: Transaction[], today = new Date()): number {
  if (transactions.length === 0) {
    return 0;
  }

  const uniqueDays = new Set(
    transactions
      .map((transaction) => new Date(`${transaction.date}T00:00:00`))
      .map((date) => date.toISOString().slice(0, 10)),
  );

  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let streak = 0;
  let cursor = new Date(start);

  if (!uniqueDays.has(cursor.toISOString().slice(0, 10))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  while (uniqueDays.has(cursor.toISOString().slice(0, 10))) {
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

export function getGoalProgress(
  goal: Goal,
  transactions: Transaction[],
  rates: ExchangeRate[],
): { savedAmount: number; percent: number } {
  const savedAmount = transactions
    .filter((transaction) => transaction.goalId === goal.id)
    .reduce((sum, transaction) => sum + convertCurrency(transaction.amount, transaction.currency, goal.currency, rates), 0);

  const percent = goal.targetAmount > 0 ? Math.min((savedAmount / goal.targetAmount) * 100, 100) : 0;

  return { savedAmount, percent };
}

// Projects a completion date from the average monthly pace of contributions made so far.
export function getProjectedCompletionDate(
  goal: Goal,
  transactions: Transaction[],
  rates: ExchangeRate[],
  referenceDate = new Date(),
): Date | null {
  const contributions = transactions
    .filter((transaction) => transaction.goalId === goal.id)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (contributions.length === 0) {
    return null;
  }

  const { savedAmount } = getGoalProgress(goal, transactions, rates);
  const remaining = goal.targetAmount - savedAmount;
  if (remaining <= 0) {
    return referenceDate;
  }

  const firstDate = new Date(`${contributions[0].date}T00:00:00`);
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

export function getBudgetProgress(
  budget: Budget,
  transactions: Transaction[],
  rates: ExchangeRate[],
  referenceDate = new Date(),
): { spentAmount: number; percent: number; isOverBudget: boolean } {
  const startOfMonthDate = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1, 0, 0, 0, 0);
  const endOfMonthDate = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0, 23, 59, 59, 999);

  const spentAmount = transactions
    .filter((transaction) => {
      if (transaction.type !== 'expense' || transaction.category !== budget.category) {
        return false;
      }
      const transactionDate = new Date(`${transaction.date}T00:00:00`);
      return transactionDate >= startOfMonthDate && transactionDate <= endOfMonthDate;
    })
    .reduce((sum, transaction) => sum + convertCurrency(transaction.amount, transaction.currency, budget.currency, rates), 0);

  const percent = budget.monthlyLimit > 0 ? Math.min((spentAmount / budget.monthlyLimit) * 100, 100) : 0;

  return { spentAmount, percent, isOverBudget: spentAmount > budget.monthlyLimit };
}
