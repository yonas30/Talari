// Schema creation and one-time data migrations, kept free of expo-sqlite so they can be tested against a real
// SQLite engine (scripts/verify-accounting.ts runs them on node:sqlite). db/database.ts adapts expo-sqlite to
// SqlRunner and calls runMigrations() once at start-up.

export interface SqlRunner {
  exec(sql: string): void;
  all<T>(sql: string, ...params: unknown[]): T[];
  run(sql: string, ...params: unknown[]): void;
}

// 2: V2 ledger rebuild - the V1 ledger tables were dropped and recreated (Part V: no migration from V1).
// 3: remove V1 leftovers the first rebuild kept (milestones, budgets, exchange rates, origin story, legacy
//    savings categories) and link goal-completed milestones to their goal by id.
export const SCHEMA_VERSION = 3;

export const SCHEMA_DDL = `
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
  goal_id TEXT,
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
`;

function count(db: SqlRunner, sql: string, ...params: unknown[]): number {
  return Number(db.all<{ c: number }>(sql, ...params)[0]?.c ?? 0);
}

function tableExists(db: SqlRunner, name: string): boolean {
  return count(db, "SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = ?", name) > 0;
}

function hasColumn(db: SqlRunner, table: string, column: string): boolean {
  return db.all<{ name: string }>(`PRAGMA table_info(${table})`).some((row) => row.name === column);
}

// When the V2 build first ran on this device. Its first start recreates monthly_snapshots and immediately
// inserts last month's snapshot, so the oldest snapshot's created_at is the launch time; anything older was
// written by V1. Falls back to the oldest V2 ledger row; null means "no V2 footprint at all".
export function findV2LaunchCutoff(db: SqlRunner): string | null {
  for (const [table, column] of [
    ['monthly_snapshots', 'created_at'],
    ['goals', 'created_at'],
    ['transactions', 'created_at'],
  ]) {
    if (!tableExists(db, table)) {
      continue;
    }
    const row = db.all<{ oldest: string | null }>(`SELECT MIN(${column}) AS oldest FROM ${table}`)[0];
    if (row?.oldest) {
      return row.oldest;
    }
  }
  return null;
}

export interface LeftoverRows {
  milestones: Array<{ id: string; title: string; type: string; created_at: string }>;
  budgets: Array<{ id: string; category: string; monthly_limit: number; currency: string; created_at: string; updated_at: string }>;
  exchangeRates: Array<{ id: string; from_currency: string; to_currency: string; rate: number; updated_at: string }>;
  origin: Array<{ id: string; story_text: string; updated_at: string }>;
  savingsCategories: Array<{ id: string; name: string; icon: string }>;
}

// The definition of "what V1 left behind". `cutoff` null = nothing on this device was created by V2, so everything in
// these tables is V1's. Rows with timestamps are judged by when they were last written, so a V1 budget or rate that
// you edited in V2 is kept. Savings-type categories go regardless of date: V2 has no such classification. Every
// other category and every currency is left alone.
export function selectV1Leftovers(db: SqlRunner, cutoff: string | null): LeftoverRows {
  const olderThan = cutoff ?? '9999-12-31T23:59:59.999Z';
  return {
    milestones: db.all('SELECT id, title, type, created_at FROM milestones WHERE created_at < ? ORDER BY created_at', olderThan),
    budgets: db.all('SELECT id, category, monthly_limit, currency, created_at, updated_at FROM budgets WHERE updated_at < ? ORDER BY category', olderThan),
    exchangeRates: db.all('SELECT id, from_currency, to_currency, rate, updated_at FROM exchange_rates WHERE updated_at < ? ORDER BY id', olderThan),
    origin: db.all('SELECT id, story_text, updated_at FROM user_origin WHERE updated_at < ?', olderThan),
    savingsCategories: db.all("SELECT id, name, icon FROM categories WHERE type = 'savings' ORDER BY name"),
  };
}

export interface PurgeResult {
  cutoff: string | null;
  milestones: number;
  budgets: number;
  exchangeRates: number;
  origin: number;
  savingsCategories: number;
}

export function purgeV1Leftovers(db: SqlRunner, cutoff: string | null): PurgeResult {
  const rows = selectV1Leftovers(db, cutoff);
  const remove = (table: string, list: Array<{ id: string }>) => {
    for (const row of list) {
      db.run(`DELETE FROM ${table} WHERE id = ?`, row.id);
    }
  };
  remove('milestones', rows.milestones);
  remove('budgets', rows.budgets);
  remove('exchange_rates', rows.exchangeRates);
  remove('user_origin', rows.origin);
  remove('categories', rows.savingsCategories);

  return {
    cutoff,
    milestones: rows.milestones.length,
    budgets: rows.budgets.length,
    exchangeRates: rows.exchangeRates.length,
    origin: rows.origin.length,
    savingsCategories: rows.savingsCategories.length,
  };
}

// Milestones used to be matched to goals by title. Existing goal-completed milestones get the id of the goal
// with that name so they keep counting as "already recorded" once matching switches to ids.
export function backfillMilestoneGoalIds(db: SqlRunner): number {
  const orphans = db.all<{ id: string; title: string }>(
    "SELECT id, title FROM milestones WHERE type = 'goal_completed' AND goal_id IS NULL",
  );
  let linked = 0;
  for (const milestone of orphans) {
    const goal = db.all<{ id: string }>('SELECT id FROM goals WHERE name = ? ORDER BY created_at ASC LIMIT 1', milestone.title)[0];
    if (goal) {
      db.run('UPDATE milestones SET goal_id = ? WHERE id = ?', goal.id, milestone.id);
      linked += 1;
    }
  }
  return linked;
}

// Brings any database - fresh, V1, or V2 at any earlier version - to SCHEMA_VERSION. All-or-nothing: if any step
// throws, nothing is changed and user_version stays put so the next launch retries.
export function runMigrations(db: SqlRunner, fromVersion: number): PurgeResult | null {
  // Needed before the V1 -> V2 step drops monthly_snapshots.
  const cutoff = fromVersion === 2 ? findV2LaunchCutoff(db) : null;

  db.exec('BEGIN');
  try {
    if (fromVersion < 2) {
      db.exec(`
        DROP TABLE IF EXISTS transactions;
        DROP TABLE IF EXISTS goals;
        DROP TABLE IF EXISTS recurring_transactions;
        DROP TABLE IF EXISTS monthly_snapshots;
      `);
    }

    db.exec(SCHEMA_DDL);

    // Columns added after earlier V2 builds shipped (altering in place keeps real data).
    if (!hasColumn(db, 'transactions', 'is_automatic')) {
      db.exec('ALTER TABLE transactions ADD COLUMN is_automatic INTEGER NOT NULL DEFAULT 0');
    }
    if (!hasColumn(db, 'milestones', 'goal_id')) {
      db.exec('ALTER TABLE milestones ADD COLUMN goal_id TEXT');
    }

    let purged: PurgeResult | null = null;
    if (fromVersion < 3) {
      purged = purgeV1Leftovers(db, cutoff);
      backfillMilestoneGoalIds(db);
    }

    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
    return purged;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
