// Checks for Phase 6C-0 (V2_SPEC Part Z, "Dates"): the CBE receipt-reference date decoder, the order of date sources, printed times as entry
// timestamps, the date-source label on entries (set on import, kept on edit, cleared by editing the date or confirming it), schema 7 on
// real SQLite (additive, rollback, run twice), the repository round trip, and backup.
// Every message and reference below is SYNTHETIC: invented names and values in the same shapes as real ones.
// Run: npx tsx scripts/verify-sms-dates.ts
import { UNCATEGORISED_EXPENSE, UNCATEGORISED_INCOME, defaultCategories, FEES_CATEGORY } from '../constants/categories';
import { readAccountsData, replaceAccountsData } from '../db/accountsRepo';
import { DATE_SOURCE_SCHEMA_VERSION, migrateToDateSource } from '../db/dateSourceMigration';
import { runMigrations, SqlRunner } from '../db/migrations';
import { insertSuggestions, readSuggestions, updateSuggestionChoices } from '../db/smsRepo';
import { Category, ExchangeRate } from '../types';
import { AccountEntry, AccountsState, DATE_SOURCES, DateSource } from '../types/accounts';
import { SmsSuggestion } from '../types/sms';
import { createBackupV3, restoreBackup } from '../utils/accounts/backup';
import { Ctx } from '../utils/accounts/context';
import { AccountsError } from '../utils/accounts/errors';
import { EntryInput, planAddEntry, planConfirmEntryDate, planEditEntry } from '../utils/accounts/entries';
import { planCreateAccount } from '../utils/accounts/manage';
import { dateSourceNote, isEstimatedDate, needsBatchDate, resolveMessageDate, timestampFromOccurredAt } from '../utils/sms/dateSource';
import { decodeReceiptDate, RECEIPT_MAX_AGE_DAYS } from '../utils/sms/receiptDate';
import { planSuggestionSave, suggestionInputs } from '../utils/sms/saveSuggestion';
import { previewBatch, stageBatch } from '../utils/sms/staging';

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

function makeClock(start = new Date(2026, 10, 10, 12, 0, 0)) {
  let t = start.getTime();
  let n = 0;
  const ctx: Ctx = { now: () => new Date(t), newId: () => `id-${++n}` };
  return { ctx, minute: () => (t += 60_000) };
}

// A reference for a given calendar day, built the way the bank builds it: FT + 2-digit year + 3-digit day of year + 6 more characters.
function refFor(year: number, month: number, day: number, tail = 'QWE123'): string {
  const doy = Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
  return `FT${String(year % 100).padStart(2, '0')}${String(doy).padStart(3, '0')}${tail}`;
}

const TODAY = new Date(2026, 10, 20, 12, 0, 0); // 2026-11-20, a non-leap year

