// Checks for "Your name as banks write it" and pairing rule 3 (V2_SPEC Part Z, Phase 6D-3): how a name matches (whole name, ignoring case, spacing,
// punctuation and a title), a match on each side, near misses, several names, ambiguity (nothing offered, and why), foreign accounts, two outgoing
// sides, removing a name, the "Not a pair" memory, accepting through the atomic pair save, schema 9, and the names in a backup.
// Every name, number and message below is SYNTHETIC. Run: npx tsx scripts/verify-sms-ownnames.ts
import { readAccountsData, replaceAccountsData } from '../db/accountsRepo';
import { applyBackupRows } from '../db/backupRepo';
import { runMigrations, SqlRunner } from '../db/migrations';
import { migrateToOwnNames, OWN_NAMES_SCHEMA_VERSION } from '../db/ownNamesMigration';
import { commitPairSave, deleteOwnName, insertOwnName, insertSuggestions, readOwnNames, readSuggestions, renameOwnName } from '../db/smsRepo';
import { AccountsState } from '../types/accounts';
import { SmsSuggestion } from '../types/sms';
import { createBackupV4, restoreBackup } from '../utils/accounts/backup';
import { getAccountBalances } from '../utils/accounts/balances';
import { Ctx } from '../utils/accounts/context';
import { AccountsError } from '../utils/accounts/errors';
import { planAddEntry } from '../utils/accounts/entries';
import { planCreateAccount } from '../utils/accounts/manage';
import { MAX_OWN_NAME_LENGTH, MAX_OWN_NAMES, matchesOwnName, normaliseOwnName, ownNameProblem } from '../utils/sms/ownNames';
import { findPairs, searchPairs, selectPairs } from '../utils/sms/pairing';
import { planPairSave } from '../utils/sms/pairSave';

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

// ---- fixtures -----------------------------------------------------------------------------------------------------------------------------------
let n = 0;
const ctx: Ctx = { now: () => new Date(2026, 10, 20, 9, 0, 0), newId: () => `id-${++n}` };
const OWNER = 'Yeshiwork Alemu Teka';
const OWNER_HALF = 'Yxxxxx Kxxxxxxx';
const STRANGER = 'Dagmawi Tilahun Abate';

let state: AccountsState = { accounts: [], entries: [], goals: [], allocations: [], notifications: [], rates: [{ id: 'USD-ETB', fromCurrency: 'USD', toCurrency: 'ETB', rate: 55, updatedAt: '2026-11-01T00:00:00Z' }], currencies: ['ETB', 'USD'] };
function open(name: string, type: 'bank' | 'wallet', currency: string, sender: string): string {
  const created = planCreateAccount(state, { name, type, currency, openingAmount: 100000, date: '2026-10-01', smsSender: sender, lastDigits: null }, ctx);
  state = created.state;
  return created.account.id;
}
const TB = open('Telebirr', 'wallet', 'ETB', '127');
const CBE = open('CBE', 'bank', 'ETB', 'CBE');
const BOA = open('BOA', 'bank', 'ETB', 'BOA');
const USD = open('Payoneer', 'bank', 'USD', 'Payoneer');
const base = state;

let counter = 0;
function msg(p: Partial<SmsSuggestion>): SmsSuggestion {
  counter += 1;
  return {
    id: `m${counter}`, rawHash: `hash-${counter}`, status: 'pending', service: 'cbe', direction: 'out', kind: 'bank_transfer', amount: 1000, fee: null, vat: null, otherCharge: null, totalDeducted: null,
    counterpartyName: null, counterpartyPhoneTail: null, counterpartyBank: null, counterpartyAccountTail: null, counterpartyCode: null, accountTail: null, reference: null,
    occurredAt: null, balanceAfter: null, note: null, flags: [], accountId: CBE, category: '', feeAmount: null, date: '2026-11-10', dateSource: 'message',
    createdAt: '2026-11-10T00:00:00Z', confirmedEntryId: null, ...p,
  };
}
// The sending side of a transfer, from CBE, naming `who` as the recipient; the receiving side into Telebirr, naming `from` as the sender.
const sent = (who: string | null, p: Partial<SmsSuggestion> = {}) => msg({ direction: 'out', service: 'cbe', accountId: CBE, counterpartyName: who, ...p });
const got = (from: string | null, p: Partial<SmsSuggestion> = {}) => msg({ direction: 'in', kind: 'received', service: 'telebirr', accountId: TB, counterpartyName: from, ...p });
const names = [OWNER];
const offered = (list: SmsSuggestion[], own: readonly string[] = names, rejected: ReadonlySet<string> = new Set(), s: AccountsState = base) => findPairs(s, list, rejected, own);

