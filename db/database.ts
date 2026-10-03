import { openDatabaseSync } from 'expo-sqlite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/expo-sqlite';

import { defaultCategories } from '../constants/categories';
import {
  Account,
  Budget,
  BudgetInput,
  Category,
  CategoryType,
  Currency,
  CurrencyCode,
  Goal,
  GoalInput,
  ExchangeRate,
  Milestone,
  MilestoneType,
  MonthlySnapshot,
  RecurringFailure,
  RecurringFrequency,
  RecurringTransaction,
  RecurringTransactionInput,
  RecurringType,
  Transaction,
  TransferEndpoint,
  UserOrigin,
  UserOriginInput,
} from '../types';
import { assertValidLedger, LedgerError, validateLedger } from '../utils/balances';
import { parseDateKey, toLocalDateKey } from '../utils/dates';
import { advanceDate, getNextDueDate, planRecurringEdit } from '../utils/recurring';
import { buildTransaction } from '../utils/transactions';
import { budgets, categories, currencies, exchangeRates, goals, milestones, monthlySnapshots, recurringTransactions, transactions, userOrigin } from './schema';

export const database = openDatabaseSync('my-finances.db');
export const db = drizzle(database);

function nowIso(): string {
  return new Date().toISOString();
}

// Bump when the ledger schema changes. V2 is a clean-slate data layer (Part V): the ledger tables are
// dropped and recreated once; categories, currencies, rates, budgets and journey data are kept.
const SCHEMA_VERSION = 2;

