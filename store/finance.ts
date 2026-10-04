import { create } from 'zustand';

import {
  addCategory,
  addCurrency,
  addGoal,
  addMilestone,
  addMonthlySnapshotIfMissing,
  addRecurringTransaction,
  deleteCategory,
  deleteCurrency,
  deleteGoal,
  deleteBudget,
  deleteRecurringTransaction,
  deleteTransaction,
  generateDueRecurringTransactions,
  getBudgets,
  getCategories,
  getCurrencies,
  getExchangeRates,
  getGoals,
  getMilestones,
  getMonthlySnapshots,
  getOrigin,
  getRecurringTransactions,
  getTransactions,
  initializeDatabase,
  insertTransaction,
  toggleRecurringTransaction,
  updateRecurringTransaction,
  updateCategory,
  updateGoal,
  updateTransaction,
  upsertBudget,
  upsertExchangeRate,
  upsertOrigin,
  setGoalStatus,
} from '../db/database';
import { Account, Category, CurrencyCode, FinanceStoreState, Goal, Transaction, TransactionInput } from '../types';
import { getBalances, LedgerError } from '../utils/balances';
import { getCurrentPeriodSummary, getGoalProgress, nextGoalStatus } from '../utils/currency';
import { todayKey } from '../utils/dates';
import { hasCompletionMilestone } from '../utils/milestones';
import { planAdd, planDelete, planEdit } from '../utils/transactions';
import { useUiStore } from './ui';

function goalNameMap(goals: Goal[]): Record<string, string> {
  return Object.fromEntries(goals.map((goal) => [goal.id, goal.name]));
}

function byNewestFirst(a: Transaction, b: Transaction): number {
  return a.date === b.date ? b.timestamp.localeCompare(a.timestamp) : b.date.localeCompare(a.date);
}