// ======================================================= 1. how a name matches ================================================================
console.log('How a name matches');
{
  check('the same name matches', matchesOwnName(OWNER, [OWNER]));
  check('case and spacing do not matter', matchesOwnName('  yeshiwork   ALEMU teka ', [OWNER]));
  check('punctuation does not matter', matchesOwnName('Yeshiwork, Alemu-Teka.', [OWNER]));
  check('a leading title is ignored on either side', matchesOwnName('Mr Yeshiwork Alemu Teka', [OWNER]) && matchesOwnName(OWNER, ['Ato Yeshiwork Alemu Teka']));
  check('a percent-encoded name is decoded first (as every name read from a message is)', matchesOwnName('Yeshiwork%20Alemu%20Teka', [OWNER]));
  check('a half-hidden name the owner typed as the bank writes it matches', matchesOwnName(OWNER_HALF, [OWNER, OWNER_HALF]) && !matchesOwnName(OWNER_HALF, [OWNER]));
  check('a short name never matches inside a longer different name', !matchesOwnName('Yeshiwork Alemu Teka Gebre', [OWNER]) && !matchesOwnName('Yeshiwork Alemu', [OWNER]) && !matchesOwnName(OWNER, ['Yeshiwork Alemu']));
  check('a partial word never matches ("Yeshi" is not "Yeshiwork", "Yeshiworks" is not "Yeshiwork")', !matchesOwnName('Yeshiwork', ['Yeshi']) && !matchesOwnName('Yeshi', ['Yeshiwork']) && !matchesOwnName('Yeshiworks', ['Yeshiwork']));
  check('a message with no name never matches, and an empty list matches nothing', !matchesOwnName(null, [OWNER]) && !matchesOwnName('', [OWNER]) && !matchesOwnName(OWNER, []));
  check('a title alone is not a name', normaliseOwnName('Mr') === 'mr' && normaliseOwnName('Mr Abate') === 'abate');
  check('the same name in another order is a different name', !matchesOwnName('Teka Alemu Yeshiwork', [OWNER]));
}