// ======================================================= 1. the receipt-date decoder ===========================================
console.log('Receipt reference -> date');
{
  check('the age limit is five years (1,827 days)', RECEIPT_MAX_AGE_DAYS === 1827);
  check('day 001 is January 1', decodeReceiptDate('FT26001ABCDEF', TODAY) === '2026-01-01');
  check('day 059 is February 28 in a normal year', decodeReceiptDate('FT26059ABCDEF', TODAY) === '2026-02-28');
  check('day 060 is March 1 in a normal year', decodeReceiptDate('FT26060ABCDEF', TODAY) === '2026-03-01');
  check('day 060 is February 29 in a leap year', decodeReceiptDate('FT24060ABCDEF', TODAY) === '2024-02-29');
  check('day 366 is December 31 in a leap year', decodeReceiptDate('FT24366ABCDEF', TODAY) === '2024-12-31');
  check('day 366 does not exist in a normal year', decodeReceiptDate('FT26366ABCDEF', new Date(2026, 11, 31)) === null);
  check('day 365 is December 31 in a normal year', decodeReceiptDate('FT26365ABCDEF', new Date(2026, 11, 31, 20, 0, 0)) === '2026-12-31');
  check('the year 2000 is a leap year (400 rule): day 366 exists', decodeReceiptDate('FT00366ABCDEF', new Date(2001, 0, 5)) === '2000-12-31');
  check('day 000 is refused', decodeReceiptDate('FT26000ABCDEF', TODAY) === null);
  check('day 367 is refused', decodeReceiptDate('FT24367ABCDEF', TODAY) === null);
  check('a synthetic FT26301... is October 28, 2026', decodeReceiptDate('FT26301ABCD1', TODAY) === '2026-10-28');
  check('the date can be today', decodeReceiptDate(refFor(2026, 11, 20), TODAY) === '2026-11-20');
  check('the date can be today even late in the evening', decodeReceiptDate(refFor(2026, 11, 20), new Date(2026, 10, 20, 23, 59, 59)) === '2026-11-20');
  check('tomorrow is a future date and is refused', decodeReceiptDate(refFor(2026, 11, 21), TODAY) === null);
  check('a later month is refused', decodeReceiptDate(refFor(2026, 12, 25), TODAY) === null);
  check('a FT99 style reference is refused as the future', decodeReceiptDate('FT99123ABCDEF', TODAY) === null);
  const limit = new Date(Date.UTC(2026, 10, 20) - 1827 * 86_400_000); // the number is written out on purpose: the test must not move with the constant
  const justInside = refFor(limit.getUTCFullYear(), limit.getUTCMonth() + 1, limit.getUTCDate());
  const justOutside = (() => {
    const d = new Date(limit.getTime() - 86_400_000);
    return refFor(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  })();
  check('exactly 1,827 days old is accepted', decodeReceiptDate(justInside, TODAY) !== null, justInside);
  check('1,828 days old is refused', decodeReceiptDate(justOutside, TODAY) === null, justOutside);
  check('a very old reference is refused', decodeReceiptDate('FT10100ABCDEF', TODAY) === null);
  check('lower case is accepted', decodeReceiptDate('ft26301abcd1', TODAY) === '2026-10-28');
  check('surrounding spaces are ignored', decodeReceiptDate('  FT26301ABCD1 ', TODAY) === '2026-10-28');
  check('the characters after the date are not needed', decodeReceiptDate('FT26301', TODAY) === '2026-10-28');
  check('too short (FT2630) is refused', decodeReceiptDate('FT2630', TODAY) === null);
  check('letters where digits belong are refused', decodeReceiptDate('FTabc12345', TODAY) === null && decodeReceiptDate('FT26A01ABC', TODAY) === null);
  check('another prefix is refused', decodeReceiptDate('XX26301ABCD1', TODAY) === null && decodeReceiptDate('DJ26301ABCD', TODAY) === null);
  check('a numeric reference from another bank is refused', decodeReceiptDate('261104093315872', TODAY) === null);
  check('empty, null and undefined give no date', decodeReceiptDate('', TODAY) === null && decodeReceiptDate(null, TODAY) === null && decodeReceiptDate(undefined, TODAY) === null);
  check('the result is a plain YYYY-MM-DD with no time', /^\d{4}-\d{2}-\d{2}$/.test(decodeReceiptDate('FT26301ABCD1', TODAY) ?? ''));
}

// ======================================================= 2. the order of date sources =========================================
console.log('Date sources: message > paired > receipt > batch');
{
  const now = new Date(2026, 10, 10, 12, 0, 0);
  const batch = '2026-11-09';
  const printed = resolveMessageDate({ occurredAt: '2026-11-04T10:15:00', reference: 'FT26301ABCD1' }, now, batch);
  check('a printed date beats a receipt date', printed.date === '2026-11-04' && printed.source === 'message');
  const receipt = resolveMessageDate({ occurredAt: null, reference: 'FT26301ABCD1' }, now, batch);
  check('a receipt date beats the batch date', receipt.date === '2026-10-28' && receipt.source === 'receipt');
  check('no printed date and no reference: the batch date', resolveMessageDate({ occurredAt: null, reference: null }, now, batch).source === 'batch');
  const future = resolveMessageDate({ occurredAt: null, reference: 'FT26340ABCDEF' }, now, batch);
  check('a receipt date in the future is ignored: batch date, estimated', future.date === batch && future.source === 'batch');
  check('a receipt reference from another service is ignored', resolveMessageDate({ occurredAt: null, reference: 'DJ26301ABCD' }, now, batch).source === 'batch');
  check('a garbled reference falls to the batch date', resolveMessageDate({ occurredAt: null, reference: 'FT26999ZZZ' }, now, batch).source === 'batch');
  check('"paired" and "manual" are known sources, and exactly five exist', DATE_SOURCES.length === 5 && (['message', 'paired', 'receipt', 'batch', 'manual'] as DateSource[]).every((s) => DATE_SOURCES.includes(s)));

  check('the batch date is needed when some message has neither a date nor a usable receipt', needsBatchDate([{ occurredAt: null, reference: null }, { occurredAt: '2026-11-04T10:15:00', reference: null }], now));
  check('...and not when every message has one of the two', !needsBatchDate([{ occurredAt: null, reference: 'FT26301ABCD1' }, { occurredAt: '2026-11-04T10:15:00', reference: null }], now));
  check('...an unusable receipt still needs it', needsBatchDate([{ occurredAt: null, reference: 'FT26340ABCDEF' }], now));
  check('an empty batch needs none', !needsBatchDate([], now));

  check('only the batch date is an estimate', isEstimatedDate('batch') && !isEstimatedDate('receipt') && !isEstimatedDate('message') && !isEstimatedDate('paired') && !isEstimatedDate('manual') && !isEstimatedDate(undefined) && !isEstimatedDate(null));
  const notes = DATE_SOURCES.map((s) => dateSourceNote(s));
  check('every source has its own caption', new Set(notes).size === 5 && notes.every((n) => n.length > 0));
  check('only the batch caption says estimated', dateSourceNote('batch').startsWith('Estimated') && DATE_SOURCES.filter((s) => s !== 'batch').every((s) => !/estimat/i.test(dateSourceNote(s))));
}

// ======================================================= 3. staging uses the sources ==========================================
const TB_OUT = `Dear Abebe
You have transferred ETB 120.00 to ZXXXXX QXXXX (2519****5521) on 14/11/2026 13:52:15. Your transaction number is QW7RTY2UI8. The service fee is  ETB 1.74 and  15% VAT on the service fee is ETB 0.26. Your current E-Money Account  balance is ETB 3,321.38. To download your payment information please click this link:
Thank you for using telebirr
Ethio telecom`;
const TB_EARLIER = `Dear Abebe
You have transferred ETB 50.00 to ZXXXXX QXXXX (2519****5521) on 14/11/2026 09:05:00. Your transaction number is QW7RTY2UI9. The service fee is  ETB 0.87 and  15% VAT on the service fee is ETB 0.13. Your current E-Money Account  balance is ETB 3,442.38. To download your payment information please click this link:
Thank you for using telebirr
Ethio telecom`;
const CBE_RECEIPT = `Dear Mr Abebe your Account 1****6213 has been credited with ETB 2012. Your Current Balance is ETB 61207.15. Thank you for Banking with CBE! for Reciept https://example.invalid/BranchReceipt/FT26301QWER12&19283746`;
const CBE_RECEIPT2 = `Dear Mr Abebe your Account 1****6213 has been credited with ETB 700. Your Current Balance is ETB 61907.15. Thank you for Banking with CBE! for Reciept https://example.invalid/BranchReceipt/FT26305ASDF34&19283747`;
const CBE_EMPTY = `Dear Mr Abebe your Account 1****6213 has been credited with ETB 100. Your Current Balance is ETB 62007.15. Thank you for Banking with CBE! for Reciept `;
const CBE_FUTURE = `Dear Mr Abebe your Account 1****6213 has been credited with ETB 55. Your Current Balance is ETB 62062.15. Thank you for Banking with CBE! for Reciept https://example.invalid/BranchReceipt/FT26340ZXCV56&19283748`;
const BOA = `Dear Abebe, your account 2***64 was debited with ETB 1,230.00. Available Balance: ETB 41,073.58.`;
const categories: Category[] = [...defaultCategories];

console.log('Staging: each message gets its source');
{
  const clock = makeClock(new Date(2026, 10, 10, 12, 0, 0));
  const now = clock.ctx.now();
  const stage = (text: string, batchDate = '2026-11-09') => stageBatch(previewBatch(text, new Set(), null, now), batchDate, clock.ctx, { accounts: [], rules: [], categories });

  const printed = stage(TB_OUT)[0];
  check('a Telebirr message: the printed date, source "message"', printed.date === '2026-11-14' && printed.dateSource === 'message');
  const receipt = stage(CBE_RECEIPT)[0];
  check('a CBE message with a receipt link: the decoded date, source "receipt"', receipt.date === '2026-10-28' && receipt.dateSource === 'receipt' && receipt.occurredAt === null && receipt.reference === 'FT26301QWER12');
  const empty = stage(CBE_EMPTY)[0];
  check('a CBE message with an empty link: the batch date, source "batch"', empty.date === '2026-11-09' && empty.dateSource === 'batch');
  const future = stage(CBE_FUTURE)[0];
  check('a receipt date in the future falls to the batch date, which is estimated', future.date === '2026-11-09' && future.dateSource === 'batch');
  const boa = stage(BOA, '2026-11-08')[0];
  check('a BOA message (no reference): the batch date, source "batch"', boa.date === '2026-11-08' && boa.dateSource === 'batch');

  check('a batch of messages that all have a date or a receipt does not ask for a batch date', previewBatch([TB_OUT, CBE_RECEIPT, CBE_RECEIPT2].join('\n\n'), new Set(), null, now).needsDate === false);
  check('one message with neither makes the batch ask', previewBatch([TB_OUT, CBE_RECEIPT, CBE_EMPTY].join('\n\n'), new Set(), null, now).needsDate === true);
  check('an unusable receipt makes it ask', previewBatch(CBE_FUTURE, new Set(), null, now).needsDate === true);
  check('a mixed batch: every card gets the right source', stageBatch(previewBatch([TB_OUT, CBE_RECEIPT, CBE_EMPTY, BOA].join('\n\n'), new Set(), null, now), '2026-11-09', clock.ctx, { accounts: [], rules: [], categories }).map((s) => s.dateSource).join() === 'message,receipt,batch,batch');
  check('the batch date is never applied over a printed or receipt date', stage([TB_OUT, CBE_RECEIPT].join('\n\n'), '2020-01-01').every((s) => s.date !== '2020-01-01'));
}

// ======================================================= 4. printed times ====================================================
console.log('Printed times become timestamps');
{
  const local = new Date(2026, 10, 14, 13, 52, 15);
  check('a printed time becomes the UTC ISO of that local moment', timestampFromOccurredAt('2026-11-14T13:52:15') === local.toISOString());
  const back = new Date(timestampFromOccurredAt('2026-11-14T13:52:15') ?? '');
  check('...whatever the phone\'s timezone, it is 13:52:15 local again', back.getHours() === 13 && back.getMinutes() === 52 && back.getSeconds() === 15 && back.getDate() === 14);
  check('no time gives none', timestampFromOccurredAt(null) === null);
  check('an impossible time gives none', timestampFromOccurredAt('2026-02-30T10:00:00') === null && timestampFromOccurredAt('2026-11-14T25:00:00') === null && timestampFromOccurredAt('2026-11-14') === null && timestampFromOccurredAt('nonsense') === null);
  check('earlier in the day sorts earlier', (timestampFromOccurredAt('2026-11-14T09:05:00') ?? '') < (timestampFromOccurredAt('2026-11-14T13:52:15') ?? ''));
}

// ======================================================= 5. entries: source and timestamp ======================================
console.log('Entries: the date source and the timestamp');
{
  const clock = makeClock(new Date(2026, 10, 20, 9, 0, 0));
  const created = planCreateAccount({ accounts: [], entries: [], goals: [], allocations: [], notifications: [], rates: [] as ExchangeRate[], currencies: ['ETB'] } as AccountsState, { name: 'Telebirr', type: 'wallet', currency: 'ETB', openingAmount: 9000, smsSender: '127' }, clock.ctx);
  const opened = { ...created.state, entries: created.state.entries.map((e) => ({ ...e, date: '2026-10-01' })) };
  const acct = created.account.id;
  const card = (text: string, patch: Partial<SmsSuggestion> = {}): SmsSuggestion => ({
    ...stageBatch(previewBatch(text, new Set(), null, clock.ctx.now()), '2026-11-18', clock.ctx, { accounts: opened.accounts, rules: [], categories })[0],
    accountId: acct,
    category: 'Food',
    ...patch,
  });

  // a printed time: entry timestamp = that time
  const out = card(TB_OUT);
  const plan = planSuggestionSave(opened, out, { remember: false }, clock.ctx);
  const [main, fee] = plan.result.added;
  const printedTs = new Date(2026, 10, 14, 13, 52, 15).toISOString();
  check('an entry saved from a message that prints a time stores that time', main.timestamp === printedTs && main.date === '2026-11-14');
  check('...and its source is "message"', main.dateSource === 'message');
  check('the Fees row carries the same date, source and time', fee.date === main.date && fee.dateSource === 'message' && fee.timestamp === printedTs);

  // same-day order follows the time even when saved in the other order
  const later = planSuggestionSave(opened, out, { remember: false }, clock.ctx).result.state;
  const earlier = planSuggestionSave(later, card(TB_EARLIER, { feeAmount: 0 }), { remember: false }, clock.ctx).result.state;
  const sameDay = earlier.entries.filter((e) => e.date === '2026-11-14' && e.category === 'Food').sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  check('two entries of one day saved out of order sort back into the order they happened', sameDay.length === 2 && sameDay[0].amount === 50 && sameDay[1].amount === 120);

  // no printed time: the moment of saving, and the source is the batch / receipt
  const batchCard = card(BOA, { accountId: acct, category: 'Food' });
  const batchMain = planSuggestionSave(opened, batchCard, { remember: false }, clock.ctx).result.added[0];
  check('a BOA message saves with the batch date, source "batch", and the time of saving as its timestamp', batchMain.date === '2026-11-18' && batchMain.dateSource === 'batch' && batchMain.timestamp === clock.ctx.now().toISOString());
  const receiptMain = planSuggestionSave(opened, card(CBE_RECEIPT, { category: 'Salary' }), { remember: false }, clock.ctx).result.added[0];
  check('a CBE message with a receipt date saves with that date, source "receipt", no printed time', receiptMain.date === '2026-10-28' && receiptMain.dateSource === 'receipt' && receiptMain.timestamp === clock.ctx.now().toISOString());
  check('(an expense on 2026-11-14 is inside the account\'s life)', opened.entries[0].date === '2026-10-01');

  // the owner edits the date on the card: source "manual", and a printed time no longer applies
  const edited = suggestionInputs({ ...out, date: '2026-11-15', dateSource: 'manual' }, acct, 'Food')[0] as Extract<EntryInput, { type: 'income' | 'expense' }>;
  check('a date the owner changed is "manual" and the printed time is not used', edited.dateSource === 'manual' && edited.timestamp === null);

  // a manual entry carries neither
  const manual = planAddEntry(opened, { type: 'expense', accountId: acct, amount: 10, currency: 'ETB', category: 'Food', date: '2026-11-15' }, clock.ctx);
  const manualEntry = manual.state.entries[manual.state.entries.length - 1];
  check('a manual entry has no date source (the key is absent)', !('dateSource' in manualEntry));
  check('...and the time of saving as its timestamp', manualEntry.timestamp === clock.ctx.now().toISOString());

  // editing
  const base = batchMain;
  const stateWith = (entry: AccountEntry): AccountsState => ({ ...opened, entries: [...opened.entries, entry] });
  const baseInput = (patch: Partial<Extract<EntryInput, { type: 'income' | 'expense' }>> = {}): EntryInput => ({ type: 'expense', accountId: acct, amount: base.amount, currency: 'ETB', category: base.category, date: base.date, ...patch });
  const s0 = stateWith(base);
  const find = (s: AccountsState) => s.entries.find((e) => e.id === base.id)!;
  check('(setup) the imported entry is an estimate', isEstimatedDate(base.dateSource));
  const sameDate = planEditEntry(s0, base.id, baseInput({ amount: base.amount + 1 }), clock.ctx).state;
  check('editing something other than the date keeps the estimate', find(sameDate).dateSource === 'batch' && find(sameDate).amount === base.amount + 1);
  const newDate = planEditEntry(s0, base.id, baseInput({ date: '2026-11-17' }), clock.ctx).state;
  check('editing the DATE makes it "manual": no longer an estimate', find(newDate).dateSource === 'manual' && find(newDate).date === '2026-11-17' && !isEstimatedDate(find(newDate).dateSource));
  check('an edit never moves the timestamp', find(newDate).timestamp === base.timestamp && find(sameDate).timestamp === base.timestamp);
  const cleared = planEditEntry(s0, base.id, baseInput({ dateSource: null }), clock.ctx).state;
  check('an explicit null clears it (the key is absent again)', !('dateSource' in find(cleared)));
  const explicit = planEditEntry(s0, base.id, baseInput({ dateSource: 'manual' }), clock.ctx).state;
  check('an explicit source is used', find(explicit).dateSource === 'manual');
  const fromMessage = stateWith({ ...base, dateSource: 'message' });
  check('a message date changed by the owner is "manual" too', find(planEditEntry(fromMessage, base.id, baseInput({ date: '2026-11-17' }), clock.ctx).state).dateSource === 'manual');
  check('a message date left alone stays "message"', find(planEditEntry(fromMessage, base.id, baseInput({ amount: 9 }), clock.ctx).state).dateSource === 'message');
  const plain = stateWith({ ...base, dateSource: undefined });
  check('an entry with no source stays without one when edited', !('dateSource' in find(planEditEntry(plain, base.id, baseInput({ date: '2026-11-17' }), clock.ctx).state)));

  // "Date is right"
  const confirmed = planConfirmEntryDate(s0, base.id);
  const before = find(s0);
  const after = find(confirmed);
  check('"Date is right" sets the source to "manual"', after.dateSource === 'manual');
  check('...and changes nothing else on the entry', JSON.stringify({ ...after, dateSource: 0 }) === JSON.stringify({ ...before, dateSource: 0 }));
  check('...nor any other entry', confirmed.entries.filter((e) => e.id !== base.id).every((e, i) => e === s0.entries.filter((x) => x.id !== base.id)[i]));
  check('...nor any balance', JSON.stringify(confirmed.entries.map((e) => [e.id, e.amount, e.date])) === JSON.stringify(s0.entries.map((e) => [e.id, e.amount, e.date])));
  check('confirming an unknown entry is refused', codeOf(() => planConfirmEntryDate(s0, 'nope')) === 'INVALID_ENTRY');
}

// ======================================================= 6. SQLite: schema 7 and the round trip ================================
interface NodeStatement {
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
}
interface NodeDb {
  exec(sql: string): void;
  prepare(sql: string): NodeStatement;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => NodeDb };
const runnerFor = (db: NodeDb): SqlRunner => ({
  exec: (sql) => db.exec(sql),
  all: <T,>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...params) as T[],
  run: (sql, ...params) => {
    db.prepare(sql).run(...params);
  },
});
const versionOf = (db: NodeDb): number => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
const tableExists = (db: NodeDb, name: string): boolean => (db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { c: number }).c > 0;
const columnsOf = (db: NodeDb, table: string): string[] => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
const countOf = (db: NodeDb, sql: string): number => (db.prepare(`SELECT COUNT(*) AS c FROM ${sql}`).get() as { c: number }).c;
const canon = (value: unknown): string =>
  JSON.stringify(value, (_key, item) => (item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item));

