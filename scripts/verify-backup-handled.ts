// Checks for the backup of handled messages (V2_SPEC Part Z, Phase 6D-1): version 4 holds hashes and a few figures and never message text or names,
// round-trips, restores atomically (failure injection), leaves the device's handled messages alone for version 3 and 2, refuses a damaged version 4
// with nothing written, and after a restore the same messages are not offered again and the fee repair still finds its entries.
// Every message and name below is SYNTHETIC. Run: npx tsx scripts/verify-backup-handled.ts
import { readAccountsData } from '../db/accountsRepo';
import { applyBackupRows } from '../db/backupRepo';
import { runMigrations, SqlRunner } from '../db/migrations';
import { insertSuggestions, readSuggestions } from '../db/smsRepo';
import { AccountEntry, AccountsState } from '../types/accounts';
import { SmsSuggestion } from '../types/sms';
import { createBackupV3, createBackupV4, restoreBackup } from '../utils/accounts/backup';
import { getAccountBalances } from '../utils/accounts/balances';
import { Ctx } from '../utils/accounts/context';
import { AccountsError } from '../utils/accounts/errors';
import { planCreateAccount } from '../utils/accounts/manage';
import { toHandledRecords } from '../utils/sms/handledBackup';
import { findFeeCountedTwice, planFeeRepair } from '../utils/sms/feeRepair';
import { planSuggestionSave } from '../utils/sms/saveSuggestion';
import { handledHashes, previewBatch, stageBatch } from '../utils/sms/staging';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed += 1;
  } else {
    failed += 1;
    console.log(`FAIL ${name} ${detail}`);
  }
}
function messageOf(fn: () => unknown): string {
  try {
    fn();
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
function codeOf(fn: () => unknown): string {
  try {
    fn();
    return 'none';
  } catch (error) {
    return error instanceof AccountsError ? error.code : `other:${error instanceof Error ? error.message : String(error)}`;
  }
}

interface NodeStatement { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown; get(...p: unknown[]): unknown }
interface NodeDb { exec(sql: string): void; prepare(sql: string): NodeStatement }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => NodeDb };
const runnerFor = (db: NodeDb): SqlRunner => ({
  exec: (sql) => db.exec(sql),
  all: <T,>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...params) as T[],
  run: (sql, ...params) => {
    db.prepare(sql).run(...params);
  },
});
const canon = (value: unknown): string =>
  JSON.stringify(value, (_key, item) => (item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item));
function freshDevice(): { db: NodeDb; run: SqlRunner } {
  const db = new DatabaseSync(':memory:');
  const run = runnerFor(db);
  runMigrations(run, 0);
  return { db, run };
}

// ---- fixtures ---------------------------------------------------------------------------------------------------------------------------------
let n = 0;
const ctx: Ctx = { now: () => new Date(2026, 10, 20, 9, 0, 0), newId: () => `id-${++n}` };
const NOW = new Date(2026, 10, 20, 9, 0, 0);

const CBE_OUT = `Dear  Abebe Gxxx dxxxxx You have successfully transferred ETB500.00 from account 1***4827 to account 1***7316 (Fiker Mulu Alem). Service charge of ETB 0.50 and VAT(15%) of ETB0.08 and Disaster Recovery(5%) of 0.03 with total of ETB500.61 .Your current balance is ETB9,415.20. Thanks for Banking with CBE. `;
const CBE_OUT2 = CBE_OUT.replace('ETB500.00', 'ETB700.00').replace('ETB500.61', 'ETB700.61');
const CBE_CREDIT = `Dear Mr Abebe your Account 1****4827 has been credited with ETB 2012. Your Current Balance is ETB 11340.67. Thank you for Banking with CBE`;
const CBE_CREDIT2 = `Dear Mr Abebe your Account 1****4827 has been credited with ETB 3000. Your Current Balance is ETB 14340.67. Thank you for Banking with CBE`;

const created = planCreateAccount({ accounts: [], entries: [], goals: [], allocations: [], notifications: [], rates: [], currencies: ['ETB'] }, { name: 'CBE', type: 'bank', currency: 'ETB', openingAmount: 25000, date: '2026-10-01', smsSender: 'CBE', lastDigits: '4827' }, ctx);
const CBE = created.account.id;
const base: AccountsState = created.state;