// ======================================================= 2. rule 3 on each side ===============================================================
console.log('Rule 3');
{
  const a = sent(OWNER);
  const b = got(STRANGER);
  const found = offered([a, b]);
  check('the SENDING message names the owner as the recipient: offered, as rule 3', found.length === 1 && found[0].rule === 'owner' && found[0].fromAccountId === CBE && found[0].toAccountId === TB && found[0].amount === 1000);
  const c = sent(STRANGER);
  const d = got(OWNER);
  const found2 = offered([c, d]);
  check('the RECEIVING message names the owner as the sender: offered, as rule 3', found2.length === 1 && found2[0].rule === 'owner');
  check('a message that names nobody on the other side, with no name on the list: not offered', offered([sent(null), got(null)]).length === 0 && offered([a, b], []).length === 0);
  check('neither message names the owner: not offered', offered([sent(STRANGER), got(STRANGER)]).length === 0);
  check('a different name: not offered', offered([sent('Hirut Mesfin Alemayehu'), got(null)]).length === 0);
  check('a different amount: not offered', offered([sent(OWNER), got(null, { amount: 999 })]).length === 0);
  check('a different day: not offered (rule 3 needs the same day)', offered([sent(OWNER), got(null, { date: '2026-11-11' })]).length === 0);
  check('the same account twice: not offered', offered([sent(OWNER), got(null, { accountId: CBE })]).length === 0);
  check('two outgoing sides: not offered', offered([sent(OWNER), sent(OWNER, { accountId: BOA, service: 'boa' })]).length === 0);
  check('two incoming sides: not offered', offered([got(OWNER), got(OWNER, { accountId: BOA, service: 'boa' })]).length === 0);
  check('a waiting message only: a message already saved is never offered', offered([sent(OWNER, { status: 'confirmed' }), got(null)]).length === 0);

  // partial words and longer names never pair
  check('the owner\'s name inside a longer different name does not pair', offered([sent(`${OWNER} Gebre`), got(null)]).length === 0 && offered([sent('Yeshiwork Alemu'), got(null)]).length === 0);
  check('several names: the second one pairs', offered([sent(OWNER_HALF), got(null)], [OWNER, OWNER_HALF]).length === 1 && offered([sent(OWNER_HALF), got(null)], [OWNER]).length === 0);

  // foreign accounts
  const usdIn = got(OWNER, { accountId: USD, service: 'telebirr' });
  check('a foreign-currency account is never paired', offered([sent(OWNER), usdIn]).length === 0);
  const usdEntry = planAddEntry(base, { type: 'income', accountId: USD, amount: 1000, currency: 'USD', category: 'Salary', date: '2026-11-10' }, ctx).state;
  check('...nor is an entry in one', offered([sent(OWNER)], names, new Set(), usdEntry).length === 0);
}

// ======================================================= 3. the weakest rule ===================================================================
console.log('Rule 3 is the weakest');
{
  const a = sent(OWNER, { reference: 'REF12345' });
  const b = got(OWNER, { reference: 'REF12345' });
  check('a pair that rules 1 fits is offered as rule 1, not rule 3', offered([a, b])[0]?.rule === 'reference' && offered([a, b]).length === 1);
  const c = sent(OWNER, { counterpartyBank: 'Telebirr' });
  const d = got(null, { counterpartyBank: 'Commercial Bank of Ethiopia' });
  check('a pair that rule 2 fits is offered as rule 2', offered([c, d])[0]?.rule === 'names');

  // M is in a rule 1 pair with N1; rule 3 would also pair M with N2: only the strong pair is offered, with no ambiguity note
  const m = sent(OWNER, { reference: 'REF99999' });
  const n1 = got(null, { reference: 'REF99999' });
  const n2 = got(null, { accountId: BOA, service: 'boa' });
  const search = searchPairs(base, [m, n1, n2], new Set(), names);
  check('a message that rule 1 already offers is not also offered by rule 3 with another message', search.candidates.length === 1 && search.candidates[0].rule === 'reference' && search.notices.length === 0);
}

