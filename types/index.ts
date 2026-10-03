export type TransactionType = 'income' | 'expense' | 'savings';
// A user-managed list of ISO-ish currency codes (see Settings → Currencies), not a fixed union.
export type CurrencyCode = string;

export interface Currency {
  code: string;
  name: string;
  isDefault: boolean;
}

export interface Category {
  id: string;
  name: string;
  type: TransactionType;
  icon: string;
  color: string;
  isDefault: boolean;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  currency: CurrencyCode;
  category: string;
  source: string;
  date: string;
  timestamp: string;
  note: string | null;
  goalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionInput {
  type: TransactionType;
  amount: number;
  currency: CurrencyCode;
  category: string;
  source: string;
  date: string;
  note?: string | null;
  goalId?: string | null;
}

export interface ExchangeRate {
  id: string;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  rate: number;
  updatedAt: string;
}

export type GoalStatus = 'active' | 'completed' | 'abandoned';

export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  currency: CurrencyCode;
  deadline: string | null;
  status: GoalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface GoalInput {
  name: string;
  targetAmount: number;
  currency: CurrencyCode;
  deadline?: string | null;
}

export interface Budget {
  id: string;
  category: string;
  monthlyLimit: number;
  currency: CurrencyCode;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetInput {
  category: string;
  monthlyLimit: number;
  currency: CurrencyCode;
}

export type RecurringFrequency = 'daily' | 'weekly' | 'monthly';

export interface RecurringTransaction {
  id: string;
  type: TransactionType;
  amount: number;
  currency: CurrencyCode;
  category: string;
  source: string;
  note: string | null;
  frequency: RecurringFrequency;
  startDate: string;
  lastGeneratedDate: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringTransactionInput {
  type: TransactionType;
  amount: number;
  currency: CurrencyCode;
  category: string;
  source: string;
  note?: string | null;
  frequency: RecurringFrequency;
  startDate: string;
}

export type MilestoneType = 'goal_completed' | 'streak' | 'income_growth' | 'manual';

export interface Milestone {
  id: string;
  title: string;
  description: string;
  date: string;
  type: MilestoneType;
  createdAt: string;
}

export interface UserOrigin {
  id: string;
  storyText: string;
  startingPoint: string;
  whyBuilding: string;
  updatedAt: string;
}

export interface UserOriginInput {
  storyText: string;
  startingPoint: string;
  whyBuilding: string;
}

export interface MonthlySnapshot {
  id: string;
  month: string;
  income: number;
  expenses: number;
  savings: number;
  currency: CurrencyCode;
  createdAt: string;
}

export interface FinanceStoreState {
  transactions: Transaction[];
  categories: Category[];
  exchangeRates: ExchangeRate[];
  goals: Goal[];
  budgets: Budget[];
  recurringTransactions: RecurringTransaction[];
  milestones: Milestone[];
  origin: UserOrigin | null;
  monthlySnapshots: MonthlySnapshot[];
  currencies: Currency[];
  homeCurrency: CurrencyCode;
  isReady: boolean;
  loadData: () => Promise<void>;
  addTransaction: (input: TransactionInput) => Promise<Transaction>;
  updateTransaction: (id: string, input: TransactionInput) => Promise<Transaction>;
  deleteTransaction: (id: string) => Promise<void>;
  addCategory: (input: Omit<Category, 'id' | 'isDefault'>) => Promise<Category>;
  updateCategory: (id: string, input: Omit<Category, 'id' | 'isDefault'>) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  setHomeCurrency: (currency: CurrencyCode) => void;
  upsertExchangeRate: (fromCurrency: CurrencyCode, toCurrency: CurrencyCode, rate: number) => Promise<ExchangeRate>;
  addCurrency: (code: string, name: string) => Promise<Currency>;
  deleteCurrency: (code: string) => Promise<void>;
  addGoal: (input: GoalInput) => Promise<Goal>;
  updateGoal: (id: string, input: GoalInput) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;
  setGoalStatus: (id: string, status: GoalStatus) => Promise<void>;
  contributeToGoal: (goalId: string, amount: number, currency: CurrencyCode) => Promise<Transaction>;
  upsertBudget: (input: BudgetInput) => Promise<Budget>;
  deleteBudget: (id: string) => Promise<void>;
  addRecurringTransaction: (input: RecurringTransactionInput) => Promise<RecurringTransaction>;
  toggleRecurringTransaction: (id: string, isActive: boolean) => Promise<void>;
  deleteRecurringTransaction: (id: string) => Promise<void>;
  saveOrigin: (input: UserOriginInput) => Promise<UserOrigin>;
  addMilestone: (input: Omit<Milestone, 'id' | 'createdAt'>) => Promise<Milestone>;
}