function stage(text: string, status: SmsSuggestion['status']): SmsSuggestion {
  const preview = previewBatch(text, new Set(), null, NOW);
  const [row] = stageBatch(preview, '2026-11-10', ctx, { accounts: base.accounts, rules: [], categories: [] });
  return { ...row, accountId: CBE, status, category: 'Food' };
}
function confirm(state: AccountsState, row: SmsSuggestion): { state: AccountsState; row: SmsSuggestion } {
  const plan = planSuggestionSave(state, { ...row, status: 'pending' }, { remember: false }, ctx);
  return { state: plan.result.state, row: { ...row, status: 'confirmed', confirmedEntryId: plan.mainEntryId } };
}

// An entry saved by the EARLIER build from a message that printed the total as its amount: the entry holds the total, and the charges again as a
// separate Fees expense. The repair card is built from exactly this pair.
function feeTwice(state: AccountsState): { state: AccountsState; row: SmsSuggestion; mainId: string } {
  const row: SmsSuggestion = {
    ...stage(CBE_OUT, 'pending'), id: 'twice', rawHash: 'hash-twice', amount: 3001.2, fee: 1, vat: 0.15, otherCharge: 0.05, totalDeducted: 3001.2, date: '2026-11-12', counterpartyName: 'Fiker Mulu Alem',
  };
  const plan = planSuggestionSave(state, row, { remember: false }, ctx);
  return { state: plan.result.state, row: { ...row, status: 'confirmed', confirmedEntryId: plan.mainEntryId }, mainId: plan.mainEntryId };
}

const out1 = confirm(base, stage(CBE_OUT, 'pending'));
const credit1 = confirm(out1.state, stage(CBE_CREDIT, 'pending'));
const twice = feeTwice(credit1.state);
const skipped = stage(CBE_OUT2, 'ignored');
const waiting = stage(CBE_CREDIT2, 'pending');
const ledger = twice.state;
const messages = [out1.row, credit1.row, twice.row, skipped, waiting];
const bal = (state: AccountsState) => getAccountBalances(state.entries, state.accounts)[CBE];
const sourceBackup = () => createBackupV4({ categories: [], budgets: [], state: ledger, suggestions: messages }, NOW);

// ======================================================= 1. what is in a version 4 backup =====================================================
console.log('What goes in');
{
  const backup = sourceBackup();
  const text = JSON.stringify(backup);
  check('an export is version 4', backup.version === 4);
  check('it holds the four handled messages (two saved, the fee-repair one, one skipped) and not the one still waiting', backup.handledMessages.length === 4 && !backup.handledMessages.some((r) => r.hash === waiting.rawHash));
  check('statuses are confirmed or ignored, a confirmed one keeps the id of its entry, a skipped one has none', backup.handledMessages.filter((r) => r.status === 'confirmed').every((r) => typeof r.confirmedEntryId === 'string') && backup.handledMessages.filter((r) => r.status === 'ignored').every((r) => r.confirmedEntryId === null));
  check('every record has exactly the agreed fields and no others', backup.handledMessages.every((r) => Object.keys(r).sort().join() === 'amount,confirmedEntryId,date,dateSource,direction,fee,feeAmount,hash,kind,otherCharge,service,status,totalDeducted,vat'));
  const leaks = ['Fiker', 'Abebe', '4827', '7316', '9,415', '9415.2', '11340.67', '14340.67', 'Thanks for Banking', 'credited with', 'Service charge'];
  const handledText = JSON.stringify(backup.handledMessages);
  check('the handled part holds no message text, no name, no tail and no printed balance', leaks.every((word) => !handledText.includes(word)), leaks.filter((word) => handledText.includes(word)).join());
  const { handledMessages: _h, ...ledgerPart } = backup;
  void _h;
  check('...the ledger part still holds the entries with their names and the account digits (so the whole file is private)', JSON.stringify(ledgerPart).includes('Fiker') && JSON.stringify(ledgerPart).includes('4827') && !text.includes('Thanks for Banking') && !text.includes('credited with'));
  check('a hash is the stored hash of the message, never the text', backup.handledMessages.some((r) => r.hash === out1.row.rawHash) && backup.handledMessages.every((r) => !/\s/.test(r.hash)));
  check('pending and confirmed/skipped are the only statuses it can ever write', toHandledRecords(messages).every((r) => r.status === 'confirmed' || r.status === 'ignored'));
}

