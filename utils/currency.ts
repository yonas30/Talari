import { BASE_CURRENCY } from '../constants/accounts';
import { Budget, CurrencyCode, ExchangeRate } from '../types';
import { AccountEntry, AccountGoal, GoalAllocation } from '../types/accounts';
import { getGoalAmount } from './accounts/reserve';
import { getNetSavingsChange, getPeriodSummary } from './accounts/totals';
import { round2 } from './accounts/money';
import { getRateToETB } from './accounts/rates';
import { parseDateKey, toLocalDateKey } from './dates';

export { BASE_CURRENCY, getRateToETB };

function sumETB(entries: AccountEntry[]): number {
  return entries.reduce((cents, item) => cents + Math.round(item.amountETB * 100), 0) / 100;
}

// This month's figures. Income and expenses use amountETB only and exclude opening / adjustment / transfer rows; `savings` is the net
// change in reserved goal money this month (V2_SPEC Part R), not a balance.
export function getCurrentPeriodSummary(entries: AccountEntry[], allocations: GoalAllocation[], referenceDate = new Date()) {
  const monthPrefix = toLocalDateKey(referenceDate).slice(0, 7);
  const { income, expenses, net } = getPeriodSummary(entries, monthPrefix);
  return { income, expenses, net, savings: getNetSavingsChange(allocations, monthPrefix) };
}

// A goal's amount is the sum of its allocation rows (V2_SPEC Part C).
export function getGoalProgress(
  goal: Pick<AccountGoal, 'id' | 'targetAmount'>,
  allocations: GoalAllocation[],
): { savedAmount: number; percent: number } {
  const savedAmount = Math.max(getGoalAmount(allocations, goal.id), 0);
  const percent = goal.targetAmount > 0 ? Math.min((savedAmount / goal.targetAmount) * 100, 100) : 0;

  return { savedAmount, percent };
}

// What a goal's status should become given what it holds: reaching the target completes it; falling back below the target (a
// withdrawal, a raised target, or reserved money being spent) reopens it. Returns null when nothing changes. Abandoned goals are
// never touched.
export function nextGoalStatus(
  goal: Pick<AccountGoal, 'id' | 'targetAmount' | 'status'>,
  allocations: GoalAllocation[],
): 'completed' | 'active' | null {
  if (goal.status === 'abandoned') {
    return null;
  }
  const { percent } = getGoalProgress(goal, allocations);
  if (percent >= 100) {
    return goal.status === 'completed' ? null : 'completed';
  }
  return goal.status === 'completed' ? 'active' : null;
}

// Projects a completion date from the average monthly pace of money the owner has put into the goal so far (manual additions only).
export function getProjectedCompletionDate(
  goal: Pick<AccountGoal, 'id' | 'targetAmount'>,
  allocations: GoalAllocation[],
  referenceDate = new Date(),
): Date | null {
  const contributions = allocations
    .filter((row) => row.goalId === goal.id && row.kind === 'manual' && row.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (contributions.length === 0) {
    return null;
  }

  const { savedAmount } = getGoalProgress(goal, allocations);
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
  entries: AccountEntry[],
  rates: ExchangeRate[],
  referenceDate = new Date(),
): { spentAmount: number; limitETB: number | null; percent: number; isOverBudget: boolean } {
  const monthPrefix = toLocalDateKey(referenceDate).slice(0, 7);

  const spentAmount = sumETB(
    entries.filter((entry) => entry.type === 'expense' && entry.category === budget.category && entry.date.startsWith(monthPrefix)),
  );

  const rate = getRateToETB(budget.currency, rates);
  const limitETB = rate === null ? null : round2(budget.monthlyLimit * rate);

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
