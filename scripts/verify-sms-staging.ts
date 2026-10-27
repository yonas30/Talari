// Checks for Phase 6B (V2_SPEC Part Z): schema 5 on real SQLite (node:sqlite), staging and dedupe, the batch date, recipient memory,
// account matching, the save pipeline (fee as its own Fees expense), the review warnings and blocks, "save all that are clean", and the
// ALL-OR-NOTHING save (main entry + fee + suggestion confirmed + recipient rule in one database transaction).
// Every message is SYNTHETIC: invented names, references and tails in the same shapes as real ones, no real balances.
// Run: npx tsx scripts/verify-sms-staging.ts
import { defaultCategories, FEES_CATEGORY, isProtectedCategory, UNCATEGORISED_EXPENSE, UNCATEGORISED_INCOME, UNCATEGORISED_NAME } from '../constants/categories';
import { readAccountsData, replaceAccountsData } from '../db/accountsRepo';
import { runMigrations, SqlRunner } from '../db/migrations';
import { migrateToSms, SMS_SCHEMA_VERSION } from '../db/smsMigration';
import { migrateToUncategorised, UNCATEGORISED_SCHEMA_VERSION } from '../db/uncategorisedMigration';
import { commitSuggestionSave, insertSuggestions, readRules, readSuggestions, updateSuggestionChoices } from '../db/smsRepo';
import { Category, ExchangeRate } from '../types';
import { AccountsState } from '../types/accounts';
import { SmsSuggestion } from '../types/sms';
import { getAccountBalances } from '../utils/accounts/balances';
import { Ctx } from '../utils/accounts/context';
import { AccountsError } from '../utils/accounts/errors';
import { EntryInput, planAddEntry } from '../utils/accounts/entries';
import { planAddToGoal, planCreateGoal } from '../utils/accounts/goals';
import { cleanLastDigits, cleanSmsSender, planCreateAccount, planUpdateAccountSms } from '../utils/accounts/manage';
import { getReserve } from '../utils/accounts/reserve';
import { calculateStreak } from '../utils/accounts/totals';
import { filterUncategorised, isUncategorised } from '../utils/search';
import { linkDetails, matchAccount, SERVICE_SENDER } from '../utils/sms/accountMatch';
import { findRule, normaliseRecipientName, recipientKey, suggestCategory } from '../utils/sms/recipient';
import { bulkSave } from '../utils/sms/bulkRun';
import { beforeOpeningProblem, categoryOf, checkSuggestion, cleanOrder, effectiveFee, openingDateOf, planSuggestionSave, printedCharges, suggestionInputs } from '../utils/sms/saveSuggestion';
import { parseSms } from '../utils/sms/parse';
import { handledHashes, previewBatch, stageBatch } from '../utils/sms/staging';
import { splitMessages } from '../utils/sms/split';

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