// ======================================================= 4. ambiguity =========================================================================
console.log('More than one fits');
{
  const m = sent(OWNER);
  const n1 = got(null);
  const n2 = got(null, { accountId: BOA, service: 'boa' });
  const search = searchPairs(base, [m, n1, n2], new Set(), names);
  check('one message that rule 3 matches with two others: nothing is offered', search.candidates.length === 0);
  check('...and a note says why, in plain words, naming both', search.notices.length === 1 && /more than one other movement fits it/.test(search.notices[0].message) && /received ETB 1,000\.00 in Telebirr/.test(search.notices[0].message) && /received ETB 1,000\.00 in BOA/.test(search.notices[0].message), search.notices[0]?.message);
  check('...the messages involved are named for a batch to leave alone', new Set(search.notices[0].heldIds).size === 3 && [m, n1, n2].every((x) => search.notices[0].heldIds?.includes(x.id)));
  // two outgoing sides for one incoming
  const o1 = sent(null);
  const o2 = sent(null, { accountId: BOA, service: 'boa' });
  const inn = got(OWNER);
  check('one incoming message that fits two outgoing ones: nothing is offered either', searchPairs(base, [o1, o2, inn], new Set(), names).candidates.length === 0);

  // "Not a pair" removes one from the count: the other is then offered
  const first = findPairs(base, [m, n1], new Set(), names)[0];
  const afterReject = findPairs(base, [m, n1, n2], new Set([first.key]), names);
  check('after "Not a pair" on one of them, the remaining one is offered', afterReject.length === 1 && afterReject[0].toAccountId === BOA && afterReject[0].rule === 'owner');
  check('a rejected pair is not offered again at all', findPairs(base, [m, n1], new Set([first.key]), names).length === 0);

  // an entry the owner typed counts as one of the candidates
  const typed = planAddEntry(base, { type: 'income', accountId: BOA, amount: 1000, currency: 'ETB', category: 'Salary', date: '2026-11-10' }, ctx).state;
  const withEntry = searchPairs(typed, [m, n1], new Set(), names);
  check('a message and an entry of the owner that both fit: nothing is offered', withEntry.candidates.filter((c) => c.rule === 'owner').length === 0 && withEntry.notices.length >= 1, JSON.stringify(withEntry.candidates.map((c) => c.rule)));
  const lone = searchPairs(typed, [m], new Set(), names);
  check('the same message with only that entry is offered as a conversion', lone.candidates.length === 1 && lone.candidates[0].existingEntryId !== null && lone.candidates[0].rule === 'owner');
}

// ======================================================= 5. removing a name ===================================================================
console.log('Removing a name');
{
  const list = [sent(OWNER), got(null)];
  check('with the name, the pair is offered', offered(list).length === 1);
  check('without it, the pair is no longer offered', offered(list, []).length === 0);
  const key = offered(list)[0].key;
  check('a pair accepted from an old card is refused once the name is gone, with nothing saved', /no longer look like one transfer/.test(messageOf(() => planPairSave(base, key, list, 'new', ctx, { ownNames: [] }))));
  check('...and the same card with the name still works', codeOf(() => planPairSave(base, key, list, 'new', ctx, { ownNames: names })) === 'none');
  check('one card per message when several names are listed', selectPairs(offered(list, [OWNER, OWNER_HALF])).length === 1);
}

