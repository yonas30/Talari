import { openDatabaseSync } from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';

import { defaultCategories } from '../constants/categories';
import {
  Budget,
  BudgetInput,
  Category,
  CategoryType,
  Currency,
  CurrencyCode,
  ExchangeRate,
  Milestone,
  MilestoneInput,
  MilestoneType,
  MonthlySnapshot,
  RecurringFailure,
  RecurringFrequency,
  RecurringTransaction,
  RecurringTransactionInput,
  RecurringType,
  UserOrigin,
  UserOriginInput,
} from '../types';
import { AccountEntry, AccountsState } from '../types/accounts';
import { BackupV3, createBackupV3, restoreBackup } from '../utils/accounts/backup';
import { defaultCtx } from '../utils/accounts/context';
import { AccountsError } from '../utils/accounts/errors';
import { planAddEntry } from '../utils/accounts/entries';
import { parseDateKey, toLocalDateKey } from '../utils/dates';
import { advanceDate, getNextDueDate, planRecurringEdit } from '../utils/recurring';
import { AccountsData, deleteNotifications, readAccountsData, saveAccountsDiff, writeAccountsData } from './accountsRepo';
import { forgetReads, getReadIds, markRead, pruneReads } from './notificationReads';
import { runMigrations, SqlRunner } from './migrations';

export const database = openDatabaseSync('my-finances.db');
export const db = drizzle(database);

function nowIso(): string {
  return new Date().toISOString();
}

// Adapts expo-sqlite to the engine-agnostic runner used by the migrations (db/migrations.ts).
const sqlRunner: SqlRunner = {
  exec: (sql) => database.execSync(sql),
  all: <T>(sql: string, ...params: unknown[]) => database.getAllSync(sql, ...(params as never[])) as T[],
  run: (sql, ...params) => {
    database.runSync(sql, ...(params as never[]));
  },
};

// Ids of notifications the user has already seen (old ones are dropped so the table can't grow without bound).
export function getReadNotificationIds(): string[] {
  pruneReads(sqlRunner, new Date(Date.now() - 120 * 86400000).toISOString());
  return getReadIds(sqlRunner);
}

export function markNotificationsRead(ids: string[]): void {
  markRead(sqlRunner, ids, nowIso());
}

// Notifications that no longer exist (goal deleted, expired, cleared) lose their saved row and their read record together.
export function deleteReserveNotifications(ids: string[]): void {
  if (ids.length === 0) {
    return;
  }
  deleteNotifications(sqlRunner, ids);
  forgetReads(sqlRunner, ids);
}

