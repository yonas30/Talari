import { useMemo } from 'react';
import { create } from 'zustand';

import {
  addCategory,
  addCurrency,
  addMilestone,
  addMonthlySnapshotIfMissing,
  addRecurringTransaction,
  deleteBudget,
  deleteCategory,
  deleteCurrency,
  deleteRecurringTransaction,
  generateDueRecurringTransactions,
  getBudgets,
  getCategories,
  getCurrencies,
  getExchangeRates,
  getMilestones,
  getMonthlySnapshots,
  getOrigin,
  getReadNotificationIds,
  getRecurringTransactions,
  deleteReserveNotifications,
  initializeDatabase,
  readLedger,
  saveLedgerDiff,
  toggleRecurringTransaction,
  updateCategory,
  updateRecurringTransaction,
  upsertBudget,
  upsertExchangeRate,
  upsertOrigin,
} from '../db/database';
import {
  Budget,
  BudgetInput,
  Category,
  Currency,
  CurrencyCode,
  ExchangeRate,
  GoalStatus,
  Milestone,
  MilestoneInput,
  MonthlySnapshot,
  RecurringTransaction,
  RecurringTransactionInput,
  UserOrigin,
  UserOriginInput,
} from '../types';
import { AccountEntry, AccountGoal, AccountsState, GoalAllocation, MoneyAccount, ReserveNotification } from '../types/accounts';
import { defaultCtx } from '../utils/accounts/context';
import { EntryInput, planAddEntry, planDeleteEntry, planEditEntry } from '../utils/accounts/entries';
import { GoalInput, planAddToGoal, planCreateGoal, planDeleteGoal, planMoveGoal, planWithdrawFromGoal } from '../utils/accounts/goals';
import {
  AccountInput,
  checkCurrencyRemovable,
  planArchiveAccount,
  planChangeAccountCurrency,
  planCreateAccount,
  planDeleteAccount,
  planRenameAccount,
} from '../utils/accounts/manage';
import { expiredIds, markReserveRead } from '../utils/accounts/notificationRetention';
import { WriteResult } from '../utils/accounts/reserve';
import { getNetSavingsChange, getPeriodSummary, getTotals, TotalsSummary } from '../utils/accounts/totals';
import { getGoalProgress, nextGoalStatus } from '../utils/currency';
import { todayKey } from '../utils/dates';
import { hasCompletionMilestone } from '../utils/milestones';
import { goalNotificationItems } from '../utils/notificationList';
import { useUiStore } from './ui';

export interface FinanceStoreState {
  accounts: MoneyAccount[];
  // The whole ledger, newest first: income, expense, transfer, and the system rows (opening balance, adjustment) and transfer fees.
  transactions: AccountEntry[];
  goals: AccountGoal[];
  // Append-only; a goal's amount and an account's reserved money are sums over these rows (V2_SPEC Part C).
  allocations: GoalAllocation[];
  // "Reserved money was used" events. Saved here; the notifications page shows them from Phase 5D.
  reserveNotifications: ReserveNotification[];
  categories: Category[];
  exchangeRates: ExchangeRate[];
  budgets: Budget[];
  recurringTransactions: RecurringTransaction[];
  milestones: Milestone[];
  origin: UserOrigin | null;
  monthlySnapshots: MonthlySnapshot[];
  currencies: Currency[];
  homeCurrency: CurrencyCode;
  isReady: boolean;
  loadData: () => Promise<void>;

  addAccount: (input: AccountInput) => Promise<MoneyAccount>;
  archiveAccount: (id: string) => Promise<void>;
  deleteAccount: (id: string) => Promise<void>;
  changeAccountCurrency: (id: string, currency: CurrencyCode) => Promise<void>;
  renameAccount: (id: string, name: string) => Promise<void>;

  addTransaction: (input: EntryInput) => Promise<WriteResult>;
  updateTransaction: (id: string, input: EntryInput) => Promise<WriteResult>;
  deleteTransaction: (id: string) => Promise<WriteResult>;