// ======================================================= 6. accepting ===========================================================================
console.log('Accepting a rule 3 pair');
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
const countOf = (db: NodeDb, sql: string): number => (db.prepare(`SELECT COUNT(*) AS c FROM ${sql}`).get() as { c: number }).c;
const bal = (s: AccountsState, id: string) => getAccountBalances(s.entries, s.accounts)[id];
{
  const out = sent(OWNER, { fee: 5, vat: 0 });
  const inn = got(null);
  const list = [out, inn];
  const candidate = offered(list)[0];
  const plan = planPairSave(base, candidate.key, list, 'new', ctx, { ownNames: names });
  check('accepting saves ONE transfer (and the printed fee as its fee): CBE down by 1,005, Telebirr up by 1,000', plan.result.state.entries.filter((e) => e.type === 'transfer').length === 1 && bal(plan.result.state, CBE) === bal(base, CBE) - 1005 && bal(plan.result.state, TB) === bal(base, TB) + 1000);
  check('both messages are confirmed against that transfer, and neither is an income or an expense', plan.confirmation.suggestions.length === 2 && plan.confirmation.entryId === plan.transferId && plan.result.state.entries.filter((e) => e.type === 'income' || e.type === 'expense').every((e) => e.category === 'Fees'));

  // through the existing atomic pair save, on SQLite
  const dev = new DatabaseSync(':memory:');
  const run = runnerFor(dev);
  runMigrations(run, 0);
  replaceAccountsData(run, base);
  insertSuggestions(run, list);
  commitPairSave(run, base, plan.result.state, plan.confirmation);
  const rows = readSuggestions(run);
  check('through the atomic pair save: one transfer in the database, both messages confirmed', countOf(dev, "transactions WHERE type = 'transfer'") === 1 && rows.every((r) => r.status === 'confirmed' && r.confirmedEntryId === plan.transferId));
  check('...and committing the same plan again is refused', /no longer pending/.test(messageOf(() => commitPairSave(run, base, plan.result.state, plan.confirmation))) && countOf(dev, "transactions WHERE type = 'transfer'") === 1);

  // converting an entry the owner typed (the sending side, larger by a fee)
  const manual = planAddEntry(base, { type: 'expense', accountId: CBE, amount: 1010, currency: 'ETB', category: 'Food', date: '2026-11-10' }, ctx).state;
  const recv = got(OWNER);
  const convCandidate = findPairs(manual, [recv], new Set(), names)[0];
  check('an entry of the owner that includes a fee is the sending side: offered as rule 3 with the difference as the fee', !!convCandidate && convCandidate.rule === 'owner' && convCandidate.feeFromEntry === 10 && convCandidate.existingEntryId !== null, JSON.stringify(convCandidate && { rule: convCandidate.rule, fee: convCandidate.feeFromEntry }));
  const conv = planPairSave(manual, convCandidate.key, [recv], 'convert', ctx, { ownNames: names });
  check('converting keeps the entry (now the transfer) and adds a Fees entry of 10: CBE does not change, Telebirr is up by 1,000', conv.transferId === convCandidate.existingEntryId && bal(conv.result.state, CBE) === bal(manual, CBE) && bal(conv.result.state, TB) === bal(manual, TB) + 1000 && conv.result.state.entries.some((e) => e.category === 'Fees' && e.amount === 10));
  check('the date fee tolerance is the existing one: a difference over the larger of 2% and ETB 100 is not offered', (() => {
    const far = planAddEntry(base, { type: 'expense', accountId: CBE, amount: 1200, currency: 'ETB', category: 'Food', date: '2026-11-10' }, ctx).state;
    return findPairs(far, [recv], new Set(), names).length === 0;
  })());
}

