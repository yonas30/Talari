// Checks for the "Fee counted twice" repair (V2_SPEC Part Z): which saved entries are offered (and which never are), what Fix changes (only the
// amount), Fix all as one all-or-nothing step, that it never overdraws or touches reserved goal money, that the card disappears afterwards and
// that all of it survives a restart. Every figure and name below is SYNTHETIC. Run: npx tsx scripts/verify-sms-repair.ts
import { FEES_CATEGORY } from '../constants/categories';
import { readAccountsData, replaceAccountsData, saveAccountsDiff } from '../db/accountsRepo';
import { runMigrations, SqlRunner } from '../db/migrations';
import { insertSuggestions, readSuggestions } from '../db/smsRepo';
import { AccountEntry, AccountsState } from '../types/accounts';
import { SmsSuggestion } from '../types/sms';
import { validateEntries, getAccountBalances } from '../utils/accounts/balances';
import { Ctx } from '../utils/accounts/context';
import { planAddEntry, planEditEntry } from '../utils/accounts/entries';
import { AccountsError } from '../utils/accounts/errors';
import { planAddToGoal, planCreateGoal } from '../utils/accounts/goals';
import { planCreateAccount } from '../utils/accounts/manage';
import { maskAmount } from '../utils/format';
import { findFeeCountedTwice, planFeeRepair, repairEffect, repairLine } from '../utils/sms/feeRepair';
import { planSuggestionSave } from '../utils/sms/saveSuggestion';

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

// ---- fixtures -----------------------------------------------------------------------------------------------------------------------------------------
let n = 0;
let t = new Date(2026, 10, 20, 9, 0, 0).getTime();
const ctx: Ctx = { now: () => new Date(t), newId: () => `id-${++n}` };
const minute = () => {
  t += 60_000;
};
const empty: AccountsState = { accounts: [], entries: [], goals: [], allocations: [], notifications: [], rates: [], currencies: ['ETB'] };
function account(state: AccountsState, name: string, opening: number, sender: string) {
  const created = planCreateAccount(state, { name, type: 'bank', currency: 'ETB', openingAmount: opening, smsSender: sender, lastDigits: null }, ctx);
  return { state: { ...created.state, entries: created.state.entries.map((e) => (e.type === 'opening' && e.accountId === created.account.id ? { ...e, date: '2026-10-01' } : e)) }, id: created.account.id };
}
const cbeAcct = account(empty, 'CBE', 25000, 'CBE');
const boaAcct = account(cbeAcct.state, 'BOA', 9000, 'BOA');
const base = boaAcct.state;
const CBE = cbeAcct.id;
const BOA = boaAcct.id;
const bal = (s: AccountsState, id: string) => getAccountBalances(s.entries, s.accounts)[id];

let counter = 0;
function message(p: Partial<SmsSuggestion>): SmsSuggestion {
  counter += 1;
  return {
    id: `s${counter}`, rawHash: `hash-${counter}`, status: 'pending', service: 'cbe', direction: 'out', kind: 'bank_transfer', amount: 0, fee: null, vat: null, otherCharge: null, totalDeducted: null,
    counterpartyName: 'Fiker Mulu Alem', counterpartyPhoneTail: null, counterpartyBank: null, counterpartyAccountTail: null, counterpartyCode: null, accountTail: null, reference: null,
    occurredAt: null, balanceAfter: null, note: null, flags: [], accountId: CBE, category: 'Food', feeAmount: null, date: '2026-11-10', dateSource: 'batch',
    createdAt: '2026-11-10T00:00:00Z', confirmedEntryId: null, ...p,
  };
}

interface Saved {
  state: AccountsState;
  suggestion: SmsSuggestion;
  main: AccountEntry;
  fee: AccountEntry;
}
// What the EARLIER build did with a message that printed the total as its amount: the entry holds the total and the charges are saved again
// as a separate Fees expense. (The current build corrects the amount before saving; this reproduces the old reading.)
function savedByEarlierBuild(state: AccountsState, p: { total: number; charges: [number, number, number]; date: string; accountId?: string; feeAmount?: number | null }): Saved {
  minute();
  const row = message({ amount: p.total, fee: p.charges[0], vat: p.charges[1], otherCharge: p.charges[2], totalDeducted: p.total, date: p.date, accountId: p.accountId ?? CBE, feeAmount: p.feeAmount ?? null });
  const plan = planSuggestionSave(state, row, { remember: false }, ctx);
  const [main, fee] = plan.result.added;
  return { state: plan.result.state, suggestion: { ...row, status: 'confirmed', confirmedEntryId: main.id }, main, fee };
}
const feeSum = (c: [number, number, number]) => Math.round((c[0] + c[1] + c[2]) * 100) / 100;
const asExpense = (e: AccountEntry, patch: Record<string, unknown> = {}) => ({ type: 'expense' as const, accountId: e.accountId as string, amount: e.amount, currency: e.currency, category: e.category, source: e.source, date: e.date, note: e.note, ...patch });