// ======================================================= 2. round trip =====================================================================
console.log('Round trip');
{
  const backup = JSON.parse(JSON.stringify(sourceBackup()));
  const restored = restoreBackup(backup, ctx);
  check('version 4 restores, and brings the handled messages with it', restored.handled !== null && restored.handled.length === 4);
  check('the message says how many came back', /4 handled messages restored \(3 saved, 1 skipped\)/.test(restored.message), restored.message);
  const device = freshDevice();
  applyBackupRows(device.run, restored.backup, restored.handled);
  const data = readAccountsData(device.run);
  check('the ledger is identical after the round trip: accounts, entries, balance', canon(data.accounts) === canon(ledger.accounts) && canon(data.entries.map((e) => e.id).sort()) === canon(ledger.entries.map((e) => e.id).sort()) && bal({ ...ledger, ...data }) === bal(ledger));
  const back = readSuggestions(device.run);
  const same = (a: SmsSuggestion, b: SmsSuggestion) => a.rawHash === b.rawHash && a.status === b.status && a.confirmedEntryId === b.confirmedEntryId && a.amount === b.amount && a.fee === b.fee && a.vat === b.vat && a.otherCharge === b.otherCharge && a.totalDeducted === b.totalDeducted && a.date === b.date && a.direction === b.direction && a.service === b.service;
  const byHash = new Map(back.map((r) => [r.rawHash, r]));
  check('the same four messages are in the database: same hash, status, entry id and figures', back.length === 4 && [out1.row, credit1.row, twice.row, skipped].every((m) => { const r = byHash.get(m.rawHash); return r !== undefined && same(r, m); }));
  check('...with no account, no name, no tail, no reference, no balance and no note', back.every((r) => r.accountId === null && r.counterpartyName === null && r.counterpartyPhoneTail === null && r.counterpartyAccountTail === null && r.accountTail === null && r.reference === null && r.balanceAfter === null && r.note === null && r.occurredAt === null));
  const again = restoreBackup(JSON.parse(JSON.stringify(createBackupV4({ categories: [], budgets: [], state: { ...ledger, ...data }, suggestions: back }, NOW))), ctx);
  check('exporting what was restored gives the same handled list again', canon(again.handled?.map((r) => [r.rawHash, r.status, r.confirmedEntryId]).sort()) === canon(restored.handled?.map((r) => [r.rawHash, r.status, r.confirmedEntryId]).sort()));
}

// ======================================================= 3. version 3 and 2 leave the device's handled set alone ====================================
console.log('Older backups');
{
  const device = freshDevice();
  applyBackupRows(device.run, restoreBackup(JSON.parse(JSON.stringify(sourceBackup())), ctx).backup, null);
  insertSuggestions(device.run, [stage(CBE_OUT, 'confirmed'), stage(CBE_OUT2, 'ignored'), stage(CBE_CREDIT2, 'pending')]);
  const before = canon(readSuggestions(device.run));
  const { version: _v, handledMessages: _h, ...ledgerOnly } = sourceBackup();
  void _v;
  void _h;
  const v3 = JSON.parse(JSON.stringify({ version: 3, ...ledgerOnly }));
  const restored3 = restoreBackup(v3, ctx);
  check('a version 3 backup carries no handled messages', restored3.handled === null && !/handled/.test(restored3.message));
  applyBackupRows(device.run, restored3.backup, restored3.handled);
  check('restoring it leaves the device\'s handled messages EXACTLY as they were (confirmed, skipped and waiting)', canon(readSuggestions(device.run)) === before);
  check('...while the ledger was replaced', readAccountsData(device.run).entries.length === ledger.entries.length);

  const legacy = { version: 2, exportedAt: '2026-01-01T00:00:00Z', categories: [], transactions: [], exchangeRates: [], goals: [], budgets: [] };
  const mapped = restoreBackup(legacy, ctx);
  check('a version 2 backup still restores into one Cash account, with no handled messages', mapped.handled === null && mapped.backup.accounts.length === 1 && mapped.backup.accounts[0].name === 'Cash');
  applyBackupRows(device.run, mapped.backup, mapped.handled);
  check('...and leaves the device\'s handled messages untouched too', canon(readSuggestions(device.run)) === before);
}

