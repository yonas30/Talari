import { FEES_CATEGORY } from '../constants/categories';
import type { SqlRunner } from './migrations';

// Phase 5 schema step 3 -> 4 (V2_SPEC Part V), called by runMigrations() in db/migrations.ts on the first launch of the accounts build.
//
// The reset, stated plainly: transactions, goals and recurring_transactions are DROPPED and recreated; milestones and monthly_snapshots are
// CLEARED. categories, budgets, currencies, exchange_rates and user_origin are KEPT. There is no data conversion: the current data is
// disposable (the owner confirmed it), and an Available / Saved ledger cannot be turned into per-account balances.
export const ACCOUNTS_SCHEMA_VERSION = 4;

export const ACCOUNTS_DDL = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  currency TEXT NOT NULL,
  colour TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  sms_sender TEXT,
  last_digits TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  account_id TEXT,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  amount_etb REAL NOT NULL,
  exchange_rate REAL NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  from_account_id TEXT,
  to_account_id TEXT,
  to_amount REAL,
  to_amount_etb REAL,
  linked_transfer_id TEXT,
  date TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  note TEXT,
  is_automatic INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_amount REAL NOT NULL,
  deadline TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  held_in_account_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goal_allocations (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  amount REAL NOT NULL,
  amount_after REAL NOT NULL,
  created_at TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS recurring_transactions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  account_id TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions (account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date);
CREATE INDEX IF NOT EXISTS idx_allocations_goal ON goal_allocations (goal_id);
`;

export interface AccountsMigrationResult {
  fromVersion: number;
  droppedTransactions: number;
  droppedGoals: number;
  droppedRecurring: number;
  clearedMilestones: number;
  clearedSnapshots: number;
  feesCategoryAdded: boolean;
}

function count(db: SqlRunner, table: string): number {
  const exists = db.all<{ c: number }>("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = ?", table)[0]?.c;
  return Number(exists) > 0 ? Number(db.all<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`)[0]?.c ?? 0) : 0;
}

// All-or-nothing: if any step throws, nothing changes and user_version stays at 3, so the next launch retries.
// Returns null when the database is already at schema 4 or later.
export function migrateToAccounts(db: SqlRunner, fromVersion: number): AccountsMigrationResult | null {
  if (fromVersion >= ACCOUNTS_SCHEMA_VERSION) {
    return null;
  }
  if (fromVersion < 3) {
    throw new Error('Run the schema 3 migration (runMigrations) before migrating to accounts.');
  }

  const result: AccountsMigrationResult = {
    fromVersion,
    droppedTransactions: count(db, 'transactions'),
    droppedGoals: count(db, 'goals'),
    droppedRecurring: count(db, 'recurring_transactions'),
    clearedMilestones: count(db, 'milestones'),
    clearedSnapshots: count(db, 'monthly_snapshots'),
    feesCategoryAdded: false,
  };

  db.exec('BEGIN');
  try {
    db.exec(`
      DROP TABLE IF EXISTS transactions;
      DROP TABLE IF EXISTS goals;
      DROP TABLE IF EXISTS recurring_transactions;
      DELETE FROM milestones;
      DELETE FROM monthly_snapshots;
    `);
    db.exec(ACCOUNTS_DDL);

    // Only on a device that already has categories. On a fresh install the table is still empty and the first launch seeds the defaults
    // (Fees among them) - adding one row here would make the table non-empty and the defaults would never be seeded.
    const categoryCount = Number(db.all<{ c: number }>('SELECT COUNT(*) AS c FROM categories')[0]?.c ?? 0);
    const hasFees = db.all<{ c: number }>("SELECT COUNT(*) AS c FROM categories WHERE name = ? AND type = 'expense'", FEES_CATEGORY.name)[0];
    if (categoryCount > 0 && Number(hasFees?.c ?? 0) === 0) {
      const idTaken = Number(db.all<{ c: number }>('SELECT COUNT(*) AS c FROM categories WHERE id = ?', FEES_CATEGORY.id)[0]?.c ?? 0) > 0;
      db.run(
        'INSERT INTO categories (id, name, type, icon, color, is_default) VALUES (?, ?, ?, ?, ?, ?)',
        idTaken ? `${FEES_CATEGORY.id}-expense` : FEES_CATEGORY.id,
        FEES_CATEGORY.name,
        FEES_CATEGORY.type,
        FEES_CATEGORY.icon,
        FEES_CATEGORY.color,
        1,
      );
      result.feesCategoryAdded = true;
    }

    db.exec(`PRAGMA user_version = ${ACCOUNTS_SCHEMA_VERSION}`);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