// ======================================================= 1. detection ==============================================================
console.log('Which entries are offered');
{
  const a = savedByEarlierBuild(base, { total: 3001.2, charges: [1, 0.15, 0.05], date: '2026-11-10' });
  const items = findFeeCountedTwice(a.state, [a.suggestion]);
  check('an entry saved with the total as its amount plus a separate fee is offered', items.length === 1 && items[0].entryId === a.main.id && items[0].feeEntryId === a.fee.id && items[0].suggestionId === a.suggestion.id);
  check('...with what it is now, what it will be, and the fee', items[0].currentAmount === 3001.2 && items[0].newAmount === 3000 && items[0].fee === 1.2 && items[0].accountId === CBE && items[0].date === '2026-11-10');
  check('(setup) the account went down by 3,002.40: too much by exactly the fee', Math.round((bal(base, CBE) - bal(a.state, CBE)) * 100) === 300240);
  check('the row reads "ETB 3,001.20 → ETB 3,000.00; your CBE balance goes up by ETB 1.20"', repairLine(items[0], 'CBE') === 'ETB 3,001.20 → ETB 3,000.00; your CBE balance goes up by ETB 1.20', repairLine(items[0], 'CBE'));

  // not offered
  check('a message that is not confirmed (waiting, skipped) is never offered', findFeeCountedTwice(a.state, [{ ...a.suggestion, status: 'pending' }]).length === 0 && findFeeCountedTwice(a.state, [{ ...a.suggestion, status: 'ignored' }]).length === 0);
  check('a message whose amount is NOT its printed total is not offered (the entry was saved right)', findFeeCountedTwice(a.state, [{ ...a.suggestion, amount: 3000 }]).length === 0);
  check('a message with no printed total is not offered', findFeeCountedTwice(a.state, [{ ...a.suggestion, totalDeducted: null }]).length === 0);
  check('a message with no charges is not offered', findFeeCountedTwice(a.state, [{ ...a.suggestion, fee: null, vat: null, otherCharge: null }]).length === 0);
  check('money coming in is never offered', findFeeCountedTwice(a.state, [{ ...a.suggestion, direction: 'in' }]).length === 0);
  check('a message that points at no entry is not offered', findFeeCountedTwice(a.state, [{ ...a.suggestion, confirmedEntryId: null }]).length === 0);

  // deleted entry / deleted fee row
  const mainGone = { ...a.state, entries: a.state.entries.filter((e) => e.id !== a.main.id) };
  check('a deleted entry is not offered', findFeeCountedTwice(mainGone, [a.suggestion]).length === 0);
  const feeGone = { ...a.state, entries: a.state.entries.filter((e) => e.id !== a.fee.id) };
  check('if the fee entry was deleted the entry is already right, so it is not offered', findFeeCountedTwice(feeGone, [a.suggestion]).length === 0);

  // edited by hand
  minute();
  const editedCategory = planEditEntry(a.state, a.main.id, asExpense(a.main, { category: 'Rent' }), ctx).state;
  check('an entry the owner edited (even only its category) is never offered', findFeeCountedTwice(editedCategory, [a.suggestion]).length === 0);
  const editedAmount = planEditEntry(a.state, a.main.id, asExpense(a.main, { amount: 3000 }), ctx).state;
  check('an entry whose amount the owner already changed is not offered', findFeeCountedTwice(editedAmount, [a.suggestion]).length === 0);
  const editedDate = planEditEntry(a.state, a.main.id, asExpense(a.main, { date: '2026-11-11' }), ctx).state;
  check('an entry whose date the owner changed is not offered', findFeeCountedTwice(editedDate, [a.suggestion]).length === 0);
  const editedFee = planEditEntry(a.state, a.fee.id, asExpense(a.fee, { amount: 2 }), ctx).state;
  check('if the owner edited the fee entry it is not offered either (the figures are theirs now)', findFeeCountedTwice(editedFee, [a.suggestion]).length === 0);
  const confirmedDate = { ...a.state, entries: a.state.entries.map((e) => (e.id === a.main.id ? { ...e, dateSource: 'manual' as const } : e)) };
  check('"Date is right" is not an edit of the amount: the entry is still offered', findFeeCountedTwice(confirmedDate, [a.suggestion]).length === 1);

  // already correct
  const right = savedByEarlierBuild(base, { total: 3001.2, charges: [1, 0.15, 0.05], date: '2026-11-11' });
  const fixedByHand = { ...right, suggestion: { ...right.suggestion, amount: 3000 } };
  check('an entry saved by the corrected build (amount 3,000.00 + fee) is not offered', findFeeCountedTwice(fixedByHand.state, [fixedByHand.suggestion]).length === 0);

  // a pair
  const transferId = 'transfer-entry';
  const asTransfer = { ...a.state, entries: a.state.entries.map((e) => (e.id === a.main.id ? { ...e, id: transferId, type: 'transfer' as const, accountId: null, fromAccountId: CBE, toAccountId: BOA, toAmount: e.amount, toAmountETB: e.amount } : e)) };
  check('an entry that is a transfer (saved from a pair) is never offered', findFeeCountedTwice(asTransfer, [{ ...a.suggestion, confirmedEntryId: transferId }]).length === 0);

  const asIncome = { ...a.state, entries: a.state.entries.map((e) => (e.id === a.main.id ? { ...e, type: 'income' as const } : e)) };
  check('an entry that is not an expense (an income with an account) is never offered', findFeeCountedTwice(asIncome, [a.suggestion]).length === 0);

  // the fee row must be the one saved WITH it
  const farFee = { ...a.state, entries: a.state.entries.map((e) => (e.id === a.fee.id ? { ...e, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } : e)) };
  check('a Fees expense of the same amount from another time is not "the fee saved with it"', findFeeCountedTwice(farFee, [a.suggestion]).length === 0);
  const otherDay = { ...a.state, entries: a.state.entries.map((e) => (e.id === a.fee.id ? { ...e, date: '2026-11-09' } : e)) };
  check('a Fees expense on another day is not matched', findFeeCountedTwice(otherDay, [a.suggestion]).length === 0);
  const otherAccount = { ...a.state, entries: a.state.entries.map((e) => (e.id === a.fee.id ? { ...e, accountId: BOA } : e)) };
  check('a Fees expense in another account is not matched', findFeeCountedTwice(otherAccount, [a.suggestion]).length === 0);
  const otherAmount = { ...a.state, entries: a.state.entries.map((e) => (e.id === a.fee.id ? { ...e, amount: 1.5 } : e)) };
  check('a Fees expense of another amount is not matched', findFeeCountedTwice(otherAmount, [a.suggestion]).length === 0);
  const twin = { ...a.state, entries: [...a.state.entries, { ...a.fee, id: 'twin-fee' }] };
  check('two equally likely fee entries: nothing is guessed, nothing is offered', findFeeCountedTwice(twin, [a.suggestion]).length === 0);
  const archived = { ...a.state, accounts: a.state.accounts.map((x) => (x.id === CBE ? { ...x, archived: true } : x)) };
  check('an archived account is not offered', findFeeCountedTwice(archived, [a.suggestion]).length === 0);

  // a fee the owner set on the card
  const custom = savedByEarlierBuild(base, { total: 3001.2, charges: [1, 0.15, 0.05], date: '2026-11-12', feeAmount: 2 });
  const customItems = findFeeCountedTwice(custom.state, [custom.suggestion]);
  check('a fee typed on the card is the one that was saved: the entry becomes total minus THAT fee', customItems.length === 1 && customItems[0].fee === 2 && customItems[0].newAmount === 2999.2);
  check('a fee of 0 typed on the card saved no fee entry, so there is nothing to repair', findFeeCountedTwice(savedByEarlierBuild(base, { total: 3001.2, charges: [1, 0.15, 0.05], date: '2026-11-13', feeAmount: 0 }).state, []).length === 0);

  check('the list is ordered by date', (() => { const b = savedByEarlierBuild(a.state, { total: 603.61, charges: [0.5, 0.08, 0.03], date: '2026-11-05' }); const found = findFeeCountedTwice(b.state, [a.suggestion, b.suggestion]); return found.map((i) => i.date).join() === '2026-11-05,2026-11-10'; })());
}