// ======================================================= 4. version 4 replaces confirmed and skipped, keeps waiting ====================================
console.log('Version 4 on a device that has messages');
{
  const device = freshDevice();
  const collides = { ...stage(CBE_OUT2, 'pending'), id: 'device-pending-collides' };
  const other = { ...stage(CBE_CREDIT2, 'pending'), id: 'device-pending-other' };
  insertSuggestions(device.run, [{ ...stage(CBE_OUT, 'confirmed'), id: 'device-old-confirmed', rawHash: 'old-confirmed', confirmedEntryId: 'gone' }, { ...stage(CBE_CREDIT, 'ignored'), id: 'device-old-skipped', rawHash: 'old-skipped' }, collides, other]);
  const restored = restoreBackup(JSON.parse(JSON.stringify(sourceBackup())), ctx);
  applyBackupRows(device.run, restored.backup, restored.handled);
  const rows = readSuggestions(device.run);
  check('the device\'s old confirmed and skipped messages are replaced by the backup\'s', !rows.some((r) => r.rawHash === 'old-confirmed' || r.rawHash === 'old-skipped') && rows.filter((r) => r.status !== 'pending').length === 4);
  check('a waiting message whose hash is in the backup was handled, so it is dropped', !rows.some((r) => r.id === 'device-pending-collides') && rows.filter((r) => r.rawHash === skipped.rawHash).length === 1);
  check('a waiting message that is not in the backup stays', rows.some((r) => r.id === 'device-pending-other' && r.status === 'pending'));
}

// ======================================================= 5. malformed version 4 ========================================================================
console.log('A damaged version 4 backup');
{
  const good = JSON.parse(JSON.stringify(sourceBackup())) as ReturnType<typeof sourceBackup> & Record<string, unknown>;
  const withRecord = (patch: Record<string, unknown>) => ({ ...good, handledMessages: [{ ...good.handledMessages[0], ...patch }, ...good.handledMessages.slice(1)] });
  const dup = { ...good, handledMessages: [good.handledMessages[0], good.handledMessages[0]] };
  const bad: Array<[string, unknown]> = [
    ['no handled list', { ...good, handledMessages: undefined }],
    ['a handled list that is not a list', { ...good, handledMessages: 'x' }],
    ['a record that is not an object', { ...good, handledMessages: [5] }],
    ['a record with no hash', withRecord({ hash: '' })],
    ['a hash that is not text', withRecord({ hash: 12 })],
    ['a status of "pending"', withRecord({ status: 'pending' })],
    ['an unknown status', withRecord({ status: 'weird' })],
    ['a bad date', withRecord({ date: '10/11/2026' })],
    ['an impossible date', withRecord({ date: '2026-13-45' })],
    ['an amount of zero', withRecord({ amount: 0 })],
    ['an amount that is text', withRecord({ amount: '500' })],
    ['a fee that is not a number', withRecord({ fee: 'abc' })],
    ['a negative figure', withRecord({ totalDeducted: -1 })],
    ['an unknown service', withRecord({ service: 'paypal' })],
    ['an unknown direction', withRecord({ direction: 'sideways' })],
    ['an unknown kind', withRecord({ kind: 'mystery' })],
    ['a bad date source', withRecord({ dateSource: 'guess' })],
    ['an entry id that is not text', withRecord({ confirmedEntryId: 7 })],
    ['the same hash twice', dup],
    ['a ledger that overdraws (checked as for version 3)', { ...good, transactions: good.transactions.map((e: AccountEntry) => (e.type === 'opening' ? { ...e, amount: 1 } : e)) }],
  ];
  const device = freshDevice();
  applyBackupRows(device.run, restoreBackup(JSON.parse(JSON.stringify(sourceBackup())), ctx).backup, restoreBackup(JSON.parse(JSON.stringify(sourceBackup())), ctx).handled);
  const snapshot = canon([readAccountsData(device.run), readSuggestions(device.run)]);
  for (const [label, payload] of bad) {
    check(`refused: ${label}`, codeOf(() => restoreBackup(JSON.parse(JSON.stringify(payload)), ctx)) === 'RESTORE_FAILED' && /Nothing was changed/.test(messageOf(() => restoreBackup(JSON.parse(JSON.stringify(payload)), ctx))));
  }
  check('...and since it is refused before anything is written, the database is exactly as it was', canon([readAccountsData(device.run), readSuggestions(device.run)]) === snapshot);

  // a hand-edited record carrying message text never brings it in
  const sneaky = JSON.parse(JSON.stringify({ ...good, handledMessages: [{ ...good.handledMessages[0], text: 'Dear Abebe your account 1234', counterpartyName: 'Fiker Mulu Alem', balanceAfter: 123, note: 'secret', accountId: CBE }, ...good.handledMessages.slice(1)] }));
  const restoredSneaky = restoreBackup(sneaky, ctx);
  check('extra fields in a record (text, names, a balance, a note, an account) are ignored and never kept', restoredSneaky.handled !== null && restoredSneaky.handled.every((r) => r.counterpartyName === null && r.note === null && r.balanceAfter === null && r.accountId === null && !JSON.stringify(r).includes('Dear Abebe')));
  check('a damaged ledger part in a version 4 file is refused as it is for version 3', codeOf(() => restoreBackup({ version: 4, handledMessages: [] }, ctx)) === 'RESTORE_FAILED');
  check('a version this app does not know is still refused', codeOf(() => restoreBackup({ version: 5 }, ctx)) === 'RESTORE_FAILED');
}