// ======================================================= 7. schema 9 ============================================================================
console.log('Schema 9');
{
  const tableExists = (db: NodeDb, name: string) => (db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { c: number }).c > 0;
  const versionOf = (db: NodeDb) => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  check('the own names schema is version 9', OWN_NAMES_SCHEMA_VERSION === 9);
  const fresh = new DatabaseSync(':memory:');
  runMigrations(runnerFor(fresh), 0);
  check('a fresh install reaches 9 with the table', versionOf(fresh) === 9 && tableExists(fresh, 'own_names'));
  check('...and running the migrations again changes nothing', (() => { runMigrations(runnerFor(fresh), 9); return versionOf(fresh) === 9; })() && migrateToOwnNames(runnerFor(fresh), 9) === false);

  // from 8, with data: additive only
  const device = new DatabaseSync(':memory:');
  const run = runnerFor(device);
  runMigrations(run, 0);
  device.exec('PRAGMA user_version = 8');
  device.exec('DROP TABLE own_names');
  replaceAccountsData(run, base);
  insertSuggestions(run, [sent(OWNER), got(null)]);
  const before = JSON.stringify([readAccountsData(run), readSuggestions(run)]);
  const failing: SqlRunner = { ...run, exec: (sql) => { if (sql.startsWith('PRAGMA user_version = 9')) throw new Error('disk full'); run.exec(sql); } };
  check('a failure while finishing the step throws', messageOf(() => migrateToOwnNames(failing, 8)) === 'disk full');
  check('...and keeps nothing: still version 8, no table, no data touched', versionOf(device) === 8 && !tableExists(device, 'own_names') && JSON.stringify([readAccountsData(run), readSuggestions(run)]) === before);
  check('the retry creates the table and goes to 9, touching no data', migrateToOwnNames(run, 8) === true && versionOf(device) === 9 && tableExists(device, 'own_names') && JSON.stringify([readAccountsData(run), readSuggestions(run)]) === before);
  check('a step from before 8 is refused (the earlier steps must run first)', /before the own names migration/.test(messageOf(() => migrateToOwnNames(run, 7))));

  // the repository
  insertOwnName(run, { id: 'a', name: OWNER, createdAt: '2026-11-01T00:00:00Z' });
  insertOwnName(run, { id: 'b', name: OWNER_HALF, createdAt: '2026-11-02T00:00:00Z' });
  check('names are stored and read back in the order added', readOwnNames(run).map((r) => r.name).join('|') === `${OWNER}|${OWNER_HALF}`);
  renameOwnName(run, 'b', 'Yxxxx Kxxxxxx');
  check('a name can be changed', readOwnNames(run)[1].name === 'Yxxxx Kxxxxxx');
  deleteOwnName(run, 'a');
  check('a name can be removed', readOwnNames(run).length === 1 && readOwnNames(run)[0].id === 'b');
  check('the pair rule reads what is stored: after a restart the stored names pair the same messages', findPairs(base, [sent('Yxxxx Kxxxxxx'), got(null)], new Set(), readOwnNames(run).map((r) => r.name)).length === 1);

  // adding rules
  const list = [OWNER, OWNER_HALF];
  check('an empty name is refused', ownNameProblem(list, '   ') !== null && ownNameProblem(list, '...') !== null);
  check('the same name again (any case, spacing, title) is refused, naming it', ownNameProblem(list, 'MR  yeshiwork alemu teka')?.includes(OWNER) === true);
  check('a new name is fine, and so is saving a name over itself', ownNameProblem(list, 'Hirut Mesfin Alemayehu') === null && ownNameProblem(list, OWNER, 0) === null);
  check('renaming onto another name on the list is refused', ownNameProblem(list, OWNER_HALF, 0) !== null);
  check('the list is limited', ownNameProblem(Array.from({ length: MAX_OWN_NAMES }, (_, i) => `Person Number${String.fromCharCode(97 + i)}`), 'Another Person') !== null && MAX_OWN_NAME_LENGTH === 60);
}