// ======================================================= 2. fixing one ================================================================
console.log('Fix');
{
  const a = savedByEarlierBuild(base, { total: 3001.2, charges: [1, 0.15, 0.05], date: '2026-11-10' });
  minute();
  const plan = planFeeRepair(a.state, [a.suggestion], [a.main.id], ctx);
  const after = plan.state;
  const mainAfter = after.entries.find((e) => e.id === a.main.id) as AccountEntry;
  const feeAfter = after.entries.find((e) => e.id === a.fee.id) as AccountEntry;
  check('Fix changes the amount of the entry to the total minus the fee: 3,000.00', mainAfter.amount === 3000 && mainAfter.amountETB === 3000);
  check('the account balance goes UP by exactly the fee, 1.20, and the account now matches the printed total', Math.round((bal(after, CBE) - bal(a.state, CBE)) * 100) === 120 && Math.round((bal(base, CBE) - bal(after, CBE)) * 100) === 300120);
  check('the fee entry is untouched (every field)', JSON.stringify(feeAfter) === JSON.stringify(a.fee));
  check('only the amount of the entry changed: date, date source, category, source, note, time, id and account are the same', mainAfter.date === a.main.date && mainAfter.dateSource === a.main.dateSource && mainAfter.category === a.main.category && mainAfter.source === a.main.source && mainAfter.note === a.main.note && mainAfter.timestamp === a.main.timestamp && mainAfter.id === a.main.id && mainAfter.accountId === a.main.accountId && mainAfter.createdAt === a.main.createdAt && mainAfter.type === 'expense');
  check('...no other entry changed (the same objects)', after.entries.filter((e) => e.id !== a.main.id).every((e, i) => e === a.state.entries.filter((x) => x.id !== a.main.id)[i]));
  check('no entry was added or removed', after.entries.length === a.state.entries.length);
  check('after the fix it is not offered again', findFeeCountedTwice(after, [a.suggestion]).length === 0);
  check('the ledger is still valid, and no account went below zero on any day', validateEntries(after.entries, after.accounts) === null);
  check('the plan does not change the ledger it was given', a.state.entries.find((e) => e.id === a.main.id)?.amount === 3001.2);

  check('a fix is refused if the entry no longer matches (edited after the list was shown): nothing changes', codeOf(() => planFeeRepair(editedCat(a), [a.suggestion], [a.main.id], ctx)) === 'INVALID_ENTRY');
  check('...and the same for an id that was never in the list', codeOf(() => planFeeRepair(a.state, [a.suggestion], ['no-such-entry'], ctx)) === 'INVALID_ENTRY');
  check('...and once it is fixed, fixing it again is refused (it cannot be fixed twice)', codeOf(() => planFeeRepair(after, [a.suggestion], [a.main.id], ctx)) === 'INVALID_ENTRY');

  function editedCat(s: Saved): AccountsState {
    minute();
    return planEditEntry(s.state, s.main.id, asExpense(s.main, { category: 'Rent' }), ctx).state;
  }

  // reserved goal money
  const goal = planCreateGoal(a.state, { name: 'Laptop', targetAmount: 30000, heldInAccountId: CBE }, ctx);
  const reserved = planAddToGoal(goal.state, goal.goal.id, 20000, ctx).state;
  const reservedPlan = planFeeRepair(reserved, [a.suggestion], [a.main.id], ctx);
  check('with money reserved for a goal in that account: no goal changes and no notification is made', JSON.stringify(reservedPlan.state.allocations) === JSON.stringify(reserved.allocations) && reservedPlan.state.notifications.length === 0 && JSON.stringify(reservedPlan.state.goals) === JSON.stringify(reserved.goals));
  check('...the reserved amount is the same and the account now has MORE free money', Math.round((bal(reservedPlan.state, CBE) - bal(reserved, CBE)) * 100) === 120);
  // a later entry that depends on the balance stays valid
  const later = planAddEntry(a.state, { type: 'expense', accountId: CBE, amount: 21990, currency: 'ETB', category: 'Rent', date: '2026-11-12' }, ctx).state;
  check('(setup) a later expense that nearly empties the account', bal(later, CBE) < 10 && bal(later, CBE) > 0);
  check('fixing the earlier entry cannot break it: the account is higher on every day after', codeOf(() => planFeeRepair(later, [a.suggestion], [a.main.id], ctx)) === 'none' && validateEntries(planFeeRepair(later, [a.suggestion], [a.main.id], ctx).state.entries, later.accounts) === null);
}