// ======================================================= 6. a confirmed message whose entry is not there =================================================
console.log('A saved message without its entry');
{
  const payload = JSON.parse(JSON.stringify(sourceBackup()));
  payload.handledMessages[0].confirmedEntryId = 'not-in-this-backup';
  payload.handledMessages[1].confirmedEntryId = null;
  const restored = restoreBackup(payload, ctx);
  const rows = restored.handled ?? [];
  check('a confirmed message that points at an entry that is not restored becomes skipped (and so does one with no entry id)', rows.filter((r) => r.status === 'ignored' && r.confirmedEntryId === null).length === 3 && rows.filter((r) => r.status === 'confirmed').length === 1);
  check('the message says so', /2 saved messages point at an entry that is not in the backup, so they were kept as skipped/.test(restored.message), restored.message);
  const device = freshDevice();
  applyBackupRows(device.run, restored.backup, restored.handled);
  const text = [CBE_OUT, CBE_CREDIT].join('\n\n');
  const preview = previewBatch(text, handledHashes(readSuggestions(device.run)), null, NOW);
  check('even so those messages are not offered again (a skipped message still counts as handled)', preview.fresh.length === 0 && preview.alreadyHandled === 2, `${preview.fresh.length} fresh`);
}

// ======================================================= 7. atomic, with failure injection ==============================================================
console.log('All or nothing');
{
  const payload = JSON.parse(JSON.stringify(sourceBackup()));
  const restored = restoreBackup(payload, ctx);
  const injections: Array<[string, (sql: string, c: { tx: number; sms: number; cat: number }) => boolean]> = [
    ['the first ledger row', (sql, c) => sql.includes('INTO transactions') && c.tx === 1],
    ['the last ledger row', (sql, c) => sql.includes('INTO transactions') && c.tx === restored.backup.transactions.length],
    ['a category', (sql, c) => sql.includes('INTO categories') && c.cat === 2],
    ['clearing the handled messages', (sql) => sql.includes("DELETE FROM sms_suggestions WHERE status IN"),],
    ['the first restored message', (sql, c) => sql.includes('INTO sms_suggestions') && c.sms === 1],
    ['the LAST restored message', (sql, c) => sql.includes('INTO sms_suggestions') && c.sms === 4],
  ];
  for (const [label, shouldFail] of injections) {
    const device = freshDevice();
    // The device already has other data and handled messages: they must survive a failed restore exactly.
    applyBackupRows(device.run, { ...restored.backup, accounts: restored.backup.accounts, transactions: restored.backup.transactions.slice(0, 1) }, null);
    insertSuggestions(device.run, [{ ...stage(CBE_OUT, 'confirmed'), id: 'keep-me', rawHash: 'keep-me', confirmedEntryId: 'x' }, { ...stage(CBE_CREDIT2, 'pending'), id: 'keep-pending' }]);
    const snapshot = canon([readAccountsData(device.run), readSuggestions(device.run)]);
    const counters = { tx: 0, sms: 0, cat: 0 };
    const bad: SqlRunner = {
      ...device.run,
      exec: (sql) => {
        if (shouldFail(sql, counters)) throw new Error('disk full');
        device.run.exec(sql);
      },
      run: (sql, ...params) => {
        if (sql.includes('INTO transactions')) counters.tx += 1;
        if (sql.includes('INTO sms_suggestions')) counters.sms += 1;
        if (sql.includes('INTO categories')) counters.cat += 1;
        if (shouldFail(sql, counters)) throw new Error('disk full');
        device.run.run(sql, ...params);
      },
    };
    check(`failure on ${label}: the restore throws`, messageOf(() => applyBackupRows(bad, restored.backup, restored.handled)) === 'disk full');
    check(`failure on ${label}: NOTHING changed (ledger, categories and every message exactly as before)`, canon([readAccountsData(device.run), readSuggestions(device.run)]) === snapshot);
    applyBackupRows(device.run, restored.backup, restored.handled);
    const rows = readSuggestions(device.run);
    check(`failure on ${label}: a retry restores everything once (4 handled messages, the waiting one stays)`, readAccountsData(device.run).entries.length === ledger.entries.length && rows.filter((r) => r.status !== 'pending').length === 4 && rows.some((r) => r.id === 'keep-pending') && !rows.some((r) => r.id === 'keep-me'));
  }
}