export async function initializeDatabase(): Promise<void> {
  const versionRow = database.getFirstSync('PRAGMA user_version') as { user_version: number } | null;
  if ((versionRow?.user_version ?? 0) < SCHEMA_VERSION) {
    database.execSync(`
      DROP TABLE IF EXISTS transactions;
      DROP TABLE IF EXISTS goals;
      DROP TABLE IF EXISTS recurring_transactions;
      DROP TABLE IF EXISTS monthly_snapshots;
      PRAGMA user_version = ${SCHEMA_VERSION};
    `);
  }

  database.execSync(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      icon TEXT NOT NULL,
      color TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS currencies (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      amount_etb REAL NOT NULL,
      exchange_rate REAL NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      account TEXT,
      from_account TEXT,
      from_goal_id TEXT,
      to_account TEXT,
      to_goal_id TEXT,
      date TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      note TEXT,
      is_automatic INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS exchange_rates (
      id TEXT PRIMARY KEY,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate REAL NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      target_amount REAL NOT NULL,
      deadline TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      monthly_limit REAL NOT NULL,
      currency TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recurring_transactions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      account TEXT NOT NULL DEFAULT 'available',
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      category TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      note TEXT,
      frequency TEXT NOT NULL,
      start_date TEXT NOT NULL,
      last_generated_date TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_origin (
      id TEXT PRIMARY KEY,
      story_text TEXT NOT NULL DEFAULT '',
      starting_point TEXT NOT NULL DEFAULT '',
      why_building TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS milestones (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS monthly_snapshots (
      id TEXT PRIMARY KEY,
      month TEXT NOT NULL,
      income REAL NOT NULL,
      expenses REAL NOT NULL,
      savings REAL NOT NULL,
      currency TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Added after the V2 schema shipped, so databases created earlier need the column added in place
  // (dropping the table again would wipe real data).
  const transactionColumns = database.getAllSync('PRAGMA table_info(transactions)') as { name: string }[];
  if (!transactionColumns.some((column) => column.name === 'is_automatic')) {
    database.execSync('ALTER TABLE transactions ADD COLUMN is_automatic INTEGER NOT NULL DEFAULT 0');
  }

  const countResult = database.getAllSync('SELECT COUNT(*) AS count FROM categories') as Array<{ count: number }>;
  const totalCategories = Number(countResult[0]?.count ?? 0);

  if (totalCategories === 0) {
    database.execSync('BEGIN');
    for (const category of defaultCategories) {
      database.runSync(
        'INSERT INTO categories (id, name, type, icon, color, is_default) VALUES (?, ?, ?, ?, ?, ?)',
        category.id,
        category.name,
        category.type,
        category.icon,
        category.color,
        category.isDefault ? 1 : 0,
      );
    }
    database.execSync('COMMIT');
  }

  const defaultRates = [
    { fromCurrency: 'ETB', toCurrency: 'USD', rate: 0.0083 },
    { fromCurrency: 'USD', toCurrency: 'ETB', rate: 120.48 },
    { fromCurrency: 'ETB', toCurrency: 'EUR', rate: 0.0076 },
    { fromCurrency: 'EUR', toCurrency: 'ETB', rate: 131.58 },
    { fromCurrency: 'ETB', toCurrency: 'GBP', rate: 0.0065 },
    { fromCurrency: 'GBP', toCurrency: 'ETB', rate: 153.85 },
  ] as const;

  const rateCount = database.getAllSync('SELECT COUNT(*) AS count FROM exchange_rates') as Array<{ count: number }>;
  if (Number(rateCount[0]?.count ?? 0) === 0) {
    database.execSync('BEGIN');
    for (const entry of defaultRates) {
      const id = `${entry.fromCurrency}-${entry.toCurrency}`;
      database.runSync(
        'INSERT INTO exchange_rates (id, from_currency, to_currency, rate, updated_at) VALUES (?, ?, ?, ?, ?)',
        id,
        entry.fromCurrency,
        entry.toCurrency,
        entry.rate,
        nowIso(),
      );
    }
    database.execSync('COMMIT');
  }

  const defaultCurrencies = [
    { code: 'ETB', name: 'Ethiopian Birr' },
    { code: 'USD', name: 'US Dollar' },
    { code: 'EUR', name: 'Euro' },
    { code: 'GBP', name: 'British Pound' },
  ] as const;

  const currencyCount = database.getAllSync('SELECT COUNT(*) AS count FROM currencies') as Array<{ count: number }>;
  if (Number(currencyCount[0]?.count ?? 0) === 0) {
    database.execSync('BEGIN');
    for (const entry of defaultCurrencies) {
      database.runSync(
        'INSERT INTO currencies (code, name, is_default) VALUES (?, ?, ?)',
        entry.code,
        entry.name,
        1,
      );
    }
    database.execSync('COMMIT');
  }
}

export async function getCategories(): Promise<Category[]> {
  const rows = database.getAllSync(
    'SELECT id, name, type, icon, color, is_default AS isDefault FROM categories ORDER BY name ASC',
  ) as Array<{
    id: string;
    name: string;
    type: CategoryType;
    icon: string;
    color: string;
    isDefault: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    icon: row.icon,
    color: row.color,
    isDefault: Boolean(row.isDefault),
  }));
}

type TransactionRow = {
  id: string;
  type: Transaction['type'];
  amount: number;
  currency: CurrencyCode;
  amount_etb: number;
  exchange_rate: number;
  category: string;
  source: string;
  account: Account | null;
  from_account: TransferEndpoint | null;
  from_goal_id: string | null;
  to_account: TransferEndpoint | null;
  to_goal_id: string | null;
  date: string;
  timestamp: string;
  note: string | null;
  is_automatic: number;
  created_at: string;
  updated_at: string;
};

function mapTransactionRow(row: TransactionRow): Transaction {
  return {
    id: row.id,
    type: row.type,
    amount: Number(row.amount),
    currency: row.currency,
    amountETB: Number(row.amount_etb),
    exchangeRate: Number(row.exchange_rate),
    category: row.category,
    source: row.source,
    account: row.account,
    fromAccount: row.from_account,
    fromGoalId: row.from_goal_id,
    toAccount: row.to_account,
    toGoalId: row.to_goal_id,
    date: row.date,
    timestamp: row.timestamp,
    note: row.note,
    isAutomatic: Boolean(row.is_automatic),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getTransactions(): Promise<Transaction[]> {
  const rows = database.getAllSync(
    'SELECT * FROM transactions ORDER BY date DESC, timestamp DESC',
  ) as TransactionRow[];

  return rows.map(mapTransactionRow);
}

export async function getExchangeRates(): Promise<ExchangeRate[]> {
  const rows = database.getAllSync(
    'SELECT id, from_currency AS fromCurrency, to_currency AS toCurrency, rate, updated_at AS updatedAt FROM exchange_rates',
  ) as Array<{
    id: string;
    fromCurrency: CurrencyCode;
    toCurrency: CurrencyCode;
    rate: number;
    updatedAt: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    fromCurrency: row.fromCurrency,
    toCurrency: row.toCurrency,
    rate: Number(row.rate),
    updatedAt: row.updatedAt,
  }));
}

// Raw ledger writes. Callers are responsible for validating the resulting ledger first
// (see commitTransaction in store/finance.ts and generateDueRecurringTransactions below).
export async function insertTransaction(transaction: Transaction): Promise<void> {
  database.runSync(
    `INSERT INTO transactions
      (id, type, amount, currency, amount_etb, exchange_rate, category, source, account,
       from_account, from_goal_id, to_account, to_goal_id, date, timestamp, note, is_automatic, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    transaction.id,
    transaction.type,
    transaction.amount,
    transaction.currency,
    transaction.amountETB,
    transaction.exchangeRate,
    transaction.category,
    transaction.source,
    transaction.account,
    transaction.fromAccount,
    transaction.fromGoalId,
    transaction.toAccount,
    transaction.toGoalId,
    transaction.date,
    transaction.timestamp,
    transaction.note,
    // Backups made before this column existed have no value.
    transaction.isAutomatic ? 1 : 0,
    transaction.createdAt,
    transaction.updatedAt,
  );
}

// Editing a ledger row is just overwriting that row (V2 Part G) - no reverse/re-apply step.
export async function updateTransaction(transaction: Transaction): Promise<void> {
  database.runSync(
    `UPDATE transactions
      SET type = ?, amount = ?, currency = ?, amount_etb = ?, exchange_rate = ?, category = ?, source = ?,
          account = ?, from_account = ?, from_goal_id = ?, to_account = ?, to_goal_id = ?,
          date = ?, note = ?, updated_at = ?
      WHERE id = ?`,
    transaction.type,
    transaction.amount,
    transaction.currency,
    transaction.amountETB,
    transaction.exchangeRate,
    transaction.category,
    transaction.source,
    transaction.account,
    transaction.fromAccount,
    transaction.fromGoalId,
    transaction.toAccount,
    transaction.toGoalId,
    transaction.date,
    transaction.note,
    transaction.updatedAt,
    transaction.id,
  );
}

export async function deleteTransaction(id: string): Promise<void> {
  database.runSync('DELETE FROM transactions WHERE id = ?', id);
}

export async function addCategory(input: Omit<Category, 'id' | 'isDefault'>): Promise<Category> {
  const category: Category = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ...input,
    isDefault: false,
  };

  database.runSync(
    'INSERT INTO categories (id, name, type, icon, color, is_default) VALUES (?, ?, ?, ?, ?, ?)',
    category.id,
    category.name,
    category.type,
    category.icon,
    category.color,
    0,
  );

  return category;
}

// Transactions, budgets and recurring rules reference a category by NAME, so renaming one must carry
// them along - otherwise old spending silently drops out of its budget and category totals.
export async function updateCategory(id: string, input: Omit<Category, 'id' | 'isDefault'>): Promise<void> {
  const previous = database.getFirstSync('SELECT name, type FROM categories WHERE id = ?', id) as
    | { name: string; type: CategoryType }
    | null;

  if (previous && previous.name !== input.name) {
    // Only income/expense categories are referenced by ledger rows; match on type so an income
    // category and an expense category that share a name stay independent.
    if (previous.type === 'income' || previous.type === 'expense') {
      database.runSync('UPDATE transactions SET category = ? WHERE category = ? AND type = ?', input.name, previous.name, previous.type);
      database.runSync('UPDATE recurring_transactions SET category = ? WHERE category = ? AND type = ?', input.name, previous.name, previous.type);
    }
    if (previous.type === 'expense') {
      database.runSync('UPDATE budgets SET category = ? WHERE category = ?', input.name, previous.name);
    }
  }

  database.runSync(
    'UPDATE categories SET name = ?, type = ?, icon = ?, color = ? WHERE id = ?',
    input.name,
    input.type,
    input.icon,
    input.color,
    id,
  );
}

export async function deleteCategory(id: string): Promise<void> {
  database.runSync('DELETE FROM categories WHERE id = ?', id);
}

export async function getCurrencies(): Promise<Currency[]> {
  const rows = database.getAllSync(
    'SELECT code, name, is_default AS isDefault FROM currencies ORDER BY is_default DESC, code ASC',
  ) as Array<{ code: string; name: string; isDefault: number }>;

  return rows.map((row) => ({ code: row.code, name: row.name, isDefault: Boolean(row.isDefault) }));
}

export async function addCurrency(code: string, name: string): Promise<Currency> {
  const normalizedCode = code.trim().toUpperCase();
  database.runSync(
    'INSERT INTO currencies (code, name, is_default) VALUES (?, ?, 0) ON CONFLICT(code) DO UPDATE SET name = excluded.name',
    normalizedCode,
    name.trim() || normalizedCode,
  );
  return { code: normalizedCode, name: name.trim() || normalizedCode, isDefault: false };
}

export async function deleteCurrency(code: string): Promise<void> {
  database.runSync('DELETE FROM currencies WHERE code = ? AND is_default = 0', code);
}

export async function upsertExchangeRate(
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  rate: number,
): Promise<ExchangeRate> {
  const entry: ExchangeRate = {
    id: `${fromCurrency}-${toCurrency}`,
    fromCurrency,
    toCurrency,
    rate,
    updatedAt: nowIso(),
  };

  database.runSync(
    `INSERT INTO exchange_rates (id, from_currency, to_currency, rate, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET rate = excluded.rate, updated_at = excluded.updated_at`,
    entry.id,
    entry.fromCurrency,
    entry.toCurrency,
    entry.rate,
    entry.updatedAt,
  );

  return entry;
}

export async function insertDefaultCategorySeed(): Promise<void> {
  const currentCategories = await getCategories();
  if (currentCategories.length > 0) {
    return;
  }

  database.execSync('BEGIN');
  for (const category of defaultCategories) {
    database.runSync(
      'INSERT INTO categories (id, name, type, icon, color, is_default) VALUES (?, ?, ?, ?, ?, ?)',
      category.id,
      category.name,
      category.type,
      category.icon,
      category.color,
      category.isDefault ? 1 : 0,
    );
  }
  database.execSync('COMMIT');
}

export async function getGoals(): Promise<Goal[]> {
  const rows = database.getAllSync(
    'SELECT id, name, target_amount AS targetAmount, deadline, status, created_at AS createdAt, updated_at AS updatedAt FROM goals ORDER BY created_at ASC',
  ) as Array<{
    id: string;
    name: string;
    targetAmount: number;
    deadline: string | null;
    status: Goal['status'];
    createdAt: string;
    updatedAt: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    targetAmount: Number(row.targetAmount),
    deadline: row.deadline,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function addGoal(input: GoalInput): Promise<Goal> {
  const now = nowIso();
  const goal: Goal = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: input.name.trim(),
    targetAmount: Number(input.targetAmount),
    deadline: input.deadline ?? null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  database.runSync(
    'INSERT INTO goals (id, name, target_amount, deadline, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    goal.id,
    goal.name,
    goal.targetAmount,
    goal.deadline,
    goal.status,
    goal.createdAt,
    goal.updatedAt,
  );

  return goal;
}

export async function setGoalStatus(id: string, status: Goal['status']): Promise<void> {
  database.runSync('UPDATE goals SET status = ?, updated_at = ? WHERE id = ?', status, nowIso(), id);
}

export async function updateGoal(id: string, input: GoalInput): Promise<void> {
  database.runSync(
    'UPDATE goals SET name = ?, target_amount = ?, deadline = ?, updated_at = ? WHERE id = ?',
    input.name.trim(),
    Number(input.targetAmount),
    input.deadline ?? null,
    nowIso(),
    id,
  );
}

export async function deleteGoal(id: string): Promise<void> {
  database.runSync('DELETE FROM goals WHERE id = ?', id);
}

export async function getBudgets(): Promise<Budget[]> {
  const rows = database.getAllSync(
    'SELECT id, category, monthly_limit AS monthlyLimit, currency, created_at AS createdAt, updated_at AS updatedAt FROM budgets ORDER BY category ASC',
  ) as Array<{
    id: string;
    category: string;
    monthlyLimit: number;
    currency: CurrencyCode;
    createdAt: string;
    updatedAt: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    monthlyLimit: Number(row.monthlyLimit),
    currency: row.currency,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function upsertBudget(input: BudgetInput): Promise<Budget> {
  const now = nowIso();
  const existing = database.getAllSync(
    'SELECT id, created_at AS createdAt FROM budgets WHERE category = ?',
    input.category,
  ) as Array<{ id: string; createdAt: string }>;

  const budget: Budget = {
    id: existing[0]?.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    category: input.category,
    monthlyLimit: Number(input.monthlyLimit),
    currency: input.currency,
    createdAt: existing[0]?.createdAt ?? now,
    updatedAt: now,
  };

  database.runSync(
    `INSERT INTO budgets (id, category, monthly_limit, currency, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET monthly_limit = excluded.monthly_limit, currency = excluded.currency, updated_at = excluded.updated_at`,
    budget.id,
    budget.category,
    budget.monthlyLimit,
    budget.currency,
    budget.createdAt,
    budget.updatedAt,
  );

  return budget;
}

export async function deleteBudget(id: string): Promise<void> {
  database.runSync('DELETE FROM budgets WHERE id = ?', id);
}

export interface BackupPayload {
  version: 2;
  exportedAt: string;
  categories: Category[];
  transactions: Transaction[];
  exchangeRates: ExchangeRate[];
  goals: Goal[];
  budgets: Budget[];
}

export async function exportAllData(): Promise<BackupPayload> {
  const [categoriesData, transactionsData, exchangeRatesData, goalsData, budgetsData] = await Promise.all([
    getCategories(),
    getTransactions(),
    getExchangeRates(),
    getGoals(),
    getBudgets(),
  ]);

  return {
    version: 2,
    exportedAt: nowIso(),
    categories: categoriesData,
    transactions: transactionsData,
    exchangeRates: exchangeRatesData,
    goals: goalsData,
    budgets: budgetsData,
  };
}

export async function importAllData(payload: BackupPayload): Promise<void> {
  // V1 backups have no amountETB / transfer model and cannot be turned into a valid V2 ledger.
  if (payload.version !== 2) {
    throw new Error('This backup was made by an older version of the app and cannot be restored.');
  }

  // Never import a ledger that would show a negative balance.
  const goalNames = Object.fromEntries(payload.goals.map((goal) => [goal.id, goal.name]));
  assertValidLedger(payload.transactions, goalNames);

  database.execSync('BEGIN');
  try {
    database.execSync('DELETE FROM transactions');
    database.execSync('DELETE FROM categories');
    database.execSync('DELETE FROM exchange_rates');
    database.execSync('DELETE FROM goals');
    database.execSync('DELETE FROM budgets');

    for (const category of payload.categories) {
      database.runSync(
        'INSERT INTO categories (id, name, type, icon, color, is_default) VALUES (?, ?, ?, ?, ?, ?)',
        category.id,
        category.name,
        category.type,
        category.icon,
        category.color,
        category.isDefault ? 1 : 0,
      );
    }

    for (const transaction of payload.transactions) {
      await insertTransaction(transaction);
    }

    for (const rate of payload.exchangeRates) {
      database.runSync(
        'INSERT INTO exchange_rates (id, from_currency, to_currency, rate, updated_at) VALUES (?, ?, ?, ?, ?)',
        rate.id,
        rate.fromCurrency,
        rate.toCurrency,
        rate.rate,
        rate.updatedAt,
      );
    }

    for (const goal of payload.goals) {
      database.runSync(
        'INSERT INTO goals (id, name, target_amount, deadline, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        goal.id,
        goal.name,
        goal.targetAmount,
        goal.deadline ?? null,
        goal.status ?? 'active',
        goal.createdAt,
        goal.updatedAt,
      );
    }

    for (const budget of payload.budgets) {
      database.runSync(
        'INSERT INTO budgets (id, category, monthly_limit, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        budget.id,
        budget.category,
        budget.monthlyLimit,
        budget.currency,
        budget.createdAt,
        budget.updatedAt,
      );
    }

    database.execSync('COMMIT');
  } catch (error) {
    database.execSync('ROLLBACK');
    throw error;
  }
}

function mapRecurringRow(row: {
  id: string;
  type: RecurringType;
  account: Account;
  amount: number;
  currency: CurrencyCode;
  category: string;
  source: string;
  note: string | null;
  frequency: RecurringFrequency;
  startDate: string;
  lastGeneratedDate: string | null;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}): RecurringTransaction {
  return {
    id: row.id,
    type: row.type,
    account: row.account,
    amount: Number(row.amount),
    currency: row.currency,
    category: row.category,
    source: row.source,
    note: row.note,
    frequency: row.frequency,
    startDate: row.startDate,
    lastGeneratedDate: row.lastGeneratedDate,
    isActive: Boolean(row.isActive),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getRecurringTransactions(): Promise<RecurringTransaction[]> {
  const rows = database.getAllSync(
    `SELECT id, type, account, amount, currency, category, source, note, frequency,
      start_date AS startDate, last_generated_date AS lastGeneratedDate, is_active AS isActive,
      created_at AS createdAt, updated_at AS updatedAt
     FROM recurring_transactions ORDER BY created_at DESC`,
  ) as Array<Parameters<typeof mapRecurringRow>[0]>;

  return rows.map(mapRecurringRow);
}

export async function addRecurringTransaction(input: RecurringTransactionInput): Promise<RecurringTransaction> {
  const now = nowIso();
  const recurring: RecurringTransaction = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: input.type,
    account: input.account,
    amount: Number(input.amount),
    currency: input.currency,
    category: input.category,
    source: input.source.trim(),
    note: input.note?.trim() ? input.note.trim() : null,
    frequency: input.frequency,
    startDate: input.startDate,
    lastGeneratedDate: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  database.runSync(
    `INSERT INTO recurring_transactions
      (id, type, account, amount, currency, category, source, note, frequency, start_date, last_generated_date, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    recurring.id,
    recurring.type,
    recurring.account,
    recurring.amount,
    recurring.currency,
    recurring.category,
    recurring.source,
    recurring.note,
    recurring.frequency,
    recurring.startDate,
    recurring.lastGeneratedDate,
    recurring.isActive ? 1 : 0,
    recurring.createdAt,
    recurring.updatedAt,
  );

  return recurring;
}

export async function toggleRecurringTransaction(id: string, isActive: boolean): Promise<void> {
  database.runSync(
    'UPDATE recurring_transactions SET is_active = ?, updated_at = ? WHERE id = ?',
    isActive ? 1 : 0,
    nowIso(),
    id,
  );
}

// Edits change the rule going forward only; occurrences already posted stay as they are.
export async function updateRecurringTransaction(
  id: string,
  input: RecurringTransactionInput,
): Promise<RecurringTransaction> {
  const existing = (await getRecurringTransactions()).find((rule) => rule.id === id);
  if (!existing) {
    throw new Error('Recurring transaction not found');
  }

  const schedule = planRecurringEdit(existing, input);
  const updated: RecurringTransaction = {
    ...existing,
    type: input.type,
    account: input.account,
    amount: Number(input.amount),
    currency: input.currency,
    category: input.category,
    source: input.source.trim(),
    note: input.note?.trim() ? input.note.trim() : null,
    frequency: input.frequency,
    startDate: schedule.startDate,
    lastGeneratedDate: schedule.lastGeneratedDate,
    updatedAt: nowIso(),
  };

  database.runSync(
    `UPDATE recurring_transactions
      SET type = ?, account = ?, amount = ?, currency = ?, category = ?, source = ?, note = ?, frequency = ?,
          start_date = ?, last_generated_date = ?, updated_at = ?
      WHERE id = ?`,
    updated.type,
    updated.account,
    updated.amount,
    updated.currency,
    updated.category,
    updated.source,
    updated.note,
    updated.frequency,
    updated.startDate,
    updated.lastGeneratedDate,
    updated.updatedAt,
    id,
  );

  return updated;
}

export async function deleteRecurringTransaction(id: string): Promise<void> {
  database.runSync('DELETE FROM recurring_transactions WHERE id = ?', id);
}

// Posts every occurrence that has come due. Each one goes through the same ledger validation as a
// manual entry; an occurrence that can't be posted (it would overdraw Available/Saved, or its
// currency has no rate) is skipped and reported back so the UI can notify - never a crash, and
// never a negative balance. A skipped occurrence is not retried: the rule moves on to its next date.
export async function generateDueRecurringTransactions(): Promise<{
  generated: Transaction[];
  failures: RecurringFailure[];
}> {
  const rules = await getRecurringTransactions();
  const rates = await getExchangeRates();
  const goalNames = Object.fromEntries((await getGoals()).map((goal) => [goal.id, goal.name]));
  const ledger = await getTransactions();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const generated: Transaction[] = [];
  const failures: RecurringFailure[] = [];

  for (const rule of rules) {
    if (!rule.isActive) {
      continue;
    }

    // Same schedule maths as the Recurring screen (utils/recurring.ts), including month-end clamping.
    let nextDue = getNextDueDate(rule);
    const anchorDay = parseDateKey(rule.startDate).getDate();

    let iterations = 0;
    let lastGenerated = rule.lastGeneratedDate;

    while (nextDue <= today && iterations < 366) {
      const dateString = toLocalDateKey(nextDue);

      try {
        const transaction = buildTransaction(
          {
            type: rule.type,
            account: rule.account,
            amount: rule.amount,
            currency: rule.currency,
            category: rule.category,
            source: rule.source || 'Recurring',
            date: dateString,
            note: rule.note,
            isAutomatic: true,
          },
          rates,
        );
        const problem = validateLedger([...ledger, transaction], goalNames);
        if (problem) {
          throw problem;
        }

        await insertTransaction(transaction);
        ledger.push(transaction);
        generated.push(transaction);
      } catch (error) {
        if (!(error instanceof LedgerError)) {
          throw error;
        }
        failures.push({ ruleId: rule.id, category: rule.category, date: dateString, reason: error.message });
      }

      lastGenerated = dateString;
      nextDue = advanceDate(nextDue, rule.frequency, anchorDay);
      iterations += 1;
    }

    if (lastGenerated !== rule.lastGeneratedDate) {
      database.runSync(
        'UPDATE recurring_transactions SET last_generated_date = ?, updated_at = ? WHERE id = ?',
        lastGenerated,
        nowIso(),
        rule.id,
      );
    }
  }

  return { generated, failures };
}

export async function getOrigin(): Promise<UserOrigin | null> {
  const rows = database.getAllSync(
    'SELECT id, story_text AS storyText, starting_point AS startingPoint, why_building AS whyBuilding, updated_at AS updatedAt FROM user_origin LIMIT 1',
  ) as Array<{ id: string; storyText: string; startingPoint: string; whyBuilding: string; updatedAt: string }>;

  if (rows.length === 0) {
    return null;
  }

  return rows[0];
}

export async function upsertOrigin(input: UserOriginInput): Promise<UserOrigin> {
  const existing = await getOrigin();
  const now = nowIso();
  const origin: UserOrigin = {
    id: existing?.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    storyText: input.storyText.trim(),
    startingPoint: input.startingPoint.trim(),
    whyBuilding: input.whyBuilding.trim(),
    updatedAt: now,
  };

  database.runSync(
    `INSERT INTO user_origin (id, story_text, starting_point, why_building, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET story_text = excluded.story_text, starting_point = excluded.starting_point,
        why_building = excluded.why_building, updated_at = excluded.updated_at`,
    origin.id,
    origin.storyText,
    origin.startingPoint,
    origin.whyBuilding,
    origin.updatedAt,
  );

  return origin;
}

export async function getMilestones(): Promise<Milestone[]> {
  const rows = database.getAllSync(
    'SELECT id, title, description, date, type, created_at AS createdAt FROM milestones ORDER BY date DESC',
  ) as Array<{ id: string; title: string; description: string; date: string; type: MilestoneType; createdAt: string }>;

  return rows;
}

export async function addMilestone(input: Omit<Milestone, 'id' | 'createdAt'>): Promise<Milestone> {
  const milestone: Milestone = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: input.title,
    description: input.description,
    date: input.date,
    type: input.type,
    createdAt: nowIso(),
  };

  database.runSync(
    'INSERT INTO milestones (id, title, description, date, type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    milestone.id,
    milestone.title,
    milestone.description,
    milestone.date,
    milestone.type,
    milestone.createdAt,
  );

  return milestone;
}

export async function getMonthlySnapshots(): Promise<MonthlySnapshot[]> {
  const rows = database.getAllSync(
    'SELECT id, month, income, expenses, savings, currency, created_at AS createdAt FROM monthly_snapshots ORDER BY month ASC',
  ) as Array<{
    id: string;
    month: string;
    income: number;
    expenses: number;
    savings: number;
    currency: CurrencyCode;
    createdAt: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    month: row.month,
    income: Number(row.income),
    expenses: Number(row.expenses),
    savings: Number(row.savings),
    currency: row.currency,
    createdAt: row.createdAt,
  }));
}

export async function addMonthlySnapshotIfMissing(
  month: string,
  income: number,
  expenses: number,
  savings: number,
  currency: CurrencyCode,
): Promise<MonthlySnapshot | null> {
  const existing = database.getAllSync('SELECT id FROM monthly_snapshots WHERE month = ?', month) as Array<{
    id: string;
  }>;

  if (existing.length > 0) {
    return null;
  }

  const snapshot: MonthlySnapshot = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    month,
    income,
    expenses,
    savings,
    currency,
    createdAt: nowIso(),
  };

  database.runSync(
    'INSERT INTO monthly_snapshots (id, month, income, expenses, savings, currency, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    snapshot.id,
    snapshot.month,
    snapshot.income,
    snapshot.expenses,
    snapshot.savings,
    snapshot.currency,
    snapshot.createdAt,
  );

  return snapshot;
}

export { categories, currencies, transactions, exchangeRates, goals, budgets, recurringTransactions, userOrigin, milestones, monthlySnapshots, eq };