// ======================================================= 3. fix all ====================================================================
console.log('Fix all');
{
  const e1 = savedByEarlierBuild(base, { total: 3001.2, charges: [1, 0.15, 0.05], date: '2026-11-10' });
  const e2 = savedByEarlierBuild(e1.state, { total: 603.61, charges: [0.5, 0.08, 0.03], date: '2026-11-12' });
  const e3 = savedByEarlierBuild(e2.state, { total: 1002.5, charges: [2.5, 0, 0], date: '2026-11-13', accountId: BOA });
  const messages = [e1.suggestion, e2.suggestion, e3.suggestion];
  const items = findFeeCountedTwice(e3.state, messages);
  check('three affected entries in two accounts are all offered', items.length === 3 && items.map((i) => i.newAmount).join() === '3000,603,1000');
  const effect = repairEffect(e3.state, items);
  check('the effect is worked out per account and in total: CBE +1.81, BOA +2.50, 4.31 in all', effect.total === 4.31 && effect.byAccount.find((r) => r.accountId === CBE)?.change === 1.81 && effect.byAccount.find((r) => r.accountId === BOA)?.change === 2.5 && effect.byAccount.find((r) => r.accountId === CBE)?.name === 'CBE');
  minute();
  const plan = planFeeRepair(e3.state, messages, items.map((i) => i.entryId), ctx);
  check('Fix all changes all three amounts and nothing else', plan.fixed.length === 3 && plan.state.entries.length === e3.state.entries.length && [e1, e2, e3].every((s, i) => plan.state.entries.find((e) => e.id === s.main.id)?.amount === [3000, 603, 1000][i]) && [e1, e2, e3].every((s) => JSON.stringify(plan.state.entries.find((e) => e.id === s.fee.id)) === JSON.stringify(s.fee)));
  check('each account goes up by exactly its fees', Math.round((bal(plan.state, CBE) - bal(e3.state, CBE)) * 100) === 181 && Math.round((bal(plan.state, BOA) - bal(e3.state, BOA)) * 100) === 250);
  check('afterwards none is offered', findFeeCountedTwice(plan.state, messages).length === 0);
  check('fixing only some leaves the rest offered', findFeeCountedTwice(planFeeRepair(e3.state, messages, [e1.main.id], ctx).state, messages).length === 2);

  // all or nothing: one of the listed entries stopped matching
  minute();
  const changed = planEditEntry(e3.state, e2.main.id, asExpense(e2.main, { category: 'Rent' }), ctx).state;
  check('if ONE listed entry no longer matches, Fix all changes NOTHING and says why', codeOf(() => planFeeRepair(changed, messages, items.map((i) => i.entryId), ctx)) === 'INVALID_ENTRY' && /Nothing was changed/.test(messageOf(() => planFeeRepair(changed, messages, items.map((i) => i.entryId), ctx))));
  check('...and what is still listed can be fixed on its own', findFeeCountedTwice(changed, messages).length === 2 && planFeeRepair(changed, messages, [e1.main.id, e3.main.id], ctx).fixed.length === 2);
}

