import { DATE_SOURCES } from '../types/accounts';
import { reconcileTotals } from '../utils/sms/amounts';
import { cleanName } from '../utils/sms/shared';
import type { AccountsState, DateSource } from '../types/accounts';
import type { RecipientRule, SmsSuggestion, SuggestionStatus } from '../types/sms';
import { applyAccountsDiff } from './accountsRepo';
import type { SqlRunner } from './migrations';

// Reads and writes the schema 5 tables through the same engine-agnostic SqlRunner as the rest of db/, so scripts/verify-sms-staging.ts
// runs this exact code on node:sqlite.

interface SuggestionRow {
  id: string;
  rawHash: string;
  status: SuggestionStatus;
  service: SmsSuggestion['service'];
  direction: SmsSuggestion['direction'];
  kind: SmsSuggestion['kind'];
  amount: number;
  fee: number | null;
  vat: number | null;
  otherCharge: number | null;
  totalDeducted: number | null;
  counterpartyName: string | null;
  counterpartyPhoneTail: string | null;
  counterpartyBank: string | null;
  counterpartyAccountTail: string | null;
  counterpartyCode: string | null;
  accountTail: string | null;
  reference: string | null;
  occurredAt: string | null;
  balanceAfter: number | null;
  note: string | null;
  flags: string;
  accountId: string | null;
  category: string;
  feeAmount: number | null;
  date: string;
  dateSource: DateSource | null;
  createdAt: string;
  confirmedEntryId: string | null;
}

const num = (value: number | null): number | null => (value === null ? null : Number(value));

function parseFlags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function readSuggestions(db: SqlRunner): SmsSuggestion[] {
  const rows = db.all<SuggestionRow>(
    `SELECT id, raw_hash AS rawHash, status, service, direction, kind, amount, fee, vat, other_charge AS otherCharge,
            total_deducted AS totalDeducted, counterparty_name AS counterpartyName, counterparty_phone_tail AS counterpartyPhoneTail,
            counterparty_bank AS counterpartyBank, counterparty_account_tail AS counterpartyAccountTail, counterparty_code AS counterpartyCode, account_tail AS accountTail,
            reference, occurred_at AS occurredAt, balance_after AS balanceAfter, note, flags, account_id AS accountId, category,
            fee_override AS feeAmount, date, date_source AS dateSource, created_at AS createdAt, confirmed_entry_id AS confirmedEntryId
     FROM sms_suggestions ORDER BY date, created_at, id`,
  );
  return rows.map((row) => {
    const read: SmsSuggestion = {
    ...row,
    amount: Number(row.amount),
    fee: num(row.fee),
    vat: num(row.vat),
    otherCharge: num(row.otherCharge),
    totalDeducted: num(row.totalDeducted),
    balanceAfter: num(row.balanceAfter),
    feeAmount: num(row.feeAmount),
    flags: parseFlags(row.flags),
    // Names saved before percent-encoding was decoded read back decoded; the stored text is not changed.
    counterpartyName: row.counterpartyName === null ? null : cleanName(row.counterpartyName),
    counterpartyBank: row.counterpartyBank === null ? null : cleanName(row.counterpartyBank),
    note: row.note === null ? null : cleanName(row.note),
    // A row saved before date sources existed: a printed time means the message gave its date, otherwise it was the batch date.
    dateSource: row.dateSource && DATE_SOURCES.includes(row.dateSource) ? row.dateSource : row.occurredAt !== null ? 'message' : 'batch',
  };
    // A message that is still waiting (or was skipped) is shown with the corrected figures if an older build stored the printed total as its
    // amount. A CONFIRMED one is left exactly as saved: it records what was done, and finding the entries that need a repair depends on it.
    return row.status === 'confirmed' ? read : { ...read, ...reconcileTotals(read) };
  });
}

export function readRules(db: SqlRunner): RecipientRule[] {
  return db
    .all<{ key: string; category: string; lastUsed: string }>('SELECT key, category, last_used AS lastUsed FROM recipient_rules ORDER BY key')
    .map((row) => ({ key: row.key, category: row.category, lastUsed: row.lastUsed }));
}

