import { UNCATEGORISED_EXPENSE, UNCATEGORISED_INCOME } from '../constants/categories';
import type { SqlRunner } from './migrations';

// Phase 6B follow-up, schema step 5 -> 6 (V2_SPEC Part Z). ADDITIVE ONLY: it adds one nullable column to sms_suggestions and the two
// built-in "Uncategorised" categories. It never updates or deletes a row, so every transaction, category, account and suggestion
// keeps exactly what it had. Safe to run twice.
export const UNCATEGORISED_SCHEMA_VERSION = 6;

function hasColumn(db: SqlRunner, table: string, column: string): boolean {
  return db.all<{ name: string }>(`PRAGMA table_info(${table})`).some((row) => row.name === column);
}

export interface UncategorisedMigrationResult {
  columnAdded: boolean;
  categoriesAdded: number;
}

// All-or-nothing: if anything throws, nothing is kept and user_version stays at 5, so the next launch retries.
// Returns null when the database is already at schema 6 or later.
export function migrateToUncategorised(db: SqlRunner, fromVersion: number): UncategorisedMigrationResult | null {
  if (fromVersion >= UNCATEGORISED_SCHEMA_VERSION) {
    return null;
  }
  if (fromVersion < 5) {
    throw new Error('Run the SMS migration (runMigrations) before the Uncategorised migration.');
  }
  const result: UncategorisedMigrationResult = { columnAdded: false, categoriesAdded: 0 };
  db.exec('BEGIN');
  try {
    // The merchant / bill / number a message pays (V2_SPEC Part Z): what "remember for this recipient" is keyed by for merchants.
    if (!hasColumn(db, 'sms_suggestions', 'counterparty_code')) {
      db.exec('ALTER TABLE sms_suggestions ADD COLUMN counterparty_code TEXT');
      result.columnAdded = true;
    }

    // Only on a device that already has categories. On a fresh install the table is still empty and the first launch seeds the defaults
    // (these two among them): adding a row here would make the table non-empty and the defaults would never be seeded.
    const categoryCount = Number(db.all<{ c: number }>('SELECT COUNT(*) AS c FROM categories')[0]?.c ?? 0);
    if (categoryCount > 0) {
      for (const category of [UNCATEGORISED_INCOME, UNCATEGORISED_EXPENSE]) {
        const exists = Number(db.all<{ c: number }>('SELECT COUNT(*) AS c FROM categories WHERE name = ? AND type = ?', category.name, category.type)[0]?.c ?? 0) > 0;
        if (exists) {
          continue;
        }
        const idTaken = Number(db.all<{ c: number }>('SELECT COUNT(*) AS c FROM categories WHERE id = ?', category.id)[0]?.c ?? 0) > 0;
        db.run(
          'INSERT INTO categories (id, name, type, icon, color, is_default) VALUES (?, ?, ?, ?, ?, ?)',
          idTaken ? `${category.id}-${Date.now()}` : category.id,
          category.name,
          category.type,
          category.icon,
          category.color,
          1,
        );
        result.categoriesAdded += 1;
      }
    }

    db.exec(`PRAGMA user_version = ${UNCATEGORISED_SCHEMA_VERSION}`);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