// ======================================================= 4. SQLite: one transaction, rollback, restart ====================================
console.log('The database: all or nothing, and it survives a restart');
{
  interface NodeStatement { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown; get(...p: unknown[]): unknown }
  interface NodeDb { exec(sql: string): void; prepare(sql: string): NodeStatement }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => NodeDb };
  const makeDevice = (state: AccountsState, messages: SmsSuggestion[]) => {
    const db = new DatabaseSync(':memory:');
    const run: SqlRunner = { exec: (sql) => db.exec(sql), all: <T,>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as T[], run: (sql, ...p) => { db.prepare(sql).run(...p); } };
    runMigrations(run, 0);
    replaceAccountsData(run, state);
    insertSuggestions(run, messages);
    return { db, run };
  };
  const e1 = savedByEarlierBuild(base, { total: 3001.2, charges: [1, 0.15, 0.05], date: '2026-11-10' });
  const e2 = savedByEarlierBuild(e1.state, { total: 603.61, charges: [0.5, 0.08, 0.03], date: '2026-11-12' });
  const e3 = savedByEarlierBuild(e2.state, { total: 1002.5, charges: [2.5, 0, 0], date: '2026-11-13', accountId: BOA });
  const messages = [e1.suggestion, e2.suggestion, e3.suggestion];
  const { db, run } = makeDevice(e3.state, messages);
  const amountsInDb = () => run.all<{ id: string; amount: number }>('SELECT id, amount FROM transactions ORDER BY id').map((r) => `${r.id}:${r.amount}`).join();

  // restart: read everything back and detect from what the database returns
  const stored = readAccountsData(run);
  const state: AccountsState = { ...e3.state, ...stored };
  const readMessages = readSuggestions(run);
  const found = findFeeCountedTwice(state, readMessages);
  check('after a restart (everything read back from SQLite) the same three entries are offered', found.length === 3 && found.map((i) => i.entryId).sort().join() === [e1.main.id, e2.main.id, e3.main.id].sort().join(), String(found.length));
  check('(a confirmed message is read back exactly as saved, which is what finds them)', readMessages.filter((m) => m.status === 'confirmed').every((m) => m.amount === m.totalDeducted));

  // one transaction for Fix all
  minute();
  const plan = planFeeRepair(state, readMessages, found.map((i) => i.entryId), ctx);
  let begins = 0;
  let commits = 0;
  const counting: SqlRunner = { ...run, exec: (sql) => { if (sql === 'BEGIN') begins += 1; if (sql === 'COMMIT') commits += 1; run.exec(sql); } };
  const before = amountsInDb();

  // a failure on the SECOND entry written: nothing at all is kept
  let writes = 0;
  const failing: SqlRunner = { ...run, run: (sql, ...p) => { if (sql.includes('INTO transactions')) writes += 1; if (sql.includes('INTO transactions') && writes === 2) throw new Error('disk full'); run.run(sql, ...p); } };
  check('a failure while writing the second entry throws', messageOf(() => saveAccountsDiff(failing, state, plan.state)) === 'disk full');
  check('...and NOTHING was kept: every amount in the database is as it was', amountsInDb() === before);
  check('...so the same three entries are still offered', findFeeCountedTwice({ ...state, ...readAccountsData(run) }, readSuggestions(run)).length === 3);

  saveAccountsDiff(counting, state, plan.state);
  check('the retry writes all three in ONE database transaction', begins === 1 && commits === 1, `${begins} begin, ${commits} commit`);
  const afterRestart = { ...state, ...readAccountsData(run) };
  check('after the restart the amounts are the corrected ones and the fee entries are unchanged', [e1, e2, e3].every((s, i) => afterRestart.entries.find((e) => e.id === s.main.id)?.amount === [3000, 603, 1000][i]) && [e1, e2, e3].every((s) => afterRestart.entries.find((e) => e.id === s.fee.id)?.amount === s.fee.amount));
  check('...and nothing is offered any more, after another restart too', findFeeCountedTwice(afterRestart, readSuggestions(run)).length === 0);
  check('the stored message records are untouched by the repair', readSuggestions(run).filter((m) => m.status === 'confirmed').every((m) => m.amount === m.totalDeducted));
  check('balances read back equal the plan: CBE +1.81, BOA +2.50', Math.round((bal(afterRestart, CBE) - bal(e3.state, CBE)) * 100) === 181 && Math.round((bal(afterRestart, BOA) - bal(e3.state, BOA)) * 100) === 250);
}

// ======================================================= 5. hidden balances ===================================================================
console.log('Hidden balances');
{
  const a = savedByEarlierBuild(base, { total: 3001.2, charges: [1, 0.15, 0.05], date: '2026-11-10' });
  const item = findFeeCountedTwice(a.state, [a.suggestion])[0];
  const hidden = repairLine(item, 'CBE', (text) => maskAmount(text, true));
  check('while balances are hidden the row shows no figure at all', !/\d/.test(hidden), hidden);
  check('...but still says what it is about', hidden.includes('your CBE balance goes up by'));
  check('while shown it has the figures', /3,001\.20/.test(repairLine(item, 'CBE', (text) => maskAmount(text, false))));
  check('the fee entry\'s category is the Fees category (what the repair leaves alone)', a.fee.category === FEES_CATEGORY.name);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