export const useFinanceStore = create<FinanceStoreState>((set, get) => ({
  transactions: [],
  categories: [],
  exchangeRates: [],
  goals: [],
  budgets: [],
  recurringTransactions: [],
  milestones: [],
  origin: null,
  monthlySnapshots: [],
  currencies: [],
  homeCurrency: 'ETB',
  isReady: false,
  loadData: async () => {
    await initializeDatabase();
    const { failures } = await generateDueRecurringTransactions();
    if (failures.length > 0) {
      useUiStore.getState().upsertNotifications(
        failures.map((failure) => ({
          id: `recurring-skipped-${failure.ruleId}-${failure.date}`,
          title: 'Recurring transaction skipped',
          description: `${failure.category} on ${failure.date} was not recorded. ${failure.reason}`,
          isRead: false,
          type: 'system' as const,
        })),
      );
    }

    const [categories, transactions, exchangeRates, goals, budgets, recurringTransactions] = await Promise.all([
      getCategories(),
      getTransactions(),
      getExchangeRates(),
      getGoals(),
      getBudgets(),
      getRecurringTransactions(),
    ]);

    const previousMonthDate = new Date();
    previousMonthDate.setDate(1);
    previousMonthDate.setMonth(previousMonthDate.getMonth() - 1);
    const previousMonthSummary = getCurrentPeriodSummary(transactions, previousMonthDate);
    const monthKey = `${previousMonthDate.getFullYear()}-${String(previousMonthDate.getMonth() + 1).padStart(2, '0')}`;
    await addMonthlySnapshotIfMissing(
      monthKey,
      previousMonthSummary.income,
      previousMonthSummary.expenses,
      previousMonthSummary.savings,
      'ETB',
    );

    const [milestones, origin, monthlySnapshots, currencies] = await Promise.all([
      getMilestones(),
      getOrigin(),
      getMonthlySnapshots(),
      getCurrencies(),
    ]);

    set({
      categories,
      transactions,
      exchangeRates,
      goals,
      budgets,
      recurringTransactions,
      milestones,
      origin,
      monthlySnapshots,
      currencies,
      homeCurrency: 'ETB',
      isReady: true,
    });
  },
  // Every write path validates the WHOLE resulting ledger first (date-ordered running balances), so
  // a create, edit, delete or back-dated entry that would push Available/Saved/a goal below zero is
  // rejected with a LedgerError and nothing is written.
  addTransaction: async (input: TransactionInput) => {
    const { exchangeRates, goals, transactions } = get();
    const transaction = planAdd(transactions, input, exchangeRates, goalNameMap(goals));

    await insertTransaction(transaction);
    set((state) => ({
      transactions: [transaction, ...state.transactions].sort(byNewestFirst),
    }));
    return transaction;
  },
  updateTransaction: async (id: string, input: TransactionInput) => {
    const { exchangeRates, goals, transactions } = get();
    const transaction = planEdit(transactions, id, input, exchangeRates, goalNameMap(goals));

    await updateTransaction(transaction);
    set((state) => ({
      transactions: state.transactions.map((item) => (item.id === id ? transaction : item)).sort(byNewestFirst),
    }));
    return transaction;
  },
  deleteTransaction: async (id: string) => {
    const { goals, transactions } = get();
    planDelete(transactions, id, goalNameMap(goals));

    await deleteTransaction(id);
    set((state) => ({
      transactions: state.transactions.filter((item) => item.id !== id),
    }));
  },
  addCategory: async (input: Omit<Category, 'id' | 'isDefault'>) => {
    const category = await addCategory(input);
    set((state) => ({
      categories: [...state.categories, category],
    }));
    return category;
  },
  updateCategory: async (id: string, input: Omit<Category, 'id' | 'isDefault'>) => {
    const previous = get().categories.find((item) => item.id === id);
    await updateCategory(id, input);
    set((state) => {
      const renamed = previous && previous.name !== input.name && (previous.type === 'income' || previous.type === 'expense');
      return {
        categories: state.categories.map((item) => (item.id === id ? { ...item, ...input } : item)),
        // Mirror the cascade done in SQL so open screens don't show stale names.
        transactions: renamed
          ? state.transactions.map((item) =>
              item.category === previous.name && item.type === previous.type ? { ...item, category: input.name } : item,
            )
          : state.transactions,
        recurringTransactions: renamed
          ? state.recurringTransactions.map((item) =>
              item.category === previous.name && item.type === previous.type ? { ...item, category: input.name } : item,
            )
          : state.recurringTransactions,
        budgets:
          renamed && previous.type === 'expense'
            ? state.budgets.map((item) => (item.category === previous.name ? { ...item, category: input.name } : item))
            : state.budgets,
      };
    });
  },
  deleteCategory: async (id: string) => {
    await deleteCategory(id);
    set((state) => ({
      categories: state.categories.filter((item) => item.id !== id),
    }));
  },
  setHomeCurrency: (currency: CurrencyCode) => {
    set({ homeCurrency: currency });
  },
  upsertExchangeRate: async (fromCurrency: CurrencyCode, toCurrency: CurrencyCode, rate: number) => {
    const entry = await upsertExchangeRate(fromCurrency, toCurrency, rate);
    set((state) => ({
      exchangeRates: [...state.exchangeRates.filter((item) => !(item.fromCurrency === fromCurrency && item.toCurrency === toCurrency)), entry],
    }));
    return entry;
  },
  addCurrency: async (code: string, name: string) => {
    const currency = await addCurrency(code, name);
    set((state) => ({
      currencies: [...state.currencies.filter((item) => item.code !== currency.code), currency],
    }));
    return currency;
  },
  deleteCurrency: async (code: string) => {
    await deleteCurrency(code);
    set((state) => ({
      currencies: state.currencies.filter((item) => item.code !== code),
    }));
  },
  addGoal: async (input) => {
    const goal = await addGoal(input);
    set((state) => ({
      goals: [...state.goals, goal],
    }));
    return goal;
  },
  updateGoal: async (id: string, input) => {
    await updateGoal(id, input);
    set((state) => ({
      goals: state.goals.map((goal) =>
        goal.id === id
          ? { ...goal, name: input.name, targetAmount: input.targetAmount, deadline: input.deadline ?? null }
          : goal,
      ),
    }));
    await reconcileGoal(id);
  },
  deleteGoal: async (id: string) => {
    // Deleting a goal that still holds money would make that money vanish from Total Balance.
    // Goal money must be moved out by a transfer first (same philosophy as Goal -> Expense).
    const held = getBalances(get().transactions).goals[id] ?? 0;
    if (held > 0) {
      throw new LedgerError(
        'GOAL_HAS_FUNDS',
        `This goal still holds ETB ${held.toFixed(2)}. Transfer it to Available or Saved before deleting the goal.`,
      );
    }

    await deleteGoal(id);
    set((state) => ({
      goals: state.goals.filter((goal) => goal.id !== id),
    }));
  },
  setGoalStatus: async (id: string, status) => {
    await setGoalStatus(id, status);
    set((state) => ({
      goals: state.goals.map((goal) => (goal.id === id ? { ...goal, status } : goal)),
    }));
  },
  // A goal contribution is a Transfer (Available|Saved -> Goal), never income. Amount is ETB.
  contributeToGoal: async (goalId: string, amount: number, from: Account) => {
    const transaction = await get().addTransaction({
      type: 'transfer',
      amount,
      currency: 'ETB',
      fromAccount: from,
      toAccount: 'goal',
      toGoalId: goalId,
      date: todayKey(),
    });
    await reconcileGoal(goalId);
    return transaction;
  },
  // The reverse: Goal -> Available|Saved. This is the only way goal money becomes spendable.
  withdrawFromGoal: async (goalId: string, amount: number, to: Account) => {
    const transaction = await get().addTransaction({
      type: 'transfer',
      amount,
      currency: 'ETB',
      fromAccount: 'goal',
      fromGoalId: goalId,
      toAccount: to,
      date: todayKey(),
    });
    await reconcileGoal(goalId);
    return transaction;
  },
  upsertBudget: async (input) => {
    const budget = await upsertBudget(input);
    set((state) => ({
      budgets: [...state.budgets.filter((item) => item.id !== budget.id), budget],
    }));
    return budget;
  },
  deleteBudget: async (id: string) => {
    await deleteBudget(id);
    set((state) => ({
      budgets: state.budgets.filter((budget) => budget.id !== id),
    }));
  },
  addRecurringTransaction: async (input) => {
    const recurring = await addRecurringTransaction(input);
    set((state) => ({
      recurringTransactions: [recurring, ...state.recurringTransactions],
    }));
    return recurring;
  },
  updateRecurringTransaction: async (id, input) => {
    const updated = await updateRecurringTransaction(id, input);
    set((state) => ({
      recurringTransactions: state.recurringTransactions.map((item) => (item.id === id ? updated : item)),
    }));
    return updated;
  },
  toggleRecurringTransaction: async (id: string, isActive: boolean) => {
    await toggleRecurringTransaction(id, isActive);
    set((state) => ({
      recurringTransactions: state.recurringTransactions.map((item) =>
        item.id === id ? { ...item, isActive } : item,
      ),
    }));
  },
  deleteRecurringTransaction: async (id: string) => {
    await deleteRecurringTransaction(id);
    set((state) => ({
      recurringTransactions: state.recurringTransactions.filter((item) => item.id !== id),
    }));
  },
  saveOrigin: async (input) => {
    const origin = await upsertOrigin(input);
    set({ origin });
    return origin;
  },
  addMilestone: async (input) => {
    const milestone = await addMilestone(input);
    set((state) => ({
      milestones: [milestone, ...state.milestones],
    }));
    return milestone;
  },
}));

