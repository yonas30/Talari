import { Budget, ExchangeRate, Transaction } from '../types';
import { getBudgetProgress } from './currency';
import { toLocalDateKey } from './dates';
import { formatETB } from './format';

export interface BudgetAlert {
  id: string;
  category: string;
  // How far over the limit, in ETB.
  amountOver: number;
  title: string;
  description: string;
  // Where tapping the notification should go.
  route: string;
}

// One notification per budget per calendar month. Including the month in the id means a budget that goes over again
// next month is a NEW notification (unread again), while one you have already seen this month stays read - including
// after the app restarts, because read ids are stored.
export function budgetNotificationId(category: string, monthKey: string): string {
  return `budget-${category}-${monthKey}`;
}

// Budgets that are over their limit this month (V2 Part P). Budgets whose limit can't be compared because the
// currency has no exchange rate are not alerted on - they show their own "set a rate" message on the Budgets screen.
export function getBudgetAlerts(
  budgets: Budget[],
  transactions: Transaction[],
  rates: ExchangeRate[],
  today = new Date(),
): BudgetAlert[] {
  const monthKey = toLocalDateKey(today).slice(0, 7);

  return budgets.flatMap((budget) => {
    const { spentAmount, limitETB, isOverBudget } = getBudgetProgress(budget, transactions, rates, today);
    if (!isOverBudget || limitETB === null) {
      return [];
    }

    const amountOver = Math.round((spentAmount - limitETB) * 100) / 100;
    return [
      {
        id: budgetNotificationId(budget.category, monthKey),
        category: budget.category,
        amountOver,
        title: 'Over budget',
        description: `${budget.category} is over its monthly budget by ${formatETB(amountOver)}.`,
        route: '/budgets',
      },
    ];
  });
}

// ---- The 80% warning -------------------------------------------------------------------------------------------------------------
// A budget that has used 80% or more of its limit but is NOT over it. Over the limit, the "Over budget" alert above takes over (the
// two are never shown together), so a budget has at most one budget notification at a time.
export const BUDGET_WARNING_PERCENT = 80;

export type BudgetAlertLevel = 'none' | 'warning' | 'over';

// Same definition of "over" as getBudgetProgress (spent > limit). A missing or zero limit (no exchange rate, or nothing set) is never
// alerted on. Compared as spent * 100 >= limit * 80 so that exactly 80% counts, with no floating-point division in the way.
export function getBudgetAlertLevel(spentETB: number, limitETB: number | null): BudgetAlertLevel {
  if (limitETB === null || !(limitETB > 0)) {
    return 'none';
  }
  if (spentETB > limitETB) {
    return 'over';
  }
  return spentETB * 100 >= limitETB * BUDGET_WARNING_PERCENT ? 'warning' : 'none';
}

// One warning per budget per calendar month (the month is in the id, so next month starts fresh). Its own id, so the seen-state of the
// "Over budget" notification and of the warning never affect each other.
export function budgetWarningNotificationId(category: string, monthKey: string): string {
  return `budget-${category}-${monthKey}-warning-${BUDGET_WARNING_PERCENT}`;
}

export interface BudgetAlertDecision {
  level: BudgetAlertLevel;
  // The notification that should exist for this budget right now; null when there is none.
  id: string | null;
  // True when the user has not seen it yet (it should count towards the bell badge).
  isNew: boolean;
}

// The whole threshold + de-duplication rule in one place. `seenIds` is the stored set of notification ids the user has already opened.
// Crossing 80% twice in one month gives the same id both times, so the second crossing is never "new"; a new month gives a new id.
export function decideBudgetAlert(input: {
  category: string;
  monthKey: string;
  spentETB: number;
  limitETB: number | null;
  seenIds: Record<string, true>;
}): BudgetAlertDecision {
  const level = getBudgetAlertLevel(input.spentETB, input.limitETB);
  if (level === 'none') {
    return { level, id: null, isNew: false };
  }
  const id = level === 'over' ? budgetNotificationId(input.category, input.monthKey) : budgetWarningNotificationId(input.category, input.monthKey);
  return { level, id, isNew: !input.seenIds[id] };
}

export interface BudgetWarning {
  id: string;
  category: string;
  // The share of the limit used, rounded DOWN (79.99% is not 80%, and 99.9% is not 100%).
  percent: number;
  spentAmount: number;
  limitETB: number;
  amountLeft: number;
  title: string;
  description: string;
  // Read out by screen readers instead of "title. description".
  accessibilityLabel: string;
  route: string;
}

// Budgets at 80% or more of their limit this month and not over it. Reads the budget figures from getBudgetProgress; it computes nothing
// of its own beyond the percentage shown in the text.
export function getBudgetWarnings(
  budgets: Budget[],
  transactions: Transaction[],
  rates: ExchangeRate[],
  today = new Date(),
): BudgetWarning[] {
  const monthKey = toLocalDateKey(today).slice(0, 7);

  return budgets.flatMap((budget) => {
    const { spentAmount, limitETB } = getBudgetProgress(budget, transactions, rates, today);
    if (getBudgetAlertLevel(spentAmount, limitETB) !== 'warning' || limitETB === null) {
      return [];
    }

    const percent = Math.floor((spentAmount * 100) / limitETB);
    const amountLeft = Math.round((limitETB - spentAmount) * 100) / 100;
    const detail = `${formatETB(spentAmount)} of ${formatETB(limitETB)} spent, ${formatETB(amountLeft)} left.`;
    return [
      {
        id: budgetWarningNotificationId(budget.category, monthKey),
        category: budget.category,
        percent,
        spentAmount,
        limitETB,
        amountLeft,
        title: `${budget.category} budget is at ${percent}%`,
        description: detail,
        accessibilityLabel: `Warning. ${budget.category} budget is at ${percent} percent. ${detail}`,
        route: '/budgets',
      },
    ];
  });
}
