import type { BackupV3 } from '../utils/accounts/backup';
import type { SmsSuggestion } from '../types/sms';
import { writeAccountsData } from './accountsRepo';
import type { SqlRunner } from './migrations';
import { OwnName, replaceHandledMessages, replaceOwnNames } from './smsRepo';

// Replaces the accounts, ledger, goals, categories, budgets and rates with the backup's, and, for a version 4 backup, the handled messages,
// ALL IN ONE TRANSACTION: a failure anywhere keeps none of it. Recurring rules are not part of a backup and point at accounts by id, so they
// are cleared (the returned count says how many). A currency the restored accounts or rates use that is not on this device's list is added to
// it, so no account is left in a currency the app does not know. `handled` is null for a version 3 or 2 backup: the device's handled messages
// are then left exactly as they are; the same for `ownNames` (null: the device's names stay).
//
// Written against the engine-agnostic SqlRunner so scripts/verify-backup-handled.ts runs this exact code, with failures injected, on node:sqlite.
export function applyBackupRows(db: SqlRunner, backup: BackupV3, handled: SmsSuggestion[] | null, ownNames: OwnName[] | null = null): number {
  const known = new Set(db.all<{ code: string }>('SELECT code FROM currencies').map((row) => row.code));
  const needed = new Set<string>([...backup.accounts.map((account) => account.currency), ...backup.exchangeRates.map((rate) => rate.fromCurrency)]);
  const clearedRules = Number(db.all<{ c: number }>('SELECT COUNT(*) AS c FROM recurring_transactions')[0]?.c ?? 0);

  db.exec('BEGIN');
  try {
    writeAccountsData(db, {
      accounts: backup.accounts,
      entries: backup.transactions,
      goals: backup.goals,
      allocations: backup.goalAllocations,
      notifications: backup.notifications,
    });
    db.exec('DELETE FROM recurring_transactions');
    db.exec('DELETE FROM categories');
    db.exec('DELETE FROM exchange_rates');
    db.exec('DELETE FROM budgets');

    for (const category of backup.categories) {
      db.run(
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
      db.run('INSERT INTO exchange_rates (id, from_currency, to_currency, rate, updated_at) VALUES (?, ?, ?, ?, ?)', rate.id, rate.fromCurrency, rate.toCurrency, rate.rate, rate.updatedAt);
    }
    for (const budget of backup.budgets) {
      db.run(
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
        db.run('INSERT INTO currencies (code, name, is_default) VALUES (?, ?, 0)', code, code);
      }
    }
    if (handled !== null) {
      replaceHandledMessages(db, handled);
    }
    // The owner's names (Phase 6D-3): only a backup that carries the list replaces the device's; an older one leaves them as they are.
    if (ownNames !== null) {
      replaceOwnNames(db, ownNames);
    }

    db.exec('COMMIT');
    return clearedRules;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