console.log('Schema 7 (additive) and the repository round trip');
{
  const clock = makeClock(new Date(2026, 10, 20, 9, 0, 0));
  const created = planCreateAccount({ accounts: [], entries: [], goals: [], allocations: [], notifications: [], rates: [] as ExchangeRate[], currencies: ['ETB'] } as AccountsState, { name: 'Telebirr', type: 'wallet', currency: 'ETB', openingAmount: 9000, smsSender: '127' }, clock.ctx);
  const opened: AccountsState = { ...created.state, entries: created.state.entries.map((e) => ({ ...e, date: '2026-10-01' })) };
  const acct = created.account.id;
  const makeCard = (text: string, batch = '2026-11-18'): SmsSuggestion => ({
    ...stageBatch(previewBatch(text, new Set(), null, clock.ctx.now()), batch, clock.ctx, { accounts: opened.accounts, rules: [], categories })[0],
    accountId: acct,
    category: 'Food',
  });

  check('the schema is version 7', DATE_SOURCE_SCHEMA_VERSION === 7);

  // a schema 6 device with the owner's data
  const device = new DatabaseSync(':memory:');
  const run = runnerFor(device);
  runMigrations(run, 0);
  const manual = planAddEntry(opened, { type: 'expense', accountId: acct, amount: 40, currency: 'ETB', category: 'Food', date: '2026-11-05' }, clock.ctx).state;
  replaceAccountsData(run, manual);
  const cards = [makeCard(TB_OUT), makeCard(BOA)];
  insertSuggestions(run, cards);
  device.exec('ALTER TABLE transactions DROP COLUMN date_source; ALTER TABLE sms_suggestions DROP COLUMN date_source; ALTER TABLE sms_suggestions DROP COLUMN paired_with_id; DROP TABLE reconcile_dismissals; PRAGMA user_version = 6');
  // Explicit columns: the schema 6 device has no date_source to read yet, and the new column must not count as a change.
  const snapshot = () => canon({ accounts: run.all('SELECT * FROM accounts ORDER BY id'), transactions: run.all('SELECT id, type, account_id, amount, currency, amount_etb, exchange_rate, category, source, from_account_id, to_account_id, to_amount, to_amount_etb, linked_transfer_id, date, timestamp, note, is_automatic, created_at, updated_at FROM transactions ORDER BY id'), goals: run.all('SELECT * FROM goals ORDER BY id'), categories: run.all('SELECT * FROM categories ORDER BY id'), suggestions: run.all('SELECT id, raw_hash, status, amount, date, occurred_at, category, account_id FROM sms_suggestions ORDER BY id'), rules: run.all('SELECT * FROM recipient_rules') });
  const before = snapshot();
  check('(setup) a schema 6 device has none of the new columns or the new table', versionOf(device) === 6 && !columnsOf(device, 'transactions').includes('date_source') && !columnsOf(device, 'sms_suggestions').includes('date_source') && !tableExists(device, 'reconcile_dismissals'));

  const failing: SqlRunner = { ...run, exec: (sql) => { if (sql.startsWith('PRAGMA user_version = 7')) throw new Error('disk full'); run.exec(sql); } };
  check('a failure part-way throws', messageOf(() => migrateToDateSource(failing, 6)) === 'disk full');
  check('...and rolls back: no new column, no new table, still version 6', versionOf(device) === 6 && !columnsOf(device, 'transactions').includes('date_source') && !columnsOf(device, 'sms_suggestions').includes('date_source') && !columnsOf(device, 'sms_suggestions').includes('paired_with_id') && !tableExists(device, 'reconcile_dismissals'));
  check('...and no existing row changed', snapshot() === before);

  const result = migrateToDateSource(run, 6);
  check('the retry adds three columns and the table', !!result && result.columnsAdded.length === 3 && versionOf(device) === 7 && tableExists(device, 'reconcile_dismissals'));
  check('the columns are where they belong', columnsOf(device, 'transactions').includes('date_source') && columnsOf(device, 'sms_suggestions').includes('date_source') && columnsOf(device, 'sms_suggestions').includes('paired_with_id'));
  check('NO existing row was touched (ledger, categories, suggestions, rules)', snapshot() === before);
  check('every old entry and suggestion has an empty date_source (no UPDATE was run)', countOf(device, 'transactions WHERE date_source IS NOT NULL') === 0 && countOf(device, 'sms_suggestions WHERE date_source IS NOT NULL') === 0 && countOf(device, 'sms_suggestions WHERE paired_with_id IS NOT NULL') === 0);
  check('the dismissals table starts empty with its columns', countOf(device, 'reconcile_dismissals') === 0 && columnsOf(device, 'reconcile_dismissals').join() === 'account_id,dismissed_hash,dismissed_at');
  check('running it again does nothing', migrateToDateSource(run, 7) === null && versionOf(device) === 7);
  runMigrations(run, 6);
  check('runMigrations from 6 again changes nothing', snapshot() === before && versionOf(device) === 9);
  check('the step refuses to run below 6', messageOf(() => migrateToDateSource(run, 5)).includes('Uncategorised migration'));
  const fresh = new DatabaseSync(':memory:');
  runMigrations(runnerFor(fresh), 0);
  check('a fresh install reaches 9 with everything in place', versionOf(fresh) === 9 && columnsOf(fresh, 'transactions').includes('date_source') && tableExists(fresh, 'reconcile_dismissals'));

  // old rows read as before
  const legacy = readSuggestions(run);
  check('an old suggestion with a printed time reads as "message"', legacy.find((s) => s.service === 'telebirr')!.dateSource === 'message');
  check('an old suggestion with no printed time reads as "batch"', legacy.find((s) => s.service === 'boa')!.dateSource === 'batch');
  check('old entries read without a date source (no key at all)', readAccountsData(run).entries.every((e) => !('dateSource' in e)));
  check('the ledger round trip is exactly what it was before the migration', canon(readAccountsData(run).entries.sort((a, b) => a.id.localeCompare(b.id))) === canon(manual.entries.sort((a, b) => a.id.localeCompare(b.id))));

  // entries and suggestions with sources
  const plan = planSuggestionSave(opened, { ...makeCard(CBE_RECEIPT), category: 'Salary' }, { remember: false }, clock.ctx);
  replaceAccountsData(run, plan.result.state);
  const read = readAccountsData(run);
  const savedEntry = read.entries.find((e) => e.id === plan.mainEntryId)!;
  check('an entry\'s date source round trips through SQLite', savedEntry.dateSource === 'receipt' && savedEntry.date === '2026-10-28');
  check('the whole entry round trips unchanged', canon(savedEntry) === canon(plan.result.state.entries.find((e) => e.id === plan.mainEntryId)));
  check('an unknown value in the column is read as no source', (() => { run.run("UPDATE transactions SET date_source = 'nonsense' WHERE id = ?", plan.mainEntryId); return !('dateSource' in readAccountsData(run).entries.find((e) => e.id === plan.mainEntryId)!); })());

  const fresh2 = new DatabaseSync(':memory:');
  const run2 = runnerFor(fresh2);
  runMigrations(run2, 0);
  const sCards = [makeCard(CBE_RECEIPT), makeCard(BOA), makeCard(TB_OUT)];
  insertSuggestions(run2, sCards);
  const back = readSuggestions(run2);
  check('each suggestion\'s source round trips (receipt, batch, message)', sCards.every((c) => back.find((b) => b.id === c.id)?.dateSource === c.dateSource));
  updateSuggestionChoices(run2, sCards[1].id, { date: '2026-11-12', dateSource: 'manual' });
  const edited = readSuggestions(run2).find((s) => s.id === sCards[1].id)!;
  check('an edited date is saved with the source "manual"', edited.date === '2026-11-12' && edited.dateSource === 'manual');
  updateSuggestionChoices(run2, sCards[1].id, { category: 'Rent' });
  check('other edits leave the source alone', readSuggestions(run2).find((s) => s.id === sCards[1].id)!.dateSource === 'manual');
}