function putSuggestion(db: SqlRunner, s: SmsSuggestion): void {
  db.run(
    `INSERT INTO sms_suggestions (id, raw_hash, status, service, direction, kind, amount, fee, vat, other_charge, total_deducted,
       counterparty_name, counterparty_phone_tail, counterparty_bank, counterparty_account_tail, counterparty_code, account_tail, reference, occurred_at,
       balance_after, note, flags, account_id, category, fee_override, date, date_source, created_at, confirmed_entry_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    s.id,
    s.rawHash,
    s.status,
    s.service,
    s.direction,
    s.kind,
    s.amount,
    s.fee,
    s.vat,
    s.otherCharge,
    s.totalDeducted,
    s.counterpartyName,
    s.counterpartyPhoneTail,
    s.counterpartyBank,
    s.counterpartyAccountTail,
    s.counterpartyCode,
    s.accountTail,
    s.reference,
    s.occurredAt,
    s.balanceAfter,
    s.note,
    JSON.stringify(s.flags),
    s.accountId,
    s.category,
    s.feeAmount,
    s.date,
    s.dateSource,
    s.createdAt,
    s.confirmedEntryId,
  );
}

// One transaction for the whole batch: either every new suggestion of a paste is saved or none is.
export function insertSuggestions(db: SqlRunner, rows: SmsSuggestion[]): void {
  if (rows.length === 0) {
    return;
  }
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      putSuggestion(db, row);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// What the owner can change on a pending card. Only these columns are ever updated this way.
export interface SuggestionChoices {
  accountId?: string | null;
  category?: string;
  feeAmount?: number | null;
  date?: string;
  dateSource?: DateSource;
  status?: SuggestionStatus;
}

export function updateSuggestionChoices(db: SqlRunner, id: string, patch: SuggestionChoices): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    params.push(value);
  };
  if (patch.accountId !== undefined) add('account_id', patch.accountId);
  if (patch.category !== undefined) add('category', patch.category);
  if (patch.feeAmount !== undefined) add('fee_override', patch.feeAmount);
  if (patch.date !== undefined) add('date', patch.date);
  if (patch.dateSource !== undefined) add('date_source', patch.dateSource);
  if (patch.status !== undefined) add('status', patch.status);
  if (sets.length === 0) {
    return;
  }
  db.run(`UPDATE sms_suggestions SET ${sets.join(', ')} WHERE id = ?`, ...params, id);
}

export interface SuggestionConfirmation {
  suggestionId: string;
  // The id of the main entry (not the fee row).
  entryId: string;
  // Null when "remember for this recipient" is off or there is no key.
  rule: RecipientRule | null;
}

// THE atomic save (V2_SPEC Part Z). The ledger write (main entry, fee entry, any goal shrink and notification), marking the suggestion
// confirmed with the main entry's id, and the recipient rule are ONE database transaction: if any statement fails, none of them is kept
// and the suggestion is still pending, so a retry cannot create a second main entry.
export function commitSuggestionSave(db: SqlRunner, before: AccountsState, after: AccountsState, confirmation: SuggestionConfirmation): void {
  db.exec('BEGIN');
  try {
    // Checked FIRST, inside the transaction: a suggestion that is already confirmed (a double tap, a replayed plan) or gone must not
    // write its entries a second time.
    const current = db.all<{ status: string }>('SELECT status FROM sms_suggestions WHERE id = ?', confirmation.suggestionId)[0];
    if (!current || current.status !== 'pending') {
      throw new Error('This suggestion is no longer pending.');
    }
    applyAccountsDiff(db, before, after);
    db.run("UPDATE sms_suggestions SET status = 'confirmed', confirmed_entry_id = ? WHERE id = ? AND status = 'pending'", confirmation.entryId, confirmation.suggestionId);
    if (confirmation.rule) {
      db.run(
        'INSERT INTO recipient_rules (key, category, last_used) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET category = excluded.category, last_used = excluded.last_used',
        confirmation.rule.key,
        confirmation.rule.category,
        confirmation.rule.lastUsed,
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// ---- pairs (V2_SPEC Part Z, Phase 6C-1) -----------------------------------------------------------------------------------------------------

export type PairRejectionReason = 'not_pair' | 'keep_separate';

export function readPairRejections(db: SqlRunner): Set<string> {
  return new Set(db.all<{ pairKey: string }>('SELECT pair_key AS pairKey FROM pair_rejections').map((row) => row.pairKey));
}

export function addPairRejection(db: SqlRunner, key: string, reason: PairRejectionReason, at: string): void {
  db.run('INSERT OR REPLACE INTO pair_rejections (pair_key, reason, created_at) VALUES (?, ?, ?)', key, reason, at);
}

export interface PairConfirmation {
  // The pending messages this transfer stands for: one or two (the other side may be an existing entry).
  suggestions: Array<{
    id: string;
    // What this message becomes: its date and where it came from (a weaker side is recorded as "paired" with the other side's date).
    date: string;
    dateSource: DateSource;
    // The id of the other side: the other message, or the existing entry.
    pairedWithId: string | null;
  }>;
  // The transfer's id: a new row, or the existing entry that was converted.
  entryId: string;
}

// THE atomic pair save. The transfer (new, or an existing entry converted), its linked fee, any goal shrink, and BOTH messages marked
// confirmed are ONE database transaction: if anything fails none of it is kept and both messages are still pending, so a retry cannot
// record the movement twice. No recipient rule is written: a transfer between your own accounts is nobody's category.
export function commitPairSave(db: SqlRunner, before: AccountsState, after: AccountsState, confirmation: PairConfirmation): void {
  db.exec('BEGIN');
  try {
    for (const item of confirmation.suggestions) {
      const current = db.all<{ status: string }>('SELECT status FROM sms_suggestions WHERE id = ?', item.id)[0];
      if (!current || current.status !== 'pending') {
        throw new Error('One of these messages is no longer pending.');
      }
    }
    applyAccountsDiff(db, before, after);
    for (const item of confirmation.suggestions) {
      db.run(
        "UPDATE sms_suggestions SET status = 'confirmed', confirmed_entry_id = ?, paired_with_id = ?, date = ?, date_source = ? WHERE id = ? AND status = 'pending'",
        confirmation.entryId,
        item.pairedWithId,
        item.date,
        item.dateSource,
        item.id,
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// ---- the owner's own names (V2_SPEC Part Z, Phase 6D-3) -------------------------------------------------------------------------------------

export interface OwnName {
  id: string;
  name: string;
  createdAt: string;
}

export function readOwnNames(db: SqlRunner): OwnName[] {
  return db.all<{ id: string; name: string; createdAt: string }>('SELECT id, name, created_at AS createdAt FROM own_names ORDER BY created_at, id');
}

export function insertOwnName(db: SqlRunner, row: OwnName): void {
  db.run('INSERT INTO own_names (id, name, created_at) VALUES (?, ?, ?)', row.id, row.name, row.createdAt);
}

export function renameOwnName(db: SqlRunner, id: string, name: string): void {
  db.run('UPDATE own_names SET name = ? WHERE id = ?', name, id);
}

export function deleteOwnName(db: SqlRunner, id: string): void {
  db.run('DELETE FROM own_names WHERE id = ?', id);
}

// A restore of a backup that carries the list, inside the restore's own transaction: the device's names are replaced by the backup's.
export function replaceOwnNames(db: SqlRunner, rows: OwnName[]): void {
  db.exec('DELETE FROM own_names');
  rows.forEach((row) => insertOwnName(db, row));
}

// A version 4 restore (Phase 6D-1), inside the restore's own transaction: the device's confirmed and skipped messages are replaced by the
// backup's. A message still waiting stays, unless its hash is one of the restored ones (it was handled, so it is dropped: the hash is unique).
export function replaceHandledMessages(db: SqlRunner, rows: SmsSuggestion[]): void {
  db.exec("DELETE FROM sms_suggestions WHERE status IN ('confirmed', 'ignored')");
  for (const row of rows) {
    db.run('DELETE FROM sms_suggestions WHERE raw_hash = ?', row.rawHash);
    putSuggestion(db, row);
  }
}

export interface OpeningConfirmationRow {
  suggestionId: string;
  // The id of the message's main entry.
  entryId: string;
}

// THE atomic opening-balance change (V2_SPEC Part Z, Phase 6C-3). The opening entry (created, moved, replaced or removed), the entries of the
// messages saved with it (and their fees, any goal shrink) and every one of those messages marked confirmed are ONE database transaction: if
// anything fails none of it is kept, the opening is as it was and the messages are still pending, so a retry cannot create a second opening
// or a second entry for a message.
export function commitOpeningChange(db: SqlRunner, before: AccountsState, after: AccountsState, confirmations: OpeningConfirmationRow[]): void {
  db.exec('BEGIN');
  try {
    for (const item of confirmations) {
      const current = db.all<{ status: string }>('SELECT status FROM sms_suggestions WHERE id = ?', item.suggestionId)[0];
      if (!current || current.status !== 'pending') {
        throw new Error('One of these messages is no longer pending.');
      }
    }
    applyAccountsDiff(db, before, after);
    for (const item of confirmations) {
      db.run("UPDATE sms_suggestions SET status = 'confirmed', confirmed_entry_id = ? WHERE id = ? AND status = 'pending'", item.entryId, item.suggestionId);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// ---- "balance doesn't match your bank" dismissals (V2_SPEC Part Z, Phase 6C-2) -------------------------------------------------------------

// account id -> the hash of the message whose mismatch was dismissed. A newer message has another hash, so the banner can come back.
export function readReconcileDismissals(db: SqlRunner): Record<string, string> {
  return Object.fromEntries(db.all<{ accountId: string; hash: string }>('SELECT account_id AS accountId, dismissed_hash AS hash FROM reconcile_dismissals').map((row) => [row.accountId, row.hash]));
}

export function saveReconcileDismissal(db: SqlRunner, accountId: string, hash: string, at: string): void {
  db.run('INSERT OR REPLACE INTO reconcile_dismissals (account_id, dismissed_hash, dismissed_at) VALUES (?, ?, ?)', accountId, hash, at);
}
