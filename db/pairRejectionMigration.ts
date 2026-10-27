import type { SqlRunner } from './migrations';

// Phase 6C-1 schema step 7 -> 8 (V2_SPEC Part Z). ADDITIVE ONLY: one new table, nothing existing is read, changed or deleted. Safe to run
// twice. It remembers "not a pair" / "keep separate" so the same two messages are not offered as a transfer again.
export const PAIR_SCHEMA_VERSION = 8;

// All-or-nothing: if anything throws, nothing is kept and user_version stays at 7, so the next launch retries.
// Returns false when the database is already at schema 8 or later.
export function migrateToPairs(db: SqlRunner, fromVersion: number): boolean {
  if (fromVersion >= PAIR_SCHEMA_VERSION) {
    return false;
  }
  if (fromVersion < 7) {
    throw new Error('Run the date source migration (runMigrations) before the pair migration.');
  }
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pair_rejections (
        pair_key TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    db.exec(`PRAGMA user_version = ${PAIR_SCHEMA_VERSION}`);
    db.exec('COMMIT');
    return true;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