// ======================================================= 7. backup ==========================================================
console.log('Backup: the optional date source, and the built-in categories');
{
  const clock = makeClock(new Date(2026, 10, 20, 9, 0, 0));
  const created = planCreateAccount({ accounts: [], entries: [], goals: [], allocations: [], notifications: [], rates: [] as ExchangeRate[], currencies: ['ETB'] } as AccountsState, { name: 'Telebirr', type: 'wallet', currency: 'ETB', openingAmount: 9000, smsSender: '127' }, clock.ctx);
  const opened: AccountsState = { ...created.state, entries: created.state.entries.map((e) => ({ ...e, date: '2026-10-01' })) };
  const acct = created.account.id;
  const card: SmsSuggestion = { ...stageBatch(previewBatch(BOA, new Set(), null, clock.ctx.now()), '2026-11-18', clock.ctx, { accounts: opened.accounts, rules: [], categories })[0], accountId: acct, category: 'Food' };
  const state = planSuggestionSave(opened, card, { remember: false }, clock.ctx).result.state;

  const backup = createBackupV3({ categories, budgets: [], state }, clock.ctx.now());
  const imported = backup.transactions.find((e) => e.dateSource === 'batch');
  check('the export carries an entry\'s date source', !!imported && backup.transactions.filter((e) => 'dateSource' in e).length === 1);
  const restored = restoreBackup(JSON.parse(JSON.stringify(backup)), clock.ctx);
  const back = restored.backup.transactions.find((e) => e.id === imported?.id);
  check('a restore keeps it, and the entry is otherwise identical', back?.dateSource === 'batch' && canon(back) === canon(imported));
  check('entries without a source still have none after a restore', restored.backup.transactions.filter((e) => !('dateSource' in e)).length === backup.transactions.length - 1);

  // a backup made before date sources existed: no key anywhere
  const old = JSON.parse(JSON.stringify(backup)) as typeof backup;
  old.transactions = old.transactions.map((e) => { const { dateSource: _gone, ...rest } = e; void _gone; return rest as AccountEntry; });
  const oldRestored = restoreBackup(old, clock.ctx);
  check('a backup without the field restores, with no source on any entry', oldRestored.backup.transactions.every((e) => !('dateSource' in e)) && oldRestored.backup.transactions.length === backup.transactions.length);

  // a value this app does not know is dropped, not trusted
  const odd = JSON.parse(JSON.stringify(backup)) as typeof backup;
  odd.transactions = odd.transactions.map((e) => (e.id === imported?.id ? ({ ...e, dateSource: 'martian' } as unknown as AccountEntry) : e));
  check('an unknown source in a file is dropped on restore', !('dateSource' in restoreBackup(odd, clock.ctx).backup.transactions.find((e) => e.id === imported?.id)!));
  check('the restore does not change the balance or any amount', canon(restored.backup.transactions.map((e) => [e.id, e.amount, e.date])) === canon(backup.transactions.map((e) => [e.id, e.amount, e.date])));

  // the built-in categories are always there after a restore (an older backup was made before Uncategorised existed)
  const noBuiltIns = JSON.parse(JSON.stringify(backup)) as typeof backup;
  noBuiltIns.categories = noBuiltIns.categories.filter((c) => c.name !== 'Uncategorised' && c.name !== FEES_CATEGORY.name);
  const withBuiltIns = restoreBackup(noBuiltIns, clock.ctx).backup.categories;
  check('a restored file with no Uncategorised or Fees categories gets them back', withBuiltIns.some((c) => c.name === 'Uncategorised' && c.type === 'income') && withBuiltIns.some((c) => c.name === 'Uncategorised' && c.type === 'expense') && withBuiltIns.some((c) => c.name === FEES_CATEGORY.name));
  const twice = restoreBackup(JSON.parse(JSON.stringify(backup)), clock.ctx).backup.categories;
  check('...and never adds a second copy', twice.filter((c) => c.name === 'Uncategorised').length === 2 && twice.filter((c) => c.name === FEES_CATEGORY.name).length === 1);
  check('the built-in category constants are the ones restored', withBuiltIns.some((c) => c.id === UNCATEGORISED_INCOME.id) && withBuiltIns.some((c) => c.id === UNCATEGORISED_EXPENSE.id));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
