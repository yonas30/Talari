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
