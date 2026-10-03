import { openDatabaseSync } from 'expo-sqlite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/expo-sqlite';

import { defaultCategories } from '../constants/categories';
import {
  Budget,
  BudgetInput,
  Category,
  Currency,
  CurrencyCode,
  Goal,
  GoalInput,
  ExchangeRate,
  Milestone,
  MilestoneType,
  MonthlySnapshot,
  RecurringFrequency,
  RecurringTransaction,
  RecurringTransactionInput,
  Transaction,
  TransactionInput,
  TransactionType,
  UserOrigin,
  UserOriginInput,
} from '../types';
import { budgets, categories, currencies, exchangeRates, goals, milestones, monthlySnapshots, recurringTransactions, transactions, userOrigin } from './schema';

export const database = openDatabaseSync('my-finances.db');
export const db = drizzle(database);

function nowIso(): string {
  return new Date().toISOString();
}

export async function initializeDatabase(): Promise<void> {
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
      category TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      note TEXT,
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
      currency TEXT NOT NULL,
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

  const transactionColumns = database.getAllSync('PRAGMA table_info(transactions)') as Array<{ name: string }>;
  if (!transactionColumns.some((column) => column.name === 'goal_id')) {
    database.execSync('ALTER TABLE transactions ADD COLUMN goal_id TEXT');
  }

  const goalColumns = database.getAllSync('PRAGMA table_info(goals)') as Array<{ name: string }>;
  if (!goalColumns.some((column) => column.name === 'deadline')) {
    database.execSync('ALTER TABLE goals ADD COLUMN deadline TEXT');
  }
  if (!goalColumns.some((column) => column.name === 'status')) {
    database.execSync("ALTER TABLE goals ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
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
    type: TransactionType;
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

export async function getTransactions(): Promise<Transaction[]> {
  const rows = database.getAllSync(
    'SELECT *, goal_id AS goalId FROM transactions ORDER BY date DESC, timestamp DESC',
  ) as Array<{
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
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    amount: Number(row.amount),
    currency: row.currency,
    category: row.category,
    source: row.source,
    date: row.date,
    timestamp: row.timestamp,
    note: row.note,
    goalId: row.goalId,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
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

export async function insertTransaction(input: TransactionInput): Promise<Transaction> {
  const now = nowIso();
  const transaction: Transaction = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: input.type,
    amount: Number(input.amount),
    currency: input.currency,
    category: input.category,
    source: input.source.trim(),
    date: input.date,
    timestamp: now,
    note: input.note?.trim() ? input.note.trim() : null,
    goalId: input.goalId ?? null,
    createdAt: now,
    updatedAt: now,
  };

  database.runSync(
    `INSERT INTO transactions (id, type, amount, currency, category, source, date, timestamp, note, goal_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    transaction.id,
    transaction.type,
    transaction.amount,
    transaction.currency,
    transaction.category,
    transaction.source,
    transaction.date,
    transaction.timestamp,
    transaction.note,
    transaction.goalId,
    transaction.createdAt,
    transaction.updatedAt,
  );

  return transaction;
}

export async function updateTransaction(id: string, input: TransactionInput): Promise<Transaction> {
  const existing = database.getAllSync('SELECT created_at AS createdAt FROM transactions WHERE id = ?', id) as Array<{
    createdAt: string;
  }>;

  if (existing.length === 0) {
    throw new Error('Transaction not found');
  }

  const now = nowIso();
  const transaction: Transaction = {
    id,
    type: input.type,
    amount: Number(input.amount),
    currency: input.currency,
    category: input.category,
    source: input.source.trim(),
    date: input.date,
    timestamp: now,
    note: input.note?.trim() ? input.note.trim() : null,
    goalId: input.goalId ?? null,
    createdAt: existing[0].createdAt,
    updatedAt: now,
  };

  database.runSync(
    `UPDATE transactions
      SET type = ?, amount = ?, currency = ?, category = ?, source = ?, date = ?, note = ?, goal_id = ?, updated_at = ?
      WHERE id = ?`,
    transaction.type,
    transaction.amount,
    transaction.currency,
    transaction.category,
    transaction.source,
    transaction.date,
    transaction.note,
    transaction.goalId,
    transaction.updatedAt,
    id,
  );

  return transaction;
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

export async function updateCategory(id: string, input: Omit<Category, 'id' | 'isDefault'>): Promise<void> {
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
    'SELECT id, name, target_amount AS targetAmount, currency, deadline, status, created_at AS createdAt, updated_at AS updatedAt FROM goals ORDER BY created_at ASC',
  ) as Array<{
    id: string;
    name: string;
    targetAmount: number;
    currency: CurrencyCode;
    deadline: string | null;
    status: Goal['status'];
    createdAt: string;
    updatedAt: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    targetAmount: Number(row.targetAmount),
    currency: row.currency,
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
    currency: input.currency,
    deadline: input.deadline ?? null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  database.runSync(
    'INSERT INTO goals (id, name, target_amount, currency, deadline, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    goal.id,
    goal.name,
    goal.targetAmount,
    goal.currency,
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
    'UPDATE goals SET name = ?, target_amount = ?, currency = ?, deadline = ?, updated_at = ? WHERE id = ?',
    input.name.trim(),
    Number(input.targetAmount),
    input.currency,
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
  version: 1;
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
    version: 1,
    exportedAt: nowIso(),
    categories: categoriesData,
    transactions: transactionsData,
    exchangeRates: exchangeRatesData,
    goals: goalsData,
    budgets: budgetsData,
  };
}

export async function importAllData(payload: BackupPayload): Promise<void> {
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
      database.runSync(
        `INSERT INTO transactions (id, type, amount, currency, category, source, date, timestamp, note, goal_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        transaction.id,
        transaction.type,
        transaction.amount,
        transaction.currency,
        transaction.category,
        transaction.source,
        transaction.date,
        transaction.timestamp,
        transaction.note,
        transaction.goalId,
        transaction.createdAt,
        transaction.updatedAt,
      );
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
        'INSERT INTO goals (id, name, target_amount, currency, deadline, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        goal.id,
        goal.name,
        goal.targetAmount,
        goal.currency,
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
  type: TransactionType;
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
    `SELECT id, type, amount, currency, category, source, note, frequency,
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
      (id, type, amount, currency, category, source, note, frequency, start_date, last_generated_date, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    recurring.id,
    recurring.type,
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

export async function deleteRecurringTransaction(id: string): Promise<void> {
  database.runSync('DELETE FROM recurring_transactions WHERE id = ?', id);
}

function advanceDate(date: Date, frequency: RecurringFrequency): Date {
  const next = new Date(date);
  if (frequency === 'daily') {
    next.setDate(next.getDate() + 1);
  } else if (frequency === 'weekly') {
    next.setDate(next.getDate() + 7);
  } else {
    next.setMonth(next.getMonth() + 1);
  }
  return next;
}

export async function generateDueRecurringTransactions(): Promise<Transaction[]> {
  const rules = await getRecurringTransactions();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const generated: Transaction[] = [];

  for (const rule of rules) {
    if (!rule.isActive) {
      continue;
    }

    let cursor = rule.lastGeneratedDate ? new Date(`${rule.lastGeneratedDate}T00:00:00`) : null;
    let nextDue = cursor ? advanceDate(cursor, rule.frequency) : new Date(`${rule.startDate}T00:00:00`);

    let iterations = 0;
    let lastGenerated = rule.lastGeneratedDate;

    while (nextDue <= today && iterations < 366) {
      const dateString = nextDue.toISOString().slice(0, 10);
      const transaction = await insertTransaction({
        type: rule.type,
        amount: rule.amount,
        currency: rule.currency,
        category: rule.category,
        source: rule.source || 'Recurring',
        date: dateString,
        note: rule.note,
      });
      generated.push(transaction);
      lastGenerated = dateString;
      nextDue = advanceDate(nextDue, rule.frequency);
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

  return generated;
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
