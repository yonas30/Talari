import type { SqlRunner } from './migrations';

// Phase 6C-0 schema step 6 -> 7 (V2_SPEC Part Z). ADDITIVE ONLY: nullable columns and one new table. It never updates or deletes a row, so
// every transaction, suggestion and account keeps exactly what it had; an empty date_source is read as "no estimate" on an entry and as
// "message if it has a printed time, otherwise batch" on a suggestion. Safe to run twice.
//   transactions.date_source        where an imported entry's date came from (6C-0)
//   sms_suggestions.date_source     the same, on the staged message (6C-0)
//   sms_suggestions.paired_with_id  the other side of an own-account transfer (used from 6C-1)
//   reconcile_dismissals            "balance doesn't match" banner dismissals (used from 6C-2)
export const DATE_SOURCE_SCHEMA_VERSION = 7;

function hasColumn(db: SqlRunner, table: string, column: string): boolean {
  return db.all<{ name: string }>(`PRAGMA table_info(${table})`).some((row) => row.name === column);
}

export interface DateSourceMigrationResult {
  columnsAdded: string[];
}

// All-or-nothing: if anything throws, nothing is kept and user_version stays at 6, so the next launch retries.
// Returns null when the database is already at schema 7 or later.
export function migrateToDateSource(db: SqlRunner, fromVersion: number): DateSourceMigrationResult | null {
  if (fromVersion >= DATE_SOURCE_SCHEMA_VERSION) {
    return null;
  }
  if (fromVersion < 6) {
    throw new Error('Run the Uncategorised migration (runMigrations) before the date source migration.');
  }
  const result: DateSourceMigrationResult = { columnsAdded: [] };
  db.exec('BEGIN');
  try {
    const columns: Array<[string, string]> = [
      ['transactions', 'date_source'],
      ['sms_suggestions', 'date_source'],
      ['sms_suggestions', 'paired_with_id'],
    ];
    for (const [table, column] of columns) {
      if (!hasColumn(db, table, column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
        result.columnsAdded.push(`${table}.${column}`);
      }
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS reconcile_dismissals (
        account_id TEXT PRIMARY KEY,
        dismissed_hash TEXT NOT NULL,
        dismissed_at TEXT NOT NULL
      );
    `);
    db.exec(`PRAGMA user_version = ${DATE_SOURCE_SCHEMA_VERSION}`);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