  addCategory: (input: Omit<Category, 'id' | 'isDefault'>) => Promise<Category>;
  updateCategory: (id: string, input: Omit<Category, 'id' | 'isDefault'>) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  setHomeCurrency: (currency: CurrencyCode) => void;
  upsertExchangeRate: (fromCurrency: CurrencyCode, toCurrency: CurrencyCode, rate: number) => Promise<ExchangeRate>;
  addCurrency: (code: string, name: string) => Promise<Currency>;
  deleteCurrency: (code: string) => Promise<void>;

  addGoal: (input: GoalInput) => Promise<AccountGoal>;
  updateGoal: (id: string, input: { name: string; targetAmount: number; deadline?: string | null }) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;
  moveGoal: (id: string, accountId: string) => Promise<void>;
  setGoalStatus: (id: string, status: GoalStatus) => Promise<void>;
  // Reserve money inside the goal's account, or free it again. Neither creates a ledger entry.
  addToGoal: (goalId: string, amount: number) => Promise<void>;
  withdrawFromGoal: (goalId: string, amount: number) => Promise<void>;

  upsertBudget: (input: BudgetInput) => Promise<Budget>;
  deleteBudget: (id: string) => Promise<void>;
  addRecurringTransaction: (input: RecurringTransactionInput) => Promise<RecurringTransaction>;
  updateRecurringTransaction: (id: string, input: RecurringTransactionInput) => Promise<RecurringTransaction>;
  toggleRecurringTransaction: (id: string, isActive: boolean) => Promise<void>;
  deleteRecurringTransaction: (id: string) => Promise<void>;
  saveOrigin: (input: UserOriginInput) => Promise<UserOrigin>;
  addMilestone: (input: MilestoneInput) => Promise<Milestone>;
  // Marks saved "reserved money was used" notifications read (the given ones, or all), so a restored backup keeps them read too. (The page's own
  // seen-state is marked by the page, as for budget alerts.)
  markReserveNotificationsRead: (ids?: string[]) => Promise<void>;
  // "Clear all": deletes the saved goal notifications (and their read records) and marks the current budget alerts read.
  clearReserveNotifications: () => Promise<void>;
}

function byNewestFirst(a: AccountEntry, b: AccountEntry): number {
  return a.date === b.date ? b.timestamp.localeCompare(a.timestamp) : b.date.localeCompare(a.date);
}

// The slice of the store the pure ledger functions read. Rates and the currency list come from the same store.
export function getAccountsState(): AccountsState {
  const state = useFinanceStore.getState();
  return {
    accounts: state.accounts,
    entries: state.transactions,
    goals: state.goals,
    allocations: state.allocations,
    notifications: state.reserveNotifications,
    rates: state.exchangeRates,
    currencies: state.currencies.map((currency) => currency.code),
  };
}

// The same slice as a hook: memoised, so a screen re-renders only when one of the ledger arrays actually changed.
export function useAccountsState(): AccountsState {
  const accounts = useFinanceStore((state) => state.accounts);
  const entries = useFinanceStore((state) => state.transactions);
  const goals = useFinanceStore((state) => state.goals);
  const allocations = useFinanceStore((state) => state.allocations);
  const notifications = useFinanceStore((state) => state.reserveNotifications);
  const rates = useFinanceStore((state) => state.exchangeRates);
  const currencies = useFinanceStore((state) => state.currencies);
  return useMemo(
    () => ({ accounts, entries, goals, allocations, notifications, rates, currencies: currencies.map((currency) => currency.code) }),
    [accounts, entries, goals, allocations, notifications, rates, currencies],
  );
}

// Per-account balances, reserved money and the ETB total (V2_SPEC Part C) - always derived from the ledger, never stored.
export function useTotals(): TotalsSummary {
  const state = useAccountsState();
  return useMemo(() => getTotals(state), [state]);
}

// Shows the saved goal notifications on the Notifications page and in the bell badge. Called whenever they may have changed: after the data
// loads and after every ledger write (a write that used reserved money has just added some).
function syncReserveNotifications(): void {
  const { reserveNotifications, goals } = useFinanceStore.getState();
  const ui = useUiStore.getState();
  ui.replaceGoalNotifications(goalNotificationItems(reserveNotifications, goals, ui.readIds));
}

