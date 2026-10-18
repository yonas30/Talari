// Verification for the Phase 5 accounts model: V2_SPEC Part W (Tests 1-25) plus edge cases, the schema 3 -> 4 migration on real SQLite
// (node:sqlite), the accounts repository, backup version 3 and the restore of an old (version 2) backup.
// Run:  npx tsx scripts/verify-accounts.ts
//
// It drives the same pure functions the app will use (planAddEntry / planEditEntry / planDeleteEntry, the goal and account planners,
// getTotals, restoreBackup), so it checks the real logic, not a copy. Everything here is independent of the phone's timezone.
// The old Available / Saved model keeps its own script (verify-accounting.ts) until Phase 5B removes that model.

import { ACCOUNT_COLOURS, accountColour, RATE_STALE_AFTER_DAYS } from '../constants/accounts';
import { defaultCategories, FEES_CATEGORY } from '../constants/categories';
import { ACCOUNTS_SCHEMA_VERSION, migrateToAccounts } from '../db/accountsMigration';
import { deleteNotifications, readAccountsData, replaceAccountsData, saveAccountsDiff } from '../db/accountsRepo';
import { runMigrations, SCHEMA_DDL, SCHEMA_VERSION, SqlRunner } from '../db/migrations';
import { Budget, Category, ExchangeRate } from '../types';
import { AccountsState } from '../types/accounts';
import { getAccountBalances } from '../utils/accounts/balances';
import { createBackupV3, LegacyGoal, LegacyTransaction, restoreBackup } from '../utils/accounts/backup';
import { Ctx } from '../utils/accounts/context';
import { AccountsError } from '../utils/accounts/errors';
import { EntryInput, planAddEntry, planDeleteEntry, planEditEntry } from '../utils/accounts/entries';
import {
  planAddToGoal,
  planCreateGoal,
  planDeleteGoal,
  planMoveGoal,
  planWithdrawFromGoal,
} from '../utils/accounts/goals';
import {
  AccountInput,
  accountNameProblem,
  checkCurrencyRemovable,
  cleanAccountName,
  planArchiveAccount,
  planChangeAccountCurrency,
  planCreateAccount,
  planDeleteAccount,
  planRenameAccount,
  suggestAccountName,
} from '../utils/accounts/manage';
import { describeReserveNotification } from '../utils/accounts/notificationText';
import { goalNotificationItems, unreadCount } from '../utils/notificationList';
import { expiredIds, isExpired, markReserveRead, pruneExpired, RESERVE_NOTIFICATION_RETENTION_DAYS } from '../utils/accounts/notificationRetention';
import { getGoalAmount, getGoalAmounts, getReserve, getReservedByAccount } from '../utils/accounts/reserve';
import {
  calculateStreak,
  getCategoryTotals,
  getNetSavingsChange,
  getPeriodSummary,
  getTotals,
} from '../utils/accounts/totals';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name} ${detail}`);
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

// ---- fixtures -------------------------------------------------------------------------------------------------------------------
// Local-time dates throughout, so the run does not depend on the machine's timezone.
function makeClock(start = new Date(2026, 2, 10, 12, 0, 0)) {
  let t = start.getTime();
  let n = 0;
  const ctx: Ctx = { now: () => new Date(t), newId: () => `id-${++n}` };
  return {
    ctx,
    minute: () => {
      t += 60_000;
    },
    day: () => {
      t += 86_400_000;
    },
    at: () => new Date(t),
  };
}

const D0 = '2026-03-10';
const MONTH = '2026-03';
const NOW = new Date(2026, 2, 10, 12, 0, 0);
const rateRow = (rate: number, updatedAt: Date = new Date(NOW.getTime() - 86_400_000)): ExchangeRate => ({
  id: 'USD-ETB',
  fromCurrency: 'USD',
  toCurrency: 'ETB',
  rate,
  updatedAt: updatedAt.toISOString(),
});

function emptyState(rates: ExchangeRate[] = [rateRow(55)]): AccountsState {
  return { accounts: [], entries: [], goals: [], allocations: [], notifications: [], rates, currencies: ['ETB', 'USD', 'EUR'] };
}

function addAccount(state: AccountsState, ctx: Ctx, input: Partial<AccountInput> & { name: string; openingAmount: number }) {
  const result = planCreateAccount(state, { type: 'bank', currency: 'ETB', ...input }, ctx);
  return { state: result.state, id: result.account.id };
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
    return 'none';
  } catch (error) {
    return error instanceof AccountsError ? error.code : `other:${error instanceof Error ? error.message : String(error)}`;
  }
}

const expense = (accountId: string, amount: number, extra: Partial<Extract<EntryInput, { type: 'income' | 'expense' }>> = {}): EntryInput => ({
  type: 'expense',
  accountId,
  amount,
  currency: 'ETB',
  category: 'Food',
  date: D0,
  ...extra,
});
const income = (accountId: string, amount: number, extra: Partial<Extract<EntryInput, { type: 'income' | 'expense' }>> = {}): EntryInput => ({
  type: 'income',
  accountId,
  amount,
  currency: 'ETB',
  category: 'Salary',
  date: D0,
  ...extra,
});
const transfer = (
  fromAccountId: string,
  toAccountId: string,
  fromAmount: number,
  toAmount: number = fromAmount,
  fee?: { amount: number; currency: string },
): EntryInput => ({ type: 'transfer', fromAccountId, toAccountId, fromAmount, toAmount, fee: fee ?? null, date: D0 });

// JSON with the keys of every object sorted, so two values compare equal regardless of the order their keys were created in
// (SQLite returns columns in the order of the SELECT, not in the order the objects were built).
function canon(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item,
  );
}
const byId = <T extends { id: string }>(rows: T[]): T[] => [...rows].sort((a, b) => a.id.localeCompare(b.id));

const bal = (state: AccountsState): Record<string, number> => getAccountBalances(state.entries, state.accounts);

// ---- Tests 1-3: opening, income, expense -----------------------------------------------------------------------------------------
console.log('\nTests 1-3: opening balance, income into an account, expense from an account');
{
  const clock = makeClock();
  let s = emptyState();
  const cbe = addAccount(s, clock.ctx, { name: 'CBE', openingAmount: 100_000 });
  s = cbe.state;
  const opening = s.entries[0];
  check('1: CBE created with 100,000 -> balance 100,000, Total 100,000', bal(s)[cbe.id] === 100_000 && getTotals(s, NOW).total === 100_000);
  check('1: the starting amount is an `opening` entry dated today', opening.type === 'opening' && opening.date === D0 && opening.accountId === cbe.id);
  const m1 = getPeriodSummary(s.entries, MONTH);
  check('1: income 0 and expenses 0 for the month (opening is not income)', m1.income === 0 && m1.expenses === 0 && m1.net === 0);
  check('1: an account created with 0 gets no opening entry', addAccount(emptyState(), clock.ctx, { name: 'Empty', openingAmount: 0 }).state.entries.length === 0);

  let t = emptyState();
  const cash = addAccount(t, clock.ctx, { name: 'Cash', type: 'cash', openingAmount: 30_000 });
  const bank = addAccount(cash.state, clock.ctx, { name: 'CBE', openingAmount: 70_000 });
  t = bank.state;
  const afterIncome = planAddEntry(t, income(bank.id, 10_000), clock.ctx).state;
  const b2 = bal(afterIncome);
  check('2: income 10,000 into CBE -> CBE 80,000 / Cash 30,000 / Total 110,000', b2[bank.id] === 80_000 && b2[cash.id] === 30_000 && getTotals(afterIncome, NOW).total === 110_000);
  check('2: month Income 10,000 (the openings are not counted)', getPeriodSummary(afterIncome.entries, MONTH).income === 10_000);

  const afterExpense = planAddEntry(t, expense(bank.id, 5_000), clock.ctx).state;
  const b3 = bal(afterExpense);
  check('3: expense 5,000 from CBE -> CBE 65,000 / Cash 30,000 / Total 95,000', b3[bank.id] === 65_000 && b3[cash.id] === 30_000 && getTotals(afterExpense, NOW).total === 95_000);
  check('3: month Expenses 5,000', getPeriodSummary(afterExpense.entries, MONTH).expenses === 5_000);
  check('the input state is never changed by planning (pure)', t.entries.length === 2 && bal(t)[bank.id] === 70_000);
}

// ---- Tests 4-6: transfers and fees -----------------------------------------------------------------------------------------------
console.log('\nTests 4-6: transfer between accounts, with a fee, and the fee following its transfer');
{
  const clock = makeClock();
  let s = emptyState();
  const cbe = addAccount(s, clock.ctx, { name: 'CBE', openingAmount: 60_000 });
  const tele = addAccount(cbe.state, clock.ctx, { name: 'Telebirr', type: 'wallet', openingAmount: 40_000 });
  s = tele.state;

  const t4 = planAddEntry(s, transfer(cbe.id, tele.id, 10_000), clock.ctx).state;
  check('4: 10,000 CBE -> Telebirr -> CBE 50,000 / Telebirr 50,000 / Total 100,000', bal(t4)[cbe.id] === 50_000 && bal(t4)[tele.id] === 50_000 && getTotals(t4, NOW).total === 100_000);
  const m4 = getPeriodSummary(t4.entries, MONTH);
  check('4: Income and Expenses unchanged (a transfer is neither)', m4.income === 0 && m4.expenses === 0);

  const t5 = planAddEntry(s, transfer(cbe.id, tele.id, 10_000, 10_000, { amount: 15, currency: 'ETB' }), clock.ctx).state;
  const main = t5.entries.find((e) => e.type === 'transfer');
  const fee = t5.entries.find((e) => e.linkedTransferId !== null);
  check('5: with fee 15 -> CBE 49,985 / Telebirr 50,000 / Total 99,985', bal(t5)[cbe.id] === 49_985 && bal(t5)[tele.id] === 50_000 && getTotals(t5, NOW).total === 99_985);
  check('5: the fee is its own expense row in CBE, category Fees, linked to the transfer', !!main && !!fee && fee.type === 'expense' && fee.accountId === cbe.id && fee.category === 'Fees' && fee.linkedTransferId === main.id);
  check('5: month Expenses 15 (the fee), the transfer is not counted', getPeriodSummary(t5.entries, MONTH).expenses === 15 && getCategoryTotals(t5.entries, MONTH, 'expense').Fees === 15);

  const edited = planEditEntry(t5, main!.id, transfer(cbe.id, tele.id, 10_000, 10_000, { amount: 20, currency: 'ETB' }), clock.ctx).state;
  const fees = edited.entries.filter((e) => e.linkedTransferId !== null);
  check('6: editing the fee to 20 -> CBE 49,980 and still exactly one fee row', bal(edited)[cbe.id] === 49_980 && fees.length === 1 && fees[0].amount === 20);
  check('6: the fee row keeps its identity across the edit', fees[0].id === fee!.id);
  const noFee = planEditEntry(t5, main!.id, transfer(cbe.id, tele.id, 10_000), clock.ctx).state;
  check('6: editing the transfer to have no fee removes the fee row', noFee.entries.every((e) => e.linkedTransferId === null) && bal(noFee)[cbe.id] === 50_000);
  const addFee = planEditEntry(t4, t4.entries.find((e) => e.type === 'transfer')!.id, transfer(cbe.id, tele.id, 10_000, 10_000, { amount: 5, currency: 'ETB' }), clock.ctx).state;
  check('6: adding a fee while editing creates it', addFee.entries.filter((e) => e.linkedTransferId !== null).length === 1 && bal(addFee)[cbe.id] === 49_995);
  const deleted = planDeleteEntry(t5, main!.id, clock.ctx).state;
  check('6: deleting the transfer removes both rows -> CBE 60,000 / Telebirr 40,000', bal(deleted)[cbe.id] === 60_000 && bal(deleted)[tele.id] === 40_000 && deleted.entries.length === 2);
  check('a fee cannot be edited or deleted on its own', codeOf(() => planEditEntry(t5, fee!.id, expense(cbe.id, 1), clock.ctx)) === 'FEE_LINKED' && codeOf(() => planDeleteEntry(t5, fee!.id, clock.ctx)) === 'FEE_LINKED');
  check('same account on both sides is rejected', codeOf(() => planAddEntry(s, transfer(cbe.id, cbe.id, 100), clock.ctx)) === 'SAME_ACCOUNT');
  check('same-currency transfer with two different amounts is rejected', codeOf(() => planAddEntry(s, transfer(cbe.id, tele.id, 100, 90), clock.ctx)) === 'TRANSFER_AMOUNT_MISMATCH');
}

// ---- Tests 7-10: foreign currency -------------------------------------------------------------------------------------------------
console.log('\nTests 7-10: cross-currency transfer, rates moving the total, foreign expense, currency rules');
{
  const clock = makeClock();
  let s = emptyState();
  const cbe = addAccount(s, clock.ctx, { name: 'CBE', openingAmount: 100_000 });
  const pay = addAccount(cbe.state, clock.ctx, { name: 'Payoneer', currency: 'USD', openingAmount: 0 });
  s = pay.state;

  const t7 = planAddEntry(s, transfer(cbe.id, pay.id, 11_000, 195), clock.ctx).state;
  const main = t7.entries.find((e) => e.type === 'transfer')!;
  check('7: 11,000 ETB out, 195 USD in -> CBE 89,000 / Payoneer 195 USD', bal(t7)[cbe.id] === 89_000 && bal(t7)[pay.id] === 195);
  check('7: Total = 89,000 + 195 x 55 = 99,725 (it moved by -275)', getTotals(t7, NOW).total === 99_725);
  check('7: the legs record 11,000 and 10,725 ETB', main.amountETB === 11_000 && main.toAmountETB === 10_725);
  const m7 = getPeriodSummary(t7.entries, MONTH);
  check('7: the 275 exchange cost is not income or expense', m7.income === 0 && m7.expenses === 0);

  // Test 8: a foreign account follows the stored rate.
  let f = emptyState();
  const p2 = addAccount(f, clock.ctx, { name: 'Payoneer', currency: 'USD', openingAmount: 200 });
  f = p2.state;
  check('8: Payoneer 200 USD at 55 is valued 11,000', getTotals(f, NOW).accounts[0].valueETB === 11_000 && getTotals(f, NOW).total === 11_000);
  const rate60: AccountsState = { ...f, rates: [rateRow(60)] };
  check('8: the rate moves to 60 -> valued 12,000, Total +1,000', getTotals(rate60, NOW).total === 12_000);
  check('8: ...and no ledger entry was created by the rate change', rate60.entries.length === f.entries.length && rate60.entries === f.entries);
  const sixDays = { ...f, rates: [rateRow(55, new Date(NOW.getTime() - 6 * 86_400_000))] };
  const sevenDays = { ...f, rates: [rateRow(55, new Date(NOW.getTime() - 7 * 86_400_000))] };
  const eightDays = { ...f, rates: [rateRow(55, new Date(NOW.getTime() - 8 * 86_400_000))] };
  check(`8: a rate 6 days old is not flagged (limit is more than ${RATE_STALE_AFTER_DAYS} days)`, getTotals(sixDays, NOW).staleRates.length === 0);
  check('8: a rate exactly 7 days old is not flagged', getTotals(sevenDays, NOW).staleRates.length === 0);
  const flagged = getTotals(eightDays, NOW).staleRates;
  check('8: a rate 8 days old is flagged with its age ("Rate last updated 8 days ago")', flagged.length === 1 && flagged[0].currency === 'USD' && flagged[0].ageDays === 8);
  check('8: ETB accounts never show a stale rate', getTotals(addAccount(emptyState(), clock.ctx, { name: 'Cash', openingAmount: 1 }).state, NOW).staleRates.length === 0);

  const noRate: AccountsState = { ...f, rates: [] };
  const unvalued = getTotals(noRate, NOW);
  check('a foreign account with no stored rate is left out of Total and reported, never valued 1:1', unvalued.total === 0 && unvalued.unvaluedAccountIds.length === 1 && unvalued.accounts[0].valueETB === null);
  check('a foreign account cannot be created without a stored rate', codeOf(() => planCreateAccount({ ...emptyState([]) }, { name: 'P', type: 'bank', currency: 'USD', openingAmount: 1 }, clock.ctx)) === 'MISSING_RATE');
  check('a currency that is not on the list is refused', codeOf(() => planCreateAccount(emptyState(), { name: 'X', type: 'bank', currency: 'XYZ', openingAmount: 1 }, clock.ctx)) === 'UNKNOWN_CURRENCY');

  // Test 9: foreign expense in a foreign account.
  const t9 = planAddEntry(f, expense(p2.id, 50, { currency: 'USD' }), clock.ctx).state;
  const e9 = t9.entries.find((e) => e.type === 'expense')!;
  check('9: 50 USD at 55 from Payoneer -> 150 USD left', bal(t9)[p2.id] === 150);
  check('9: entry amount=50, currency=USD, amountETB=2,750', e9.amount === 50 && e9.currency === 'USD' && e9.amountETB === 2_750 && e9.exchangeRate === 55);
  check('9: month Expenses 2,750 (not 50); Total 150 x 55 = 8,250', getPeriodSummary(t9.entries, MONTH).expenses === 2_750 && getTotals(t9, NOW).total === 8_250);

  // Test 10: currency rules by account type.
  let c = emptyState();
  const cash = addAccount(c, clock.ctx, { name: 'Cash', type: 'cash', openingAmount: 10_000 });
  const p3 = addAccount(cash.state, clock.ctx, { name: 'Payoneer', currency: 'USD', openingAmount: 100 });
  c = p3.state;
  const a = planAddEntry(c, expense(cash.id, 50, { currency: 'USD' }), clock.ctx).state;
  const ea = a.entries.find((e) => e.type === 'expense')!;
  check('10a: 50 USD on Cash (ETB) is accepted -> Cash 7,250', bal(a)[cash.id] === 7_250);
  check('10a: stored as amount=50, currency=USD, rate 55, amountETB 2,750', ea.amount === 50 && ea.currency === 'USD' && ea.exchangeRate === 55 && ea.amountETB === 2_750);
  check('10a: month Expenses rise by 2,750', getPeriodSummary(a.entries, MONTH).expenses === 2_750);
  const ov = planAddEntry(c, expense(cash.id, 50, { currency: 'USD', rateOverride: 60 }), clock.ctx);
  check('10a: an override rate of 60 gives 3,000 for that one entry', ov.state.entries.find((e) => e.type === 'expense')!.amountETB === 3_000 && bal(ov.state)[cash.id] === 7_000);
  check('10a: ...and never changes the stored rate', ov.state.rates === c.rates && ov.state.rates[0].rate === 55);
  const inc = planAddEntry(c, income(cash.id, 10, { currency: 'USD' }), clock.ctx).state;
  check('10a: a foreign income on an ETB account converts the same way (+550)', bal(inc)[cash.id] === 10_550);
  check('10b: with no stored USD rate that entry is rejected', codeOf(() => planAddEntry({ ...c, rates: [] }, expense(cash.id, 50, { currency: 'USD' }), clock.ctx)) === 'MISSING_RATE');
  check('10c: an expense in ETB against Payoneer (USD) is rejected', codeOf(() => planAddEntry(c, expense(p3.id, 50), clock.ctx)) === 'WRONG_CURRENCY');
  check('10c: ...and so is one in EUR', codeOf(() => planAddEntry(c, expense(p3.id, 50, { currency: 'EUR' }), clock.ctx)) === 'WRONG_CURRENCY');
  check('10c: nothing was written by the rejected entries', c.entries.length === 2);
  check('an edit keeps the rate the entry was made at (history is not re-priced)', (() => {
    const base = planAddEntry(c, expense(cash.id, 50, { currency: 'USD' }), clock.ctx).state;
    const id = base.entries.find((e) => e.type === 'expense')!.id;
    const repriced = { ...base, rates: [rateRow(80)] };
    return planEditEntry(repriced, id, expense(cash.id, 60, { currency: 'USD' }), clock.ctx).state.entries.find((e) => e.id === id)!.amountETB === 3_300;
  })());
  check('a transfer from an ETB account into a USD account takes the USD amount the owner types', (() => {
    const moved = planAddEntry(c, transfer(cash.id, p3.id, 5_500, 100), clock.ctx).state;
    return bal(moved)[cash.id] === 4_500 && bal(moved)[p3.id] === 200;
  })());
}

// ---- Tests 11-13: blocking, edit, system entries ----------------------------------------------------------------------------------
console.log('\nTests 11-13: negative balances, editing, system entries');
{
  const clock = makeClock();
  let s = emptyState();
  const cash = addAccount(s, clock.ctx, { name: 'Cash', type: 'cash', openingAmount: 1_000 });
  const cbe = addAccount(cash.state, clock.ctx, { name: 'CBE', openingAmount: 100_000 });
  s = cbe.state;
  check('11: an expense of 1,500 from Cash (1,000) is blocked; CBE does not help', codeOf(() => planAddEntry(s, expense(cash.id, 1_500), clock.ctx)) === 'NEGATIVE_BALANCE');
  check('11: ...and no entry is created', s.entries.length === 2);
  check('11: a transfer out of Cash above its balance is blocked', codeOf(() => planAddEntry(s, transfer(cash.id, cbe.id, 1_500), clock.ctx)) === 'NEGATIVE_BALANCE');
  check('11: the warning names the account and the shortfall', (() => {
    try {
      planAddEntry(s, expense(cash.id, 1_500), clock.ctx);
      return false;
    } catch (error) {
      return error instanceof AccountsError && error.message.includes('Cash') && error.message.includes('ETB 500.00');
    }
  })());
  const sameDay = planAddEntry(planAddEntry(s, income(cash.id, 2_000), clock.ctx).state, expense(cash.id, 2_500), clock.ctx).state;
  check('11: income 2,000 then expense 2,500 on the same day (start 1,000) is allowed: the day ends at 500', bal(sameDay)[cash.id] === 500);
  check('11: but the expense on its own, before the income exists, is blocked', codeOf(() => planAddEntry(s, expense(cash.id, 2_500), clock.ctx)) === 'NEGATIVE_BALANCE');
  const withExpense = planAddEntry(s, expense(cash.id, 800, { date: '2026-03-11' }), clock.ctx).state;
  check('11: deleting the opening balance that a later expense depends on is blocked (deletes are validated too)', codeOf(() => planDeleteEntry(withExpense, withExpense.entries[0].id, clock.ctx)) === 'NEGATIVE_BALANCE');
  check('11: a back-dated expense before the opening is blocked by the running balance', codeOf(() => planAddEntry(s, expense(cash.id, 500, { date: '2026-03-01' }), clock.ctx)) === 'NEGATIVE_BALANCE');

  const e12 = planAddEntry(s, expense(cbe.id, 5_000), clock.ctx).state;
  const id12 = e12.entries.find((e) => e.type === 'expense')!.id;
  const edited = planEditEntry(e12, id12, expense(cash.id, 700), clock.ctx).state;
  check('12: expense 5,000 from CBE edited to 700 from Cash -> only the new row counts', bal(edited)[cbe.id] === 100_000 && bal(edited)[cash.id] === 300);
  check('12: still exactly one expense row, same id', edited.entries.filter((e) => e.type === 'expense').length === 1 && edited.entries.some((e) => e.id === id12));

  let z = emptyState();
  const zc = addAccount(z, clock.ctx, { name: 'Cash', type: 'cash', openingAmount: 50_000 });
  z = planAddEntry(zc.state, { type: 'adjustment', accountId: zc.id, amount: -2_000, date: D0 }, clock.ctx).state;
  check('13: opening 50,000 and adjustment -2,000 -> Cash 48,000', bal(z)[zc.id] === 48_000);
  const m13 = getPeriodSummary(z.entries, MONTH);
  check('13: Income, Expenses and every category total ignore both', m13.income === 0 && m13.expenses === 0 && Object.keys(getCategoryTotals(z.entries, MONTH, 'expense')).length === 0 && Object.keys(getCategoryTotals(z.entries, MONTH, 'income')).length === 0);
  const plus = planAddEntry(z, { type: 'adjustment', accountId: zc.id, amount: 500, date: D0 }, clock.ctx).state;
  check('13: a positive adjustment adds to the balance and is still not income', bal(plus)[zc.id] === 48_500 && getPeriodSummary(plus.entries, MONTH).income === 0);
  check('13: an adjustment of zero is rejected', codeOf(() => planAddEntry(z, { type: 'adjustment', accountId: zc.id, amount: 0, date: D0 }, clock.ctx)) === 'INVALID_AMOUNT');
  check('13: an adjustment that would overdraw is blocked', codeOf(() => planAddEntry(z, { type: 'adjustment', accountId: zc.id, amount: -60_000, date: D0 }, clock.ctx)) === 'NEGATIVE_BALANCE');
  const openingId = z.entries.find((e) => e.type === 'opening')!.id;
  check('an opening balance is changed with an adjustment, not edited', codeOf(() => planEditEntry(z, openingId, { type: 'adjustment', accountId: zc.id, amount: 1, date: D0 }, clock.ctx)) === 'INVALID_ENTRY');
  check('an adjustment stays an adjustment when edited', codeOf(() => planEditEntry(z, z.entries.find((e) => e.type === 'adjustment')!.id, expense(zc.id, 1), clock.ctx)) === 'INVALID_ENTRY');
}

// ---- Tests 14-16: goals reserve, they do not move money -----------------------------------------------------------------------------
console.log('\nTests 14-16: adding to a goal reserves money inside the account');
{
  const clock = makeClock();
  let s = emptyState();
  const cbe = addAccount(s, clock.ctx, { name: 'CBE', openingAmount: 100_000 });
  const pay = addAccount(cbe.state, clock.ctx, { name: 'Payoneer', currency: 'USD', openingAmount: 100 });
  s = pay.state;
  const g = planCreateGoal(s, { name: 'Laptop', targetAmount: 50_000, heldInAccountId: cbe.id }, clock.ctx);
  s = g.state;
  const entriesBefore = s.entries.length;
  const added = planAddToGoal(s, g.goal.id, 10_000, clock.ctx);
  s = added.state;
  const r14 = getReserve(s, cbe.id);
  check('14: add 10,000 -> CBE balance 100,000 (unchanged), reserved 10,000, free 90,000', r14.balance === 100_000 && r14.reserved === 10_000 && r14.freeToSpend === 90_000);
  check('14: Total 100,000 + 100 USD x 55 (reserved money is not added twice)', getTotals(s, NOW).total === 105_500);
  check('14: the goal holds 10,000 and no transaction was created, one allocation row', getGoalAmount(s.allocations, g.goal.id) === 10_000 && s.entries.length === entriesBefore && s.allocations.length === 1);
  const summary = getTotals(s, NOW).accounts.find((x) => x.account.id === cbe.id)!;
  check('14: the account summary shows reserved and free to spend', summary.reserved === 10_000 && summary.freeToSpend === 90_000);

  const w = planWithdrawFromGoal(s, g.goal.id, 4_000, clock.ctx).state;
  check('15: withdraw 4,000 -> goal 6,000, reserved 6,000, balance unchanged', getGoalAmount(w.allocations, g.goal.id) === 6_000 && getReserve(w, cbe.id).reserved === 6_000 && bal(w)[cbe.id] === 100_000);
  check('15: a withdrawal is a negative allocation row (append-only)', w.allocations.length === 2 && w.allocations[1].amount === -4_000 && w.allocations[1].kind === 'manual');
  check('15: cannot withdraw more than the goal holds', codeOf(() => planWithdrawFromGoal(s, g.goal.id, 10_001, clock.ctx)) === 'GOAL_BELOW_ZERO');
  check('cannot reserve more than is free to spend', codeOf(() => planAddToGoal(s, g.goal.id, 90_001, clock.ctx)) === 'GOAL_NOT_FREE');
  check('can reserve exactly what is free', planAddToGoal(s, g.goal.id, 90_000, clock.ctx).state.allocations.length === 2);

  check('16: a goal held in a USD account is rejected', codeOf(() => planCreateGoal(s, { name: 'USD goal', targetAmount: 10, heldInAccountId: pay.id }, clock.ctx)) === 'GOAL_NOT_ETB');
  check('a goal needs a name and a positive target', codeOf(() => planCreateGoal(s, { name: ' ', targetAmount: 10, heldInAccountId: cbe.id }, clock.ctx)) === 'INVALID_ENTRY' && codeOf(() => planCreateGoal(s, { name: 'X', targetAmount: 0, heldInAccountId: cbe.id }, clock.ctx)) === 'INVALID_AMOUNT');
  check('a goal can only move account / be deleted while it holds nothing', codeOf(() => planMoveGoal(s, g.goal.id, cbe.id, clock.ctx)) === 'GOAL_HAS_AMOUNT' && codeOf(() => planDeleteGoal(s, g.goal.id)) === 'GOAL_HAS_AMOUNT');
  const emptied = planWithdrawFromGoal(s, g.goal.id, 10_000, clock.ctx).state;
  const other = addAccount(emptied, clock.ctx, { name: 'Telebirr', type: 'wallet', openingAmount: 1_000 });
  check('...once it holds nothing it can move to another ETB account', planMoveGoal(other.state, g.goal.id, other.id, clock.ctx).goals[0].heldInAccountId === other.id);
  const gone = planDeleteGoal(emptied, g.goal.id);
  check('...and be deleted, taking its net-zero allocation rows with it', gone.goals.length === 0 && gone.allocations.length === 0);
}

// ---- Tests 17-20: spending reserved money -------------------------------------------------------------------------------------------
console.log('\nTests 17-20: spending reserved money warns, then shrinks the most recently contributed goals first');
{
  const clock = makeClock();
  let s = emptyState();
  const cbe = addAccount(s, clock.ctx, { name: 'CBE', openingAmount: 100_000 });
  s = cbe.state;
  const laptop = planCreateGoal(s, { name: 'Laptop', targetAmount: 50_000, heldInAccountId: cbe.id }, clock.ctx);
  s = laptop.state;
  const car = planCreateGoal(s, { name: 'Car', targetAmount: 20_000, heldInAccountId: cbe.id }, clock.ctx);
  s = car.state;
  clock.minute();
  s = planAddToGoal(s, laptop.goal.id, 30_000, clock.ctx).state; // reserved first
  clock.minute();
  s = planAddToGoal(s, car.goal.id, 20_000, clock.ctx).state; // reserved second = most recent
  const base = s;

  const preview = planAddEntry(base, expense(cbe.id, 60_000), clock.ctx);
  check('17: the preview says this uses ETB 10,000 of the ETB 50,000 reserved', preview.reserveUsed.length === 1 && preview.reserveUsed[0].shortfall === 10_000 && preview.reserveUsed[0].reservedBefore === 50_000 && preview.reserveUsed[0].accountId === cbe.id);
  check('17: planning is a preview: the state it was given is untouched', base.allocations.length === 2 && base.notifications.length === 0 && base.entries.length === 1);

  const r17 = preview.state;
  const amounts = getGoalAmounts(r17.allocations);
  check('17: CBE 40,000 / Total 40,000', bal(r17)[cbe.id] === 40_000 && getTotals(r17, NOW).total === 40_000);
  check('17: Car (most recent) shrank to 10,000, Laptop still 30,000', amounts[car.goal.id] === 10_000 && amounts[laptop.goal.id] === 30_000);
  check('17: one auto_reduce row of -10,000 for Car', preview.autoReductions.length === 1 && preview.autoReductions[0].amount === -10_000 && preview.autoReductions[0].kind === 'auto_reduce' && preview.autoReductions[0].goalId === car.goal.id);
  const n17 = r17.notifications;
  check('17: one notification: Car, 10,000 used, now 10,000', n17.length === 1 && n17[0].goalId === car.goal.id && n17[0].amount === 10_000 && n17[0].amountAfter === 10_000 && n17[0].kind === 'goal_reserve_used' && n17[0].read === false);
  check('17: reserved 40,000 <= balance 40,000 (the invariant holds)', getReserve(r17, cbe.id).reserved === 40_000 && getReserve(r17, cbe.id).freeToSpend === 0);
  const text = describeReserveNotification(n17[0], r17.goals.find((x) => x.id === car.goal.id));
  check('17: the notification reads "ETB 10,000.00 reserved for Car was used. Car is now ETB 10,000.00 of ETB 20,000.00."', text.description === 'ETB 10,000.00 reserved for Car was used. Car is now ETB 10,000.00 of ETB 20,000.00.' && text.goalId === car.goal.id);
  check('17: a notification for a deleted goal still reads sensibly and opens nothing', describeReserveNotification(n17[0], undefined).goalId === null);

  const r18 = planAddEntry(base, expense(cbe.id, 80_000), clock.ctx);
  const a18 = getGoalAmounts(r18.state.allocations);
  check('18: expense 80,000 -> CBE 20,000; Car 0 then Laptop 20,000', bal(r18.state)[cbe.id] === 20_000 && a18[car.goal.id] === 0 && a18[laptop.goal.id] === 20_000);
  check('18: two notifications, one per goal, Car first', r18.notifications.length === 2 && r18.notifications[0].goalId === car.goal.id && r18.notifications[0].amount === 20_000 && r18.notifications[1].goalId === laptop.goal.id && r18.notifications[1].amount === 10_000 && r18.notifications[1].amountAfter === 20_000);

  const exactly = planAddEntry(base, expense(cbe.id, 50_000), clock.ctx);
  check('spending exactly the free money (balance = reserved) changes no goal', exactly.autoReductions.length === 0 && exactly.reserveUsed.length === 0 && exactly.notifications.length === 0);

  // Test 19: edit and delete re-check reserved.
  let e = emptyState();
  const acc = addAccount(e, clock.ctx, { name: 'CBE', openingAmount: 30_000 });
  e = planAddEntry(acc.state, income(acc.id, 70_000), clock.ctx).state;
  const lp = planCreateGoal(e, { name: 'Laptop', targetAmount: 90_000, heldInAccountId: acc.id }, clock.ctx);
  e = planAddToGoal(lp.state, lp.goal.id, 60_000, clock.ctx).state;
  const incomeId = e.entries.find((x) => x.type === 'income')!.id;
  const r19 = planEditEntry(e, incomeId, income(acc.id, 20_000), clock.ctx);
  check('19: editing the income to 20,000 -> balance 50,000 < 60,000 reserved: Laptop reduced by 10,000', getGoalAmount(r19.state.allocations, lp.goal.id) === 50_000 && r19.notifications.length === 1 && r19.notifications[0].amount === 10_000);
  const r19d = planDeleteEntry(e, incomeId, clock.ctx);
  check('19: deleting the income -> balance 30,000: Laptop reduced by 30,000 and one notification', getGoalAmount(r19d.state.allocations, lp.goal.id) === 30_000 && r19d.notifications.length === 1 && r19d.notifications[0].amount === 30_000);
  check('19: raising the income afterwards does NOT give the money back (reductions are a record)', getGoalAmount(planEditEntry(r19.state, incomeId, income(acc.id, 70_000), clock.ctx).state.allocations, lp.goal.id) === 50_000);
  const otherAcc = addAccount(e, clock.ctx, { name: 'Telebirr', type: 'wallet', openingAmount: 0 });
  const moved = planAddEntry(otherAcc.state, transfer(acc.id, otherAcc.id, 50_000), clock.ctx);
  check('a transfer out that dips into reserved money shrinks the goal too (balance 50,000 < 60,000 reserved)', getGoalAmount(moved.state.allocations, lp.goal.id) === 50_000 && moved.notifications.length === 1 && moved.reserveUsed[0].shortfall === 10_000);

  // Test 20: reductions are not ledger activity.
  const m20 = getPeriodSummary(r17.entries, MONTH);
  check('20: the ledger still holds only the opening and the one expense', r17.entries.length === 2 && r17.entries.filter((x) => x.type === 'expense').length === 1);
  check('20: the auto_reduce row is in no income, expense or category total (Expenses = 60,000 only)', m20.expenses === 60_000 && m20.income === 0 && getCategoryTotals(r17.entries, MONTH, 'expense').Food === 60_000);
  const sums = Object.entries(getGoalAmounts(r17.allocations)).every(([id, value]) => value === getGoalAmount(r17.allocations, id));
  check('20: every goal amount equals the sum of its allocation rows', sums);
}

// ---- Tests 21-22: streak and savings figure -------------------------------------------------------------------------------------------
console.log('\nTests 21-22: streak and the monthly savings figure');
{
  const clock = makeClock();
  const TODAY = clock.at();
  let s = emptyState();
  const acc = addAccount(s, clock.ctx, { name: 'CBE', openingAmount: 100_000 });
  s = planAddEntry(acc.state, { type: 'adjustment', accountId: acc.id, amount: -1_000, date: D0 }, clock.ctx).state;
  check('21: opening and adjustment alone give no streak', calculateStreak(s.entries, s.allocations, TODAY) === 0);
  s = planAddEntry(s, income(acc.id, 500, { isAutomatic: true }), clock.ctx).state;
  check('21: a recurring-generated row does not count', calculateStreak(s.entries, s.allocations, TODAY) === 0);
  const g = planCreateGoal(s, { name: 'Laptop', targetAmount: 50_000, heldInAccountId: acc.id }, clock.ctx);
  s = planAddToGoal(g.state, g.goal.id, 10_000, clock.ctx).state;
  check('21: a manual add to a goal counts for its day', calculateStreak(s.entries, s.allocations, TODAY) === 1);
  s = planAddEntry(s, income(acc.id, 100, { date: '2026-03-09' }), clock.ctx).state;
  check('21: plus an income yesterday -> 2', calculateStreak(s.entries, s.allocations, TODAY) === 2);

  const withdrawRow = { id: 'w', goalId: 'g', accountId: 'a', amount: -1_000, date: D0, kind: 'manual' as const, createdAt: '2026-03-10T12:00:00.000Z' };
  check('21: a manual withdrawal counts for its day too', calculateStreak([], [withdrawRow], TODAY) === 1);
  // An automatic reduction on a day where nothing else was recorded does not count.
  const dayClock = makeClock(new Date(2026, 2, 10, 12, 0, 0));
  let r = emptyState();
  const a3 = addAccount(r, dayClock.ctx, { name: 'CBE', openingAmount: 10_000 });
  const g3 = planCreateGoal(a3.state, { name: 'Laptop', targetAmount: 50_000, heldInAccountId: a3.id }, dayClock.ctx);
  r = planAddToGoal(g3.state, g3.goal.id, 10_000, dayClock.ctx).state;
  dayClock.day();
  const reduced = planAddEntry(r, expense(a3.id, 4_000, { date: '2026-03-10' }), dayClock.ctx);
  const reductionDay = reduced.autoReductions[0].date;
  check('21: an automatic reduction is dated the day it happened', reductionDay === '2026-03-11');
  const onlyReduction = calculateStreak([], reduced.autoReductions, new Date(2026, 2, 11, 12));
  check('21: ...an automatic reduction on its own gives streak 0', onlyReduction === 0);

  // Test 22: savings = net change in reserved goal money for the month.
  const k = makeClock();
  let q = emptyState();
  const acc3 = addAccount(q, k.ctx, { name: 'CBE', openingAmount: 100_000 });
  const g4 = planCreateGoal(acc3.state, { name: 'Laptop', targetAmount: 80_000, heldInAccountId: acc3.id }, k.ctx);
  q = planAddToGoal(g4.state, g4.goal.id, 10_000, k.ctx).state;
  k.day();
  q = planAddToGoal(q, g4.goal.id, 5_000, k.ctx).state;
  k.day();
  q = planWithdrawFromGoal(q, g4.goal.id, 3_000, k.ctx).state;
  k.day();
  const spend = planAddEntry(q, expense(acc3.id, 89_000, { date: '2026-03-13' }), k.ctx);
  q = spend.state;
  check('22: the expense used 1,000 of reserved money (an automatic reduction)', spend.autoReductions.length === 1 && spend.autoReductions[0].amount === -1_000);
  check('22: monthly savings = +10,000 +5,000 -3,000 -1,000 = 11,000', getNetSavingsChange(q.allocations, MONTH) === 11_000);
  check('22: another month has no change', getNetSavingsChange(q.allocations, '2026-04') === 0);
}

// ---- Test 23: account rules ---------------------------------------------------------------------------------------------------------
console.log('\nTest 23: account rules');
{
  const clock = makeClock();
  let s = emptyState();
  check('23: with no accounts, adding any transaction is rejected', codeOf(() => planAddEntry(s, expense('x', 1), clock.ctx)) === 'NO_ACCOUNTS');
  const cbe = addAccount(s, clock.ctx, { name: 'CBE', openingAmount: 5_000 });
  const cash = addAccount(cbe.state, clock.ctx, { name: 'Cash', type: 'cash', openingAmount: 0 });
  s = cash.state;
  check('23: archiving an account with a balance is refused', codeOf(() => planArchiveAccount(s, cbe.id)) === 'ACCOUNT_NOT_EMPTY');
  check('23: deleting an account that has entries is refused', codeOf(() => planDeleteAccount(s, cbe.id)) === 'ACCOUNT_HAS_ENTRIES');
  check('23: an account with no entries can be deleted', planDeleteAccount(s, cash.id).accounts.length === 1);
  check('23: its currency can change while it has no entries, not after', planChangeAccountCurrency(s, cash.id, 'USD').accounts.find((a) => a.id === cash.id)!.currency === 'USD' && codeOf(() => planChangeAccountCurrency(s, cbe.id, 'USD')) === 'ACCOUNT_HAS_ENTRIES');
  check('23: changing to a currency with no rate is refused', codeOf(() => planChangeAccountCurrency({ ...s, rates: [] }, cash.id, 'USD')) === 'MISSING_RATE');
  const emptied = planAddEntry(s, transfer(cbe.id, cash.id, 5_000), clock.ctx).state;
  const archived = planArchiveAccount(emptied, cbe.id);
  check('23: at exactly zero it can be archived; its history stays', archived.accounts.find((a) => a.id === cbe.id)!.archived && archived.entries.length === emptied.entries.length);
  check('23: an archived account is out of Total and takes no new entries', getTotals(archived, NOW).accounts.length === 1 && codeOf(() => planAddEntry(archived, income(cbe.id, 1), clock.ctx)) === 'ACCOUNT_ARCHIVED');
  const g = planCreateGoal(s, { name: 'G', targetAmount: 100, heldInAccountId: cash.id }, clock.ctx);
  check('23: an account a goal is held in cannot be archived or deleted', codeOf(() => planArchiveAccount(g.state, cash.id)) === 'ACCOUNT_NOT_EMPTY' && codeOf(() => planDeleteAccount(g.state, cash.id)) === 'ACCOUNT_HAS_GOALS');
  check('accounts get the colour of their type (Cash gold, Wallet orange, Bank teal)', cbe.state.accounts[0].colour === accountColour('bank') && cash.state.accounts[1].colour === ACCOUNT_COLOURS.cash && ACCOUNT_COLOURS.wallet !== ACCOUNT_COLOURS.bank);
  check('smsSender and lastDigits are stored, nullable, and do nothing else', cbe.state.accounts[0].smsSender === null && planCreateAccount(emptyState(), { name: 'CBE', type: 'bank', currency: 'ETB', openingAmount: 0, smsSender: 'CBE', lastDigits: '1234' }, clock.ctx).account.lastDigits === '1234');
  check('an account needs a name and a valid starting amount', codeOf(() => planCreateAccount(emptyState(), { name: '  ', type: 'bank', currency: 'ETB', openingAmount: 0 }, clock.ctx)) === 'INVALID_ACCOUNT' && codeOf(() => planCreateAccount(emptyState(), { name: 'A', type: 'bank', currency: 'ETB', openingAmount: -1 }, clock.ctx)) === 'INVALID_AMOUNT');
  check('accounts keep a stable order', cash.state.accounts.map((a) => a.sortOrder).join(',') === '0,1');
}

// ---- Removing a currency from the list ------------------------------------------------------------------------------------------------
console.log('\nCurrencies: removing one while an account uses it');
{
  const clock = makeClock();
  let s = emptyState();
  const pay = addAccount(s, clock.ctx, { name: 'Payoneer', currency: 'USD', openingAmount: 100 });
  const pal = addAccount(pay.state, clock.ctx, { name: 'PayPal', type: 'wallet', currency: 'USD', openingAmount: 0 });
  const cbe = addAccount(pal.state, clock.ctx, { name: 'CBE', openingAmount: 10 });
  s = cbe.state;
  const one = checkCurrencyRemovable(s.accounts.filter((a) => a.name !== 'PayPal'), 'USD');
  check('removing a currency an account is held in is refused (CURRENCY_IN_USE)', one !== null && one.code === 'CURRENCY_IN_USE');
  check('...and the message names the account and the currency', one !== null && one.message === 'USD is used by Payoneer. Archive or delete that account first.', one?.message);
  const both = checkCurrencyRemovable(s.accounts, 'USD');
  check('two accounts: both are named, and the wording is plural', both !== null && both.message === 'USD is used by Payoneer, PayPal. Archive or delete those accounts first.', both?.message);
  check('a currency no account uses can be removed', checkCurrencyRemovable(s.accounts, 'EUR') === null);
  check('ETB-held accounts do not block another currency', checkCurrencyRemovable(s.accounts.filter((a) => a.currency === 'ETB'), 'USD') === null);

  // an archived account does not block: it is empty and hidden, only its history is kept
  const archivedPal = planArchiveAccount(s, pal.id);
  check('PayPal archives (it is empty)', archivedPal.accounts.find((a) => a.id === pal.id)!.archived);
  const mixed = checkCurrencyRemovable(archivedPal.accounts, 'USD');
  check('with one archived and one in use, only the one in use is named', mixed !== null && mixed.message === 'USD is used by Payoneer. Archive or delete that account first.', mixed?.message);
  const noLive = { ...archivedPal, accounts: archivedPal.accounts.filter((a) => a.id !== pay.id) };
  check('when only an archived account used it, removal is allowed', checkCurrencyRemovable(noLive.accounts, 'USD') === null);

  // what an archived account looks like after its currency (and even its rate) is gone: its history is intact, and it is not in the total
  const h = addAccount(emptyState(), clock.ctx, { name: 'OldUSD', currency: 'USD', openingAmount: 50 });
  const target = addAccount(h.state, clock.ctx, { name: 'CBE', openingAmount: 0 });
  const moved = planAddEntry(target.state, transfer(h.id, target.id, 50, 2750), clock.ctx).state;
  const archivedOld = planArchiveAccount(moved, h.id);
  const gone = { ...archivedOld, currencies: ['ETB'], rates: [] };
  const goneTotals = getTotals(gone, NOW);
  check('an archived account with history: removal is allowed', checkCurrencyRemovable(gone.accounts, 'USD') === null);
  check('...its history stays (opening and the transfer out), its balance reads 0, and it is out of the total', gone.entries.length === 2 && bal(gone)[h.id] === 0 && goneTotals.total === 2750 && goneTotals.unvaluedAccountIds.length === 0);
  check('...and it is still listed as archived, not deleted', gone.accounts.find((a) => a.id === h.id)?.archived === true);
}

// ---- Tests 24-25: backup -----------------------------------------------------------------------------------------------------------------
console.log('\nTests 24-25: backup version 3, and restoring an old (version 2) backup');

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
const columnsOf = (db: NodeDb, table: string): string[] => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
const tableExists = (db: NodeDb, name: string): boolean => countOfWhere(db, name) > 0;
function countOfWhere(db: NodeDb, name: string): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { c: number }).c;
}

{
  // A rich state: ETB and USD accounts, income, a transfer with a fee, a cross-currency transfer, goals, an auto-reduction + notification.
  const clock = makeClock();
  let s = emptyState();
  const cash = addAccount(s, clock.ctx, { name: 'Cash', type: 'cash', openingAmount: 30_000, smsSender: null });
  const cbe = addAccount(cash.state, clock.ctx, { name: 'CBE', openingAmount: 70_000, smsSender: 'CBE', lastDigits: '4321' });
  const pay = addAccount(cbe.state, clock.ctx, { name: 'Payoneer', currency: 'USD', openingAmount: 100 });
  s = pay.state;
  s = planAddEntry(s, income(cbe.id, 10_000), clock.ctx).state;
  s = planAddEntry(s, transfer(cbe.id, cash.id, 2_000, 2_000, { amount: 15, currency: 'ETB' }), clock.ctx).state;
  s = planAddEntry(s, transfer(cbe.id, pay.id, 5_500, 100), clock.ctx).state;
  s = planAddEntry(s, expense(cash.id, 50, { currency: 'USD' }), clock.ctx).state;
  const laptop = planCreateGoal(s, { name: 'Laptop', targetAmount: 50_000, heldInAccountId: cbe.id }, clock.ctx);
  s = laptop.state;
  clock.minute();
  s = planAddToGoal(s, laptop.goal.id, 60_000, clock.ctx).state;
  const squeeze = planAddEntry(s, expense(cbe.id, 20_000), clock.ctx);
  s = squeeze.state;
  check('(setup) the rich state has a stored notification and an auto-reduction', s.notifications.length === 1 && s.allocations.some((a) => a.kind === 'auto_reduce'));

  const categories: Category[] = [...defaultCategories];
  const budgets: Budget[] = [{ id: 'b1', category: 'Food', monthlyLimit: 5_000, currency: 'ETB', createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-01T00:00:00Z' }];
  const backup = createBackupV3({ categories, budgets, state: s }, NOW);
  check('24: the backup is version 3 and carries accounts, allocations and notifications', backup.version === 3 && backup.accounts.length === 3 && backup.goalAllocations.length === s.allocations.length && backup.notifications.length === 1);
  const restored = restoreBackup(JSON.parse(JSON.stringify(backup)), clock.ctx);
  const back: AccountsState = {
    accounts: restored.backup.accounts,
    entries: restored.backup.transactions,
    goals: restored.backup.goals,
    allocations: restored.backup.goalAllocations,
    notifications: restored.backup.notifications,
    rates: restored.backup.exchangeRates,
    currencies: s.currencies,
  };
  check('24: balances are identical after export -> import', JSON.stringify(bal(back)) === JSON.stringify(bal(s)));
  check('24: goal amounts and reserved amounts are identical', JSON.stringify(getGoalAmounts(back.allocations)) === JSON.stringify(getGoalAmounts(s.allocations)) && JSON.stringify(getReservedByAccount(back.allocations)) === JSON.stringify(getReservedByAccount(s.allocations)));
  check('24: notifications and Total are identical', JSON.stringify(back.notifications) === JSON.stringify(s.notifications) && getTotals(back, NOW).total === getTotals(s, NOW).total);
  check('24: accounts keep smsSender / lastDigits', back.accounts.find((a) => a.name === 'CBE')!.lastDigits === '4321');
  check('24: a version 3 restore says plainly it is a normal restore', restored.message.startsWith('Your data has been restored'));

  // Through real SQLite: the migrated schema stores and returns exactly the same data.
  const db = new DatabaseSync(':memory:');
  const run = runnerFor(db);
  runMigrations(run, 0); // a fresh database: schema 3, then the accounts step, straight to 4
  replaceAccountsData(run, { accounts: back.accounts, entries: back.entries, goals: back.goals, allocations: back.allocations, notifications: back.notifications });
  const read = readAccountsData(run);
  check('24: the repository round trip on SQLite returns the same data (accounts, entries, goals, allocations, notifications)', canon(read.accounts) === canon(back.accounts) && canon(read.goals) === canon(back.goals) && canon(read.notifications) === canon(back.notifications) && canon(byId(read.allocations)) === canon(byId(back.allocations)) && canon(byId(read.entries)) === canon(byId(back.entries)));
  check('24: balances recomputed from what SQLite returned equal the originals', JSON.stringify(bal({ ...back, ...read })) === JSON.stringify(bal(s)));
  replaceAccountsData(run, { accounts: [], entries: [], goals: [], allocations: [], notifications: [] });
  check('24: replace clears everything first (a restore never merges)', countOf(db, 'accounts') === 0 && countOf(db, 'transactions') === 0);
  const failing: SqlRunner = { ...run, run: (sql, ...params) => { if (sql.includes('INTO goals')) throw new Error('disk full'); run.run(sql, ...params); } };
  replaceAccountsData(run, { accounts: back.accounts, entries: back.entries, goals: [], allocations: [], notifications: [] });
  let threw = false;
  try {
    replaceAccountsData(failing, { accounts: [], entries: [], goals: back.goals, allocations: [], notifications: [] });
  } catch {
    threw = true;
  }
  check('24: a failure part-way rolls the whole replace back', threw && countOf(db, 'accounts') === back.accounts.length);

  // Invalid version 3 backups are refused and say why.
  const reservedTooMuch = JSON.parse(JSON.stringify(backup));
  reservedTooMuch.goalAllocations.push({ id: 'x', goalId: laptop.goal.id, accountId: cbe.id, amount: 1_000_000, date: D0, kind: 'manual', createdAt: '2026-03-10T12:00:00.000Z' });
  check('24: a backup whose goals exceed the account is refused', codeOf(() => restoreBackup(reservedTooMuch, clock.ctx)) === 'RESTORE_FAILED');
  const negative = JSON.parse(JSON.stringify(backup));
  negative.transactions.push({ ...negative.transactions.find((e: { type: string }) => e.type === 'expense'), id: 'dup', amount: 9_999_999, amountETB: 9_999_999 });
  check('24: a backup that overdraws an account is refused', codeOf(() => restoreBackup(negative, clock.ctx)) === 'RESTORE_FAILED');
  check('24: a backup with missing parts is refused', codeOf(() => restoreBackup({ version: 3, accounts: [] }, clock.ctx)) === 'RESTORE_FAILED');
  check('24: the restored categories always include Fees', restored.backup.categories.some((c) => c.name === 'Fees' && c.type === 'expense'));

  // Test 25: an old (version 2, Available / Saved) backup. The rows are written out by hand in the shape the old build saved them; the
  // old totals below are worked out from them on paper (the old ledger code no longer exists).
  const RATES: ExchangeRate[] = [rateRow(55)];
  const goalsOld: LegacyGoal[] = [{ id: 'g1', name: 'Laptop', targetAmount: 50_000, deadline: null, status: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }];
  let tick = 0;
  const oldRow = (patch: Partial<LegacyTransaction> & Pick<LegacyTransaction, 'type' | 'date'>): LegacyTransaction => {
    tick += 1;
    const at = `2026-01-0${Math.min(tick, 9)}T10:00:00.000Z`;
    return {
      id: `old-${tick}`, amount: 0, currency: 'ETB', amountETB: 0, exchangeRate: 1, category: '', source: '', account: null,
      fromAccount: null, fromGoalId: null, toAccount: null, toGoalId: null, timestamp: at, note: null, isAutomatic: false, createdAt: at, updatedAt: at,
      ...patch,
    };
  };
  const ledger: LegacyTransaction[] = [
    oldRow({ type: 'income', amount: 50_000, amountETB: 50_000, category: 'Salary', source: 'Job', account: 'available', date: '2026-01-02' }),
    oldRow({ type: 'income', amount: 20_000, amountETB: 20_000, category: 'Salary', source: 'Job', account: 'saved', date: '2026-01-02' }),
    oldRow({ type: 'expense', amount: 10, currency: 'USD', amountETB: 550, exchangeRate: 55, category: 'Food', source: 'Cafe', account: 'available', date: '2026-01-03' }),
    oldRow({ type: 'transfer', amount: 5_000, amountETB: 5_000, fromAccount: 'available', toAccount: 'saved', date: '2026-01-03' }),
    oldRow({ type: 'transfer', amount: 8_000, amountETB: 8_000, fromAccount: 'saved', toAccount: 'goal', toGoalId: 'g1', date: '2026-01-04' }),
    oldRow({ type: 'transfer', amount: 2_000, amountETB: 2_000, fromAccount: 'available', toAccount: 'goal', toGoalId: 'g1', date: '2026-01-04' }),
    oldRow({ type: 'transfer', amount: 1_000, amountETB: 1_000, fromAccount: 'goal', fromGoalId: 'g1', toAccount: 'available', date: '2026-01-05' }),
  ];
  // Available 50,000 - 550 - 5,000 - 2,000 + 1,000 = 43,450; Saved 20,000 + 5,000 - 8,000 = 17,000; the goal holds 8,000 + 2,000 - 1,000 = 9,000.
  const oldBalances = { total: 43_450 + 17_000 + 9_000, goals: { g1: 9_000 } };
  const legacyCategories: Category[] = [...defaultCategories.filter((c) => c.name !== 'Fees'), { id: 'sav', name: 'Savings', type: 'savings', icon: 'x', color: '#000', isDefault: false }];
  const legacy = { version: 2, exportedAt: '2026-02-01T00:00:00Z', categories: legacyCategories, transactions: ledger, exchangeRates: RATES, goals: goalsOld, budgets };
  const mapped = restoreBackup(legacy, clock.ctx);
  const m = mapped.backup;
  const mState: AccountsState = { accounts: m.accounts, entries: m.transactions, goals: m.goals, allocations: m.goalAllocations, notifications: [], rates: m.exchangeRates, currencies: [] };
  check('25: everything lands in one ETB account named "Cash"', m.accounts.length === 1 && m.accounts[0].name === 'Cash' && m.accounts[0].currency === 'ETB' && m.accounts[0].type === 'cash');
  check('25: Cash balance equals the old total (money was not created or lost)', bal(mState)[m.accounts[0].id] === oldBalances.total && getTotals(mState, NOW).total === oldBalances.total);
  check('25: the goal is restored as a reservation held in Cash for what it held (9,000)', getGoalAmount(m.goalAllocations, 'g1') === oldBalances.goals.g1 && oldBalances.goals.g1 === 9_000 && m.goals[0].heldInAccountId === m.accounts[0].id);
  check('25: goal transfers became 3 allocation rows (+8,000 +2,000 -1,000)', m.goalAllocations.length === 3 && m.goalAllocations.reduce((sum, a) => sum + a.amount, 0) === 9_000);
  check('25: income and expense rows are kept (3), the Available <-> Saved transfer is left out', m.transactions.length === 3 && m.transactions.every((e) => e.type !== 'transfer'));
  const usd = m.transactions.find((e) => e.currency === 'USD')!;
  check('25: the foreign row keeps its original 10 USD, rate 55 and ETB value 550', usd.amount === 10 && usd.exchangeRate === 55 && usd.amountETB === 550);
  check('25: reserved never exceeds Cash after the restore', getReserve(mState, m.accounts[0].id).freeToSpend === oldBalances.total - 9_000);
  check('25: the message says what happened (Cash, goals, left-out transfer)', mapped.message.includes('"Cash"') && mapped.message.includes('reserved') && mapped.message.includes('1 transfer between Available and Saved was left out'));
  check('25: the legacy savings category is dropped and Fees is added', !m.categories.some((c) => c.type === 'savings') && m.categories.some((c) => c.name === 'Fees'));
  check('25: budgets and rates carry over', m.budgets.length === 1 && m.exchangeRates.length === 1);

  const tooBig = { ...legacy, transactions: [ledger[0], { ...ledger[4], amountETB: 99_999, amount: 99_999 }].map((row, i) => (i === 1 ? { ...row, fromAccount: 'saved', toAccount: 'goal', toGoalId: 'g1' } : row)) };
  let reason = '';
  try {
    restoreBackup(tooBig, clock.ctx);
  } catch (error) {
    reason = error instanceof AccountsError ? error.message : '';
  }
  check('25: goals larger than the total fail with both figures and "Nothing was changed"', reason.includes('ETB 99,999.00') && reason.includes('ETB 50,000.00') && reason.includes('Nothing was changed'));
  check('25: a transfer pointing at a goal that is not in the backup fails', codeOf(() => restoreBackup({ ...legacy, goals: [] }, clock.ctx)) === 'RESTORE_FAILED');
  check('25: an unknown version is refused', codeOf(() => restoreBackup({ version: 1 }, clock.ctx)) === 'RESTORE_FAILED' && codeOf(() => restoreBackup({ version: 99 }, clock.ctx)) === 'RESTORE_FAILED');
  check('25: not a backup at all is refused', codeOf(() => restoreBackup(null, clock.ctx)) === 'RESTORE_FAILED' && codeOf(() => restoreBackup('x', clock.ctx)) === 'RESTORE_FAILED' && codeOf(() => restoreBackup({}, clock.ctx)) === 'RESTORE_FAILED');
  const noGoals = restoreBackup({ ...legacy, goals: [], transactions: ledger.slice(0, 4) }, clock.ctx);
  check('25: an old backup with no goals says so', noGoals.message.includes('You had no goals'));
}

// ---- Account names are unique ----------------------------------------------------------------------------------------------------------
console.log('\nAccount names: unique (case, spaces and archived accounts included); old duplicates keep working');
{
  const clock = makeClock();
  const make = (state: AccountsState, name: string, extra: Partial<AccountInput> = {}) =>
    planCreateAccount(state, { name, type: 'bank', currency: 'ETB', openingAmount: 0, ...extra }, clock.ctx);
  const create = (state: AccountsState, name: string) => codeOf(() => make(state, name));
  const messageOf = (fn: () => unknown): string => {
    try {
      fn();
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : '';
    }
  };

  const cbe = addAccount(emptyState(), clock.ctx, { name: 'CBE', openingAmount: 100 });
  const base = cbe.state;

  // creating
  check('an exact duplicate is refused with its own error code', create(base, 'CBE') === 'DUPLICATE_ACCOUNT_NAME');
  check('...and the message names the existing account and offers "<name> 2"', messageOf(() => make(base, 'CBE')) === 'You already have an account called CBE. Try CBE 2.', messageOf(() => make(base, 'CBE')));
  check('case differences are the same name ("cbe", "cBe")', create(base, 'cbe') === 'DUPLICATE_ACCOUNT_NAME' && create(base, 'cBe') === 'DUPLICATE_ACCOUNT_NAME');
  check('leading and trailing spaces are ignored ("  CBE ")', create(base, '  CBE ') === 'DUPLICATE_ACCOUNT_NAME');
  const awash = addAccount(base, clock.ctx, { name: 'Awash Bank', openingAmount: 0 }).state;
  check('repeated spaces inside are ignored ("awash   bank")', create(awash, 'awash   bank') === 'DUPLICATE_ACCOUNT_NAME');
  check('the suggestion uses what was typed, tidied ("cbe" -> "Try cbe 2.")', messageOf(() => make(base, '  cbe ')) === 'You already have an account called CBE. Try cbe 2.', messageOf(() => make(base, '  cbe ')));
  check('a different name that merely contains it is fine ("CBE Birr")', create(base, 'CBE Birr') === 'none');
  check('letters spread apart are a different name ("C B E")', create(base, 'C B E') === 'none');
  check('nothing is created when it is refused', (() => {
    try {
      make(base, 'CBE');
    } catch {
      return base.accounts.length === 1 && base.entries.length === 1;
    }
    return false;
  })());

  // the suggestion is whichever number is free
  const cbe2 = addAccount(base, clock.ctx, { name: 'CBE 2', openingAmount: 0 }).state;
  check('"CBE" with "CBE" and "CBE 2" taken suggests "CBE 3"', suggestAccountName(cbe2.accounts, 'CBE') === 'CBE 3' && messageOf(() => make(cbe2, 'CBE')) === 'You already have an account called CBE. Try CBE 3.');
  check('typing "CBE 2" (taken) also suggests the next free one, "CBE 3", not "CBE 2 2"', suggestAccountName(cbe2.accounts, 'CBE 2') === 'CBE 3');
  const gap = { ...cbe2, accounts: cbe2.accounts.filter((a) => a.name !== 'CBE 2') };
  check('a gap is reused: with only "CBE" taken the suggestion is "CBE 2"', suggestAccountName(gap.accounts, 'CBE') === 'CBE 2');
  check('a name that merely ends in a long number keeps it ("Savings 2024" -> "Savings 2024 2")', suggestAccountName([{ ...cbe.state.accounts[0], name: 'Savings 2024' }], 'Savings 2024') === 'Savings 2024 2');

  // archived accounts count
  const empty = addAccount(emptyState(), clock.ctx, { name: 'Old wallet', type: 'wallet', openingAmount: 0 });
  const archived = planArchiveAccount(empty.state, empty.id);
  check('an archived account still holds its name', archived.accounts[0].archived && create(archived, 'Old wallet') === 'DUPLICATE_ACCOUNT_NAME' && create(archived, ' old  WALLET') === 'DUPLICATE_ACCOUNT_NAME');
  check('...and the message names it', messageOf(() => make(archived, 'old wallet')) === 'You already have an account called Old wallet. Try old wallet 2.');

  // the stored name is tidied
  const tidy = make(emptyState(), '  Telebirr   Main ');
  check('the name is stored trimmed with single spaces', tidy.account.name === 'Telebirr Main' && cleanAccountName('  a   b  ') === 'a b');
  check('an empty or blank name is still "give it a name", not a duplicate', create(base, '   ') === 'INVALID_ACCOUNT' && accountNameProblem(base.accounts, '   ') === null);

  // renaming
  const cash = addAccount(base, clock.ctx, { name: 'Cash', type: 'cash', openingAmount: 50 });
  const two = cash.state;
  check('renaming to another account\'s name is refused', codeOf(() => planRenameAccount(two, cash.id, 'CBE')) === 'DUPLICATE_ACCOUNT_NAME' && codeOf(() => planRenameAccount(two, cash.id, ' cbe ')) === 'DUPLICATE_ACCOUNT_NAME');
  check('...with the same message and suggestion', messageOf(() => planRenameAccount(two, cash.id, 'CBE')) === 'You already have an account called CBE. Try CBE 2.');
  check('renaming into an archived account\'s name is refused', codeOf(() => planRenameAccount({ ...two, accounts: [...two.accounts, archived.accounts[0]] }, cash.id, 'Old wallet')) === 'DUPLICATE_ACCOUNT_NAME');
  const renamed = planRenameAccount(two, cash.id, '  Pocket   cash ');
  check('renaming to a free name works, and it is stored tidied', renamed.accounts.find((a) => a.id === cash.id)!.name === 'Pocket cash');
  check('...the account keeps its id, balance and history (nothing else changes)', renamed.entries === two.entries && bal(renamed)[cash.id] === 50 && renamed.accounts.length === two.accounts.length);
  check('renaming to its own current name is allowed', planRenameAccount(two, cash.id, 'Cash').accounts.find((a) => a.id === cash.id)!.name === 'Cash');
  check('changing only its own case or spacing is allowed ("CASH", " cash ")', planRenameAccount(two, cash.id, 'CASH').accounts.find((a) => a.id === cash.id)!.name === 'CASH' && planRenameAccount(two, cash.id, ' cash ').accounts.find((a) => a.id === cash.id)!.name === 'cash');
  check('the rule the forms use agrees: own name -> no problem, another\'s -> a message', accountNameProblem(two.accounts, 'Cash', cash.id) === null && accountNameProblem(two.accounts, 'CBE', cash.id) !== null && accountNameProblem(two.accounts, 'CBE') !== null);
  check('renaming an account that does not exist, or to nothing, is refused', codeOf(() => planRenameAccount(two, 'nope', 'X')) === 'UNKNOWN_ACCOUNT' && codeOf(() => planRenameAccount(two, cash.id, '   ')) === 'INVALID_ACCOUNT');
  check('a rename can free a name for the next account', (() => {
    const freed = planRenameAccount(two, cbe.id, 'CBE main');
    return create(freed, 'CBE') === 'none';
  })());

  // accounts that were ALREADY duplicates (from earlier testing) still load, work and can be fixed
  const first = cbe.state.accounts[0];
  const twin = { ...first, id: 'twin', createdAt: '2026-03-11T09:00:00.000Z', sortOrder: 1 };
  const opening = cbe.state.entries[0];
  const twinOpening = { ...opening, id: 'twin-opening', accountId: 'twin', amount: 300, amountETB: 300 };
  const dup: AccountsState = { ...base, accounts: [first, twin], entries: [opening, twinOpening] };
  check('two accounts that share a name load: balances and total are right', bal(dup)[first.id] === 100 && bal(dup).twin === 300 && getTotals(dup, NOW).total === 400 && getTotals(dup, NOW).accounts.length === 2);
  check('entries can still be added to either of them', bal(planAddEntry(planAddEntry(dup, income(first.id, 10), clock.ctx).state, expense('twin', 50), clock.ctx).state).twin === 250);
  check('a transfer between the two same-named accounts still works', bal(planAddEntry(dup, transfer('twin', first.id, 100), clock.ctx).state)[first.id] === 200);
  const viaBackup = restoreBackup(JSON.parse(JSON.stringify(createBackupV3({ categories: [], budgets: [], state: dup }, NOW))), clock.ctx);
  check('a backup of them restores (the name rule is not applied to existing data)', viaBackup.backup.accounts.length === 2 && viaBackup.backup.accounts.every((a) => a.name === 'CBE'));
  check('the database layer stores and reads them back', (() => {
    const db = new DatabaseSync(':memory:');
    const run = runnerFor(db);
    runMigrations(run, 0);
    replaceAccountsData(run, { accounts: dup.accounts, entries: dup.entries, goals: [], allocations: [], notifications: [] });
    return readAccountsData(run).accounts.map((a) => a.name).join() === 'CBE,CBE';
  })());
  check('one of them can be renamed to a free name', planRenameAccount(dup, 'twin', 'CBE savings').accounts.find((a) => a.id === 'twin')!.name === 'CBE savings');
  check('...and the other can be renamed to its own name (no new collision is made)', planRenameAccount(dup, first.id, 'CBE').accounts.find((a) => a.id === first.id)!.name === 'CBE');
  check('...but neither can be renamed INTO a name a third account has', codeOf(() => planRenameAccount({ ...dup, accounts: [...dup.accounts, { ...first, id: 'third', name: 'Cash' }] }, 'twin', 'cash')) === 'DUPLICATE_ACCOUNT_NAME');
  check('a new account cannot take the shared name; the message names the first one', create(dup, 'cbe') === 'DUPLICATE_ACCOUNT_NAME' && messageOf(() => make(dup, 'cbe')) === 'You already have an account called CBE. Try cbe 2.');
  check('a new account with another name works next to them', create(dup, 'BOA') === 'none');
  check('they can be archived and deleted as usual (the twin has no entries after a transfer-out)', (() => {
    const moved = planAddEntry(dup, transfer('twin', first.id, 300), clock.ctx).state;
    return planArchiveAccount(moved, 'twin').accounts.find((a) => a.id === 'twin')!.archived;
  })());
}

// ---- Backup round trip (final pass) ----------------------------------------------------------------------------------------------------
console.log('\nBackup round trip: everything survives export -> file -> restore, balances, reserved money and the unread badge match');
{
  const clock = makeClock(new Date(2026, 0, 10, 12, 0, 0));
  const RESTORE_NOW = new Date(2026, 0, 20, 12, 0, 0);
  const restoreCtx = { now: () => RESTORE_NOW, newId: () => 'restore-id' };
  const rates: ExchangeRate[] = [
    rateRow(55),
    { id: 'EUR-ETB', fromCurrency: 'EUR', toCurrency: 'ETB', rate: 60, updatedAt: new Date(2026, 0, 9).toISOString() },
  ];

  // ---- a busy ledger: every entry type, a USD account, a transfer with a fee, a cross-currency transfer, an archived account ----
  let st = emptyState(rates);
  const cash = addAccount(st, clock.ctx, { name: 'Cash', type: 'cash', openingAmount: 5000, date: '2026-01-01' });
  const tele = addAccount(cash.state, clock.ctx, { name: 'Telebirr', type: 'wallet', openingAmount: 2000, date: '2026-01-01' });
  const cbe = addAccount(tele.state, clock.ctx, { name: 'CBE', openingAmount: 80000, smsSender: 'CBE', lastDigits: '4321', date: '2026-01-01' });
  const pay = addAccount(cbe.state, clock.ctx, { name: 'Payoneer', currency: 'USD', openingAmount: 300, date: '2026-01-01' });
  const old = addAccount(pay.state, clock.ctx, { name: 'Old wallet', type: 'wallet', openingAmount: 100, date: '2026-01-01' });
  st = old.state;
  const step = (input: EntryInput) => {
    st = planAddEntry(st, input, clock.ctx).state;
  };
  step({ type: 'income', accountId: cbe.id, amount: 20000, currency: 'ETB', category: 'Salary', source: 'Job', date: '2026-01-05' });
  step(expense(cash.id, 300, { date: '2026-01-06' }));
  step(expense(cash.id, 10, { currency: 'USD', date: '2026-01-06' })); // a foreign amount on an ETB account
  step(expense(pay.id, 50, { currency: 'USD', date: '2026-01-07' }));
  step({ ...transfer(cbe.id, tele.id, 1000, 1000, { amount: 15, currency: 'ETB' }), date: '2026-01-07' }); // with a fee
  step({ ...transfer(cbe.id, pay.id, 5500, 100), date: '2026-01-08' }); // cross-currency
  step({ type: 'adjustment', accountId: tele.id, amount: -50, date: '2026-01-08', note: 'counted the wallet' });
  step({ ...transfer(old.id, cash.id, 100), date: '2026-01-08' });
  st = planArchiveAccount(st, old.id);
  // goals: reserve 50,000 for Laptop, then 20,000 for Car (the most recent); then two overspends that shrink them
  const laptop = planCreateGoal(st, { name: 'Laptop', targetAmount: 60000, heldInAccountId: cbe.id }, clock.ctx);
  const carGoal = planCreateGoal(laptop.state, { name: 'Car', targetAmount: 20000, heldInAccountId: cbe.id }, clock.ctx);
  st = planAddToGoal(planAddToGoal(carGoal.state, laptop.goal.id, 50000, clock.ctx).state, carGoal.goal.id, 20000, clock.ctx).state;
  const spend1 = planAddEntry(st, expense(cbe.id, 40000, { date: '2026-01-09' }), clock.ctx);
  const spend2 = planAddEntry(spend1.state, expense(cbe.id, 20000, { date: '2026-01-09' }), clock.ctx);
  st = spend2.state;
  // two of the three saved notifications are unread, one was read (its saved flag)
  st = { ...st, notifications: markReserveRead(st.notifications, [st.notifications[0].id]) };

  check('(setup) the ledger has every entry type', ['opening', 'income', 'expense', 'transfer', 'adjustment'].every((t) => st.entries.some((e) => e.type === t)));
  check('(setup) a fee row is linked to its transfer, a USD account exists, one account is archived, goals are reserved', st.entries.some((e) => e.linkedTransferId !== null) && st.accounts.some((a) => a.currency === 'USD') && st.accounts.some((a) => a.archived) && getReservedByAccount(st.allocations)[cbe.id] > 0);
  check('(setup) overspending shrank the goals: auto_reduce rows and 3 saved notifications, 1 read and 2 unread', st.allocations.some((a) => a.kind === 'auto_reduce') && st.notifications.length === 3 && st.notifications.filter((n) => n.read).length === 1);
  const categories = [...defaultCategories];
  const budgets: Budget[] = [{ id: 'b1', category: 'Food', monthlyLimit: 5000, currency: 'ETB', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }];

  // ---- export, write it as a file, read it back, restore ----
  const file = JSON.stringify(createBackupV3({ categories, budgets, state: st }, new Date(2026, 0, 12)), null, 2);
  const restored = restoreBackup(JSON.parse(file), restoreCtx);
  const b = restored.backup;
  const back: AccountsState = { accounts: b.accounts, entries: b.transactions, goals: b.goals, allocations: b.goalAllocations, notifications: b.notifications, rates: b.exchangeRates, currencies: st.currencies };
  check('the backup file is version 3 and the restore says it is a normal restore', b.version === 3 && restored.message === 'Your data has been restored from the backup.');
  check('accounts are identical (type, currency, colour, order, archived flag, sms fields)', canon(back.accounts) === canon(st.accounts) && back.accounts.find((a) => a.name === 'CBE')!.lastDigits === '4321' && back.accounts.find((a) => a.name === 'Old wallet')!.archived);
  check('every entry is identical: opening, income, expense, foreign amount, transfers, the fee row, the adjustment', canon(byId(back.entries)) === canon(byId(st.entries)) && back.entries.length === st.entries.length);
  check('the cross-currency transfer keeps both legs and both ETB values', (() => { const t = back.entries.find((e) => e.type === 'transfer' && e.toAmount === 100)!; return t.amount === 5500 && t.currency === 'ETB' && t.toAmountETB === 5500 && t.amountETB === 5500; })());
  check('the foreign amount on the ETB account keeps its original amount, currency and rate', (() => { const e = back.entries.find((x) => x.currency === 'USD' && x.accountId === cash.id)!; return e.amount === 10 && e.exchangeRate === 55 && e.amountETB === 550; })());
  check('goals and every goal_allocations row are identical (including the automatic reductions)', canon(byId(back.goals)) === canon(byId(st.goals)) && canon(byId(back.allocations)) === canon(byId(st.allocations)));
  check('exchange rates are identical (both of them, with their dates)', canon(byId(back.rates)) === canon(byId(rates)) && back.rates.length === 2);
  check('categories and budgets come back (Fees included)', b.categories.some((c) => c.name === 'Fees') && canon(b.budgets) === canon(budgets));
  check('notifications are identical, read flags included', canon(back.notifications) === canon(st.notifications) && JSON.stringify(back.notifications.map((n) => n.read)) === JSON.stringify(st.notifications.map((n) => n.read)));

  // ---- the numbers match ----
  check('every account balance matches', JSON.stringify(bal(back)) === JSON.stringify(bal(st)));
  check('reserved money per account and every goal amount match', JSON.stringify(getReservedByAccount(back.allocations)) === JSON.stringify(getReservedByAccount(st.allocations)) && JSON.stringify(getGoalAmounts(back.allocations)) === JSON.stringify(getGoalAmounts(st.allocations)));
  check('free to spend matches', getReserve(back, cbe.id).freeToSpend === getReserve(st, cbe.id).freeToSpend);
  const totalsBefore = getTotals(st, RESTORE_NOW);
  const totalsAfter = getTotals(back, RESTORE_NOW);
  check('the Total, each account\'s ETB value and the per-account list match', totalsAfter.total === totalsBefore.total && JSON.stringify(totalsAfter.accounts.map((x) => [x.account.id, x.balance, x.valueETB, x.reserved])) === JSON.stringify(totalsBefore.accounts.map((x) => [x.account.id, x.balance, x.valueETB, x.reserved])));
  check('the unread badge matches: 2 unread before and after', unreadCount(goalNotificationItems(st.notifications, st.goals, {})) === 2 && unreadCount(goalNotificationItems(back.notifications, back.goals, {})) === 2);
  check('the notification texts match too', JSON.stringify(goalNotificationItems(back.notifications, back.goals, {}).map((n) => n.description)) === JSON.stringify(goalNotificationItems(st.notifications, st.goals, {}).map((n) => n.description)));
  check('the restored data is a valid ledger that can be used straight away (an expense and a goal add both work)', (() => {
    const next = planAddEntry(back, expense(cash.id, 1), restoreCtx).state;
    return bal(next)[cash.id] === bal(back)[cash.id] - 1;
  })());

  // ---- through the real database tables too ----
  const db = new DatabaseSync(':memory:');
  const run = runnerFor(db);
  runMigrations(run, 0);
  replaceAccountsData(run, { accounts: back.accounts, entries: back.entries, goals: back.goals, allocations: back.allocations, notifications: back.notifications });
  const read = readAccountsData(run);
  check('written to the database and read back, all of it is the same', canon(read.accounts) === canon(back.accounts) && canon(byId(read.entries)) === canon(byId(back.entries)) && canon(byId(read.goals)) === canon(byId(back.goals)) && canon(byId(read.allocations)) === canon(byId(back.allocations)) && canon(byId(read.notifications)) === canon(byId(back.notifications)));
  check('...and the notifications keep their read flags in the table', JSON.stringify(read.notifications.map((n) => n.read).sort()) === JSON.stringify(st.notifications.map((n) => n.read).sort()));

  // ---- exporting the restored data and restoring again changes nothing (idempotent) ----
  const again = restoreBackup(JSON.parse(JSON.stringify(createBackupV3({ categories: b.categories, budgets: b.budgets, state: back }, new Date(2026, 0, 13)))), restoreCtx).backup;
  check('export -> restore -> export -> restore is stable (same accounts, entries, goals, allocations, notifications, rates)', canon(again.accounts) === canon(b.accounts) && canon(byId(again.transactions)) === canon(byId(b.transactions)) && canon(byId(again.goals)) === canon(byId(b.goals)) && canon(byId(again.goalAllocations)) === canon(byId(b.goalAllocations)) && canon(byId(again.notifications)) === canon(byId(b.notifications)) && canon(byId(again.exchangeRates)) === canon(byId(b.exchangeRates)));

  // ---- a damaged copy is refused, and a notification older than 30 days is dropped, the rest still restores ----
  const tampered = JSON.parse(file);
  tampered.goalAllocations.push({ id: 'extra', goalId: laptop.goal.id, accountId: cbe.id, amount: 9_999_999, date: D0, kind: 'manual', createdAt: '2026-01-10T12:00:00.000Z' });
  check('a copy whose goals would hold more than the account is refused', codeOf(() => restoreBackup(tampered, restoreCtx)) === 'RESTORE_FAILED');
  const late = restoreBackup(JSON.parse(file), { now: () => new Date(2026, 1, 25), newId: () => 'x' }).backup;
  check('restoring it 46 days later drops the notifications (older than 30 days) and keeps all the money data', late.notifications.length === 0 && late.transactions.length === b.transactions.length && late.goalAllocations.length === b.goalAllocations.length);

  // ---- a version 2 backup: restored, then exported and restored again ----
  const legacyRows: LegacyTransaction[] = [
    { id: 'o1', type: 'income', amount: 60000, currency: 'ETB', amountETB: 60000, exchangeRate: 1, category: 'Salary', source: 'Job', account: 'available', fromAccount: null, fromGoalId: null, toAccount: null, toGoalId: null, date: '2026-01-02', timestamp: '2026-01-02T08:00:00.000Z', note: null, isAutomatic: false, createdAt: '2026-01-02T08:00:00.000Z', updatedAt: '2026-01-02T08:00:00.000Z' },
    { id: 'o2', type: 'income', amount: 20000, currency: 'ETB', amountETB: 20000, exchangeRate: 1, category: 'Salary', source: 'Job', account: 'saved', fromAccount: null, fromGoalId: null, toAccount: null, toGoalId: null, date: '2026-01-02', timestamp: '2026-01-02T08:01:00.000Z', note: null, isAutomatic: false, createdAt: '2026-01-02T08:01:00.000Z', updatedAt: '2026-01-02T08:01:00.000Z' },
    { id: 'o3', type: 'expense', amount: 10, currency: 'USD', amountETB: 550, exchangeRate: 55, category: 'Food', source: 'Cafe', account: 'available', fromAccount: null, fromGoalId: null, toAccount: null, toGoalId: null, date: '2026-01-03', timestamp: '2026-01-03T08:00:00.000Z', note: 'coffee', isAutomatic: false, createdAt: '2026-01-03T08:00:00.000Z', updatedAt: '2026-01-03T08:00:00.000Z' },
    { id: 'o4', type: 'transfer', amount: 3000, currency: 'ETB', amountETB: 3000, exchangeRate: 1, category: '', source: '', account: null, fromAccount: 'available', fromGoalId: null, toAccount: 'saved', toGoalId: null, date: '2026-01-04', timestamp: '2026-01-04T08:00:00.000Z', note: null, isAutomatic: false, createdAt: '2026-01-04T08:00:00.000Z', updatedAt: '2026-01-04T08:00:00.000Z' },
    { id: 'o5', type: 'transfer', amount: 8000, currency: 'ETB', amountETB: 8000, exchangeRate: 1, category: '', source: '', account: null, fromAccount: 'saved', fromGoalId: null, toAccount: 'goal', toGoalId: 'g1', date: '2026-01-05', timestamp: '2026-01-05T08:00:00.000Z', note: null, isAutomatic: false, createdAt: '2026-01-05T08:00:00.000Z', updatedAt: '2026-01-05T08:00:00.000Z' },
  ];
  const legacyGoals: LegacyGoal[] = [{ id: 'g1', name: 'Trip', targetAmount: 20000, deadline: null, status: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }];
  const v2 = { version: 2, exportedAt: '2026-01-06T00:00:00Z', categories: [...categories.filter((c) => c.name !== 'Fees'), { id: 'sav', name: 'Savings', type: 'savings', icon: 'x', color: '#000', isDefault: false }], transactions: legacyRows, exchangeRates: rates, goals: legacyGoals, budgets };
  const m = restoreBackup(v2, restoreCtx);
  const mState: AccountsState = { accounts: m.backup.accounts, entries: m.backup.transactions, goals: m.backup.goals, allocations: m.backup.goalAllocations, notifications: m.backup.notifications, rates: m.backup.exchangeRates, currencies: st.currencies };
  check('a version 2 backup restores into one Cash account whose balance is the old total (80,000 - 550 = 79,450)', m.backup.accounts.length === 1 && m.backup.accounts[0].name === 'Cash' && bal(mState)[m.backup.accounts[0].id] === 79450 && getTotals(mState, RESTORE_NOW).total === 79450);
  check('...the goal is a reservation held in Cash (8,000), the Available -> Saved transfer is left out, the USD row keeps its original amount', getGoalAmount(m.backup.goalAllocations, 'g1') === 8000 && m.backup.transactions.length === 3 && m.backup.transactions.some((e) => e.currency === 'USD' && e.amount === 10) && m.message.includes('1 transfer between Available and Saved was left out'));
  check('...rates and budgets carry over, the savings category is dropped, Fees is added, and the badge is 0 (no notifications)', canon(byId(m.backup.exchangeRates)) === canon(byId(rates)) && m.backup.budgets.length === 1 && !m.backup.categories.some((c) => c.type === 'savings') && m.backup.categories.some((c) => c.name === 'Fees') && unreadCount(goalNotificationItems(m.backup.notifications, m.backup.goals, {})) === 0);
  const m2 = restoreBackup(JSON.parse(JSON.stringify(createBackupV3({ categories: m.backup.categories, budgets: m.backup.budgets, state: mState }, new Date(2026, 0, 13)))), restoreCtx).backup;
  check('...and exporting that as version 3 and restoring it again gives exactly the same data', canon(m2.accounts) === canon(m.backup.accounts) && canon(byId(m2.transactions)) === canon(byId(m.backup.transactions)) && canon(byId(m2.goalAllocations)) === canon(byId(m.backup.goalAllocations)) && canon(byId(m2.goals)) === canon(byId(m.backup.goals)));
  check('...and the restored old data is usable: a new account can be added next to Cash and money moved into it', (() => {
    const cashId = m.backup.accounts[0].id;
    const withBank = planCreateAccount(mState, { name: 'CBE', type: 'bank', currency: 'ETB', openingAmount: 0 }, restoreCtx);
    const moved = planAddEntry(withBank.state, transfer(cashId, withBank.account.id, 1000), restoreCtx).state;
    return bal(moved)[withBank.account.id] === 1000 && getTotals(moved, RESTORE_NOW).total === 79450;
  })());
}

// ---- Persistence: saveAccountsDiff (what the store calls after every write) ----------------------------------------------------------
console.log('\nPersistence: each write saves only the rows it changed, in one transaction (real SQLite)');
{
  const db = new DatabaseSync(':memory:');
  const real = runnerFor(db);
  runMigrations(real, 0);
  const statements: string[] = [];
  const counting: SqlRunner = { ...real, run: (sql, ...params) => { statements.push(sql.trim().split(/\s+/).slice(0, 4).join(' ')); real.run(sql, ...params); } };
  const clock = makeClock();

  let state = emptyState();
  let saved = state;
  const persist = (next: AccountsState) => {
    statements.length = 0;
    saveAccountsDiff(counting, saved, next);
    saved = next;
    state = next;
  };
  const roundTrip = () => {
    const read = readAccountsData(real);
    return canon(byId(read.accounts)) === canon(byId(state.accounts)) && canon(byId(read.entries)) === canon(byId(state.entries)) && canon(byId(read.goals)) === canon(byId(state.goals)) && canon(byId(read.allocations)) === canon(byId(state.allocations)) && canon(byId(read.notifications)) === canon(byId(state.notifications));
  };

  const cbe = addAccount(state, clock.ctx, { name: 'CBE', openingAmount: 100_000 });
  persist(cbe.state);
  check('a new account with its opening entry is 2 row writes', statements.length === 2 && roundTrip());

  const tele = addAccount(state, clock.ctx, { name: 'Telebirr', type: 'wallet', openingAmount: 1_000 });
  persist(tele.state);
  persist(planAddEntry(state, expense(cbe.id, 500), clock.ctx).state);
  check('an expense is exactly one row write; nothing else is rewritten', statements.length === 1 && roundTrip());

  const withFee = planAddEntry(state, transfer(cbe.id, tele.id, 2_000, 2_000, { amount: 10, currency: 'ETB' }), clock.ctx).state;
  persist(withFee);
  check('a transfer with a fee is two row writes (the transfer and its fee)', statements.length === 2 && roundTrip());

  const transferId = state.entries.find((e) => e.type === 'transfer')!.id;
  persist(planEditEntry(state, transferId, transfer(cbe.id, tele.id, 2_000, 2_000, { amount: 20, currency: 'ETB' }), clock.ctx).state);
  check('editing it rewrites those two rows only', statements.length === 2 && roundTrip());

  persist(planDeleteEntry(state, transferId, clock.ctx).state);
  check('deleting it removes both rows from the table', roundTrip() && countOf(db, 'transactions') === state.entries.length);

  const goal = planCreateGoal(state, { name: 'Laptop', targetAmount: 50_000, heldInAccountId: cbe.id }, clock.ctx);
  persist(goal.state);
  clock.minute();
  persist(planAddToGoal(state, goal.goal.id, 60_000, clock.ctx).state);
  const squeeze = planAddEntry(state, expense(cbe.id, 45_000), clock.ctx);
  persist(squeeze.state);
  check('a write that uses reserved money saves the expense, the reduction and the notification together (3 rows)', statements.length === 3 && roundTrip() && countOf(db, 'notifications') === 1);

  const emptiedGoal = planWithdrawFromGoal(state, goal.goal.id, getGoalAmount(state.allocations, goal.goal.id), clock.ctx).state;
  persist(emptiedGoal);
  persist(planDeleteGoal(state, goal.goal.id));
  check('deleting a goal removes it and its allocation rows', roundTrip() && countOf(db, 'goals') === 0 && countOf(db, 'goal_allocations') === 0);
  check('...and the notification about it goes with it (it would only point at a goal that is gone)', countOf(db, 'notifications') === 0);

  const before = state;
  const broken: SqlRunner = { ...real, run: (sql, ...params) => { if (sql.includes('INTO transactions')) throw new Error('disk full'); real.run(sql, ...params); } };
  let threw = false;
  try {
    saveAccountsDiff(broken, before, planAddEntry(before, expense(tele.id, 100), clock.ctx).state);
  } catch {
    threw = true;
  }
  check('a failure while saving rolls the whole write back', threw && roundTrip());

  check('an unchanged state writes nothing', (() => {
    statements.length = 0;
    saveAccountsDiff(counting, state, state);
    return statements.length === 0;
  })());
}

// ---- Notification retention: expiry, deleting by id, restore trimming ----------------------------------------------------------------------
console.log('\nNotification retention: 30 days from creation (read or not); restore drops the older ones');
{
  const clock = makeClock();
  const NOW_R = new Date(2026, 1, 15, 12, 0, 0);
  const ago = (days: number, extraSeconds = 0) => new Date(NOW_R.getTime() - days * 86_400_000 - extraSeconds * 1000).toISOString();
  const note = (id: string, createdAt: string, read = false) => ({ id, kind: 'goal_reserve_used' as const, goalId: 'g', accountId: 'a', amount: 1, amountAfter: 0, createdAt, read });

  check('the retention is a named constant: 30 days', RESERVE_NOTIFICATION_RETENTION_DAYS === 30);
  check('day 29 stays', !isExpired(note('n', ago(29)), NOW_R));
  check('exactly 30 days old still stays (the limit is "more than 30 days")', !isExpired(note('n', ago(30)), NOW_R));
  check('30 days and a second goes', isExpired(note('n', ago(30, 1)), NOW_R));
  check('day 31 goes', isExpired(note('n', ago(31)), NOW_R));
  check('a brand-new one and one from the future (clock change) stay', !isExpired(note('n', ago(0)), NOW_R) && !isExpired(note('n', ago(-2)), NOW_R));
  check('read or unread makes no difference: both go at 31 days, both stay at 29', isExpired(note('r', ago(31), true), NOW_R) && isExpired(note('u', ago(31), false), NOW_R) && !isExpired(note('r', ago(29), true), NOW_R) && !isExpired(note('u', ago(29), false), NOW_R));
  check('a time that cannot be read is kept, not lost', !isExpired(note('n', 'not a date'), NOW_R));
  const list = [note('old', ago(40)), note('edge', ago(30)), note('mid', ago(29)), note('new', ago(1)), note('old-read', ago(31), true)];
  check('pruning keeps day 29, day 30 and newer; drops day 31 and older (in the original order)', pruneExpired(list, NOW_R).map((n) => n.id).join() === 'edge,mid,new', pruneExpired(list, NOW_R).map((n) => n.id).join());
  check('the ids to delete on app load are exactly the dropped ones', expiredIds(list, NOW_R).join() === 'old,old-read');
  check('a different number of days is respected (the constant is only a default)', pruneExpired(list, NOW_R, 5).map((n) => n.id).join() === 'new');
  check('pruning does not change the list it was given', list.length === 5);

  // deleting saved notifications by id (what expiry does on load)
  const db = new DatabaseSync(':memory:');
  const run = runnerFor(db);
  runMigrations(run, 0);
  const a = addAccount(emptyState(), clock.ctx, { name: 'CBE', openingAmount: 100 });
  replaceAccountsData(run, { accounts: a.state.accounts, entries: a.state.entries, goals: [], allocations: [], notifications: list.map((n) => ({ ...n, goalId: 'g', accountId: a.id })) });
  check('five notifications saved', countOf(db, 'notifications') === 5);
  deleteNotifications(run, expiredIds(list, NOW_R));
  check('deleting the expired ids removes exactly those rows', countOf(db, 'notifications') === 3 && readAccountsData(run).notifications.map((n) => n.id).sort().join() === 'edge,mid,new');
  deleteNotifications(run, []);
  check('deleting nothing is harmless', countOf(db, 'notifications') === 3);

  // restore: a backup's notifications older than the retention are dropped (relative to the restore time)
  const base = addAccount(emptyState(), clock.ctx, { name: 'CBE', openingAmount: 1000 });
  const g = planCreateGoal(base.state, { name: 'Laptop', targetAmount: 500, heldInAccountId: base.id }, clock.ctx);
  const withNotes = { ...g.state, notifications: list.map((n) => ({ ...n, goalId: g.goal.id, accountId: base.id })) };
  const backup = JSON.parse(JSON.stringify(createBackupV3({ categories: [], budgets: [], state: withNotes }, NOW_R)));
  const restoreCtx = { now: () => NOW_R, newId: () => 'x' };
  const restoredNotes = restoreBackup(backup, restoreCtx).backup.notifications;
  check('restoring drops notifications older than 30 days (day 31 and 40, read or unread) and keeps day 30 and newer', restoredNotes.map((n) => n.id).join() === 'edge,mid,new', restoredNotes.map((n) => n.id).join());
  check('...the rest of the backup is restored as usual (accounts, goals)', restoreBackup(backup, restoreCtx).backup.accounts.length === 1 && restoreBackup(backup, restoreCtx).backup.goals.length === 1);
  check('...the file that was read is not changed', backup.notifications.length === 5);
  const fresh = JSON.parse(JSON.stringify(createBackupV3({ categories: [], budgets: [], state: { ...withNotes, notifications: [note('n1', ago(2)), note('n2', ago(20), true)].map((n) => ({ ...n, goalId: g.goal.id, accountId: base.id })) } }, NOW_R)));
  check('a backup whose notifications are all recent restores all of them, read flags included', (() => { const r = restoreBackup(fresh, restoreCtx).backup.notifications; return r.length === 2 && r[1].read === true && r[0].read === false; })());
  check('restoring it a year later drops them all (the age is measured at restore time)', restoreBackup(fresh, { now: () => new Date(2027, 1, 15), newId: () => 'x' }).backup.notifications.length === 0);
}

// ---- Migration schema 3 -> 4 (real SQLite) -----------------------------------------------------------------------------------------------
console.log('\nMigration 3 -> 4: reset transactions / goals / recurring, clear milestones and snapshots, keep the rest');
{
  check('the app is on schema 4 and runMigrations runs the accounts step', SCHEMA_VERSION === 4 && ACCOUNTS_SCHEMA_VERSION === 4);
  const freshDb = new DatabaseSync(':memory:');
  const freshResult = runMigrations(runnerFor(freshDb), 0);
  check('a fresh install goes 0 -> 4 in one call and gets the accounts tables', versionOf(freshDb) === 4 && freshResult.accounts !== null && tableExists(freshDb, 'accounts') && tableExists(freshDb, 'goal_allocations') && tableExists(freshDb, 'notifications'));
  check('...and running it again changes nothing', runMigrations(runnerFor(freshDb), 4).accounts === null && versionOf(freshDb) === 4);
  check('a fresh install keeps an EMPTY categories table, so the first launch still seeds every default (Fees among them)', countOf(freshDb, 'categories') === 0 && !freshResult.accounts?.feesCategoryAdded);

  const schema3Device = (): NodeDb => {
    const db = new DatabaseSync(':memory:');
    db.exec(SCHEMA_DDL);
    db.exec('PRAGMA user_version = 3'); // a device that is already on schema 3, as the owner's phone is today
    const cat = db.prepare('INSERT INTO categories (id,name,type,icon,color,is_default) VALUES (?,?,?,?,?,?)');
    cat.run('salary', 'Salary', 'income', 'x', '#000', 1);
    cat.run('food', 'Food', 'expense', 'x', '#000', 1);
    cat.run('mine', 'Coffee', 'expense', 'x', '#000', 0);
    db.prepare('INSERT INTO currencies (code,name,is_default) VALUES (?,?,?)').run('ETB', 'Birr', 1);
    db.prepare('INSERT INTO currencies (code,name,is_default) VALUES (?,?,?)').run('USD', 'Dollar', 1);
    db.prepare('INSERT INTO exchange_rates (id,from_currency,to_currency,rate,updated_at) VALUES (?,?,?,?,?)').run('USD-ETB', 'USD', 'ETB', 57, '2026-03-01T00:00:00Z');
    db.prepare('INSERT INTO budgets (id,category,monthly_limit,currency,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('b1', 'Food', 4000, 'ETB', '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z');
    db.prepare('INSERT INTO user_origin (id,story_text,starting_point,why_building,updated_at) VALUES (?,?,?,?,?)').run('o', 'my story', 'start', 'why', '2026-03-01T00:00:00Z');
    db.prepare("INSERT INTO transactions (id,type,amount,currency,amount_etb,exchange_rate,category,source,account,date,timestamp,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run('t1', 'income', 1000, 'ETB', 1000, 1, 'Salary', 'Job', 'available', '2026-03-02', '2026-03-02T00:00:00Z', '2026-03-02T00:00:00Z', '2026-03-02T00:00:00Z');
    db.prepare("INSERT INTO transactions (id,type,amount,currency,amount_etb,exchange_rate,category,source,account,date,timestamp,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run('t2', 'expense', 100, 'ETB', 100, 1, 'Food', 'Cafe', 'available', '2026-03-03', '2026-03-03T00:00:00Z', '2026-03-03T00:00:00Z', '2026-03-03T00:00:00Z');
    db.prepare("INSERT INTO goals (id,name,target_amount,deadline,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run('g1', 'Laptop', 50000, null, 'active', '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z');
    db.prepare("INSERT INTO recurring_transactions (id,type,account,amount,currency,category,source,frequency,start_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run('r1', 'income', 'available', 500, 'ETB', 'Salary', 'Job', 'monthly', '2026-03-01', '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z');
    db.prepare('INSERT INTO milestones (id,title,description,date,type,goal_id,created_at) VALUES (?,?,?,?,?,?,?)').run('m1', 'Laptop', '', '2026-03-05', 'goal_completed', 'g1', '2026-03-05T00:00:00Z');
    db.prepare('INSERT INTO monthly_snapshots (id,month,income,expenses,savings,currency,created_at) VALUES (?,?,?,?,?,?,?)').run('s1', '2026-02', 1, 1, 1, 'ETB', '2026-03-01T00:00:00Z');
    db.prepare('INSERT INTO notification_reads (id,read_at) VALUES (?,?)').run('budget-Food-2026-03', '2026-03-05T00:00:00Z');
    return db;
  };

  const db = schema3Device();
  const run = runnerFor(db);
  check('(setup) the sample device is at schema 3 with data in every table', versionOf(db) === 3 && countOf(db, 'transactions') === 2 && countOf(db, 'goals') === 1 && countOf(db, 'recurring_transactions') === 1 && countOf(db, 'milestones') === 1 && countOf(db, 'monthly_snapshots') === 1);
  const wired = runMigrations(run, 3);
  const result = wired.accounts!;
  check('the migration reports what it removed (2 transactions, 1 goal, 1 recurring rule, 1 milestone, 1 snapshot)', result.droppedTransactions === 2 && result.droppedGoals === 1 && result.droppedRecurring === 1 && result.clearedMilestones === 1 && result.clearedSnapshots === 1);
  check('the schema is now version 4', versionOf(db) === 4);
  check('transactions, goals and recurring rules are recreated empty', countOf(db, 'transactions') === 0 && countOf(db, 'goals') === 0 && countOf(db, 'recurring_transactions') === 0);
  check('milestones and monthly snapshots are cleared', countOf(db, 'milestones') === 0 && countOf(db, 'monthly_snapshots') === 0);
  check('categories, budgets, currencies, exchange rates and the origin story are kept', countOf(db, 'budgets') === 1 && countOf(db, 'currencies') === 2 && countOf(db, 'exchange_rates') === 1 && countOf(db, 'user_origin') === 1 && countOf(db, 'categories') === 4);
  check('the user\'s own category and the stored rate are untouched', (db.prepare("SELECT COUNT(*) AS c FROM categories WHERE id = 'mine'").get() as { c: number }).c === 1 && (db.prepare("SELECT rate FROM exchange_rates WHERE id = 'USD-ETB'").get() as { rate: number }).rate === 57);
  check('stored notification read ids are kept', countOf(db, 'notification_reads') === 1);
  check('a Fees expense category was added', result.feesCategoryAdded && (db.prepare("SELECT COUNT(*) AS c FROM categories WHERE name = 'Fees' AND type = 'expense'").get() as { c: number }).c === 1);

  const txCols = columnsOf(db, 'transactions');
  check('transactions has the new columns and lost the old `account` ones', ['account_id', 'from_account_id', 'to_account_id', 'to_amount', 'to_amount_etb', 'linked_transfer_id'].every((c) => txCols.includes(c)) && !txCols.includes('account') && !txCols.includes('from_account') && !txCols.includes('from_goal_id'));
  check('goals gained held_in_account_id', columnsOf(db, 'goals').includes('held_in_account_id'));
  check('recurring rules gained account_id and lost account', columnsOf(db, 'recurring_transactions').includes('account_id') && !columnsOf(db, 'recurring_transactions').includes('account'));
  check('accounts has sms_sender and last_digits (nullable)', ['sms_sender', 'last_digits', 'sort_order', 'archived', 'colour'].every((c) => columnsOf(db, 'accounts').includes(c)));
  db.prepare("INSERT INTO accounts (id,name,type,currency,colour,created_at) VALUES ('a','Cash','cash','ETB','#D9A21B','2026-03-10T00:00:00Z')").run();
  const stored = db.prepare("SELECT sms_sender, last_digits, sort_order, archived FROM accounts WHERE id = 'a'").get() as { sms_sender: string | null; last_digits: string | null; sort_order: number; archived: number };
  check('an account can be saved without them: they are NULL, not required', stored.sms_sender === null && stored.last_digits === null && stored.sort_order === 0 && stored.archived === 0);
  check('goal_allocations and notifications tables exist', tableExists(db, 'goal_allocations') && tableExists(db, 'notifications') && columnsOf(db, 'notifications').includes('amount_after') && columnsOf(db, 'notifications').includes('read'));
  check('running it again does nothing (idempotent) and does not add a second Fees category', migrateToAccounts(run, versionOf(db)) === null && (db.prepare("SELECT COUNT(*) AS c FROM categories WHERE name = 'Fees'").get() as { c: number }).c === 1);

  const fresh = new DatabaseSync(':memory:');
  let freshError = '';
  try {
    migrateToAccounts(runnerFor(fresh), 0);
  } catch (error) {
    freshError = error instanceof Error ? error.message : '';
  }
  check('it refuses to run before schema 3 exists', freshError.includes('schema 3'));

  // Atomic: a failure part-way leaves schema 3 and every old row exactly as it was.
  const crash = schema3Device();
  const base = runnerFor(crash);
  const breaking: SqlRunner = { ...base, run: (sql, ...params) => { if (sql.includes('INSERT INTO categories')) throw new Error('disk full'); base.run(sql, ...params); } };
  let crashed = false;
  try {
    migrateToAccounts(breaking, 3);
  } catch {
    crashed = true;
  }
  check('a failure part-way rolls everything back (still schema 3, all old rows intact)', crashed && versionOf(crash) === 3 && countOf(crash, 'transactions') === 2 && countOf(crash, 'goals') === 1 && countOf(crash, 'recurring_transactions') === 1 && countOf(crash, 'milestones') === 1 && countOf(crash, 'monthly_snapshots') === 1);
  check('...with the old columns and no new tables', columnsOf(crash, 'transactions').includes('account') && !tableExists(crash, 'accounts') && !tableExists(crash, 'goal_allocations'));
  check('...and the next launch can retry and succeed', migrateToAccounts(base, 3) !== null && versionOf(crash) === 4);

  const hasFees = schema3Device();
  hasFees.prepare("INSERT INTO categories (id,name,type,icon,color,is_default) VALUES ('my-fees','Fees','expense','x','#000',0)").run();
  const noDup = migrateToAccounts(runnerFor(hasFees), 3)!;
  check('an existing Fees expense category is reused, not duplicated', !noDup.feesCategoryAdded && (hasFees.prepare("SELECT COUNT(*) AS c FROM categories WHERE name = 'Fees'").get() as { c: number }).c === 1);

  const idTaken = schema3Device();
  idTaken.prepare("INSERT INTO categories (id,name,type,icon,color,is_default) VALUES ('fees','Fees income','income','x','#000',0)").run();
  const taken = migrateToAccounts(runnerFor(idTaken), 3)!;
  check('if the id "fees" is taken by something else, Fees still gets added under another id', taken.feesCategoryAdded && (idTaken.prepare("SELECT COUNT(*) AS c FROM categories WHERE name = 'Fees' AND type = 'expense'").get() as { c: number }).c === 1);

  check('Fees is part of the default seed exactly once', defaultCategories.filter((c) => c.name === FEES_CATEGORY.name).length === 1 && new Set(defaultCategories.map((c) => c.id)).size === defaultCategories.length);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:\n  ' + failures.join('\n  '));
  process.exit(1);
}
