// What the owner can record. Transfer is its own type (never an expense category) - see V2_SPEC Part B. The ledger row itself
// (AccountEntry, with its extra system types opening and adjustment) is in types/accounts.ts.
export type TransactionType = 'income' | 'expense' | 'transfer';
// Categories only classify income/expense; 'savings' is kept for existing category rows.
export type CategoryType = 'income' | 'expense' | 'savings';
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
  type: CategoryType;
  icon: string;
  color: string;
  isDefault: boolean;
}

export interface ExchangeRate {
  id: string;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  rate: number;
  updatedAt: string;
}

export type GoalStatus = 'active' | 'completed' | 'abandoned';

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
export type RecurringType = 'income' | 'expense';

// A rule posts into one account, in that account's currency (V2_SPEC Part Q).
export interface RecurringTransaction {
  id: string;
  type: RecurringType;
  accountId: string;
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
  type: RecurringType;
  accountId: string;
  amount: number;
  currency: CurrencyCode;
  category: string;
  source: string;
  note?: string | null;
  frequency: RecurringFrequency;
  startDate: string;
}

// An occurrence the recurring generator could not post (e.g. it would overdraw its account).
export interface RecurringFailure {
  ruleId: string;
  category: string;
  date: string;
  reason: string;
}

export type MilestoneType = 'goal_completed' | 'streak' | 'income_growth' | 'manual';

export interface Milestone {
  id: string;
  title: string;
  description: string;
  date: string;
  type: MilestoneType;
  // The goal a goal_completed milestone belongs to (null for streaks / manual entries).
  goalId: string | null;
  createdAt: string;
}

export type MilestoneInput = Omit<Milestone, 'id' | 'createdAt' | 'goalId'> & { goalId?: string | null };

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

// All snapshot amounts are ETB. `savings` is the month's net change in reserved goal money (V2_SPEC Part R).
export interface MonthlySnapshot {
  id: string;
  month: string;
  income: number;
  expenses: number;
  savings: number;
  currency: CurrencyCode;
  createdAt: string;
}