// Keeps a goal's status in step with what the ledger says it holds: reaching the target completes it
// (and records the milestone once); dropping back below the target - by withdrawing money or raising
// the target - reopens it. Abandoned goals are left alone.
async function reconcileGoal(goalId: string): Promise<void> {
  const state = useFinanceStore.getState();
  const goal = state.goals.find((item) => item.id === goalId);
  if (!goal || goal.status === 'abandoned') {
    return;
  }

  const { percent } = getGoalProgress(goal, state.transactions);
  const nextStatus = nextGoalStatus(goal, state.transactions);

  if (nextStatus) {
    await setGoalStatus(goal.id, nextStatus);
    useFinanceStore.setState((prev) => ({
      goals: prev.goals.map((item) => (item.id === goal.id ? { ...item, status: nextStatus } : item)),
    }));
  }

  if (percent >= 100) {
    // By goal id (utils/milestones.ts) - matching on the title let an unrelated or leftover record suppress this one.
    if (!hasCompletionMilestone(state.milestones, goal.id)) {
      const milestone = await addMilestone({
        title: goal.name,
        description: `Reached your ${goal.name} goal of ETB ${goal.targetAmount.toFixed(2)}.`,
        date: todayKey(),
        type: 'goal_completed',
        goalId: goal.id,
      });
      useFinanceStore.setState((prev) => ({ milestones: [milestone, ...prev.milestones] }));
    }
  }
}

export function getLatestTransactions(limit: number): Transaction[] {
  return useFinanceStore.getState().transactions.slice(0, limit);
}

export function getExchangeRateMap(): Record<string, number> {
  return Object.fromEntries(
    useFinanceStore.getState().exchangeRates.map((rate) => [`${rate.fromCurrency}-${rate.toCurrency}`, rate.rate]),
  );
}
