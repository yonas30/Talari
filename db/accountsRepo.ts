import { DATE_SOURCES } from '../types/accounts';
import type { AccountEntry, AccountGoal, AccountsState, DateSource, GoalAllocation, MoneyAccount, ReserveNotification } from '../types/accounts';
import type { SqlRunner } from './migrations';

// Reads and writes the schema 4 tables through the same engine-agnostic SqlRunner as db/migrations.ts, so the verify script can run
// them on real SQLite. The store (store/finance.ts) saves through saveAccountsDiff after every ledger write.
export interface AccountsData {
  accounts: MoneyAccount[];
  entries: AccountEntry[];
  goals: AccountGoal[];
  allocations: GoalAllocation[];
  notifications: ReserveNotification[];
}

export function readAccountsData(db: SqlRunner): AccountsData {
  const accounts = db
    .all<{
      id: string; name: string; type: MoneyAccount['type']; currency: string; colour: string; sortOrder: number; archived: number;
      smsSender: string | null; lastDigits: string | null; createdAt: string;
    }>(
      `SELECT id, name, type, currency, colour, sort_order AS sortOrder, archived, sms_sender AS smsSender,
              last_digits AS lastDigits, created_at AS createdAt FROM accounts ORDER BY sort_order, created_at`,
    )
    .map((row) => ({ ...row, sortOrder: Number(row.sortOrder), archived: Boolean(row.archived) }));

  const entries = db
    .all<{
      id: string; type: AccountEntry['type']; accountId: string | null; amount: number; currency: string; amountETB: number;
      exchangeRate: number; category: string; source: string; fromAccountId: string | null; toAccountId: string | null;
      toAmount: number | null; toAmountETB: number | null; linkedTransferId: string | null; date: string; timestamp: string;
      note: string | null; isAutomatic: number; createdAt: string; updatedAt: string; dateSource: DateSource | null;
    }>(
      `SELECT id, type, account_id AS accountId, amount, currency, amount_etb AS amountETB, exchange_rate AS exchangeRate,
              category, source, from_account_id AS fromAccountId, to_account_id AS toAccountId, to_amount AS toAmount,
              to_amount_etb AS toAmountETB, linked_transfer_id AS linkedTransferId, date, timestamp, note,
              is_automatic AS isAutomatic, created_at AS createdAt, updated_at AS updatedAt, date_source AS dateSource
         FROM transactions ORDER BY date, timestamp, id`,
    )
    .map(({ dateSource, ...row }) => ({
      ...row,
      // Absent (not null) for an entry with no source, so entries that never came from an SMS look exactly as they always did.
      ...(dateSource && DATE_SOURCES.includes(dateSource) ? { dateSource } : {}),
      amount: Number(row.amount),
      amountETB: Number(row.amountETB),
      exchangeRate: Number(row.exchangeRate),
      toAmount: row.toAmount === null ? null : Number(row.toAmount),
      toAmountETB: row.toAmountETB === null ? null : Number(row.toAmountETB),
      isAutomatic: Boolean(row.isAutomatic),
    }));

  const goals = db
    .all<AccountGoal>(
      `SELECT id, name, target_amount AS targetAmount, deadline, status, held_in_account_id AS heldInAccountId,
              created_at AS createdAt, updated_at AS updatedAt FROM goals ORDER BY created_at, id`,
    )
    .map((row) => ({ ...row, targetAmount: Number(row.targetAmount) }));

  const allocations = db
    .all<GoalAllocation>(
      `SELECT id, goal_id AS goalId, account_id AS accountId, amount, date, kind, created_at AS createdAt
         FROM goal_allocations ORDER BY created_at, id`,
    )
    .map((row) => ({ ...row, amount: Number(row.amount) }));

  const notifications = db
    .all<{ id: string; kind: 'goal_reserve_used'; goalId: string; accountId: string; amount: number; amountAfter: number; createdAt: string; read: number }>(
      `SELECT id, kind, goal_id AS goalId, account_id AS accountId, amount, amount_after AS amountAfter,
              created_at AS createdAt, read FROM notifications ORDER BY created_at, id`,
    )
    .map((row) => ({ ...row, amount: Number(row.amount), amountAfter: Number(row.amountAfter), read: Boolean(row.read) }));

  return { accounts, entries, goals, allocations, notifications };
}

// One row at a time, INSERT OR REPLACE: the same statement writes a new row and overwrites an edited one (V2_SPEC Part G: an edit is
// just that one row changing).
function putAccount(db: SqlRunner, a: MoneyAccount): void {
  db.run(
    'INSERT OR REPLACE INTO accounts (id, name, type, currency, colour, sort_order, archived, sms_sender, last_digits, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    a.id, a.name, a.type, a.currency, a.colour, a.sortOrder, a.archived ? 1 : 0, a.smsSender, a.lastDigits, a.createdAt,
  );
}

