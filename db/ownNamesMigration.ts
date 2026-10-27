import type { SqlRunner } from './migrations';

// Phase 6D-3 schema step 8 -> 9 (V2_SPEC Part Z). ADDITIVE ONLY: one new table, nothing existing is read, changed or deleted. Safe to run twice.
// It holds the owner's own names as banks write them, used only by pairing rule 3. They are personal data (and are in a backup).
export const OWN_NAMES_SCHEMA_VERSION = 9;

// All-or-nothing: if anything throws, nothing is kept and user_version stays at 8, so the next launch retries.
// Returns false when the database is already at schema 9 or later.
export function migrateToOwnNames(db: SqlRunner, fromVersion: number): boolean {
  if (fromVersion >= OWN_NAMES_SCHEMA_VERSION) {
    return false;
  }
  if (fromVersion < 8) {
    throw new Error('Run the pair migration (runMigrations) before the own names migration.');
  }
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS own_names (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    db.exec(`PRAGMA user_version = ${OWN_NAMES_SCHEMA_VERSION}`);
    db.exec('COMMIT');
    return true;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