export async function initializeDatabase(): Promise<void> {
  const versionRow = database.getFirstSync('PRAGMA user_version') as { user_version: number } | null;
  // Creates / upgrades the schema and runs each one-time data migration exactly once (see db/migrations.ts).
  runMigrations(sqlRunner, versionRow?.user_version ?? 0);

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

  // Exchange rates are deliberately NOT seeded. A made-up default (the old USD->ETB 120.48 etc.) would silently
  // convert real amounts at a fabricated rate; with no rate stored, entering a foreign-currency amount is blocked
  // until the user sets a real one on the Exchange Rates page (V2 Parts D and E).

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

// ---- the ledger (accounts model) ------------------------------------------------------------------------------------------------
// Everything about accounts, transactions, goals, allocations and reserve notifications is read and written through
// db/accountsRepo.ts. A write is planned as a pure function first (utils/accounts), and only then saved as one SQL transaction.
export function readLedger(): AccountsData {
  return readAccountsData(sqlRunner);
}

export function saveLedgerDiff(before: AccountsState, after: AccountsState): void {
  saveAccountsDiff(sqlRunner, before, after);
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

function mapRecurringRow(row: {
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
  isActive: number;
  createdAt: string;
  updatedAt: string;
}): RecurringTransaction {
  return {
    id: row.id,
    type: row.type,
    accountId: row.accountId,
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
    `SELECT id, type, account_id AS accountId, amount, currency, category, source, note, frequency,
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
    accountId: input.accountId,
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
      (id, type, account_id, amount, currency, category, source, note, frequency, start_date, last_generated_date, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    recurring.id,
    recurring.type,
    recurring.accountId,
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
    accountId: input.accountId,
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
      SET type = ?, account_id = ?, amount = ?, currency = ?, category = ?, source = ?, note = ?, frequency = ?,
          start_date = ?, last_generated_date = ?, updated_at = ?
      WHERE id = ?`,
    updated.type,
    updated.accountId,
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

// Posts every occurrence that has come due. Each one goes through the same planner as a manual entry (utils/accounts/entries.ts); an
// occurrence that can't be posted (it would overdraw its account, its currency has no rate, its account was archived) is skipped and
// reported back so the UI can notify - never a crash, and never a negative balance. A skipped occurrence is not retried: the rule moves
// on to its next date. Reserved goal money never blocks a rule: if it is used, the goals shrink like for any other entry.
export async function generateDueRecurringTransactions(): Promise<{
  generated: AccountEntry[];
  failures: RecurringFailure[];
}> {
  const rules = await getRecurringTransactions();
  const rates = await getExchangeRates();
  const currencyCodes = (await getCurrencies()).map((currency) => currency.code);
  let state: AccountsState = { ...readAccountsData(sqlRunner), rates, currencies: currencyCodes };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const generated: AccountEntry[] = [];
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
        const result = planAddEntry(
          state,
          {
            type: rule.type,
            accountId: rule.accountId,
            amount: rule.amount,
            currency: rule.currency,
            category: rule.category,
            source: rule.source || 'Recurring',
            date: dateString,
            note: rule.note,
            isAutomatic: true,
          },
          defaultCtx,
        );
        saveAccountsDiff(sqlRunner, state, result.state);
        generated.push(result.state.entries[result.state.entries.length - 1]);
        state = result.state;
      } catch (error) {
        if (!(error instanceof AccountsError)) {
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
    'SELECT id, title, description, date, type, goal_id AS goalId, created_at AS createdAt FROM milestones ORDER BY date DESC',
  ) as Array<{
    id: string;
    title: string;
    description: string;
    date: string;
    type: MilestoneType;
    goalId: string | null;
    createdAt: string;
  }>;

  return rows;
}

export async function addMilestone(input: MilestoneInput): Promise<Milestone> {
  const milestone: Milestone = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: input.title,
    description: input.description,
    date: input.date,
    type: input.type,
    goalId: input.goalId ?? null,
    createdAt: nowIso(),
  };

  database.runSync(
    'INSERT INTO milestones (id, title, description, date, type, goal_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    milestone.id,
    milestone.title,
    milestone.description,
    milestone.date,
    milestone.type,
    milestone.goalId,
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

// ---- backup and restore (version 3) ---------------------------------------------------------------------------------------------
export async function exportBackup(): Promise<BackupV3> {
  const [categoriesData, budgetsData, ratesData] = await Promise.all([getCategories(), getBudgets(), getExchangeRates()]);
  const data = readAccountsData(sqlRunner);
  return createBackupV3({
    categories: categoriesData,
    budgets: budgetsData,
    state: { ...data, rates: ratesData, currencies: [] },
  });
}

// Replaces the accounts, ledger, goals, categories, budgets and rates with the backup's, all or nothing. Recurring rules are not part of
// a backup and point at accounts by id, so they are cleared (the returned count says how many). A currency the restored accounts or
// rates use that is not on this device's list is added to it, so no account is left in a currency the app does not know.
function applyBackup(backup: BackupV3): number {
  const known = new Set((database.getAllSync('SELECT code FROM currencies') as Array<{ code: string }>).map((row) => row.code));
  const needed = new Set<string>([...backup.accounts.map((account) => account.currency), ...backup.exchangeRates.map((rate) => rate.fromCurrency)]);
  const clearedRules = Number((database.getFirstSync('SELECT COUNT(*) AS c FROM recurring_transactions') as { c: number } | null)?.c ?? 0);

  database.execSync('BEGIN');
  try {
    writeAccountsData(sqlRunner, {
      accounts: backup.accounts,
      entries: backup.transactions,
      goals: backup.goals,
      allocations: backup.goalAllocations,
      notifications: backup.notifications,
    });
    database.execSync('DELETE FROM recurring_transactions');
    database.execSync('DELETE FROM categories');
    database.execSync('DELETE FROM exchange_rates');
    database.execSync('DELETE FROM budgets');

    for (const category of backup.categories) {
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
    for (const rate of backup.exchangeRates) {
      database.runSync(
        'INSERT INTO exchange_rates (id, from_currency, to_currency, rate, updated_at) VALUES (?, ?, ?, ?, ?)',
        rate.id,
        rate.fromCurrency,
        rate.toCurrency,
        rate.rate,
        rate.updatedAt,
      );
    }
    for (const budget of backup.budgets) {
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
    for (const code of needed) {
      if (!known.has(code)) {
        database.runSync('INSERT INTO currencies (code, name, is_default) VALUES (?, ?, 0)', code, code);
      }
    }

    database.execSync('COMMIT');
    return clearedRules;
  } catch (error) {
    database.execSync('ROLLBACK');
    throw error;
  }
}

// Reads any backup this app has written (version 3, or an old version 2 which lands in one "Cash" account), checks it, and replaces
// the data with it. Returns the message to show the owner. Throws AccountsError('RESTORE_FAILED') when it cannot be restored, with nothing changed.
export async function restoreBackupPayload(payload: unknown): Promise<string> {
  const { backup, message } = restoreBackup(payload);
  const clearedRules = applyBackup(backup);
  return clearedRules > 0
    ? `${message} Your ${clearedRules} recurring ${clearedRules === 1 ? 'rule was' : 'rules were'} cleared, because they belong to accounts and are not part of a backup.`
    : message;
}