function codeOf(fn: () => unknown): string {
  try {
    fn();
    return 'none';
  } catch (error) {
    return error instanceof AccountsError ? error.code : `other:${error instanceof Error ? error.message : String(error)}`;
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

function makeClock(start = new Date(2026, 10, 10, 12, 0, 0)) {
  let t = start.getTime();
  let n = 0;
  const ctx: Ctx = { now: () => new Date(t), newId: () => `id-${++n}` };
  return { ctx, minute: () => (t += 60_000) };
}

// ---- synthetic messages (invented values) -----------------------------------------------------------------------------------------
const TB_OUT = `Dear Abebe
You have transferred ETB 120.00 to ZXXXXX QXXXX (2519****5521) on 14/11/2026 13:52:15. Your transaction number is QW7RTY2UI8. The service fee is  ETB 1.74 and  15% VAT on the service fee is ETB 0.26. Your current E-Money Account  balance is ETB 3,321.38. To download your payment information please click this link:
Thank you for using telebirr
Ethio telecom`;
const TB_PKG = `Dear Abebe
You have paid ETB 3.00 for package Daily SMS Package 36 SMS purchase made for 9XXXXXXX5 on 14/11/2026 18:56:44. Your transaction number is  ZP3LKJ9HG5. Your current balance is ETB 3,318.38.To download your payment information please click this `;
const TB_IN = `Dear Abebe,
You have received ETB 2,000.00 from Hxxxxx Nxxxxx(2519****7743)  on 15/11/2026 09:13:58. Your transaction number is MN4BVC8XZ2. Your current E-Money Account balance is ETB 5,318.38.`;
const CBE_OUT = `Dear  Abebe Gxxx dxxxxx You have successfully transferred ETB500.00 from account 1***4827 to account 1***7316 (Fiker Mulu Alem). Service charge of ETB 0.50 and VAT(15%) of ETB0.08 and Disaster Recovery(5%) of 0.03 with total of ETB500.61 .Your current balance is ETB9,415.20. Thanks for Banking with CBE. `;
const CBE_CREDIT = `Dear Mr Abebe your Account 1****4827 has been credited with ETB 2012. Your Current Balance is ETB 11340.67. Thank you for Banking with CBE`;
const OTP = 'Dear Abebe, your OTP is 482913. Do not share it with anyone.';
const GARBAGE = 'Dear Abebe, ETB 250.00 was moved around in an unfamiliar way on your account.';

// ---- fixtures --------------------------------------------------------------------------------------------------------------------
const NOW = new Date(2026, 10, 20, 12, 0, 0);
const TODAY = '2026-11-20';
const categories: Category[] = [...defaultCategories, { id: 'phone', name: 'Phone & Internet', type: 'expense', icon: '📱', color: '#0ea5e9', isDefault: false }];
const rate: ExchangeRate = { id: 'USD-ETB', fromCurrency: 'USD', toCurrency: 'ETB', rate: 55, updatedAt: new Date(NOW.getTime() - 86_400_000).toISOString() };
const emptyState = (): AccountsState => ({ accounts: [], entries: [], goals: [], allocations: [], notifications: [], rates: [rate], currencies: ['ETB', 'USD'] });

function withAccount(state: AccountsState, ctx: Ctx, input: { name: string; opening: number; openingDate?: string; sender?: string | null; digits?: string | null; type?: 'cash' | 'wallet' | 'bank'; currency?: string }) {
  const created = planCreateAccount(
    state,
    { name: input.name, type: input.type ?? 'bank', currency: input.currency ?? 'ETB', openingAmount: input.opening, smsSender: input.sender ?? null, lastDigits: input.digits ?? null },
    ctx,
  );
  // The planner dates the opening balance "today"; move it so a message can be dated before it.
  let next = created.state;
  if (input.openingDate) {
    next = { ...next, entries: next.entries.map((e) => (e.type === 'opening' && e.accountId === created.account.id ? { ...e, date: input.openingDate as string } : e)) };
  }
  return { state: next, id: created.account.id };
}

const bal = (state: AccountsState) => getAccountBalances(state.entries, state.accounts);

// A pending suggestion built from a real parse of one of the synthetic messages above.
function suggestionFrom(text: string, ctx: Ctx, state: AccountsState, batchDate = TODAY, rules: ReturnType<typeof readRules> = []): SmsSuggestion {
  const preview = previewBatch(text, new Set());
  const rows = stageBatch(preview, batchDate, ctx, { accounts: state.accounts, rules, categories });
  return rows[0];
}
const choose = (s: SmsSuggestion, patch: Partial<SmsSuggestion>): SmsSuggestion => ({ ...s, ...patch });

// ---- node:sqlite ---------------------------------------------------------------------------------------------------------------
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
const countOf = (db: NodeDb, table: string): number => (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
const tableExists = (db: NodeDb, name: string): boolean => (db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { c: number }).c > 0;
const canon = (value: unknown): string =>
  JSON.stringify(value, (_key, item) => (item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item));

// ======================================================= 1. schema 5 ==========================================================
console.log('Schema 5 (additive) on node:sqlite');
{
  check('the SMS schema is version 5 and the Uncategorised one 6', SMS_SCHEMA_VERSION === 5 && UNCATEGORISED_SCHEMA_VERSION === 6);

  // A device at schema 4 that has real data in the existing tables.
  const clock = makeClock();
  const a = withAccount(emptyState(), clock.ctx, { name: 'Telebirr', opening: 5000, type: 'wallet', sender: '127' });
  const b = withAccount(a.state, clock.ctx, { name: 'CBE', opening: 9000, sender: 'CBE', digits: '4827' });
  const state = planAddEntry(b.state, { type: 'expense', accountId: a.id, amount: 80, currency: 'ETB', category: 'Food', date: TODAY }, clock.ctx).state;
  const device = new DatabaseSync(':memory:');
  const run = runnerFor(device);
  runMigrations(run, 0);
  replaceAccountsData(run, state);
  run.run("INSERT INTO budgets (id, category, monthly_limit, currency, created_at, updated_at) VALUES ('b1','Food',500,'ETB','2026-11-01','2026-11-01')");
  // Make it look like a schema 4 device: no SMS tables yet.
  device.exec('DROP TABLE sms_suggestions; DROP TABLE recipient_rules; PRAGMA user_version = 4');
  const snapshot = () =>
    canon({
      ledger: readAccountsData(run),
      categories: run.all('SELECT * FROM categories ORDER BY id').filter((row) => (row as { name: string }).name !== UNCATEGORISED_NAME),
      currencies: run.all('SELECT * FROM currencies ORDER BY code'),
      budgets: run.all('SELECT * FROM budgets ORDER BY id'),
    });
  const before = snapshot();
  check('(setup) a schema 4 device has no SMS tables and keeps its data', versionOf(device) === 4 && !tableExists(device, 'sms_suggestions') && countOf(device, 'transactions') === 3);

  // Rollback: the DDL runs, then the step fails at the very end. Nothing may be kept and the version must stay 4.
  const failing: SqlRunner = { ...run, exec: (sql) => { if (sql.startsWith('PRAGMA user_version = 5')) throw new Error('disk full'); run.exec(sql); } };
  check('a failure part-way throws', messageOf(() => migrateToSms(failing, 4)) === 'disk full');
  check('...and rolls back: no SMS tables, still version 4', !tableExists(device, 'sms_suggestions') && !tableExists(device, 'recipient_rules') && versionOf(device) === 4);
  check('...and no existing data changed', snapshot() === before);

  check('the retry succeeds and returns true', migrateToSms(run, 4) === true);
  check('the device is at version 5 with both tables', versionOf(device) === 5 && tableExists(device, 'sms_suggestions') && tableExists(device, 'recipient_rules'));
  check('NO existing data was touched (ledger, categories, currencies, budgets identical)', snapshot() === before);

  check('running it again does nothing (already at 5)', migrateToSms(run, 5) === false && versionOf(device) === 5);
  runMigrations(run, 5);
  check('runMigrations from 5 goes on to 9 without touching existing data', snapshot() === before && versionOf(device) === 9);
  runMigrations(run, 4);
  check('even re-running the steps from 4 (tables exist) is harmless', snapshot() === before && versionOf(device) === 9);
  check('the step refuses to run on a database below 4', messageOf(() => migrateToSms(run, 3)).includes('accounts migration'));

  const fresh = new DatabaseSync(':memory:');
  runMigrations(runnerFor(fresh), 0);
  check('a fresh install reaches 9 with both tables', versionOf(fresh) === 9 && tableExists(fresh, 'sms_suggestions') && tableExists(fresh, 'recipient_rules'));
}

// ======================================================= 2. repository ========================================================
console.log('Repository: suggestions and recipient rules');
{
  const clock = makeClock();
  const state = withAccount(emptyState(), clock.ctx, { name: 'Telebirr', opening: 5000, type: 'wallet', sender: '127' }).state;
  const device = new DatabaseSync(':memory:');
  const run = runnerFor(device);
  runMigrations(run, 0);
  const rows = stageBatch(previewBatch([TB_OUT, TB_PKG, CBE_OUT].join('\n\n'), new Set()), TODAY, clock.ctx, { accounts: state.accounts, rules: [], categories });
  insertSuggestions(run, rows);
  const read = readSuggestions(run);
  check('three suggestions round trip through SQLite unchanged', canon(read.sort((a, b) => a.id.localeCompare(b.id))) === canon([...rows].sort((a, b) => a.id.localeCompare(b.id))));
  check('charges, flags and null fields survive', read.find((r) => r.service === 'cbe')?.otherCharge === 0.03 && read.every((r) => Array.isArray(r.flags)) && read.find((r) => r.kind === 'package_payment')?.fee === null);
  check('the message text is not in the table', !device.prepare('PRAGMA table_info(sms_suggestions)').all().some((c) => /text|raw_text|body/.test((c as { name: string }).name)));

  // raw_hash is unique, and a batch is all or nothing.
  const dup = { ...rows[0], id: 'other-id' };
  const fresh = { ...rows[0], id: 'fresh-id', rawHash: 'ffffffffffffffff' };
  check('a repeated hash is refused', messageOf(() => insertSuggestions(run, [dup])).length > 0);
  check('a batch with a repeated hash saves none of it', messageOf(() => insertSuggestions(run, [fresh, dup])).length > 0 && countOf(device, 'sms_suggestions') === 3);

  updateSuggestionChoices(run, rows[0].id, { accountId: 'acc-1', category: 'Food', feeAmount: 4, date: '2026-11-18' });
  const edited = readSuggestions(run).find((r) => r.id === rows[0].id)!;
  check('the owner\'s choices on a card are saved', edited.accountId === 'acc-1' && edited.category === 'Food' && edited.feeAmount === 4 && edited.date === '2026-11-18' && edited.status === 'pending');
  updateSuggestionChoices(run, rows[0].id, { feeAmount: null, status: 'ignored' });
  const ignored = readSuggestions(run).find((r) => r.id === rows[0].id)!;
  check('a fee can be reset to "use the printed charges" and a card ignored', ignored.feeAmount === null && ignored.status === 'ignored');
  check('no rules to begin with', readRules(run).length === 0);
}

// ======================================================= 3. dedupe and the summary ============================================
console.log('Pipeline: dedupe, summary, batch date');
{
  const clock = makeClock();
  const state = withAccount(emptyState(), clock.ctx, { name: 'Telebirr', opening: 5000, type: 'wallet', sender: '127' }).state;
  const lookup = { accounts: state.accounts, rules: [], categories };
  const block = [TB_OUT, OTP, CBE_OUT, GARBAGE, TB_IN].join('\n\n');
  const pasted = splitMessages(block).length;

  const first = previewBatch(block, new Set());
  check('first paste: 3 new, 0 handled, 1 ignored, 1 unreadable', first.fresh.length === 3 && first.alreadyHandled === 0 && first.ignored === 1 && first.unreadable.length === 1);
  check('the summary adds up to every message pasted', first.fresh.length + first.alreadyHandled + first.ignored + first.unreadable.length === pasted);
  check('only the unreadable group carries text', first.unreadable[0].text === GARBAGE && first.fresh.every((m) => !('text' in m) && !('rawText' in m)));

  const rows = stageBatch(first, TODAY, clock.ctx, lookup);
  check('every new message becomes a pending suggestion', rows.length === 3 && rows.every((r) => r.status === 'pending' && r.confirmedEntryId === null));

  const again = previewBatch(block, handledHashes(rows));
  check('the same block pasted again: nothing new, 3 already handled', again.fresh.length === 0 && again.alreadyHandled === 3 && again.ignored === 1 && again.unreadable.length === 1);

  const states: SmsSuggestion[] = [
    { ...rows[0], status: 'confirmed', confirmedEntryId: 'e1' },
    { ...rows[1], status: 'ignored' },
    { ...rows[2], status: 'pending' },
  ];
  const third = previewBatch(block, handledHashes(states));
  check('confirmed, ignored and pending messages are ALL treated as handled', third.fresh.length === 0 && third.alreadyHandled === 3);

  const withNew = previewBatch([TB_OUT, TB_PKG].join('\n\n'), handledHashes(rows));
  check('a mix: one already handled, one new', withNew.alreadyHandled === 1 && withNew.fresh.length === 1 && withNew.fresh[0].kind === 'package_payment');

  const twice = previewBatch([TB_PKG, TB_PKG, TB_PKG].join('\n\n'), new Set());
  check('the same message three times in one paste counts once (2 already handled)', twice.fresh.length === 1 && twice.alreadyHandled === 2);
  check('a paste with extra spaces and CRLF is the same message', previewBatch(TB_PKG.replace(/\n/g, '\r\n') + '\r\n\r\n', handledHashes(rows.concat(stageBatch(twice, TODAY, clock.ctx, lookup)))).fresh.length === 0);

  const nothing = previewBatch('', new Set());
  check('an empty paste gives an empty summary', nothing.fresh.length === 0 && nothing.alreadyHandled === 0 && nothing.ignored === 0 && nothing.unreadable.length === 0 && nothing.needsDate === false);

  // Dates
  check('CBE has no date, so the batch needs one', first.needsDate === true);
  check('messages that all carry a date need no batch date', previewBatch([TB_OUT, TB_IN].join('\n\n'), new Set()).needsDate === false);
  const dated = stageBatch(first, '2026-11-18', clock.ctx, lookup);
  const cbe = dated.find((r) => r.service === 'cbe')!;
  const tb = dated.find((r) => r.kind === 'person_transfer')!;
  check('an undated message takes the batch date', cbe.date === '2026-11-18' && cbe.occurredAt === null);
  check('a dated message keeps its own date, not the batch date', tb.date === '2026-11-14' && tb.occurredAt === '2026-11-14T13:52:15');
  check('the default for a batch is whatever date is passed (today in the app)', stageBatch(first, TODAY, clock.ctx, lookup).find((r) => r.service === 'cbe')!.date === TODAY);
}

// ======================================================= 4. recipient memory ==================================================
console.log('Recipient memory');
{
  check('names are normalised: case, spacing, punctuation', normaliseRecipientName('  Abel  Haile-Gebre ') === 'abel hailegebre' && normaliseRecipientName('ABEL HAILEGEBRE') === 'abel hailegebre');
  check('an empty or symbol-only name is no name', normaliseRecipientName('') === null && normaliseRecipientName('--') === null && normaliseRecipientName(null) === null);
  const base = { counterpartyName: null, counterpartyPhoneTail: null, counterpartyBank: null, counterpartyAccountTail: null, counterpartyCode: null };
  check('the key is the normalised name', recipientKey({ ...base, counterpartyName: 'Fiker  Mulu Alem' }) === 'name:fiker mulu alem');
  check('the same person written two ways has one key', recipientKey({ ...base, counterpartyName: 'fiker mulu alem' }) === recipientKey({ ...base, counterpartyName: 'FIKER MULU  ALEM' }));
  check('a name wins over a tail', recipientKey({ ...base, counterpartyName: 'Fiker', counterpartyPhoneTail: '5521' }) === 'name:fiker');
  check('no name: the phone tail', recipientKey({ ...base, counterpartyPhoneTail: '5521' }) === 'phone:5521');
  check('no name or phone: bank and account tail', recipientKey({ ...base, counterpartyBank: 'Hibret Bank', counterpartyAccountTail: '3' }) === 'acct:hibret bank:3');
  check('nobody named: no key, nothing to remember', recipientKey(base) === null);
  check('findRule finds by key and not by anything else', findRule([{ key: 'name:x', category: 'Food', lastUsed: 'z' }], 'name:x')?.category === 'Food' && findRule([], 'name:x') === null && findRule([], null) === null);

  const out = { ...base, counterpartyName: 'Fiker Mulu Alem', direction: 'out' as const, kind: 'bank_transfer' as const };
  const rules = [{ key: 'name:fiker mulu alem', category: 'Food', lastUsed: '2026-11-01T00:00:00Z' }];
  check('a remembered category is suggested', suggestCategory(out, rules, categories) === 'Food');
  check('a remembered category that no longer exists is ignored', suggestCategory(out, [{ ...rules[0], category: 'Deleted' }], categories) === '');
  check('a remembered expense category is not used for money coming in', suggestCategory({ ...out, direction: 'in' }, rules, categories) === '');
  check('no rule, no suggestion', suggestCategory(out, [], categories) === '');
  const pkg = { ...base, direction: 'out' as const, kind: 'package_payment' as const };
  check('a package payment suggests a Phone / Internet category when one exists', suggestCategory(pkg, [], categories) === 'Phone & Internet');
  check('...and nothing when the owner has no such category', suggestCategory(pkg, [], defaultCategories) === '');
  check('a remembered category beats the package hint', suggestCategory({ ...pkg, counterpartyName: 'Fiker Mulu Alem' }, rules, categories) === 'Food');
}

// ======================================================= 5. account link =====================================================
console.log('Account link and matching');
{
  const clock = makeClock();
  let s = emptyState();
  const tele = withAccount(s, clock.ctx, { name: 'Telebirr', opening: 100, type: 'wallet', sender: '127' });
  const cbeA = withAccount(tele.state, clock.ctx, { name: 'CBE Main', opening: 100, sender: 'CBE', digits: '4827' });
  const cbeB = withAccount(cbeA.state, clock.ctx, { name: 'CBE Savings', opening: 100, sender: 'CBE', digits: '9150' });
  const usd = withAccount(cbeB.state, clock.ctx, { name: 'Payoneer', opening: 10, currency: 'USD', sender: 'BOA' });
  const none = withAccount(usd.state, clock.ctx, { name: 'Cash', opening: 10, type: 'cash' });
  s = none.state;
  check('the sender defaults for each service', SERVICE_SENDER.telebirr === '127' && SERVICE_SENDER.cbe === 'CBE' && SERVICE_SENDER.boa === 'BOA' && SERVICE_SENDER.awash === 'Awash Bank');
  check('a message is matched to the only account for its service', matchAccount(s.accounts, { service: 'telebirr', accountTail: null }) === tele.id);
  check('with two CBE accounts the printed digits pick one', matchAccount(s.accounts, { service: 'cbe', accountTail: '4827' }) === cbeA.id && matchAccount(s.accounts, { service: 'cbe', accountTail: '9150' }) === cbeB.id);
  check('with two CBE accounts and no digits it does not guess', matchAccount(s.accounts, { service: 'cbe', accountTail: null }) === null);
  check('with two CBE accounts and digits that match neither it does not guess', matchAccount(s.accounts, { service: 'cbe', accountTail: '0000' }) === null);
  check('a USD account is never matched (messages are ETB)', matchAccount(s.accounts, { service: 'boa', accountTail: null }) === null);
  check('an account with no sender is never matched', matchAccount(s.accounts, { service: 'awash', accountTail: null }) === null);
  check('an archived account is never matched', matchAccount(s.accounts.map((a) => (a.id === tele.id ? { ...a, archived: true } : a)), { service: 'telebirr', accountTail: null }) === null);
  check('two printed digits match an account that stores four', matchAccount(s.accounts, { service: 'cbe', accountTail: '27' }) === cbeA.id);

  const link = linkDetails({ service: 'cbe', accountTail: '4827' });
  check('linking from a card sets the sender and the digits', link.smsSender === 'CBE' && link.lastDigits === '4827');
  check('linking when the message prints no digits sets only the sender', linkDetails({ service: 'telebirr', accountTail: null }).lastDigits === null);
  const linked = planUpdateAccountSms(s, none.id, { smsSender: 'Awash Bank', lastDigits: '5555' });
  check('planUpdateAccountSms changes only the SMS fields', linked.accounts.find((a) => a.id === none.id)!.smsSender === 'Awash Bank' && linked.accounts.find((a) => a.id === none.id)!.name === 'Cash' && linked.entries === s.entries);
  check('a linked account is then matched', matchAccount(linked.accounts, { service: 'awash', accountTail: '5555' }) === none.id && matchAccount(linked.accounts, { service: 'awash', accountTail: null }) === none.id);
  check('digits are cleaned: digits only, at most four', cleanLastDigits(' 12 34-56') === '1234' && cleanLastDigits('abc') === null && cleanLastDigits('') === null && cleanLastDigits(null) === null);
  check('the sender is trimmed and emptied to null', cleanSmsSender('  Awash   Bank ') === 'Awash Bank' && cleanSmsSender('   ') === null);
  check('creating an account stores cleaned SMS fields', (() => { const c = withAccount(emptyState(), clock.ctx, { name: 'X', opening: 0, sender: ' 127 ', digits: '9-8-7' }); return c.state.accounts[0].smsSender === '127' && c.state.accounts[0].lastDigits === '987'; })());
}

// ======================================================= 6. the save pipeline =================================================
console.log('Save pipeline: expense, income, fee as its own Fees expense');
{
  const clock = makeClock();
  const t = withAccount(emptyState(), clock.ctx, { name: 'Telebirr', opening: 5000, openingDate: '2026-11-01', type: 'wallet', sender: '127' });
  const state = t.state;
  const out = choose(suggestionFrom(TB_OUT, clock.ctx, state), { category: 'Food' });
  check('(setup) the card is matched to the Telebirr account', out.accountId === t.id && out.date === '2026-11-14' && out.direction === 'out');
  check('printed charges: fee 1.74 + VAT 0.26 = 2.00 to the cent', printedCharges(out) === 2 && effectiveFee(out) === 2);

  const plan = planSuggestionSave(state, out, { remember: true }, clock.ctx);
  const [main, fee, ...rest] = plan.result.added;
  check('exactly two rows are added: the payment and its fee', plan.result.added.length === 2 && rest.length === 0);
  check('money sent to a person is an EXPENSE of ETB 120 in the chosen category', main.type === 'expense' && main.amount === 120 && main.amountETB === 120 && main.category === 'Food' && main.accountId === t.id);
  check('the counterparty is the source and the date is the message date', main.source === 'ZXXXXX QXXXX' && main.date === '2026-11-14');
  check('the fee is its own expense in the Fees category, same account and date', fee.type === 'expense' && fee.category === FEES_CATEGORY.name && fee.amount === 2 && fee.accountId === t.id && fee.date === main.date);
  check('the fee is NOT linked to the main entry (links are for transfer fees)', fee.linkedTransferId === null && main.linkedTransferId === null);
  check('the fee note names the recipient', fee.note === 'Fee for ZXXXXX QXXXX');
  check('both rows are not automatic (they count for the streak)', main.isAutomatic === false && fee.isAutomatic === false);
  check('the account balance is 5000 - 120 - 2', bal(plan.result.state)[t.id] === 4878);
  check('ids are reported: main first', plan.mainEntryId === main.id && plan.feeEntryId === fee.id && plan.confirmation.entryId === main.id);
  check('the saved entry counts for the streak like a manual one', calculateStreak(plan.result.state.entries, plan.result.state.allocations, new Date(2026, 10, 14, 20, 0, 0)) === 1);
  check('the recipient rule is planned with the category', plan.confirmation.rule?.key === 'name:zxxxxx qxxxx' && plan.confirmation.rule?.category === 'Food');
  check('"remember" off plans no rule', planSuggestionSave(state, out, { remember: false }, clock.ctx).confirmation.rule === null);
  check('a message that names nobody plans no rule even with "remember" on', planSuggestionSave(state, choose(suggestionFrom(CBE_CREDIT, clock.ctx, withAccount(state, clock.ctx, { name: 'CBE', opening: 0, sender: 'CBE' }).state), { category: 'Salary', accountId: t.id }), { remember: true }, clock.ctx).confirmation.rule === null);

  const noFee = planSuggestionSave(state, { ...out, feeAmount: 0 }, { remember: false }, clock.ctx);
  check('a fee edited to 0 saves no fee row', noFee.result.added.length === 1 && noFee.feeEntryId === null && bal(noFee.result.state)[t.id] === 4880);
  const bigFee = planSuggestionSave(state, { ...out, feeAmount: 5 }, { remember: false }, clock.ctx);
  check('an edited fee is used instead of the printed one', bigFee.result.added[1].amount === 5);
  check('a negative fee is treated as none', effectiveFee({ ...out, feeAmount: -3 }) === 0);

  const pkg = choose(suggestionFrom(TB_PKG, clock.ctx, state), { category: 'Phone & Internet' });
  check('(setup) the package payment suggests the Phone & Internet category when the card is made with rules', suggestionFrom(TB_PKG, clock.ctx, state).category === 'Phone & Internet');
  const pkgPlan = planSuggestionSave(state, pkg, { remember: false }, clock.ctx);
  check('a package payment with no fee saves one expense and keeps the package name as the note', pkgPlan.result.added.length === 1 && pkgPlan.result.added[0].note === 'Daily SMS Package 36 SMS' && pkgPlan.result.added[0].amount === 3);

  const inc = choose(suggestionFrom(TB_IN, clock.ctx, state), { category: 'Salary', feeAmount: 9 });
  const incPlan = planSuggestionSave(state, inc, { remember: true }, clock.ctx);
  check('money received is INCOME, with no fee row even if one was typed', incPlan.result.added.length === 1 && incPlan.result.added[0].type === 'income' && incPlan.result.added[0].amount === 2000 && bal(incPlan.result.state)[t.id] === 7000);
  check('income from a person is keyed by name', incPlan.confirmation.rule?.key === 'name:hxxxxx nxxxxx');

  const inputs = suggestionInputs(out, t.id, 'Food');
  check('suggestionInputs makes the payment then the fee', inputs.length === 2 && inputs[0].type === 'expense' && (inputs[1] as Extract<EntryInput, { type: 'income' | 'expense' }>).category === 'Fees');
  check('nothing creates a transfer', plan.result.added.every((e) => e.type !== 'transfer'));

  check('a card with no account cannot be saved', codeOf(() => planSuggestionSave(state, { ...out, accountId: null }, { remember: false }, clock.ctx)) === 'UNKNOWN_ACCOUNT');
  check('a card pointing at a deleted account cannot be saved', codeOf(() => planSuggestionSave(state, { ...out, accountId: 'gone' }, { remember: false }, clock.ctx)) === 'UNKNOWN_ACCOUNT');
  check('a card with no category is saved as Uncategorised', planSuggestionSave(state, { ...out, category: ' ' }, { remember: false }, clock.ctx).result.added[0].category === UNCATEGORISED_NAME);
  check('an already handled card cannot be saved again', codeOf(() => planSuggestionSave(state, { ...out, status: 'confirmed' }, { remember: false }, clock.ctx)) === 'INVALID_ENTRY');
  check('planning does not change the state it was given', state.entries.length === 1);
}

// ======================================================= 7. warnings and blocks ==============================================
console.log('Review warnings and blocks');
{
  const clock = makeClock();
  const t = withAccount(emptyState(), clock.ctx, { name: 'Telebirr', opening: 5000, openingDate: '2026-11-01', type: 'wallet', sender: '127' });
  let state = t.state;
  const card = (text: string, patch: Partial<SmsSuggestion> = {}) => choose(suggestionFrom(text, clock.ctx, state), { category: 'Food', ...patch });

  const clean = checkSuggestion(state, card(TB_OUT), clock.ctx);
  check('a card with account, category, enough money and no clash is clean', clean.clean && clean.warnings.length === 0 && clean.blocked === null && clean.missing.length === 0);
  check('a card with no category is still clean: a category is not required', checkSuggestion(state, card(TB_OUT, { category: '' }), clock.ctx).clean && checkSuggestion(state, card(TB_OUT, { category: '' }), clock.ctx).missing.length === 0);
  check('a card with no account is missing it', checkSuggestion(state, card(TB_OUT, { accountId: null }), clock.ctx).missing.includes('account'));

  // possible duplicate: same account, amount and date
  const manual = planAddEntry(state, { type: 'expense', accountId: t.id, amount: 120, currency: 'ETB', category: 'Food', date: '2026-11-14' }, clock.ctx).state;
  const dup = checkSuggestion(manual, card(TB_OUT), clock.ctx);
  check('an existing entry with the same account, amount and date is a possible duplicate', dup.warnings.some((w) => w.kind === 'duplicate') && !dup.clean && dup.blocked === null);
  check('a different date is not a duplicate', !checkSuggestion(manual, card(TB_OUT, { date: '2026-11-15' }), clock.ctx).warnings.some((w) => w.kind === 'duplicate'));
  check('a different amount is not a duplicate', !checkSuggestion(manual, card(TB_PKG), clock.ctx).warnings.some((w) => w.kind === 'duplicate'));
  check('an income of the same amount is not a duplicate of an expense', !checkSuggestion(planAddEntry(state, { type: 'income', accountId: t.id, amount: 120, currency: 'ETB', category: 'Salary', date: '2026-11-14' }, clock.ctx).state, card(TB_OUT), clock.ctx).warnings.some((w) => w.kind === 'duplicate'));
  check('an opening balance of the same amount and date is not a duplicate', !checkSuggestion(withAccount(emptyState(), clock.ctx, { name: 'W', opening: 120, openingDate: '2026-11-14', type: 'wallet', sender: '127' }).state, choose(card(TB_OUT), { accountId: 'id-1' }), clock.ctx).warnings.some((w) => w.kind === 'duplicate'));
  check('a duplicate is a warning, not a block: it can still be saved', planSuggestionSave(manual, card(TB_OUT), { remember: false }, clock.ctx).result.added.length === 2);

  // reserved goal money
  const goal = planCreateGoal(state, { name: 'Laptop', targetAmount: 9000, heldInAccountId: t.id }, clock.ctx);
  const reserved = planAddToGoal(goal.state, goal.goal.id, 4950, clock.ctx).state;
  check('(setup) 4,950 of the 5,000 is reserved: free to spend 50', getReserve(reserved, t.id).freeToSpend === 50);
  const uses = checkSuggestion(reserved, card(TB_OUT), clock.ctx);
  const reserveWarning = uses.warnings.find((w) => w.kind === 'reserved');
  check('using reserved goal money is a WARNING with the amount (122 needed, 50 free -> 72)', !!reserveWarning && reserveWarning.message.includes('72.00') && uses.blocked === null && !uses.clean, reserveWarning?.message);
  const usedPlan = planSuggestionSave(reserved, card(TB_OUT), { remember: false }, clock.ctx);
  check('...and saving is still allowed: the goal shrinks and one notification is made', usedPlan.result.autoReductions.length === 1 && usedPlan.result.notifications.length === 1 && bal(usedPlan.result.state)[t.id] === 4878);
  check('money that stays within free-to-spend gives no reserved warning', !checkSuggestion(reserved, card(TB_PKG), clock.ctx).warnings.some((w) => w.kind === 'reserved'));

  // negative balance
  const poor = withAccount(emptyState(), clock.ctx, { name: 'Telebirr', opening: 100, openingDate: '2026-11-01', type: 'wallet', sender: '127' });
  const big = choose(suggestionFrom(TB_IN.replace('received ETB 2,000.00', 'received ETB 2,000.00'), clock.ctx, poor.state), { category: 'Food' });
  const overdraw = checkSuggestion(poor.state, card(TB_OUT, { accountId: poor.id, amount: 500 }), clock.ctx);
  check('an expense that would take the account below zero is BLOCKED, with the usual message', overdraw.blocked !== null && overdraw.blocked.startsWith('Not enough money in Telebirr') && !overdraw.clean, String(overdraw.blocked));
  check('saving it throws NEGATIVE_BALANCE and writes nothing', codeOf(() => planSuggestionSave(poor.state, card(TB_OUT, { accountId: poor.id, amount: 500 }), { remember: false }, clock.ctx)) === 'NEGATIVE_BALANCE' && poor.state.entries.length === 1);
  check('(income is never blocked)', checkSuggestion(poor.state, big, clock.ctx).blocked === null);

  // the payment and its fee are validated as ONE set
  const edge = withAccount(emptyState(), clock.ctx, { name: 'Telebirr', opening: 121, openingDate: '2026-11-01', type: 'wallet', sender: '127' });
  check('120 alone would fit in 121', checkSuggestion(edge.state, card(TB_OUT, { accountId: edge.id, feeAmount: 0 }), clock.ctx).blocked === null);
  const together = checkSuggestion(edge.state, card(TB_OUT, { accountId: edge.id }), clock.ctx);
  check('120 + a 2.00 fee does not: the pair is blocked together', together.blocked !== null && together.blocked.includes('short by ETB 1.00'), String(together.blocked));
  check('so neither row is saved', codeOf(() => planSuggestionSave(edge.state, card(TB_OUT, { accountId: edge.id }), { remember: false }, clock.ctx)) === 'NEGATIVE_BALANCE');

  // dated before the opening balance
  const opened = withAccount(emptyState(), clock.ctx, { name: 'Telebirr', opening: 5000, openingDate: '2026-11-10', type: 'wallet', sender: '127' });
  const before = checkSuggestion(opened.state, card(TB_OUT, { accountId: opened.id, date: '2026-11-05' }), clock.ctx);
  check('an expense dated before the opening balance gets the specific message', before.blocked === "This is dated before the account's opening balance on 2026-11-10.", String(before.blocked));
  check('...not the generic "not enough money" one', !String(before.blocked).includes('Not enough money'));
  check('saving it throws with that same message', messageOf(() => planSuggestionSave(opened.state, card(TB_OUT, { accountId: opened.id, date: '2026-11-05' }), { remember: false }, clock.ctx)) === "This is dated before the account's opening balance on 2026-11-10.");
  check('...as a BEFORE_OPENING block that writes nothing', codeOf(() => planSuggestionSave(opened.state, card(TB_OUT, { accountId: opened.id, date: '2026-11-05' }), { remember: false }, clock.ctx)) === 'BEFORE_OPENING' && opened.state.entries.length === 1);
  check('dated on the opening day it is allowed', checkSuggestion(opened.state, card(TB_OUT, { accountId: opened.id, date: '2026-11-10' }), clock.ctx).blocked === null);
  check('dated after the opening day it is allowed', checkSuggestion(opened.state, card(TB_OUT, { accountId: opened.id, date: '2026-11-14' }), clock.ctx).blocked === null);
  const incomeBefore = checkSuggestion(opened.state, choose(card(TB_IN, { accountId: opened.id }), { date: '2026-11-05', category: 'Salary' }), clock.ctx);
  check('INCOMING dated before the opening balance is blocked too, with the same message', incomeBefore.blocked === "This is dated before the account's opening balance on 2026-11-10." && !incomeBefore.clean, String(incomeBefore.blocked));
  check('...and saving it throws BEFORE_OPENING and writes nothing', codeOf(() => planSuggestionSave(opened.state, choose(card(TB_IN, { accountId: opened.id }), { date: '2026-11-05', category: 'Salary' }), { remember: false }, clock.ctx)) === 'BEFORE_OPENING');
  check('incoming dated on or after the opening day is allowed', checkSuggestion(opened.state, choose(card(TB_IN, { accountId: opened.id }), { date: '2026-11-10' }), clock.ctx).blocked === null && checkSuggestion(opened.state, choose(card(TB_IN, { accountId: opened.id }), { date: '2026-11-14' }), clock.ctx).blocked === null);
  const manualBefore = planAddEntry(opened.state, { type: 'income', accountId: opened.id, amount: 50, currency: 'ETB', category: 'Salary', date: '2026-11-05' }, clock.ctx);
  check('MANUAL entries are left as they are: a manual income before the opening day is still allowed', manualBefore.state.entries.length === opened.state.entries.length + 1);
  check('openingDateOf finds the earliest opening day, null when there is none', openingDateOf(opened.state, opened.id) === '2026-11-10' && openingDateOf(emptyState(), 'x') === null);
  check('beforeOpeningProblem is null for an account with no opening balance', beforeOpeningProblem(withAccount(emptyState(), clock.ctx, { name: 'N', opening: 0 }).state, 'id-1', '2000-01-01') === null);
  const noOpening = withAccount(emptyState(), clock.ctx, { name: 'Telebirr', opening: 0, type: 'wallet', sender: '127' });
  check('an account with no opening balance gets the ordinary message when it runs short', String(checkSuggestion(noOpening.state, card(TB_OUT, { accountId: noOpening.id }), clock.ctx).blocked).startsWith('Not enough money'));
}

// ======================================================= 8. save all that are clean ==========================================
console.log('Save all that are clean');
// Async because the save callback may be (the store's is); the script has no top-level await (tsx runs it as CommonJS).
const bulkDone = (async () => {
  const clock = makeClock();
  const t = withAccount(emptyState(), clock.ctx, { name: 'Telebirr', opening: 100, openingDate: '2026-11-01', type: 'wallet', sender: '127' });
  const mk = (text: string, patch: Partial<SmsSuggestion>) => ({ ...suggestionFrom(text, clock.ctx, t.state), ...patch });
  const a = mk(TB_OUT, { id: 's-a', category: 'Food', amount: 80, feeAmount: 0, date: '2026-11-12', accountId: t.id });
  const b = mk(TB_PKG, { id: 's-b', category: 'Food', amount: 50, date: '2026-11-13', accountId: t.id });
  const c = mk(TB_IN, { id: 's-c', category: 'Salary', amount: 10, date: '2026-11-14', accountId: t.id });
  const d = mk(TB_OUT, { id: 's-d', category: '', amount: 1, feeAmount: 0, date: '2026-11-15', accountId: t.id, rawHash: 'd' });
  check('(setup) a and b are each clean on their own', checkSuggestion(t.state, a, clock.ctx).clean && checkSuggestion(t.state, b, clock.ctx).clean);
  check('oldest first, pending only', cleanOrder([d, c, b, { ...a, status: 'ignored' }]).map((s) => s.id).join() === 's-b,s-c,s-d');
  check('(setup) d, with no category, is clean', checkSuggestion(t.state, d, clock.ctx).clean);

  const saved: string[] = [];
  const result = await bulkSave(t.state, [d, c, b, a], (plan, s) => { saved.push(s.id); check('(each plan is a full set)', plan.confirmation.suggestionId === s.id); }, clock.ctx);
  check('saved in date order: a, c and d (b no longer fits after a; d has no category and is still clean)', result.saved.join() === 's-a,s-c,s-d', result.saved.join());
  check('b needs attention because the card before it used the money', result.needAttention.includes('s-b'));
  check('d is saved as Uncategorised', result.state.entries.some((e) => e.amount === 1 && e.category === UNCATEGORISED_NAME));
  check('the callback saw exactly the saved ones', saved.join() === 's-a,s-c,s-d');
  check('the ledger after the run: 100 - 80 + 10 - 1 = 29', bal(result.state)[t.id] === 29);

  const failOnce = await bulkSave(t.state, [a], () => { throw new AccountsError('INVALID_ENTRY', 'x'); }, clock.ctx);
  check('an AccountsError from a save counts as needing attention', failOnce.saved.length === 0 && failOnce.needAttention.join() === 's-a');
  let bug = '';
  try {
    await bulkSave(t.state, [a], () => { throw new Error('disk full'); }, clock.ctx);
  } catch (error) {
    bug = (error as Error).message;
  }
  check('any other error is a real bug and is rethrown', bug === 'disk full');
  check('with nothing pending it does nothing', (await bulkSave(t.state, [], () => undefined, clock.ctx)).saved.length === 0);
})();

// ======================================================= 9. the atomic save ==================================================
console.log('All-or-nothing save (one database transaction)');
{
  const clock = makeClock();
  const t = withAccount(emptyState(), clock.ctx, { name: 'Telebirr', opening: 5000, openingDate: '2026-11-01', type: 'wallet', sender: '127' });

  function freshDevice() {
    const device = new DatabaseSync(':memory:');
    const run = runnerFor(device);
    runMigrations(run, 0);
    replaceAccountsData(run, t.state);
    const card = choose(suggestionFrom(TB_OUT, clock.ctx, t.state), { category: 'Food' });
    insertSuggestions(run, [card]);
    return { device, run, card };
  }
  const rowsOf = (device: NodeDb, where: string) => countOf(device, `transactions WHERE ${where}`);

  // Happy path through SQLite.
  {
    const { device, run, card } = freshDevice();
    const plan = planSuggestionSave(t.state, card, { remember: true }, clock.ctx);
    commitSuggestionSave(run, t.state, plan.result.state, plan.confirmation);
    const data = readAccountsData(run);
    const saved = readSuggestions(run)[0];
    check('commit writes the main entry and the fee entry', rowsOf(device, "type = 'expense'") === 2 && rowsOf(device, "category = 'Fees'") === 1);
    check('the suggestion is confirmed and points at the MAIN entry', saved.status === 'confirmed' && saved.confirmedEntryId === plan.mainEntryId && data.entries.some((e) => e.id === saved.confirmedEntryId && e.category === 'Food'));
    check('the recipient rule is saved and found again after a reload', readRules(run).length === 1 && findRule(readRules(run), recipientKey(card))?.category === 'Food');
    check('balances computed from what SQLite returned match the plan', bal({ ...t.state, ...data })[t.id] === 4878);

    // the same plan a second time (a double tap): refused, nothing doubled
    check('committing the same plan again is refused', messageOf(() => commitSuggestionSave(run, plan.result.state, plan.result.state, plan.confirmation)).includes('no longer pending'));
    const replay = planSuggestionSave(t.state, card, { remember: true }, clock.ctx);
    check('replaying the plan from the OLD ledger is refused and writes nothing', messageOf(() => commitSuggestionSave(run, t.state, replay.result.state, replay.confirmation)).includes('no longer pending') && rowsOf(device, "category = 'Food'") === 1 && rowsOf(device, "category = 'Fees'") === 1);
  }

  // Failures, injected at each step. In every case nothing may be kept and the suggestion must still be pending.
  const injections: Array<[string, (sql: string, count: number) => boolean]> = [
    ['the SECOND write (the Fees entry)', (sql, n) => sql.includes('INTO transactions') && n === 2],
    ['the main entry itself', (sql, n) => sql.includes('INTO transactions') && n === 1],
    ['marking the suggestion confirmed', (sql) => sql.includes('UPDATE sms_suggestions')],
    ['the recipient rule', (sql) => sql.includes('INTO recipient_rules')],
  ];
  for (const [label, shouldFail] of injections) {
    const { device, run, card } = freshDevice();
    const plan = planSuggestionSave(t.state, card, { remember: true }, clock.ctx);
    let transactionWrites = 0;
    const failing: SqlRunner = {
      ...run,
      run: (sql, ...params) => {
        if (sql.includes('INTO transactions')) transactionWrites += 1;
        if (shouldFail(sql, transactionWrites)) throw new Error('disk full');
        run.run(sql, ...params);
      },
    };
    check(`failure on ${label}: the save throws`, messageOf(() => commitSuggestionSave(failing, t.state, plan.result.state, plan.confirmation)) === 'disk full');
    const after = readSuggestions(run)[0];
    check(`failure on ${label}: nothing was saved (only the opening entry remains)`, countOf(device, 'transactions') === 1 && rowsOf(device, "category = 'Food'") === 0 && rowsOf(device, "category = 'Fees'") === 0);
    check(`failure on ${label}: the suggestion is still pending with no entry id`, after.status === 'pending' && after.confirmedEntryId === null);
    check(`failure on ${label}: no recipient rule was kept`, readRules(run).length === 0);
    check(`failure on ${label}: goals, allocations and notifications untouched`, countOf(device, 'goal_allocations') === 0 && countOf(device, 'notifications') === 0);

    // The retry on the same plan, with the real runner: exactly one main entry.
    commitSuggestionSave(run, t.state, plan.result.state, plan.confirmation);
    check(`failure on ${label}: a retry produces exactly ONE main entry and one fee`, rowsOf(device, "category = 'Food'") === 1 && rowsOf(device, "category = 'Fees'") === 1 && countOf(device, 'transactions') === 3);
    check(`failure on ${label}: ...and the suggestion is confirmed after the retry`, readSuggestions(run)[0].status === 'confirmed' && readRules(run).length === 1);
  }

  // A failed save that also had a goal shrink: the shrink and its notification roll back with it.
  {
    const device = new DatabaseSync(':memory:');
    const run = runnerFor(device);
    runMigrations(run, 0);
    const g = planCreateGoal(t.state, { name: 'Laptop', targetAmount: 9000, heldInAccountId: t.id }, clock.ctx);
    const reserved = planAddToGoal(g.state, g.goal.id, 4950, clock.ctx).state;
    replaceAccountsData(run, reserved);
    const card = choose(suggestionFrom(TB_OUT, clock.ctx, reserved), { category: 'Food' });
    insertSuggestions(run, [card]);
    const plan = planSuggestionSave(reserved, card, { remember: false }, clock.ctx);
    check('(setup) this save would shrink the goal and notify', plan.result.autoReductions.length === 1 && plan.result.notifications.length === 1);
    const failing: SqlRunner = { ...run, run: (sql, ...params) => { if (sql.includes('UPDATE sms_suggestions')) throw new Error('disk full'); run.run(sql, ...params); } };
    messageOf(() => commitSuggestionSave(failing, reserved, plan.result.state, plan.confirmation));
    check('a failed save keeps no goal shrink and no notification', countOf(device, 'goal_allocations') === 1 && countOf(device, 'notifications') === 0 && countOf(device, 'transactions') === 1);
    commitSuggestionSave(run, reserved, plan.result.state, plan.confirmation);
    check('the retry saves the entries, the shrink and the notification together', countOf(device, 'goal_allocations') === 2 && countOf(device, 'notifications') === 1 && countOf(device, 'transactions') === 3);
  }
}

// ======================================================= 10. follow-up: schema 6 ==============================================
console.log('Schema 6 (additive): the merchant code column and the built-in Uncategorised categories');
{
  const clock = makeClock();
  const make = () => {
    const device = new DatabaseSync(':memory:');
    const run = runnerFor(device);
    runMigrations(run, 0);
    return { device, run };
  };
  const toSchema5 = (device: NodeDb) => {
    device.exec("DELETE FROM categories WHERE name = 'Uncategorised'; ALTER TABLE sms_suggestions DROP COLUMN counterparty_code; PRAGMA user_version = 5");
  };

  // A device at schema 5 with the owner's own data in it.
  const { device, run } = make();
  for (const category of defaultCategories.filter((c) => c.name !== UNCATEGORISED_NAME)) {
    run.run('INSERT INTO categories (id, name, type, icon, color, is_default) VALUES (?, ?, ?, ?, ?, ?)', category.id, category.name, category.type, category.icon, category.color, category.isDefault ? 1 : 0);
  }
  run.run('INSERT INTO categories (id, name, type, icon, color, is_default) VALUES (?, ?, ?, ?, ?, ?)', 'mine', 'Coffee', 'expense', 'c', '#000', 0);
  const state = withAccount(emptyState(), clock.ctx, { name: 'Telebirr', opening: 5000, type: 'wallet', sender: '127' }).state;
  replaceAccountsData(run, state);
  const cards = stageBatch(previewBatch(TB_OUT, new Set()), TODAY, clock.ctx, { accounts: state.accounts, rules: [], categories });
  insertSuggestions(run, cards);
  toSchema5(device);
  // The two new categories are what the migration ADDS, so they are left out; everything else must be identical.
  const snapshot = () => canon({ ledger: readAccountsData(run), categories: run.all('SELECT * FROM categories ORDER BY id').filter((row) => (row as { name: string }).name !== UNCATEGORISED_NAME), suggestions: run.all('SELECT id, raw_hash, status, amount, category FROM sms_suggestions ORDER BY id'), rules: run.all('SELECT * FROM recipient_rules') });
  const before = snapshot();
  check('(setup) a schema 5 device has no code column and no Uncategorised categories', versionOf(device) === 5 && countOf(device, "categories WHERE name = 'Uncategorised'") === 0 && !(device.prepare('PRAGMA table_info(sms_suggestions)').all() as { name: string }[]).some((c) => c.name === 'counterparty_code'));

  // rollback: everything runs, then the very last statement fails
  const failing: SqlRunner = { ...run, exec: (sql) => { if (sql.startsWith('PRAGMA user_version = 6')) throw new Error('disk full'); run.exec(sql); } };
  check('a failure part-way throws', messageOf(() => migrateToUncategorised(failing, 5)) === 'disk full');
  check('...and rolls back: no new column, no new categories, still version 5', versionOf(device) === 5 && countOf(device, "categories WHERE name = 'Uncategorised'") === 0 && !(device.prepare('PRAGMA table_info(sms_suggestions)').all() as { name: string }[]).some((c) => c.name === 'counterparty_code'));
  check('...and no existing row changed', snapshot() === before);

  const result = migrateToUncategorised(run, 5);
  check('the retry adds the column and both categories', !!result && result.columnAdded && result.categoriesAdded === 2 && versionOf(device) === 6);
  const added = run.all<{ id: string; name: string; type: string; is_default: number }>("SELECT id, name, type, is_default FROM categories WHERE name = 'Uncategorised' ORDER BY type");
  check('one for income and one for expense, both built in', added.length === 2 && added[0].type === 'expense' && added[1].type === 'income' && added.every((row) => row.is_default === 1));
  check('every existing row is untouched (ledger, categories incl. the owner\'s own, suggestions, rules)', snapshot() === before);
  check('an old suggestion row simply has no merchant code', readSuggestions(run).every((row) => row.counterpartyCode === null) && readSuggestions(run).length === 1);
  check('running it again does nothing', migrateToUncategorised(run, 6) === null && versionOf(device) === 6);
  const afterSecond = canon(run.all('SELECT * FROM categories ORDER BY id'));
  runMigrations(run, 5);
  check('runMigrations from 5 again adds nothing a second time', canon(run.all('SELECT * FROM categories ORDER BY id')) === afterSecond && countOf(device, "categories WHERE name = 'Uncategorised'") === 2);
  check('the step refuses to run below 5', messageOf(() => migrateToUncategorised(run, 4)).includes('SMS migration'));

  // the owner already made their own "Uncategorised" expense category
  const other = make();
  other.run.run('INSERT INTO categories (id, name, type, icon, color, is_default) VALUES (?, ?, ?, ?, ?, ?)', 'seed', 'Food', 'expense', 'f', '#111', 1);
  other.run.run('INSERT INTO categories (id, name, type, icon, color, is_default) VALUES (?, ?, ?, ?, ?, ?)', 'theirs', 'Uncategorised', 'expense', 'x', '#222', 0);
  other.device.exec("DELETE FROM categories WHERE id LIKE 'uncategorised-%'; ALTER TABLE sms_suggestions DROP COLUMN counterparty_code; PRAGMA user_version = 5");
  const mine = migrateToUncategorised(other.run, 5);
  check('a category the owner already named Uncategorised is kept as it is, and only the missing one is added', !!mine && mine.categoriesAdded === 1 && countOf(other.device, "categories WHERE name = 'Uncategorised'") === 2 && other.run.all<{ id: string }>("SELECT id FROM categories WHERE name = 'Uncategorised' AND type = 'expense'")[0].id === 'theirs');

  // a fresh install: the migration adds none (the first launch seeds them), and the seed has both
  const fresh = make();
  check('a fresh install reaches 9 with the code column and no categories added by the migration', versionOf(fresh.device) === 9 && countOf(fresh.device, 'categories') === 0 && (fresh.device.prepare('PRAGMA table_info(sms_suggestions)').all() as { name: string }[]).some((c) => c.name === 'counterparty_code'));
  check('the seed list has both built-in categories (income and expense)', defaultCategories.some((c) => c.id === UNCATEGORISED_INCOME.id && c.type === 'income') && defaultCategories.some((c) => c.id === UNCATEGORISED_EXPENSE.id && c.type === 'expense'));
  check('the code column round trips on a suggestion', (() => { const row = { ...cards[0], id: 'with-code', rawHash: '0000000000000001', counterpartyCode: '731284' }; insertSuggestions(fresh.run, [row]); return readSuggestions(fresh.run)[0].counterpartyCode === '731284'; })());
}

// ======================================================= 11. Uncategorised ===================================================
console.log('Uncategorised: the default, saving with it, the shortcut');
{
  const clock = makeClock();
  const t = withAccount(emptyState(), clock.ctx, { name: 'Telebirr', opening: 5000, openingDate: '2026-11-01', type: 'wallet', sender: '127' });
  const state = t.state;
  check('the two built-in categories are protected, others are not', isProtectedCategory(UNCATEGORISED_EXPENSE) && isProtectedCategory(UNCATEGORISED_INCOME) && !isProtectedCategory(FEES_CATEGORY) && !isProtectedCategory({ name: 'Food', type: 'expense' }) && !isProtectedCategory({ name: 'Uncategorised', type: 'savings' }));
  const card = suggestionFrom(TB_OUT, clock.ctx, state);
  check('a new card starts as Uncategorised when nothing names a category', card.category === UNCATEGORISED_NAME && categoryOf(card) === UNCATEGORISED_NAME);
  const cardIn = suggestionFrom(TB_IN, clock.ctx, state);
  check('...incoming too', cardIn.category === UNCATEGORISED_NAME);
  check('a card in that state is clean and can be saved', checkSuggestion(state, card, clock.ctx).clean);
  const plan = planSuggestionSave(state, card, { remember: true }, clock.ctx);
  check('saving it works and the entry is Uncategorised', plan.result.added[0].category === UNCATEGORISED_NAME && plan.result.added[0].type === 'expense');
  check('remember does NOT store a rule for Uncategorised', plan.confirmation.rule === null);
  check('with a real category the rule IS stored', planSuggestionSave(state, { ...card, category: 'Food' }, { remember: true }, clock.ctx).confirmation.rule?.category === 'Food');
  const rules = [{ key: 'name:zxxxxx qxxxx', category: 'Food', lastUsed: '2026-11-01T00:00:00Z' }];
  const remembered = stageBatch(previewBatch(TB_OUT, new Set()), TODAY, clock.ctx, { accounts: state.accounts, rules, categories })[0];
  check('recipient memory still applies: a remembered category beats the default', remembered.category === 'Food');
  const hinted = suggestionFrom(TB_PKG, clock.ctx, state);
  check('a Phone / Internet hint beats the default', hinted.category === 'Phone & Internet');
  check('...and without such a category the default is used', stageBatch(previewBatch(TB_PKG, new Set()), TODAY, clock.ctx, { accounts: state.accounts, rules: [], categories: defaultCategories })[0].category === UNCATEGORISED_NAME);
  check('an old pending card with no category saves as Uncategorised', planSuggestionSave(state, { ...card, category: '' }, { remember: false }, clock.ctx).result.added[0].category === UNCATEGORISED_NAME);

  // the shortcut
  let s = state;
  s = planSuggestionSave(s, card, { remember: false }, clock.ctx).result.state;
  const second = { ...suggestionFrom(TB_PKG, clock.ctx, s, TODAY, []), category: UNCATEGORISED_NAME, id: 'u2', rawHash: 'u2', feeAmount: 0 };
  s = planSuggestionSave(s, second, { remember: false }, clock.ctx).result.state;
  s = planSuggestionSave(s, { ...cardIn, category: UNCATEGORISED_NAME, id: 'u3', rawHash: 'u3', accountId: t.id }, { remember: false }, clock.ctx).result.state;
  s = planSuggestionSave(s, { ...card, category: 'Food', id: 'u4', rawHash: 'u4' }, { remember: false }, clock.ctx).result.state;
  const mixed = filterUncategorised(s.entries);
  check('the shortcut finds income and expense entries that are Uncategorised, and nothing else', mixed.length === 3 && mixed.every(isUncategorised), String(mixed.length));
  check('it never counts the opening balance, a Fees row or a transfer', !mixed.some((e) => e.type === 'opening' || e.category === 'Fees' || e.type === 'transfer'));
  const target = mixed.find((e) => e.type === 'expense')!;
  const fixed = planAddEntry(s, { type: 'expense', accountId: t.id, amount: 1, currency: 'ETB', category: UNCATEGORISED_NAME, date: '2026-11-15' }, clock.ctx).state;
  check('an entry added by hand as Uncategorised is counted', filterUncategorised(fixed.entries).length === 4);
  const edited = { ...s, entries: s.entries.map((e) => (e.id === target.id ? { ...e, category: 'Food' } : e)) };
  check('fixing one drops the count', filterUncategorised(edited.entries).length === 2);
  check('with none left the list is empty', filterUncategorised(edited.entries.map((e) => (isUncategorised(e) ? { ...e, category: 'Food' } : e))).length === 0);
}

// ======================================================= 12. Skip and Restore ================================================
console.log('Skipped messages: kept, never suggested again, restorable');
{
  const clock = makeClock();
  const state = withAccount(emptyState(), clock.ctx, { name: 'Telebirr', opening: 5000, type: 'wallet', sender: '127' }).state;
  const device = new DatabaseSync(':memory:');
  const run = runnerFor(device);
  runMigrations(run, 0);
  const rows = stageBatch(previewBatch([TB_OUT, TB_PKG].join('\n\n'), new Set()), TODAY, clock.ctx, { accounts: state.accounts, rules: [], categories });
  insertSuggestions(run, rows);
  updateSuggestionChoices(run, rows[0].id, { category: 'Food', feeAmount: 4 });
  updateSuggestionChoices(run, rows[0].id, { status: 'ignored' });
  const skipped = readSuggestions(run).filter((s) => s.status === 'ignored');
  check('a skipped message is kept with its choices', skipped.length === 1 && skipped[0].id === rows[0].id && skipped[0].category === 'Food' && skipped[0].feeAmount === 4);
  check('it leaves the queue', cleanOrder(readSuggestions(run)).map((s) => s.id).join() === rows[1].id);
  check('pasting it again does not suggest it again', previewBatch(TB_OUT, handledHashes(readSuggestions(run))).fresh.length === 0 && previewBatch(TB_OUT, handledHashes(readSuggestions(run))).alreadyHandled === 1);
  updateSuggestionChoices(run, rows[0].id, { status: 'pending' });
  const back = readSuggestions(run).find((s) => s.id === rows[0].id)!;
  check('Restore returns it to pending with the same choices', back.status === 'pending' && back.category === 'Food' && back.feeAmount === 4 && back.confirmedEntryId === null);
  check('it is back in the queue', cleanOrder(readSuggestions(run)).length === 2);
  check('and still counts as handled for dedupe', previewBatch(TB_OUT, handledHashes(readSuggestions(run))).alreadyHandled === 1);
  check('a restored message can be saved as usual', planSuggestionSave(state, back, { remember: false }, clock.ctx).result.added.length === 2);
}

// ======================================================= 13. merchants, airtime, bills, two CBE accounts ===================
console.log('Merchants, airtime, bills and two CBE accounts');
{
  const clock = makeClock();
  const M1 = `Dear Abebe
You have paid ETB 1,070.00 for Service Fee from 731284 - Lemlem Cafe and Pastry plc Bole Branch on 08/11/2026 16:15:35. Your transaction number is  QD27HKAXMN. Your current balance is ETB 4,903.51. To download your payment information please click this link: https://example.invalid/receipt/QD27HKAXMN
Thank you for using telebirr
Ethio telecom`;
  const M1b = M1.replace('Lemlem Cafe and Pastry plc Bole Branch', 'LEMLEM CAFE PLC Piassa Branch').replace('QD27HKAXMN', 'QD99LMNOPQ').replace('08/11/2026', '09/11/2026');
  const M2 = `Dear Abebe
You have paid ETB 2,590.00 to Orion Data Services PLC with Payment number 0911223344 on 30/10/2026 13:36:31. The service fee is  ETB 0.00 and  15% VAT on the service fee is ETB 0.00. Your transaction number is MV5T2KQ8ZD
Your current telebirr balance is ETB 9,267.00. To download your payment information please click this link: https://example.invalid/receipt/MV5T2KQ8ZD
Thank you for using telebirr
Ethio telecom`;
  const FOOT = `For any support and information related to telebirr service
Send SMS to 126 or Contact us via
Telegram: https://t.me/telebirr
Facebook: https://facebook.com/telebirr or
Visit our website :https://www.ethiotelecom.et/telebirr/
Thank you for using telebirr
Ethio telecom`;
  const AIR = `Dear Abebe
You have recharged ETB 15.00 airtime for 911223355 on 02/11/2026 22:30:04. Your transaction number is PN3TJ7YVQ6. Your current  balance is  ETB 6,208.14. To download your payment information please click this link: https://example.invalid/receipt/PN3TJ7YVQ6
${FOOT}`;
  const AIR_RECEIVED = `Dear Customer
You have received ETB 15.00 airtime from 251911223355 on 02/11/2026 22:30:04. Your transaction number is PN3TJ7YVQ6.
Thank you for using telebirr
ethio telecom`;
  const BILL = `Dear Abebe
You have paid ETB 18.01 to pay bill for 700112233 on 05/11/2026 09:49:10. Your transaction number is KX9PD36LWE. Your telebirr account balance is  ETB 3,846.05. To download your payment information please click this link: https://example.invalid/receipt/KX9PD36LWE
Thank you for using telebirr
Ethio telecom`;
  const CBE_MAIN = `Dear Mrs Abebe your Account 1****6213 has been debited for MEKDES TADESSE GEBRE with ETB 2200. Your Current Balance is ETB 64218.93. Thank you for Banking with CBE!. For feedback https://example.invalid/s for Reciept https://example.invalid/BranchReceipt/FT26301ABCD1&17283940`;
  const CBE_SAVINGS = `Dear Mr Abebe your Account 1****9847 has been credited with ETB 2012. Your Current Balance is ETB 61207.15. Thank you for Banking with CBE`;

  const cards = (text: string, rules: ReturnType<typeof readRules> = [], cats: Category[] = categories, accounts: AccountsState['accounts'] = []) =>
    stageBatch(previewBatch(text, new Set()), TODAY, clock.ctx, { accounts, rules, categories: cats });

  // the new kinds become expenses with the right fields
  const [m1] = cards(M1);
  check('a merchant payment becomes a pending expense card with the merchant code', m1.kind === 'merchant_payment' && m1.counterpartyCode === '731284' && m1.direction === 'out' && m1.amount === 1070 && m1.date === '2026-11-08');
  const [m2] = cards(M2);
  check('a payment-number merchant has zero fee and VAT, so no fee row', m2.fee === 0 && m2.vat === 0 && effectiveFee(m2) === 0);

  // recipient key: the merchant code first
  const [m1b] = cards(M1b);
  check('the same merchant under another branch name has the same key (the code)', recipientKey(m1) === 'code:731284' && recipientKey(m1b) === 'code:731284' && m1.counterpartyName !== m1b.counterpartyName);
  check('a merchant paid by payment number is keyed by that number', recipientKey(m2) === 'code:0911223344');
  check('with no code the normalised name is the fallback', recipientKey({ counterpartyCode: null, counterpartyName: 'Lemlem Cafe', counterpartyPhoneTail: null, counterpartyBank: null, counterpartyAccountTail: null }) === 'name:lemlem cafe');
  const ruleFor1 = { key: 'code:731284', category: 'Food', lastUsed: '2026-11-01T00:00:00Z' };
  check('a remembered category for the code is used for the other branch', cards(M1b, [ruleFor1])[0].category === 'Food' && cards(M1, [ruleFor1])[0].category === 'Food');
  check('a rule for a different code is not used', cards(M2, [ruleFor1])[0].category === UNCATEGORISED_NAME);

  // airtime and bills: hints
  const withBills: Category[] = [...categories, { id: 'bills', name: 'Bills & Utilities', type: 'expense', icon: 'b', color: '#000', isDefault: false }];
  const [air] = cards(AIR, [], withBills);
  check('airtime goes to a Phone / Internet category when the owner has one', air.kind === 'airtime' && air.category === 'Phone & Internet');
  check('...and is Uncategorised when they do not', cards(AIR, [], defaultCategories)[0].category === UNCATEGORISED_NAME);
  const [bill] = cards(BILL, [], withBills);
  check('a bill goes to a Bills-style category when the owner has one', bill.kind === 'bill_payment' && bill.category === 'Bills & Utilities');
  check('...and is Uncategorised when they do not', cards(BILL, [], categories)[0].category === UNCATEGORISED_NAME);
  check('a bill is never sent to the Phone category, nor airtime to Bills', cards(BILL, [], [...categories])[0].category !== 'Phone & Internet' && air.category !== 'Bills & Utilities');
  const t = withAccount(emptyState(), clock.ctx, { name: 'Telebirr', opening: 9000, openingDate: '2026-11-01', type: 'wallet', sender: '127' });
  const airPlan = planSuggestionSave(t.state, { ...air, accountId: t.id }, { remember: true }, clock.ctx);
  check('an airtime card saves as an expense with a useful source and note', airPlan.result.added[0].source === 'Airtime' && airPlan.result.added[0].note === 'Airtime' && airPlan.result.added[0].amount === 15 && airPlan.result.added[0].category === 'Phone & Internet');
  check('...and remembers the number for next time', airPlan.confirmation.rule?.key === 'code:911223355');

  // airtime received: not a transaction, and shares its number with the recharge
  const block = [AIR, AIR_RECEIVED].join('\n\n');
  const first = previewBatch(block, new Set());
  check('a recharge and the notice that airtime arrived: one transaction, one "not a transaction"', first.fresh.length === 1 && first.fresh[0].kind === 'airtime' && first.ignored === 1 && first.unreadable.length === 0 && first.alreadyHandled === 0);
  const staged = stageBatch(first, TODAY, clock.ctx, { accounts: [], rules: [], categories });
  check('the notice never becomes a suggestion', staged.length === 1 && staged[0].reference === 'PN3TJ7YVQ6');
  const again = previewBatch(block, handledHashes(staged));
  check('pasting the pair again: the recharge is already handled, the notice is still not a transaction', again.alreadyHandled === 1 && again.ignored === 1 && again.fresh.length === 0);
  const notice = parseSms(AIR_RECEIVED);
  const recharge = parseSms(AIR);
  check('they carry the same transaction number', notice.status === 'ignored' && recharge.status === 'parsed' && notice.reference === recharge.sms.reference);
  check('the notice alone is ignored, not unreadable and not new', previewBatch(AIR_RECEIVED, new Set()).ignored === 1 && previewBatch(AIR_RECEIVED, new Set()).fresh.length === 0 && previewBatch(AIR_RECEIVED, new Set()).unreadable.length === 0);

  // two CBE accounts
  let s = emptyState();
  const main = withAccount(s, clock.ctx, { name: 'CBE Main', opening: 100, sender: 'CBE', digits: '6213' });
  const savings = withAccount(main.state, clock.ctx, { name: 'CBE Savings', opening: 100, sender: ' cbe ', digits: '9847' });
  s = savings.state;
  const parsedMain = cards(CBE_MAIN, [], categories, s.accounts)[0];
  const parsedSavings = cards(CBE_SAVINGS, [], categories, s.accounts)[0];
  check('the CBE message printing 6213 goes to the account whose last digits are 6213', parsedMain.accountTail === '6213' && parsedMain.accountId === main.id);
  check('the CBE message printing 9847 goes to the other account (sender typed with spaces and lower case)', parsedSavings.accountTail === '9847' && parsedSavings.accountId === savings.id);
  const third = withAccount(s, clock.ctx, { name: 'CBE Old', opening: 0, sender: 'CBE', digits: null });
  check('a third CBE account with no digits does not steal either message', cards(CBE_MAIN, [], categories, third.state.accounts)[0].accountId === main.id && cards(CBE_SAVINGS, [], categories, third.state.accounts)[0].accountId === savings.id);
  const unknown = CBE_MAIN.replace('1****6213', '1****0000');
  check('digits that match no account leave the card to ask (never a guess)', cards(unknown, [], categories, third.state.accounts)[0].accountId === null);
  check('two accounts with the same digits are ambiguous: the card asks', cards(CBE_MAIN, [], categories, withAccount(s, clock.ctx, { name: 'Twin', opening: 0, sender: 'CBE', digits: '6213' }).state.accounts)[0].accountId === null);
  check('an account for another service is never chosen for a CBE message', cards(CBE_MAIN, [], categories, [...s.accounts, withAccount(emptyState(), clock.ctx, { name: 'Telebirr', opening: 0, sender: '127', digits: '6213' }).state.accounts[0]])[0].accountId === main.id);
}

// ======================================================= 14. names saved before decoding existed ============================================
console.log('Percent-encoded names already in the database');
{
  const clock = makeClock();
  const state = withAccount(emptyState(), clock.ctx, { name: 'CBE', opening: 5000, sender: 'CBE', digits: '6213' }).state;
  const CBE_PCT_NAME = `Dear Mrs Abebe your Account 1****6213 has been debited for ABEBE & SONS TRADING with ETB 2200. Your Current Balance is ETB 64218.93. Thank you for Banking with CBE!. For feedback https://example.invalid/s for Reciept https://example.invalid/BranchReceipt/FT26301ABCD1&17283940`;
  const rows = stageBatch(previewBatch(CBE_PCT_NAME, new Set(), null, clock.ctx.now()), TODAY, clock.ctx, { accounts: state.accounts, rules: [], categories });
  const device = new DatabaseSync(':memory:');
  const run = runnerFor(device);
  runMigrations(run, 0);
  // what an older build stored: the name exactly as it was printed, still encoded
  insertSuggestions(run, [{ ...rows[0], counterpartyName: 'ABEBE %26 SONS TRADING', counterpartyBank: 'Commercial%20Bank', note: 'Daily%20Package' }]);
  const back = readSuggestions(run)[0];
  check('a name saved with its %26 still encoded reads back decoded', back.counterpartyName === 'ABEBE & SONS TRADING', String(back.counterpartyName));
  check('...and so do the bank name and the note', back.counterpartyBank === 'Commercial Bank' && back.note === 'Daily Package');
  check('the stored text itself is not rewritten (reading never changes data)', (run.all<{ n: string }>('SELECT counterparty_name AS n FROM sms_suggestions')[0]).n === 'ABEBE %26 SONS TRADING');
  check('a card from the old row and one from a fresh paste have the same recipient key', recipientKey(back) === recipientKey(rows[0]) && recipientKey(back) === 'name:abebe sons trading');
  check('a name that was never encoded reads back unchanged', readSuggestions(run).length === 1 && (insertSuggestions(run, [{ ...rows[0], id: 'plain', rawHash: 'plain-hash', counterpartyName: 'ABEBE TADELE' }]), readSuggestions(run).find((r) => r.id === 'plain')?.counterpartyName === 'ABEBE TADELE'));
  check('a missing name stays missing', (insertSuggestions(run, [{ ...rows[0], id: 'none', rawHash: 'none-hash', counterpartyName: null, counterpartyBank: null, note: null }]), readSuggestions(run).find((r) => r.id === 'none')?.counterpartyName === null));
}

void bulkDone.then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
});
