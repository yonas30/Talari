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

export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  type: text('type', { enum: ['income', 'expense', 'transfer'] }).notNull(),
  // amount/currency are display-only; amountETB is the only value ever summed (V2 Part D).
  amount: real('amount').notNull(),
  currency: text('currency').notNull(),
  amountETB: real('amount_etb').notNull(),
  exchangeRate: real('exchange_rate').notNull(),
  category: text('category').notNull().default(''),
  source: text('source').notNull().default(''),
  account: text('account', { enum: ['available', 'saved'] }),
  fromAccount: text('from_account', { enum: ['available', 'saved', 'goal'] }),
  fromGoalId: text('from_goal_id'),
  toAccount: text('to_account', { enum: ['available', 'saved', 'goal'] }),
  toGoalId: text('to_goal_id'),
  date: text('date').notNull(),
  timestamp: text('timestamp').notNull(),
  note: text('note'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const goals = sqliteTable('goals', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  targetAmount: real('target_amount').notNull(),
  deadline: text('deadline'),
  status: text('status', { enum: ['active', 'completed', 'abandoned'] }).notNull().default('active'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
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
  account: text('account', { enum: ['available', 'saved'] }).notNull().default('available'),
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