// ======================================================= 8. backup ===============================================================================
console.log('The names in a backup');
{
  const ledger = base;
  const backup = JSON.parse(JSON.stringify(createBackupV4({ categories: [], budgets: [], state: ledger, suggestions: [], ownNames: [OWNER, OWNER_HALF] })));
  check('an export is still version 4 and carries the list', backup.version === 4 && JSON.stringify(backup.ownNames) === JSON.stringify([OWNER, OWNER_HALF]));
  const restored = restoreBackup(backup, ctx);
  check('restoring it brings the names back, and says so', JSON.stringify(restored.ownNames) === JSON.stringify([OWNER, OWNER_HALF]) && /2 names as banks write them restored/.test(restored.message), restored.message);

  const device = new DatabaseSync(':memory:');
  const run = runnerFor(device);
  runMigrations(run, 0);
  insertOwnName(run, { id: 'old', name: 'Old Name Person', createdAt: '2026-01-01T00:00:00Z' });
  applyBackupRows(run, restored.backup, restored.handled, (restored.ownNames ?? []).map((name, i) => ({ id: `r${i}`, name, createdAt: '2026-11-20T00:00:00Z' })));
  check('round trip through SQLite: the device\'s names are replaced by the backup\'s', readOwnNames(run).map((r) => r.name).join('|') === `${OWNER}|${OWNER_HALF}`);

  // an older backup: no list, no change to the device's names
  const { ownNames: _gone, ...older } = backup;
  void _gone;
  const oldV4 = restoreBackup(JSON.parse(JSON.stringify(older)), ctx);
  check('a version 4 backup written before this phase restores with no names (the device\'s are left alone)', oldV4.ownNames === null && !/names as banks write/.test(oldV4.message));
  const { version: _v, handledMessages: _h, ...ledgerOnly } = older;
  void _v;
  void _h;
  const v3 = restoreBackup(JSON.parse(JSON.stringify({ version: 3, ...ledgerOnly })), ctx);
  check('a version 3 backup too', v3.ownNames === null);
  check('and a version 2 backup too', restoreBackup({ version: 2, exportedAt: '2026-01-01T00:00:00Z', categories: [], transactions: [], exchangeRates: [], goals: [], budgets: [] }, ctx).ownNames === null);
  const device2 = new DatabaseSync(':memory:');
  const run2 = runnerFor(device2);
  runMigrations(run2, 0);
  insertOwnName(run2, { id: 'keep', name: 'Keep This Name', createdAt: '2026-01-01T00:00:00Z' });
  applyBackupRows(run2, v3.backup, v3.handled, v3.ownNames === null ? null : []);
  check('restoring an older backup leaves the names on the device exactly as they were', readOwnNames(run2).map((r) => r.name).join('|') === 'Keep This Name');

  // an empty list replaces; a damaged one is refused
  const emptyList = restoreBackup(JSON.parse(JSON.stringify({ ...backup, ownNames: [] })), ctx);
  check('a backup with an EMPTY list clears the names, and says so', Array.isArray(emptyList.ownNames) && emptyList.ownNames.length === 0 && /list of names as banks write them was cleared/.test(emptyList.message));
  const bad: Array<[string, unknown]> = [
    ['names that are not a list', 'Abebe'],
    ['a name that is not text', [OWNER, 5]],
    ['an empty name', [OWNER, '   ']],
    ['a name of only punctuation', ['...']],
    ['an enormous name', ['x'.repeat(500)]],
    ['far too many names', Array.from({ length: 200 }, (_, i) => `Person Number${i}`)],
    ['more than the limit', Array.from({ length: MAX_OWN_NAMES + 1 }, (_, i) => `Person${String.fromCharCode(97 + (i % 26))} Surname${String.fromCharCode(97 + Math.floor(i / 26))}`)],
  ];
  for (const [label, value] of bad) {
    check(`refused: ${label}`, codeOf(() => restoreBackup(JSON.parse(JSON.stringify({ ...backup, ownNames: value })), ctx)) === 'RESTORE_FAILED' && /Nothing was changed/.test(messageOf(() => restoreBackup(JSON.parse(JSON.stringify({ ...backup, ownNames: value })), ctx))));
  }
  const dup = restoreBackup(JSON.parse(JSON.stringify({ ...backup, ownNames: [OWNER, 'MR yeshiwork  ALEMU Teka', OWNER_HALF] })), ctx);
  check('the same name twice (ignoring case, spacing, title) is kept once', JSON.stringify(dup.ownNames) === JSON.stringify([OWNER, OWNER_HALF]));

  // all or nothing: a failure while writing the names keeps nothing of the restore
  const device3 = new DatabaseSync(':memory:');
  const run3 = runnerFor(device3);
  runMigrations(run3, 0);
  insertOwnName(run3, { id: 'stay', name: 'Stay Here Person', createdAt: '2026-01-01T00:00:00Z' });
  const snapshot = JSON.stringify([readAccountsData(run3), readOwnNames(run3)]);
  let writes = 0;
  const bad3: SqlRunner = { ...run3, run: (sql, ...p) => { if (sql.includes('INTO own_names')) { writes += 1; if (writes === 2) throw new Error('disk full'); } run3.run(sql, ...p); } };
  check('a failure on the second name throws', messageOf(() => applyBackupRows(bad3, restored.backup, restored.handled, [{ id: 'x1', name: OWNER, createdAt: 'now' }, { id: 'x2', name: OWNER_HALF, createdAt: 'now' }])) === 'disk full');
  check('...and keeps nothing: the ledger and the names are exactly as before', JSON.stringify([readAccountsData(run3), readOwnNames(run3)]) === snapshot);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