// ======================================================= 8. dedupe and the repair card after a restore ===============================================
console.log('After a restore');
{
  const restored = restoreBackup(JSON.parse(JSON.stringify(sourceBackup())), ctx);
  const device = freshDevice();
  applyBackupRows(device.run, restored.backup, restored.handled);
  const rows = readSuggestions(device.run);
  const state: AccountsState = { ...ledger, ...readAccountsData(device.run) };

  const preview = previewBatch([CBE_OUT, CBE_CREDIT, CBE_OUT2, CBE_CREDIT2].join('\n\n'), handledHashes(rows), null, NOW);
  check('a restored confirmed message is not offered again', preview.alreadyHandled >= 2 && !preview.fresh.some((m) => m.rawHash === out1.row.rawHash || m.rawHash === credit1.row.rawHash));
  check('a restored skipped message is not offered again either', !preview.fresh.some((m) => m.rawHash === skipped.rawHash));
  check('a message that was only waiting is new again (it is not in a backup)', preview.fresh.length === 1 && preview.fresh[0].rawHash === waiting.rawHash && preview.alreadyHandled === 3);

  const before = findFeeCountedTwice(ledger, messages);
  const after = findFeeCountedTwice(state, rows);
  check('the "Fee counted twice" card finds the same entry after a restore as before', before.length === 1 && after.length === 1 && after[0].entryId === twice.mainId && after[0].newAmount === before[0].newAmount && after[0].fee === before[0].fee, JSON.stringify(after));
  const plan = planFeeRepair(state, rows, [twice.mainId], ctx);
  check('...and Fix works on the restored data: the amount goes to 3,000 and the account goes up by the fee', plan.state.entries.find((e) => e.id === twice.mainId)?.amount === 3000 && Math.round((bal(plan.state) - bal(state)) * 100) === 120);
  check('...after fixing, nothing is offered again, also after another restart', findFeeCountedTwice(plan.state, rows).length === 0);
  const noEntry = restoreBackup(JSON.parse(JSON.stringify({ ...sourceBackup(), transactions: sourceBackup().transactions.filter((e) => e.id !== twice.mainId && e.linkedTransferId === null) })), ctx);
  const demotedRows = noEntry.handled ?? [];
  check('a repair is never offered for a message whose entry did not come back', findFeeCountedTwice({ ...ledger, entries: noEntry.backup.transactions }, demotedRows).length === 0 && demotedRows.find((r) => r.rawHash === twice.row.rawHash)?.status === 'ignored');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
