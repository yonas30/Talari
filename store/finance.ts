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
  updateCategory,
  updateGoal,
  updateTransaction,
  upsertBudget,
  upsertExchangeRate,
  upsertOrigin,
  setGoalStatus,
} from '../db/database';
import { Category, CurrencyCode, ExchangeRate, FinanceStoreState, Transaction, TransactionInput } from '../types';
import { getCurrentPeriodSummary, getGoalProgress } from '../utils/currency';

export const useFinanceStore = create<FinanceStoreState>((set) => ({
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
    await generateDueRecurringTransactions();
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
    const previousMonthSummary = getCurrentPeriodSummary(transactions, 'ETB', exchangeRates, previousMonthDate);
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
  addTransaction: async (input: TransactionInput) => {
    const transaction = await insertTransaction(input);
    set((state) => ({
      transactions: [transaction, ...state.transactions],
    }));
    return transaction;
  },
  updateTransaction: async (id: string, input: TransactionInput) => {
    const transaction = await updateTransaction(id, input);
    set((state) => ({
      transactions: state.transactions
        .map((item) => (item.id === id ? transaction : item))
        .sort((a, b) => (a.date === b.date ? b.timestamp.localeCompare(a.timestamp) : b.date.localeCompare(a.date))),
    }));
    return transaction;
  },
  deleteTransaction: async (id: string) => {
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
    await updateCategory(id, input);
    set((state) => ({
      categories: state.categories.map((item) => (item.id === id ? { ...item, ...input } : item)),
    }));
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
          ? { ...goal, name: input.name, targetAmount: input.targetAmount, currency: input.currency, deadline: input.deadline ?? null }
          : goal,
      ),
    }));
  },
  deleteGoal: async (id: string) => {
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
  contributeToGoal: async (goalId: string, amount: number, currency: CurrencyCode) => {
    const goal = useFinanceStore.getState().goals.find((item) => item.id === goalId);
    const transaction = await insertTransaction({
      type: 'savings',
      amount,
      currency,
      category: goal?.name ?? 'Goal contribution',
      source: 'Goal contribution',
      date: new Date().toISOString().slice(0, 10),
      goalId,
    });
    set((state) => ({
      transactions: [transaction, ...state.transactions],
    }));

    // Auto-record a milestone the first time a goal's target is reached.
    if (goal) {
      const state = useFinanceStore.getState();
      const { percent } = getGoalProgress(goal, state.transactions, state.exchangeRates);
      const alreadyRecorded = state.milestones.some(
        (item) => item.type === 'goal_completed' && item.title === goal.name,
      );
      if (percent >= 100 && !alreadyRecorded) {
        const milestone = await addMilestone({
          title: goal.name,
          description: `Reached your ${goal.name} goal of ${goal.currency} ${goal.targetAmount.toFixed(2)}.`,
          date: new Date().toISOString().slice(0, 10),
          type: 'goal_completed',
        });
        set((prev) => ({ milestones: [milestone, ...prev.milestones] }));

        if (goal.status !== 'completed') {
          await setGoalStatus(goal.id, 'completed');
          set((prev) => ({
            goals: prev.goals.map((item) => (item.id === goal.id ? { ...item, status: 'completed' } : item)),
          }));
        }
      }
    }

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

export function getLatestTransactions(limit: number): Transaction[] {
  return useFinanceStore.getState().transactions.slice(0, limit);
}

export function getExchangeRateMap(): Record<string, number> {
  return Object.fromEntries(
    useFinanceStore.getState().exchangeRates.map((rate) => [`${rate.fromCurrency}-${rate.toCurrency}`, rate.rate]),
  );
}
