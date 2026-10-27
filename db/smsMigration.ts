import type { SqlRunner } from './migrations';

// Phase 6B schema step 4 -> 5 (V2_SPEC Part Z). ADDITIVE ONLY: it creates two tables and an index and touches nothing that exists, so no
// transaction, account, goal or category is read, changed or deleted. Safe to run twice (IF NOT EXISTS, and it skips at version 5).
export const SMS_SCHEMA_VERSION = 5;

export const SMS_DDL = `
CREATE TABLE IF NOT EXISTS sms_suggestions (
  id TEXT PRIMARY KEY,
  raw_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  service TEXT NOT NULL,
  direction TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount REAL NOT NULL,
  fee REAL,
  vat REAL,
  other_charge REAL,
  total_deducted REAL,
  counterparty_name TEXT,
  counterparty_phone_tail TEXT,
  counterparty_bank TEXT,
  counterparty_account_tail TEXT,
  account_tail TEXT,
  reference TEXT,
  occurred_at TEXT,
  balance_after REAL,
  note TEXT,
  flags TEXT NOT NULL DEFAULT '[]',
  account_id TEXT,
  category TEXT NOT NULL DEFAULT '',
  fee_override REAL,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_entry_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_sms_suggestions_status ON sms_suggestions (status);

CREATE TABLE IF NOT EXISTS recipient_rules (
  key TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  last_used TEXT NOT NULL
);
`;

// All-or-nothing: if anything throws, nothing is kept and user_version stays at 4, so the next launch retries.
// Returns false when the database is already at schema 5 or later.
export function migrateToSms(db: SqlRunner, fromVersion: number): boolean {
  if (fromVersion >= SMS_SCHEMA_VERSION) {
    return false;
  }
  if (fromVersion < 4) {
    throw new Error('Run the accounts migration (runMigrations) before the SMS migration.');
  }
  db.exec('BEGIN');
  try {
    db.exec(SMS_DDL);
    db.exec(`PRAGMA user_version = ${SMS_SCHEMA_VERSION}`);
    db.exec('COMMIT');
    return true;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