// Saves the difference to SQLite first (one transaction), and only then updates what the screens see, so a failed save leaves the screen
// and the database in step.
function saveLedger(next: AccountsState): void {
  saveLedgerDiff(getAccountsState(), next);
  useFinanceStore.setState({
    accounts: next.accounts,
    transactions: [...next.entries].sort(byNewestFirst),
    goals: next.goals,
    allocations: next.allocations,
    reserveNotifications: next.notifications,
  });
  syncReserveNotifications();
}

export const useFinanceStore = create<FinanceStoreState>((set, get) => ({
  accounts: [],
  transactions: [],
  goals: [],
  allocations: [],
  reserveNotifications: [],
  categories: [],
  exchangeRates: [],
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
    // Before anything can raise a notification, so already-seen ones don't flash up as unread again.
    useUiStore.getState().hydrateReadIds(getReadNotificationIds());
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

    const [categories, exchangeRates, budgets, recurringTransactions] = await Promise.all([
      getCategories(),
      getExchangeRates(),
      getBudgets(),
      getRecurringTransactions(),
    ]);
    const ledger = readLedger();
    // Saved goal notifications are kept for a fixed time after they were created, read or not; older ones go now, with their read records.
    const expired = new Set(expiredIds(ledger.notifications, new Date()));
    if (expired.size > 0) {
      deleteReserveNotifications([...expired]);
      useUiStore.getState().forgetReadIds([...expired]);
    }
    const reserveNotifications = ledger.notifications.filter((item) => !expired.has(item.id));

    const previousMonthDate = new Date();
    previousMonthDate.setDate(1);
    previousMonthDate.setMonth(previousMonthDate.getMonth() - 1);
    const monthKey = `${previousMonthDate.getFullYear()}-${String(previousMonthDate.getMonth() + 1).padStart(2, '0')}`;
    const previousMonth = getPeriodSummary(ledger.entries, monthKey);
    await addMonthlySnapshotIfMissing(
      monthKey,
      previousMonth.income,
      previousMonth.expenses,
      getNetSavingsChange(ledger.allocations, monthKey),
      'ETB',
    );

    const [milestones, origin, monthlySnapshots, currencies] = await Promise.all([
      getMilestones(),
      getOrigin(),
      getMonthlySnapshots(),
      getCurrencies(),
    ]);

    set({
      accounts: ledger.accounts,
      transactions: [...ledger.entries].sort(byNewestFirst),
      goals: ledger.goals,
      allocations: ledger.allocations,
      reserveNotifications,
      categories,
      exchangeRates,
      budgets,
      recurringTransactions,
      milestones,
      origin,
      monthlySnapshots,
      currencies,
      homeCurrency: 'ETB',
      isReady: true,
    });
    syncReserveNotifications();
  },

  addAccount: async (input: AccountInput) => {
    const { state, account } = planCreateAccount(getAccountsState(), input);
    saveLedger(state);
    return account;
  },
  archiveAccount: async (id: string) => {
    saveLedger(planArchiveAccount(getAccountsState(), id));
  },
  deleteAccount: async (id: string) => {
    saveLedger(planDeleteAccount(getAccountsState(), id));
  },
  changeAccountCurrency: async (id: string, currency: CurrencyCode) => {
    saveLedger(planChangeAccountCurrency(getAccountsState(), id, currency));
  },
  renameAccount: async (id: string, name: string) => {
    saveLedger(planRenameAccount(getAccountsState(), id, name));
  },

  // Every write validates the WHOLE resulting ledger first (date-ordered running balance of every account), so a create, edit, delete or
  // back-dated entry that would push an account below zero is rejected with an AccountsError and nothing is written. If it uses money
  // reserved for goals, the goals shrink and a notification is saved with it (V2_SPEC Part E).
  addTransaction: async (input: EntryInput) => {
    const result = planAddEntry(getAccountsState(), input, defaultCtx);
    saveLedger(result.state);
    await reconcileAllGoals();
    return result;
  },
  updateTransaction: async (id: string, input: EntryInput) => {
    const result = planEditEntry(getAccountsState(), id, input, defaultCtx);
    saveLedger(result.state);
    await reconcileAllGoals();
    return result;
  },
  deleteTransaction: async (id: string) => {
    const result = planDeleteEntry(getAccountsState(), id, defaultCtx);
    saveLedger(result.state);
    await reconcileAllGoals();
    return result;
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
  // A currency a non-archived account is held in cannot be removed (utils/accounts/manage.ts: checkCurrencyRemovable has the reasoning).
  deleteCurrency: async (code: string) => {
    const problem = checkCurrencyRemovable(get().accounts, code);
    if (problem) {
      throw problem;
    }
    await deleteCurrency(code);
    set((state) => ({
      currencies: state.currencies.filter((item) => item.code !== code),
    }));
  },

  addGoal: async (input: GoalInput) => {
    const { state, goal } = planCreateGoal(getAccountsState(), input, defaultCtx);
    saveLedger(state);
    return goal;
  },
  updateGoal: async (id: string, input) => {
    const current = getAccountsState();
    saveLedger({
      ...current,
      goals: current.goals.map((goal) =>
        goal.id === id
          ? { ...goal, name: input.name.trim(), targetAmount: input.targetAmount, deadline: input.deadline ?? null, updatedAt: new Date().toISOString() }
          : goal,
      ),
    });
    await reconcileGoal(id);
  },
  // A goal can only be deleted while it holds nothing (utils/accounts/goals.ts): withdraw it first.
  deleteGoal: async (id: string) => {
    // Its saved notifications go with it (the planner removes the rows); so do their read records and any copy in the page's list.
    const gone = getAccountsState().notifications.filter((item) => item.goalId === id).map((item) => item.id);
    saveLedger(planDeleteGoal(getAccountsState(), id));
    deleteReserveNotifications(gone);
    useUiStore.getState().forgetReadIds(gone);
  },
  moveGoal: async (id: string, accountId: string) => {
    saveLedger(planMoveGoal(getAccountsState(), id, accountId, defaultCtx));
  },
  setGoalStatus: async (id: string, status: GoalStatus) => {
    const current = getAccountsState();
    saveLedger({
      ...current,
      goals: current.goals.map((goal) => (goal.id === id ? { ...goal, status, updatedAt: new Date().toISOString() } : goal)),
    });
  },
  addToGoal: async (goalId: string, amount: number) => {
    saveLedger(planAddToGoal(getAccountsState(), goalId, amount, defaultCtx).state);
    await reconcileGoal(goalId);
  },
  withdrawFromGoal: async (goalId: string, amount: number) => {
    saveLedger(planWithdrawFromGoal(getAccountsState(), goalId, amount, defaultCtx).state);
    await reconcileGoal(goalId);
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
  markReserveNotificationsRead: async (ids) => {
    const current = getAccountsState();
    const next = markReserveRead(current.notifications, ids);
    if (next.every((item, index) => item === current.notifications[index])) {
      return;
    }
    saveLedger({ ...current, notifications: next });
  },
  clearReserveNotifications: async () => {
    const current = getAccountsState();
    const gone = current.notifications.map((item) => item.id);
    if (gone.length > 0) {
      saveLedger({ ...current, notifications: [] });
      deleteReserveNotifications(gone);
      useUiStore.getState().forgetReadIds(gone);
    }
    // Budget alerts are worked out from the spending, so they stay; they are marked read.
    useUiStore.getState().clearAllNotifications();
  },
}));

// Keeps a goal's status in step with what it holds: reaching the target completes it (and records the milestone once); dropping back
// below the target - by withdrawing, raising the target, or reserved money being spent - reopens it. Abandoned goals are left alone.
async function reconcileGoal(goalId: string): Promise<void> {
  const state = useFinanceStore.getState();
  const goal = state.goals.find((item) => item.id === goalId);
  if (!goal || goal.status === 'abandoned') {
    return;
  }

  const { percent } = getGoalProgress(goal, state.allocations);
  const nextStatus = nextGoalStatus(goal, state.allocations);

  if (nextStatus) {
    const current = getAccountsState();
    saveLedger({
      ...current,
      goals: current.goals.map((item) => (item.id === goal.id ? { ...item, status: nextStatus, updatedAt: new Date().toISOString() } : item)),
    });
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

// After any ledger write a goal may have changed (reserved money used up, an entry edited): check them all.
async function reconcileAllGoals(): Promise<void> {
  for (const goal of useFinanceStore.getState().goals) {
    await reconcileGoal(goal.id);
  }
}
