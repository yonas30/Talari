import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type', { enum: ['income', 'expense', 'savings'] }).notNull(),
  icon: text('icon').notNull(),
  color: text('color').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(true),
});

export const currencies = sqliteTable('currencies', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
});

// Schema 4 (Phase 5, the accounts model). The SQL that creates these tables is db/accountsMigration.ts; this mirrors it for Drizzle.
export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type', { enum: ['cash', 'wallet', 'bank'] }).notNull(),
  currency: text('currency').notNull(),
  colour: text('colour').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  smsSender: text('sms_sender'),
  lastDigits: text('last_digits'),
  createdAt: text('created_at').notNull(),
});

// One immutable ledger row. income / expense / opening / adjustment use account_id; a transfer uses from_account_id / to_account_id and
// carries both legs (amount + to_amount); a transfer's fee is its own expense row with linked_transfer_id set.
export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  type: text('type', { enum: ['income', 'expense', 'transfer', 'opening', 'adjustment'] }).notNull(),
  accountId: text('account_id'),
  // The amount in the account's currency (or the original amount, for a foreign entry on an ETB account); amountETB is what reports use.
  amount: real('amount').notNull(),
  currency: text('currency').notNull(),
  amountETB: real('amount_etb').notNull(),
  exchangeRate: real('exchange_rate').notNull(),
  category: text('category').notNull().default(''),
  source: text('source').notNull().default(''),
  fromAccountId: text('from_account_id'),
  toAccountId: text('to_account_id'),
  toAmount: real('to_amount'),
  toAmountETB: real('to_amount_etb'),
  linkedTransferId: text('linked_transfer_id'),
  date: text('date').notNull(),
  timestamp: text('timestamp').notNull(),
  note: text('note'),
  isAutomatic: integer('is_automatic', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const goals = sqliteTable('goals', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  targetAmount: real('target_amount').notNull(),
  deadline: text('deadline'),
  status: text('status', { enum: ['active', 'completed', 'abandoned'] }).notNull().default('active'),
  heldInAccountId: text('held_in_account_id').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Append-only: a goal's amount is the sum of its rows, an account's reserved money the sum of its rows.
export const goalAllocations = sqliteTable('goal_allocations', {
  id: text('id').primaryKey(),
  goalId: text('goal_id').notNull(),
  accountId: text('account_id').notNull(),
  amount: real('amount').notNull(),
  date: text('date').notNull(),
  kind: text('kind', { enum: ['manual', 'auto_reduce'] }).notNull(),
  createdAt: text('created_at').notNull(),
});

export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['goal_reserve_used'] }).notNull(),
  goalId: text('goal_id').notNull(),
  accountId: text('account_id').notNull(),
  amount: real('amount').notNull(),
  amountAfter: real('amount_after').notNull(),
  createdAt: text('created_at').notNull(),
  read: integer('read', { mode: 'boolean' }).notNull().default(false),
});

export const budgets = sqliteTable('budgets', {
  id: text('id').primaryKey(),
  category: text('category').notNull(),
  monthlyLimit: real('monthly_limit').notNull(),
  currency: text('currency').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const exchangeRates = sqliteTable('exchange_rates', {
  id: text('id').primaryKey(),
  fromCurrency: text('from_currency').notNull(),
  toCurrency: text('to_currency').notNull(),
  rate: real('rate').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const recurringTransactions = sqliteTable('recurring_transactions', {
  id: text('id').primaryKey(),
  type: text('type', { enum: ['income', 'expense'] }).notNull(),
  accountId: text('account_id').notNull(),
  amount: real('amount').notNull(),
  currency: text('currency').notNull(),
  category: text('category').notNull(),
  source: text('source').notNull().default(''),
  note: text('note'),
  frequency: text('frequency', { enum: ['daily', 'weekly', 'monthly'] }).notNull(),
  startDate: text('start_date').notNull(),
  lastGeneratedDate: text('last_generated_date'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const userOrigin = sqliteTable('user_origin', {
  id: text('id').primaryKey(),
  storyText: text('story_text').notNull().default(''),
  startingPoint: text('starting_point').notNull().default(''),
  whyBuilding: text('why_building').notNull().default(''),
  updatedAt: text('updated_at').notNull(),
});

export const milestones = sqliteTable('milestones', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  date: text('date').notNull(),
  type: text('type', { enum: ['goal_completed', 'streak', 'income_growth', 'manual'] }).notNull(),
  createdAt: text('created_at').notNull(),
});

export const monthlySnapshots = sqliteTable('monthly_snapshots', {
  id: text('id').primaryKey(),
  month: text('month').notNull(),
  income: real('income').notNull(),
  expenses: real('expenses').notNull(),
  savings: real('savings').notNull(),
  currency: text('currency', { enum: ['ETB', 'USD', 'EUR', 'GBP'] }).notNull(),
  createdAt: text('created_at').notNull(),
});