function putEntry(db: SqlRunner, e: AccountEntry): void {
  db.run(
    `INSERT OR REPLACE INTO transactions (id, type, account_id, amount, currency, amount_etb, exchange_rate, category, source, from_account_id,
       to_account_id, to_amount, to_amount_etb, linked_transfer_id, date, timestamp, note, is_automatic, created_at, updated_at, date_source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    e.id, e.type, e.accountId, e.amount, e.currency, e.amountETB, e.exchangeRate, e.category, e.source, e.fromAccountId,
    e.toAccountId, e.toAmount, e.toAmountETB, e.linkedTransferId, e.date, e.timestamp, e.note, e.isAutomatic ? 1 : 0, e.createdAt, e.updatedAt, e.dateSource ?? null,
  );
}

function putGoal(db: SqlRunner, g: AccountGoal): void {
  db.run(
    'INSERT OR REPLACE INTO goals (id, name, target_amount, deadline, status, held_in_account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    g.id, g.name, g.targetAmount, g.deadline, g.status, g.heldInAccountId, g.createdAt, g.updatedAt,
  );
}

function putAllocation(db: SqlRunner, r: GoalAllocation): void {
  db.run(
    'INSERT OR REPLACE INTO goal_allocations (id, goal_id, account_id, amount, date, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    r.id, r.goalId, r.accountId, r.amount, r.date, r.kind, r.createdAt,
  );
}

function putNotification(db: SqlRunner, n: ReserveNotification): void {
  db.run(
    'INSERT OR REPLACE INTO notifications (id, kind, goal_id, account_id, amount, amount_after, created_at, read) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    n.id, n.kind, n.goalId, n.accountId, n.amount, n.amountAfter, n.createdAt, n.read ? 1 : 0,
  );
}

// Writes every row of `data` WITHOUT opening a transaction, for callers that already have one open (restore).
export function writeAccountsData(db: SqlRunner, data: AccountsData): void {
  for (const table of ['notifications', 'goal_allocations', 'goals', 'transactions', 'accounts']) {
    db.exec(`DELETE FROM ${table}`);
  }
  data.accounts.forEach((row) => putAccount(db, row));
  data.entries.forEach((row) => putEntry(db, row));
  data.goals.forEach((row) => putGoal(db, row));
  data.allocations.forEach((row) => putAllocation(db, row));
  data.notifications.forEach((row) => putNotification(db, row));
}

// Replaces everything in the accounts tables in one transaction (used by restore). Callers validate the data first.
export function replaceAccountsData(db: SqlRunner, data: AccountsData): void {
  db.exec('BEGIN');
  try {
    writeAccountsData(db, data);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function syncTable<T extends { id: string }>(
  before: T[],
  after: T[],
  put: (row: T) => void,
  remove: (id: string) => void,
): void {
  const previous = new Map(before.map((row) => [row.id, row]));
  const kept = new Set<string>();
  for (const row of after) {
    kept.add(row.id);
    // A row that is the very same object as before was not touched by the write; anything else is new or edited.
    if (previous.get(row.id) !== row) {
      put(row);
    }
  }
  for (const id of previous.keys()) {
    if (!kept.has(id)) {
      remove(id);
    }
  }
}

// Removes saved notifications by id (expiry on app load). Used on their own, outside a ledger write.
export function deleteNotifications(db: SqlRunner, ids: string[]): void {
  for (const id of ids) {
    db.run('DELETE FROM notifications WHERE id = ?', id);
  }
}

// The statements of a ledger write, with no transaction of their own: the caller owns BEGIN / COMMIT. This is what lets one database
// transaction cover a ledger write AND something else (an imported SMS being marked confirmed) so they succeed or fail together.
export function applyAccountsDiff(db: SqlRunner, before: AccountsState, after: AccountsState): void {
  const deleteBy = (table: string) => (id: string) => db.run(`DELETE FROM ${table} WHERE id = ?`, id);
  syncTable(before.accounts, after.accounts, (row) => putAccount(db, row), deleteBy('accounts'));
  syncTable(before.entries, after.entries, (row) => putEntry(db, row), deleteBy('transactions'));
  syncTable(before.goals, after.goals, (row) => putGoal(db, row), deleteBy('goals'));
  syncTable(before.allocations, after.allocations, (row) => putAllocation(db, row), deleteBy('goal_allocations'));
  syncTable(before.notifications, after.notifications, (row) => putNotification(db, row), deleteBy('notifications'));
}

// Saves the difference between two states in ONE transaction: a ledger write, the allocation rows and notifications it caused, all or
// nothing. Rows are compared by identity (the pure planners reuse the objects they did not change), so a write that touched three
// rows does three statements, not a rewrite of the ledger.
export function saveAccountsDiff(db: SqlRunner, before: AccountsState, after: AccountsState): void {
  db.exec('BEGIN');
  try {
    applyAccountsDiff(db, before, after);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
