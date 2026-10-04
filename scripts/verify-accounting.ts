// Accounting verification for V2_SPEC Part W (Test Cases 1-13) plus extra edge cases.
// Run:  TZ=Africa/Addis_Ababa npx tsx scripts/verify-accounting.ts
//
// It drives the same pure functions the store uses (planAdd / planEdit / planDelete +
// getBalances), so it checks the real validation and balance logic - not a copy of it. It cannot
// exercise React Native screens or SQLite; those are covered separately.

import { findV2LaunchCutoff, runMigrations, SCHEMA_DDL, SCHEMA_VERSION, SqlRunner } from '../db/migrations';
import { getReadIds, markRead, pruneReads } from '../db/notificationReads';
import { Budget, ExchangeRate, Milestone, Transaction, TransactionInput } from '../types';
import { getBalances, LedgerError, LedgerErrorCode } from '../utils/balances';
import { calculateBuilderStreak, getBudgetProgress, getGoalProgress, nextGoalStatus } from '../utils/currency';
import { suggestCategoryEmoji } from '../utils/categoryIcons';
import { parseDateKey, toLocalDateKey } from '../utils/dates';
import { advanceDate, getNextDueDate, planRecurringEdit } from '../utils/recurring';
import {
  TREND_TITLES,
  clampCustomRange,
  getCategoryBreakdown,
  getFilteredTransactionsByRange,
  getPeriodTotals,
  getRangeDates,
  getSourceBreakdown,
  getTrendGranularity,
  getTrendSeries,
  shiftMonth,
  shiftWeek,
} from '../utils/reports';
import { CONTROL_LABEL_MAX_SCALE, getTabBarMetrics, TAB_LABEL_FONT_SIZE, TAB_LABEL_MAX_SCALE } from '../utils/layout';
import { statusBarStyleForBackground } from '../utils/statusBar';
import { hasCompletionMilestone } from '../utils/milestones';
import { budgetNotificationId, getBudgetAlerts } from '../utils/notifications';
import { planAdd, planDelete, planEdit } from '../utils/transactions';

const RATES: ExchangeRate[] = [
  { id: 'USD-ETB', fromCurrency: 'USD', toCurrency: 'ETB', rate: 55, updatedAt: '2026-01-01T00:00:00Z' },
];
const GOALS = { laptop: 'Laptop' };

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

function ledgerOf(...inputs: TransactionInput[]): Transaction[] {
  const ledger: Transaction[] = [];
  for (const input of inputs) {
    ledger.push(planAdd(ledger, input, RATES, GOALS));
  }
  return ledger;
}

function add(ledger: Transaction[], input: TransactionInput): Transaction[] {
  return [...ledger, planAdd(ledger, input, RATES, GOALS)];
}

function rejectedWith(code: LedgerErrorCode, action: () => unknown): boolean {
  try {
    action();
    return false;
  } catch (error) {
    return error instanceof LedgerError && error.code === code;
  }
}

const income = (amount: number, account: 'available' | 'saved', date = '2026-01-01'): TransactionInput => ({
  type: 'income', amount, currency: 'ETB', category: 'Salary', source: 'Job', account, date,
});
const expense = (amount: number, account: 'available' | 'saved', date = '2026-01-02'): TransactionInput => ({
  type: 'expense', amount, currency: 'ETB', category: 'Food', account, date,
});
const transfer = (
  amount: number,
  from: 'available' | 'saved' | 'goal',
  to: 'available' | 'saved' | 'goal',
  date = '2026-01-02',
): TransactionInput => ({
  type: 'transfer', amount, currency: 'ETB', fromAccount: from, toAccount: to,
  fromGoalId: from === 'goal' ? 'laptop' : null, toGoalId: to === 'goal' ? 'laptop' : null, date,
});

// "Start: Total 100,000 / Available 70,000 / Saved 30,000"
const start = () => ledgerOf(income(70000, 'available'), income(30000, 'saved'));

function expectBalances(
  name: string,
  ledger: Transaction[],
  want: { total: number; available: number; saved: number; laptop?: number },
): void {
  const got = getBalances(ledger);
  const laptop = got.goals.laptop ?? 0;
  check(
    name,
    got.total === want.total && got.available === want.available && got.saved === want.saved && laptop === (want.laptop ?? 0),
    `got total=${got.total} available=${got.available} saved=${got.saved} laptop=${laptop}`,
  );
}

console.log('\nPart W test cases');

console.log('Test 1 - Income to Available');
expectBalances('110,000 / 80,000 / 30,000', add(start(), income(10000, 'available', '2026-01-02')), { total: 110000, available: 80000, saved: 30000 });

console.log('Test 2 - Income to Saved');
expectBalances('110,000 / 70,000 / 40,000', add(start(), income(10000, 'saved', '2026-01-02')), { total: 110000, available: 70000, saved: 40000 });

console.log('Test 3 - Available -> Saved');
expectBalances('100,000 / 60,000 / 40,000', add(start(), transfer(10000, 'available', 'saved')), { total: 100000, available: 60000, saved: 40000 });

console.log('Test 4 - Saved -> Available');
{
  const base = ledgerOf(income(60000, 'available'), income(40000, 'saved'));
  expectBalances('100,000 / 70,000 / 30,000', add(base, transfer(10000, 'saved', 'available')), { total: 100000, available: 70000, saved: 30000 });
}

console.log('Test 5 - Expense from Available');
expectBalances('95,000 / 65,000 / 30,000', add(start(), expense(5000, 'available')), { total: 95000, available: 65000, saved: 30000 });

console.log('Test 6 - Expense from Saved');
expectBalances('95,000 / 70,000 / 25,000', add(start(), expense(5000, 'saved')), { total: 95000, available: 70000, saved: 25000 });

console.log('Test 7 - Available -> Goal');
expectBalances('100,000 / 60,000 / 30,000 / Laptop 10,000', add(start(), transfer(10000, 'available', 'goal')), { total: 100000, available: 60000, saved: 30000, laptop: 10000 });

console.log('Test 8 - Saved -> Goal');
expectBalances('100,000 / 70,000 / 20,000 / Laptop 10,000', add(start(), transfer(10000, 'saved', 'goal')), { total: 100000, available: 70000, saved: 20000, laptop: 10000 });

console.log('Test 9 - Goal -> Available');
{
  const base = ledgerOf(income(70000, 'available'), income(30000, 'saved'), transfer(10000, 'available', 'goal', '2026-01-01'));
  expectBalances('start: 60,000 / 30,000 / Laptop 10,000', base, { total: 100000, available: 60000, saved: 30000, laptop: 10000 });
  expectBalances('after: 100,000 / 65,000 / 30,000 / Laptop 5,000', add(base, transfer(5000, 'goal', 'available')), { total: 100000, available: 65000, saved: 30000, laptop: 5000 });
}

console.log('Test 10 - Goal cannot pay an expense');
{
  const base = ledgerOf(income(70000, 'available'), transfer(10000, 'available', 'goal', '2026-01-01'));
  const goalExpense = { ...expense(5000, 'available'), account: 'goal' } as unknown as TransactionInput;
  check('expense with Goal as pay-from is rejected (GOAL_EXPENSE)', rejectedWith('GOAL_EXPENSE', () => planAdd(base, goalExpense, RATES, GOALS)));
  check('Laptop goal untouched', getBalances(base).goals.laptop === 10000);
  console.log('  note  "UI must not offer Goal as an expense source": the Account type is "available" | "saved" (compile-time) and the ledger guard above is the runtime backstop. The Step 3 form only offers Available / Saved for expenses (components/TransactionForm.tsx); Goal appears only as a Transfer endpoint.');
}

console.log('Test 11 - Edit transaction (ledger model)');
{
  const base = start();
  const withExpense = add(base, expense(5000, 'available'));
  const original = withExpense[withExpense.length - 1];
  const edited = planEdit(withExpense, original.id, expense(7000, 'saved'), RATES, GOALS);
  const after = withExpense.map((row) => (row.id === original.id ? edited : row));
  expectBalances('Available 70,000 (as if 5,000 never existed), Saved 23,000, Total 93,000', after, { total: 93000, available: 70000, saved: 23000 });
  check('still exactly one expense row', after.filter((row) => row.type === 'expense').length === 1);
  check('edit kept id / createdAt / timestamp', edited.id === original.id && edited.createdAt === original.createdAt && edited.timestamp === original.timestamp);
}

console.log('Test 12 - Currency conversion');
{
  const usd: TransactionInput = { type: 'expense', amount: 50, currency: 'USD', category: 'Coffee', account: 'available', date: '2026-01-02' };
  const before = getBalances(start()).available;
  const ledger = add(start(), usd);
  const row = ledger[ledger.length - 1];
  check('amount=50 currency=USD amountETB=2750', row.amount === 50 && row.currency === 'USD' && row.amountETB === 2750, JSON.stringify(row));
  check('Available decreased by exactly 2,750 (not 50)', before - getBalances(ledger).available === 2750);
  check('stored rate recorded on the row (55)', row.exchangeRate === 55);
  check('list display data present: ETB amount + original amount/currency', row.amountETB === 2750 && row.amount === 50 && row.currency === 'USD');
  console.log('  note  the "(originally $50)" text itself is rendered in app/transactions.tsx; checked by reading the code, not by running the UI.');
}

console.log('Test 13 - Negative balance blocked');
{
  const base = start();
  check('expense > Available is blocked (NEGATIVE_BALANCE)', rejectedWith('NEGATIVE_BALANCE', () => planAdd(base, expense(70000.01, 'available'), RATES, GOALS)));
  check('no transaction created (ledger unchanged)', base.length === 2);
  check('exactly Available is allowed', (() => { const l = add(base, expense(70000, 'available')); return getBalances(l).available === 0; })());
}

console.log('\nExtra cases (approved scope: edit / delete / back-dated / rates / streak)');
{
  const base = start();
  check('transfer > Available blocked', rejectedWith('NEGATIVE_BALANCE', () => planAdd(base, transfer(70001, 'available', 'saved'), RATES, GOALS)));
  check('transfer > Saved blocked', rejectedWith('NEGATIVE_BALANCE', () => planAdd(base, transfer(30001, 'saved', 'available'), RATES, GOALS)));
  check('goal contribution > Available blocked', rejectedWith('NEGATIVE_BALANCE', () => planAdd(base, transfer(70001, 'available', 'goal'), RATES, GOALS)));
  check('withdrawing more than the goal holds is blocked', rejectedWith('NEGATIVE_BALANCE', () => planAdd(add(base, transfer(1000, 'available', 'goal')), transfer(1001, 'goal', 'available'), RATES, GOALS)));
  check('same source and destination rejected', rejectedWith('SAME_ACCOUNT', () => planAdd(base, transfer(10, 'saved', 'saved'), RATES, GOALS)));
  check('goal -> same goal rejected', rejectedWith('SAME_ACCOUNT', () => planAdd(base, transfer(10, 'goal', 'goal'), RATES, GOALS)));
  check('zero / negative amount rejected', rejectedWith('INVALID_AMOUNT', () => planAdd(base, expense(0, 'available'), RATES, GOALS)) && rejectedWith('INVALID_AMOUNT', () => planAdd(base, expense(-5, 'available'), RATES, GOALS)));
}
{
  // delete / edit that would strand later spending
  const l = ledgerOf(income(1000, 'available', '2026-01-01'), expense(800, 'available', '2026-01-05'));
  const incomeRow = l[0];
  const expenseRow = l[1];
  check('delete income that funds a later expense is blocked', rejectedWith('NEGATIVE_BALANCE', () => planDelete(l, incomeRow.id, GOALS)));
  check('delete the expense is allowed', (() => { planDelete(l, expenseRow.id, GOALS); return true; })());
  check('edit income down below later spending is blocked', rejectedWith('NEGATIVE_BALANCE', () => planEdit(l, incomeRow.id, income(500, 'available', '2026-01-01'), RATES, GOALS)));
  check('edit income to a LATER date than the expense is blocked', rejectedWith('NEGATIVE_BALANCE', () => planEdit(l, incomeRow.id, income(1000, 'available', '2026-01-10'), RATES, GOALS)));
  check('edit expense raising it above funds is blocked', rejectedWith('NEGATIVE_BALANCE', () => planEdit(l, expenseRow.id, expense(1001, 'available', '2026-01-05'), RATES, GOALS)));
  check('back-dated expense before the income is blocked', rejectedWith('NEGATIVE_BALANCE', () => planAdd(l, expense(10, 'available', '2025-12-31'), RATES, GOALS)));
  check('back-dated expense that overdraws an intermediate day is blocked even though today balances', rejectedWith('NEGATIVE_BALANCE', () => planAdd(add(l, income(5000, 'available', '2026-02-01')), expense(300, 'available', '2026-01-06'), RATES, GOALS)));
  check('same-day income + expense is judged at end of day', (() => { planAdd(ledgerOf(income(100, 'available', '2026-03-01')), expense(100, 'available', '2026-03-01'), RATES, GOALS); return true; })());
}
{
  // exchange rates
  check('non-ETB with no stored rate is blocked (MISSING_RATE, no 1:1 fallback)', rejectedWith('MISSING_RATE', () => planAdd(start(), { ...expense(10, 'available'), currency: 'EUR' }, RATES, GOALS)));
  const override = planAdd(start(), { ...expense(10, 'available'), currency: 'USD', rateOverride: 60 }, RATES, GOALS);
  check('per-transaction override used (10 USD @ 60 = 600)', override.amountETB === 600 && override.exchangeRate === 60);
  check('override does not modify the stored rate table', RATES[0].rate === 55);
  check('invalid override rejected', rejectedWith('INVALID_RATE', () => planAdd(start(), { ...expense(10, 'available'), currency: 'USD', rateOverride: 0 }, RATES, GOALS)));

  // editing keeps the original rate even if the stored rate later changes
  const l = ledgerOf(income(100000, 'available'), { type: 'expense', amount: 10, currency: 'USD', category: 'X', account: 'available', date: '2026-01-02' });
  const newRates: ExchangeRate[] = [{ ...RATES[0], rate: 130 }];
  const edited = planEdit(l, l[1].id, { type: 'expense', amount: 20, currency: 'USD', category: 'X', account: 'available', date: '2026-01-02' }, newRates, GOALS);
  check('edit keeps the entry-time rate (20 USD @ 55 = 1,100, not 2,600)', edited.amountETB === 1100);
}
{
  // arithmetic
  let l = ledgerOf(income(0.1, 'available', '2026-01-01'));
  l = add(l, income(0.2, 'available', '2026-01-01'));
  check('0.1 + 0.2 = 0.3 exactly (cent arithmetic)', getBalances(l).available === 0.3);
  check('total never double-counts goals', (() => { const g = add(start(), transfer(20000, 'available', 'goal')); return getBalances(g).total === 100000; })());
}
{
  // budgets use amountETB and a converted limit
  const l = ledgerOf(income(100000, 'available'), { type: 'expense', amount: 10, currency: 'USD', category: 'Food', account: 'available', date: '2026-01-02' });
  const budget = { id: 'b', category: 'Food', monthlyLimit: 10, currency: 'USD', createdAt: '', updatedAt: '' };
  const progress = getBudgetProgress(budget, l, RATES, new Date(2026, 0, 15));
  check('budget spent = 550 ETB vs limit 10 USD = 550 ETB (not over)', progress.spentAmount === 550 && progress.limitETB === 550 && !progress.isOverBudget);
  check('budget in a currency with no rate is not compared', getBudgetProgress({ ...budget, currency: 'EUR' }, l, RATES, new Date(2026, 0, 15)).limitETB === null);
}
{
  // streak: local day keys. Run under TZ=Africa/Addis_Ababa (UTC+3) to exercise the old UTC bug.
  const at1am = new Date(2026, 0, 10, 1, 0, 0);
  const rows = ledgerOf(income(100, 'available', '2026-01-08'), income(100, 'available', '2026-01-09'), income(100, 'available', '2026-01-10'));
  check(`streak at 01:00 local (TZ=${process.env.TZ ?? 'system'}) counts 3 consecutive days`, calculateBuilderStreak(rows, at1am) === 3, `got ${calculateBuilderStreak(rows, at1am)}`);
  const noToday = rows.slice(0, 2);
  check('streak survives a day with nothing logged yet (yesterday active)', calculateBuilderStreak(noToday, at1am) === 2);
  check('streak breaks after a gap', calculateBuilderStreak(ledgerOf(income(1, 'available', '2026-01-05')), at1am) === 0);
  const transferRows = ledgerOf(income(100, 'available', '2026-01-01'), transfer(10, 'available', 'saved', '2026-01-09'), transfer(10, 'available', 'goal', '2026-01-10'));
  const withAuto = [...ledgerOf(income(100, 'available', '2026-01-01')), { ...ledgerOf(income(5, 'available', '2026-01-10'))[0], isAutomatic: true }];
  check('automatically generated (recurring) rows do not count toward the streak', calculateBuilderStreak(withAuto, at1am) === 0, `got ${calculateBuilderStreak(withAuto, at1am)}`);
  check('transfers and goal contributions count toward the streak', calculateBuilderStreak(transferRows, at1am) === 2);
}

console.log('\nStep 3: editing across all three transaction types');
{
  const base = ledgerOf(income(70000, 'available'), income(30000, 'saved'));
  const exp = add(base, expense(5000, 'available'));
  const expRow = exp[exp.length - 1];

  // expense -> transfer (Saved -> Laptop goal): row is converted in place, no leftover expense effect
  const asTransfer = planEdit(exp, expRow.id, transfer(5000, 'saved', 'goal'), RATES, GOALS);
  const l1 = exp.map((row) => (row.id === expRow.id ? asTransfer : row));
  expectBalances('expense -> Saved->Goal transfer: 100,000 / 70,000 / 25,000 / Laptop 5,000', l1, { total: 100000, available: 70000, saved: 25000, laptop: 5000 });
  check('converted row has no category/account/source left over', asTransfer.category === '' && asTransfer.account === null && asTransfer.source === '' && asTransfer.fromGoalId === null && asTransfer.toGoalId === 'laptop');
  check('id/createdAt/timestamp survive a type change', asTransfer.id === expRow.id && asTransfer.createdAt === expRow.createdAt && asTransfer.timestamp === expRow.timestamp);

  // transfer -> income (Saved)
  const asIncome = planEdit(l1, asTransfer.id, income(5000, 'saved', '2026-01-02'), RATES, GOALS);
  const l2 = l1.map((row) => (row.id === asTransfer.id ? asIncome : row));
  expectBalances('transfer -> Income to Saved: 105,000 / 70,000 / 35,000 / Laptop 0', l2, { total: 105000, available: 70000, saved: 35000 });
  check('income row has account, no transfer endpoints', asIncome.account === 'saved' && asIncome.fromAccount === null && asIncome.toAccount === null && asIncome.toGoalId === null);

  // move a transfer's endpoints (Available->Saved becomes Saved->Available)
  const t = add(base, transfer(1000, 'available', 'saved'));
  const tRow = t[t.length - 1];
  const flipped = planEdit(t, tRow.id, transfer(1000, 'saved', 'available'), RATES, GOALS);
  expectBalances('flipping a transfer: 100,000 / 71,000 / 29,000', t.map((row) => (row.id === tRow.id ? flipped : row)), { total: 100000, available: 71000, saved: 29000 });

  // goal withdrawals
  const funded = add(base, transfer(10000, 'available', 'goal'));
  const withdrawn = add(funded, transfer(4000, 'goal', 'saved'));
  expectBalances('Goal -> Saved: 100,000 / 60,000 / 34,000 / Laptop 6,000', withdrawn, { total: 100000, available: 60000, saved: 34000, laptop: 6000 });
  const fundingRow = funded[funded.length - 1];
  check('delete the goal-funding transfer after withdrawing is blocked', rejectedWith('NEGATIVE_BALANCE', () => planDelete(withdrawn, fundingRow.id, GOALS)));
  check('shrinking the goal-funding transfer below what was withdrawn is blocked', rejectedWith('NEGATIVE_BALANCE', () => planEdit(withdrawn, fundingRow.id, transfer(3000, 'available', 'goal'), RATES, GOALS)));
  check('goal -> a different goal id is not "same account"', (() => { planAdd(funded, { ...transfer(100, 'goal', 'goal'), toGoalId: 'other' }, RATES, { ...GOALS, other: 'Car' }); return true; })());
  check('transfer with a goal endpoint but no goal id is rejected', rejectedWith('MISSING_GOAL', () => planAdd(base, { ...transfer(10, 'available', 'goal'), toGoalId: null }, RATES, GOALS)));
  check('foreign-currency transfer converts to ETB (10 USD = 550)', planAdd(base, { ...transfer(10, 'available', 'saved'), currency: 'USD' }, RATES, GOALS).amountETB === 550);
}

console.log('\nStep 5: Insights periods, navigation, custom range, trend');
{
  // Fixture across several months. Transfers and a USD expense are included on purpose.
  const L = ledgerOf(
    income(100000, 'available', '2025-12-31'),
    income(5000, 'available', '2026-01-01'),
    expense(300, 'available', '2026-01-05'),
    expense(200, 'available', '2026-01-31'),
    transfer(1000, 'available', 'saved', '2026-01-31'),
    income(7000, 'saved', '2026-02-01'),
    { type: 'expense', amount: 10, currency: 'USD', category: 'Food', account: 'available', date: '2026-02-10' },
    expense(400, 'available', '2026-02-28'),
    income(2000, 'available', '2026-03-15'),
    expense(50, 'available', '2026-03-15'),
  );

  // --- month navigation (the old setMonth() overflow bug) ---
  const from31st = new Date(2026, 9, 31); // 31 Oct
  const months = [0, -1, -2, -3, -4, -5, -6, -7, -8, -9, -10, -11, -12, -13].map((offset) => shiftMonth(from31st, offset));
  const expectedMonths = ['2026-10', '2026-09', '2026-08', '2026-07', '2026-06', '2026-05', '2026-04', '2026-03', '2026-02', '2026-01', '2025-12', '2025-11', '2025-10', '2025-09'];
  check('month navigation from the 31st steps through every month exactly once', months.map((m) => toLocalDateKey(m).slice(0, 7)).join() === expectedMonths.join(), months.map((m) => toLocalDateKey(m).slice(0, 7)).join());
  check('shiftMonth always returns day 1', months.every((m) => m.getDate() === 1));
  check('shiftWeek moves exactly 7 days', toLocalDateKey(shiftWeek(new Date(2026, 0, 14), -1)) === '2026-01-07' && toLocalDateKey(shiftWeek(new Date(2026, 0, 14), 2)) === '2026-01-28');

  // --- ranges ---
  check('monthly range Feb 2026 = 02-01..02-28', JSON.stringify(getRangeDates('monthly', new Date(2026, 1, 10))) === JSON.stringify({ start: '2026-02-01', end: '2026-02-28' }));
  check('monthly range Feb 2028 (leap) ends 02-29', getRangeDates('monthly', new Date(2028, 1, 3)).end === '2028-02-29');
  check('weekly range is Monday..Sunday (Sun 2026-01-11 belongs to 01-05..01-11)', JSON.stringify(getRangeDates('weekly', new Date(2026, 0, 11))) === JSON.stringify({ start: '2026-01-05', end: '2026-01-11' }));

  // --- period filtering and totals ---
  const jan = getFilteredTransactionsByRange(L, '2026-01-01', '2026-01-31');
  const feb = getFilteredTransactionsByRange(L, '2026-02-01', '2026-02-28');
  const janT = getPeriodTotals(jan);
  const febT = getPeriodTotals(feb);
  check('Jan: income 5,000 / expenses 500 / net 4,500 (transfer ignored, both boundary days included)', janT.income === 5000 && janT.expenses === 500 && janT.net === 4500, JSON.stringify(janT));
  check('Feb: income 7,000 / expenses 950 (10 USD @55 + 400) / net 6,050', febT.income === 7000 && febT.expenses === 950 && febT.net === 6050, JSON.stringify(febT));
  check('changing month changes every metric (Jan != Feb)', janT.income !== febT.income && janT.expenses !== febT.expenses && janT.net !== febT.net);
  check('custom range is inclusive of start AND end day', getFilteredTransactionsByRange(L, '2026-01-31', '2026-02-01').length === 3);
  check('custom range excludes the day before and after', getFilteredTransactionsByRange(L, '2026-01-06', '2026-01-30').length === 0);
  check('custom one-day range works', getFilteredTransactionsByRange(L, '2026-03-15', '2026-03-15').length === 2);
  check('custom range spanning months sums across them', (() => { const t = getPeriodTotals(getFilteredTransactionsByRange(L, '2026-01-15', '2026-03-01')); return t.income === 7000 && t.expenses === 1150; })());
  check('empty period gives zeros, not NaN', (() => { const t = getPeriodTotals(getFilteredTransactionsByRange(L, '2030-01-01', '2030-01-31')); return t.income === 0 && t.expenses === 0 && t.net === 0; })());

  // --- breakdowns reconcile with the headline numbers ---
  const febCats = getCategoryBreakdown(feb);
  check('category breakdown sums to period expenses (ETB)', Math.round(febCats.reduce((s, c) => s + c.amount, 0) * 100) === Math.round(febT.expenses * 100));
  check('source breakdown sums to period income', Math.round(getSourceBreakdown(feb).reduce((s, c) => s + c.amount, 0) * 100) === Math.round(febT.income * 100));

  // --- custom range clamping ---
  check('moving start past end pulls end up to start', JSON.stringify(clampCustomRange('start', '2026-03-10', '2026-03-01')) === JSON.stringify({ start: '2026-03-10', end: '2026-03-10' }));
  check('moving end before start pulls start back to end', JSON.stringify(clampCustomRange('end', '2026-03-10', '2026-03-01')) === JSON.stringify({ start: '2026-03-01', end: '2026-03-01' }));
  check('a valid range is left alone', JSON.stringify(clampCustomRange('end', '2026-03-01', '2026-03-10')) === JSON.stringify({ start: '2026-03-01', end: '2026-03-10' }));

  // --- trend: titles + bucketing, and always reconciles with totals ---
  check('trend titles match the selected period', TREND_TITLES.weekly === 'Weekly Trend' && TREND_TITLES.monthly === 'Monthly Trend' && TREND_TITLES.custom === 'Custom Period');
  const janTrend = getTrendSeries(jan, '2026-01-01', '2026-01-31');
  check('monthly view uses daily points (31 for January)', janTrend.length === 31 && getTrendGranularity('2026-01-01', '2026-01-31') === 'day');
  check('daily points carry the right day (01-05 expense 300, 01-31 expense 200)', janTrend.find((p) => p.label === '01-05')?.expense === 300 && janTrend.find((p) => p.label === '01-31')?.expense === 200);
  const sumTrend = (points: { income: number; expense: number }[]) => ({ i: Math.round(points.reduce((s, p) => s + p.income, 0) * 100), e: Math.round(points.reduce((s, p) => s + p.expense, 0) * 100) });
  check('daily trend totals equal period totals', sumTrend(janTrend).i === janT.income * 100 && sumTrend(janTrend).e === janT.expenses * 100);
  const wide = getFilteredTransactionsByRange(L, '2025-12-01', '2026-03-31');
  const wideTrend = getTrendSeries(wide, '2025-12-01', '2026-03-31');
  const wideT = getPeriodTotals(wide);
  check('a ~4-month custom range is bucketed weekly (not 120 daily points)', getTrendGranularity('2025-12-01', '2026-03-31') === 'week' && wideTrend.length > 15 && wideTrend.length < 25, `${wideTrend.length} points`);
  check('weekly-bucketed trend still reconciles with totals', sumTrend(wideTrend).i === wideT.income * 100 && sumTrend(wideTrend).e === wideT.expenses * 100);
  const yearTrend = getTrendSeries(L, '2025-01-01', '2026-12-31');
  check('a 2-year custom range is bucketed monthly (24 points)', getTrendGranularity('2025-01-01', '2026-12-31') === 'month' && yearTrend.length === 24, `${yearTrend.length}`);
  check('monthly-bucketed trend reconciles with totals', sumTrend(yearTrend).i === getPeriodTotals(L).income * 100 && sumTrend(yearTrend).e === getPeriodTotals(L).expenses * 100);
  check('one-day custom range gives exactly one point', getTrendSeries(getFilteredTransactionsByRange(L, '2026-03-15', '2026-03-15'), '2026-03-15', '2026-03-15').length === 1);
  check('trend ignores transfers', getTrendSeries(jan, '2026-01-31', '2026-01-31')[0].income === 0 && getTrendSeries(jan, '2026-01-31', '2026-01-31')[0].expense === 200);
}

console.log('\nStep 6: status bar contrast');
{
  check('app background (#F7F7F3) gets dark icons', statusBarStyleForBackground('#F7F7F3') === 'dark');
  check('white gets dark icons', statusBarStyleForBackground('#FFFFFF') === 'dark');
  check('navy (#172033) gets light icons', statusBarStyleForBackground('#172033') === 'light');
  check('black gets light icons', statusBarStyleForBackground('#000') === 'light');
  check('orange accent (#E87532) gets dark icons', statusBarStyleForBackground('#E87532') === 'dark');
}

console.log('\nStep 7: Goals - all transfer directions, completion status');
{
  const goal = { id: 'laptop', name: 'Laptop', targetAmount: 10000, deadline: null, status: 'active' as const, createdAt: '', updatedAt: '' };
  const base = ledgerOf(income(70000, 'available'), income(30000, 'saved'));

  // all four directions in the Goals UI, each leaving Total untouched
  const fromAvail = add(base, transfer(4000, 'available', 'goal'));
  expectBalances('Available -> Goal 4,000', fromAvail, { total: 100000, available: 66000, saved: 30000, laptop: 4000 });
  const fromSaved = add(fromAvail, transfer(3000, 'saved', 'goal'));
  expectBalances('Saved -> Goal 3,000 (goal now 7,000)', fromSaved, { total: 100000, available: 66000, saved: 27000, laptop: 7000 });
  const toAvail = add(fromSaved, transfer(2000, 'goal', 'available'));
  expectBalances('Goal -> Available 2,000', toAvail, { total: 100000, available: 68000, saved: 27000, laptop: 5000 });
  const toSaved = add(toAvail, transfer(1000, 'goal', 'saved'));
  expectBalances('Goal -> Saved 1,000', toSaved, { total: 100000, available: 68000, saved: 28000, laptop: 4000 });

  // sheet rules enforced by the ledger
  check('withdraw more than the goal holds is blocked', rejectedWith('NEGATIVE_BALANCE', () => planAdd(toSaved, transfer(4001, 'goal', 'available'), RATES, GOALS)));
  check('withdraw exactly what it holds is allowed (goal -> 0)', (() => { const l = add(toSaved, transfer(4000, 'goal', 'available')); return (getBalances(l).goals.laptop ?? 0) === 0; })());
  check('add more than Available holds is blocked', rejectedWith('NEGATIVE_BALANCE', () => planAdd(base, transfer(70001, 'available', 'goal'), RATES, GOALS)));
  check('add more than Saved holds is blocked', rejectedWith('NEGATIVE_BALANCE', () => planAdd(base, transfer(30001, 'saved', 'goal'), RATES, GOALS)));

  // progress comes from the ledger only
  check('goal progress = ledger amount (4,000 of 10,000 = 40%)', (() => { const p = getGoalProgress(goal, toSaved); return p.savedAmount === 4000 && p.percent === 40; })());
  check('goal progress ignores money merely sitting in Saved', getGoalProgress(goal, base).savedAmount === 0);

  // status transitions
  const full = add(base, transfer(10000, 'available', 'goal'));
  check('reaching the target completes an active goal', nextGoalStatus(goal, full) === 'completed');
  check('exceeding the target keeps it completed (no change)', nextGoalStatus({ ...goal, status: 'completed' }, add(full, transfer(500, 'saved', 'goal'))) === null);
  const reopened = add(full, transfer(1, 'goal', 'available'));
  check('withdrawing below the target reopens a completed goal', nextGoalStatus({ ...goal, status: 'completed' }, reopened) === 'active');
  check('an active goal below target is left alone', nextGoalStatus(goal, toSaved) === null);
  check('raising the target above what is held reopens a completed goal', nextGoalStatus({ ...goal, status: 'completed', targetAmount: 20000 }, full) === 'active');
  check('lowering the target to what is held completes the goal', nextGoalStatus({ ...goal, targetAmount: 4000 }, toSaved) === 'completed');
  check('abandoned goals are never changed', nextGoalStatus({ ...goal, status: 'abandoned' }, full) === null);

  // a completed goal still holds money that can be moved out (and only then is it "free")
  check('a completed goal can be withdrawn to Saved', (() => { const l = add(full, transfer(10000, 'goal', 'saved')); const b = getBalances(l); return (b.goals.laptop ?? 0) === 0 && b.saved === 40000 && b.total === 100000; })());
}

console.log('\nStep 8: recurring schedule, recurring edits, category icons');
{
  const key = (d: Date) => toLocalDateKey(d);
  const anchor = (startKey: string) => parseDateKey(startKey).getDate();

  // Replicates the generator loop in db/database.ts: every occurrence due on or before `today`.
  const occurrences = (rule: { startDate: string; lastGeneratedDate: string | null; frequency: 'daily' | 'weekly' | 'monthly' }, today: string) => {
    const out: string[] = [];
    let next = getNextDueDate(rule);
    const todayDate = parseDateKey(today);
    while (next <= todayDate && out.length < 400) {
      out.push(key(next));
      next = advanceDate(next, rule.frequency, anchor(rule.startDate));
    }
    return out;
  };

  check('monthly from the 31st clamps to short months and returns to the 31st', occurrences({ startDate: '2026-01-31', lastGeneratedDate: null, frequency: 'monthly' }, '2026-05-31').join() === '2026-01-31,2026-02-28,2026-03-31,2026-04-30,2026-05-31', occurrences({ startDate: '2026-01-31', lastGeneratedDate: null, frequency: 'monthly' }, '2026-05-31').join());
  check('monthly from the 31st in a leap year uses Feb 29', occurrences({ startDate: '2028-01-31', lastGeneratedDate: null, frequency: 'monthly' }, '2028-03-01').join() === '2028-01-31,2028-02-29');
  check('monthly across a year boundary (Dec 15 -> Jan 15)', occurrences({ startDate: '2025-12-15', lastGeneratedDate: null, frequency: 'monthly' }, '2026-02-15').join() === '2025-12-15,2026-01-15,2026-02-15');
  check('weekly steps exactly 7 days', occurrences({ startDate: '2026-01-01', lastGeneratedDate: null, frequency: 'weekly' }, '2026-01-22').join() === '2026-01-01,2026-01-08,2026-01-15,2026-01-22');
  check('daily steps one day (across a month end)', occurrences({ startDate: '2026-01-30', lastGeneratedDate: null, frequency: 'daily' }, '2026-02-02').join() === '2026-01-30,2026-01-31,2026-02-01,2026-02-02');
  check('a rule starting in the future has nothing due yet', occurrences({ startDate: '2026-06-01', lastGeneratedDate: null, frequency: 'monthly' }, '2026-05-01').length === 0);
  check('resuming from lastGeneratedDate continues the cadence without repeating it', occurrences({ startDate: '2026-01-31', lastGeneratedDate: '2026-02-28', frequency: 'monthly' }, '2026-04-30').join() === '2026-03-31,2026-04-30');
  check('getNextDueDate = start before it has fired, next period after', key(getNextDueDate({ startDate: '2026-03-10', lastGeneratedDate: null, frequency: 'monthly' })) === '2026-03-10' && key(getNextDueDate({ startDate: '2026-03-10', lastGeneratedDate: '2026-03-10', frequency: 'monthly' })) === '2026-04-10');

  // editing must never back-post already-posted occurrences
  const planned = planRecurringEdit({ startDate: '2026-01-15', lastGeneratedDate: null, frequency: 'monthly' }, { startDate: '2026-02-01', frequency: 'monthly' });
  check('a rule that never fired takes the new start date', planned.startDate === '2026-02-01' && planned.lastGeneratedDate === null);
  const kept = planRecurringEdit({ startDate: '2026-01-15', lastGeneratedDate: '2026-03-15', frequency: 'monthly' }, { startDate: '2026-02-01', frequency: 'monthly' });
  check('a rule with history keeps its schedule even if a new date is submitted', kept.startDate === '2026-01-15' && kept.lastGeneratedDate === '2026-03-15');
  const switched = planRecurringEdit({ startDate: '2026-01-15', lastGeneratedDate: '2026-03-15', frequency: 'monthly' }, { startDate: '2026-01-15', frequency: 'daily' });
  check('changing frequency restarts at the date it was due next (no back-posting)', switched.startDate === '2026-04-15' && switched.lastGeneratedDate === null, JSON.stringify(switched));
  check('after a frequency change, nothing before the old next-due date is generated', occurrences({ startDate: switched.startDate, lastGeneratedDate: switched.lastGeneratedDate, frequency: 'daily' }, '2026-04-17').join() === '2026-04-15,2026-04-16,2026-04-17');

  // category icon suggestions
  const emoji = suggestCategoryEmoji;
  check('Salary -> briefcase, Food -> plate, Rent -> house', emoji('Salary') === '💼' && emoji('Food') === '🍽️' && emoji('Rent') === '🏠');
  check('Groceries -> cart (not the generic food plate)', emoji('Groceries') === '🛒');
  check('Coffee shop -> coffee (not shopping)', emoji('Coffee shop') === '☕');
  check('Car insurance -> shield (not taxi)', emoji('Car insurance') === '🛡️');
  check('Petrol -> fuel (not pet)', emoji('Petrol') === '⛽');
  check('Pet food -> paw', emoji('Pet food') === '🐾');
  check('Internet bill -> phone/data icon', emoji('Internet bill') === '📱');
  check('Education is not mistaken for "cat"', emoji('Education') === '📚');
  check('"Card fees" is not mistaken for a car', emoji('Card fees') !== '🚕');
  check('unknown or empty names get the neutral sparkle', emoji('Zzzz') === '✨' && emoji('') === '✨' && emoji('   ') === '✨');
}

console.log('\nLayout: tab bar clearance at any system font size');
{
  // What the icon + label really need: the label renders at the system scale capped at TAB_LABEL_MAX_SCALE.
  const needed = (fontScale: number) => 28 + Math.ceil(TAB_LABEL_FONT_SIZE * Math.min(fontScale, TAB_LABEL_MAX_SCALE) * 1.3);
  const roomFor = (fontScale: number, inset: number) => {
    const bar = getTabBarMetrics(fontScale, inset);
    return bar.height - bar.paddingTop - bar.paddingBottom;
  };

  // The previous hard-coded bar: height 56 + inset, paddingTop 6, paddingBottom inset + 6 -> 44dp for icon + label.
  const OLD_ROOM = 56 - 6 - 6;
  const oldNeeded = (fontScale: number) => 28 + Math.ceil(TAB_LABEL_FONT_SIZE * fontScale * 1.3);
  check('old fixed bar fitted at normal size', oldNeeded(1) <= OLD_ROOM);
  check('old fixed bar overflowed into the nav-bar space at 1.3x', oldNeeded(1.3) > OLD_ROOM);
  check('old fixed bar overflowed by >10dp at 2x (largest Android size)', oldNeeded(2) - OLD_ROOM > 10, `by ${oldNeeded(2) - OLD_ROOM}`);

  for (const inset of [0, 24, 48]) {
    for (const scale of [0.85, 1, 1.15, 1.3, 1.5, 2, 3]) {
      check(`bar has room for icon + label at font scale ${scale}, nav inset ${inset}`, roomFor(scale, inset) >= needed(scale), `room ${roomFor(scale, inset)} needed ${needed(scale)}`);
    }
    check(`system nav inset (${inset}) always stays clear below the content`, getTabBarMetrics(2, inset).paddingBottom >= inset);
  }
  check('normal size: bar is within 2dp of the previous 56dp + inset (no visible regression)', Math.abs(getTabBarMetrics(1, 24).height - (56 + 24)) <= 2, `${getTabBarMetrics(1, 24).height}`);
  check('bar stops growing past the label cap (3x == 1.3x), so it never balloons', getTabBarMetrics(3, 24).height === getTabBarMetrics(1.3, 24).height);
  check('one shared cap for tab labels and small controls (links, pills, chart labels)', CONTROL_LABEL_MAX_SCALE === TAB_LABEL_MAX_SCALE && CONTROL_LABEL_MAX_SCALE === 1.3);
  check('bar grows with font scale up to the cap', getTabBarMetrics(1.3, 24).height > getTabBarMetrics(1, 24).height);
}

console.log('\nMigration v3: V1 leftovers (real SQLite via node:sqlite) + milestone matching by goal id');
{
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
  const ids = (db: NodeDb, table: string, key = 'id'): string[] =>
    (db.prepare(`SELECT ${key} AS k FROM ${table} ORDER BY ${key}`).all() as { k: string }[]).map((row) => row.k);
  const version = (db: NodeDb): number => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  const countOf = (db: NodeDb, table: string): number => (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;

  // The V1 schema exactly as the V1 build created it (V1 snapshot commit d5059f4), including its later ALTERs.
  const V1_DDL = `
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, icon TEXT NOT NULL, color TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE currencies (code TEXT PRIMARY KEY, name TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE transactions (id TEXT PRIMARY KEY, type TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL, category TEXT NOT NULL, source TEXT NOT NULL DEFAULT '', date TEXT NOT NULL, timestamp TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE exchange_rates (id TEXT PRIMARY KEY, from_currency TEXT NOT NULL, to_currency TEXT NOT NULL, rate REAL NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE goals (id TEXT PRIMARY KEY, name TEXT NOT NULL, target_amount REAL NOT NULL, currency TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE budgets (id TEXT PRIMARY KEY, category TEXT NOT NULL, monthly_limit REAL NOT NULL, currency TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE recurring_transactions (id TEXT PRIMARY KEY, type TEXT NOT NULL, amount REAL NOT NULL, currency TEXT NOT NULL, category TEXT NOT NULL, source TEXT NOT NULL DEFAULT '', note TEXT, frequency TEXT NOT NULL, start_date TEXT NOT NULL, last_generated_date TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE user_origin (id TEXT PRIMARY KEY, story_text TEXT NOT NULL DEFAULT '', starting_point TEXT NOT NULL DEFAULT '', why_building TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
    CREATE TABLE milestones (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', date TEXT NOT NULL, type TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE monthly_snapshots (id TEXT PRIMARY KEY, month TEXT NOT NULL, income REAL NOT NULL, expenses REAL NOT NULL, savings REAL NOT NULL, currency TEXT NOT NULL, created_at TEXT NOT NULL);
    ALTER TABLE transactions ADD COLUMN goal_id TEXT;
    ALTER TABLE goals ADD COLUMN deadline TEXT;
    ALTER TABLE goals ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
  `;
  const V1 = '2025-09-10T08:00:00.000Z';
  const T0 = '2026-01-05T09:00:00.000Z'; // first V2 launch
  const afterT0 = (days: number) => new Date(Date.parse(T0) + days * 86400000).toISOString();

  const v1Device = (): NodeDb => {
    const db = new DatabaseSync(':memory:');
    db.exec(V1_DDL);
    const cat = db.prepare('INSERT INTO categories (id,name,type,icon,color,is_default) VALUES (?,?,?,?,?,?)');
    for (const [id, name, type] of [
      ['salary', 'Salary', 'income'], ['freelance', 'Freelance', 'income'], ['food', 'Food', 'expense'], ['rent', 'Rent', 'expense'],
      ['transport', 'Transport', 'expense'], ['shopping', 'Shopping', 'expense'], ['savings', 'Savings', 'savings'],
    ]) cat.run(id, name, type, 'x', '#000', 1);
    cat.run('v1-coffee', 'Coffee', 'expense', 'x', '#000', 0);
    cat.run('v1-side', 'Side gig', 'income', 'x', '#000', 0);
    const cur = db.prepare('INSERT INTO currencies (code,name,is_default) VALUES (?,?,?)');
    for (const code of ['ETB', 'USD', 'EUR', 'GBP', 'CAD']) cur.run(code, code, 1);
    const rate = db.prepare('INSERT INTO exchange_rates VALUES (?,?,?,?,?)');
    rate.run('USD-ETB', 'USD', 'ETB', 155, V1); rate.run('EUR-ETB', 'EUR', 'ETB', 131.58, V1);
    db.prepare('INSERT INTO goals (id,name,target_amount,currency,deadline,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('g-old', 'Laptop', 20000, 'ETB', null, 'completed', V1, V1);
    db.prepare('INSERT INTO transactions (id,type,amount,currency,category,source,date,timestamp,note,goal_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('t1', 'income', 50000, 'ETB', 'Salary', 'Job', '2025-09-01', V1, null, null, V1, V1);
    db.prepare('INSERT INTO budgets VALUES (?,?,?,?,?,?)').run('b-old1', 'Food', 5000, 'ETB', V1, V1);
    db.prepare('INSERT INTO budgets VALUES (?,?,?,?,?,?)').run('b-old2', 'Coffee', 800, 'ETB', V1, V1);
    db.prepare('INSERT INTO recurring_transactions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run('r1', 'expense', 8000, 'ETB', 'Rent', 'Landlord', null, 'monthly', '2025-08-01', '2025-09-01', 1, V1, V1);
    db.prepare('INSERT INTO user_origin VALUES (?,?,?,?,?)').run('o-old', 'my V1 story', 'start', 'why', V1);
    db.prepare('INSERT INTO milestones VALUES (?,?,?,?,?,?)').run('m-old1', 'Laptop', 'V1 goal done', '2025-09-03', 'goal_completed', V1);
    db.prepare('INSERT INTO milestones VALUES (?,?,?,?,?,?)').run('m-old2', 'First streak', 'V1 streak', '2025-09-30', 'streak', V1);
    db.prepare('INSERT INTO monthly_snapshots VALUES (?,?,?,?,?,?,?)').run('s-old', '2025-09', 1, 1, 1, 'ETB', V1);
    return db;
  };

  // A device that already ran the first V2 build (user_version 2): ledger tables rebuilt, everything else kept,
  // then some V2-era usage after the first launch (T0).
  const v2Device = (): NodeDb => {
    const db = v1Device();
    db.exec('DROP TABLE transactions; DROP TABLE goals; DROP TABLE recurring_transactions; DROP TABLE monthly_snapshots;');
    db.exec(SCHEMA_DDL); // creates the four rebuilt tables; the kept ones (incl. milestones without goal_id) stay as they were
    db.exec('PRAGMA user_version = 2');
    db.prepare('INSERT INTO monthly_snapshots VALUES (?,?,?,?,?,?,?)').run('s-v2', '2025-12', 0, 0, 0, 'ETB', T0);
    db.prepare('INSERT INTO goals (id,name,target_amount,deadline,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('g-v2', 'Laptop', 20000, null, 'completed', afterT0(1), afterT0(1));
    db.prepare('INSERT INTO milestones VALUES (?,?,?,?,?,?)').run('m-v2', 'Laptop', 'V2 goal done', '2026-01-07', 'goal_completed', afterT0(2));
    db.prepare('INSERT INTO milestones VALUES (?,?,?,?,?,?)').run('m-v2-streak', 'V2 streak', 'x', '2026-01-08', 'streak', afterT0(3));
    db.prepare('UPDATE budgets SET monthly_limit = 6000, updated_at = ? WHERE id = ?').run(afterT0(2), 'b-old1'); // V1 budget edited in V2
    db.prepare('INSERT INTO budgets VALUES (?,?,?,?,?,?)').run('b-v2', 'Transport', 2000, 'ETB', afterT0(3), afterT0(3));
    db.prepare('UPDATE exchange_rates SET rate = 140, updated_at = ? WHERE id = ?').run(afterT0(1), 'EUR-ETB'); // V1 rate re-set in V2
    db.prepare('INSERT INTO user_origin VALUES (?,?,?,?,?)').run('o-v2', 'my V2 story', 's', 'w', afterT0(4));
    db.prepare('INSERT INTO categories (id,name,type,icon,color,is_default) VALUES (?,?,?,?,?,?)').run('v2-sav', 'Rainy day', 'savings', 'x', '#000', 0);
    db.prepare('INSERT INTO categories (id,name,type,icon,color,is_default) VALUES (?,?,?,?,?,?)').run('v2-cat', 'Gym', 'expense', 'x', '#000', 0);
    return db;
  };

  // ---- A. V1 device, first launch of the migrated build (user_version 0) -------------------------------------
  {
    const db = v1Device();
    const categoriesBefore = ids(db, 'categories').filter((id) => id !== 'savings');
    const currenciesBefore = ids(db, 'currencies', 'code');
    check('V1 database is at user_version 0 before', version(db) === 0);
    const purged = runMigrations(runnerFor(db), 0);
    check('A: every V1 milestone is gone', countOf(db, 'milestones') === 0, JSON.stringify(ids(db, 'milestones')));
    check('A: every V1 budget is gone', countOf(db, 'budgets') === 0);
    check('A: every V1 exchange rate is gone (placeholder defaults are re-seeded by initializeDatabase, not kept)', countOf(db, 'exchange_rates') === 0);
    check('A: the V1 origin story is gone', countOf(db, 'user_origin') === 0);
    check('A: the legacy Savings category is gone', !ids(db, 'categories').includes('savings'));
    check('A: all other categories (defaults AND custom) are untouched', JSON.stringify(ids(db, 'categories')) === JSON.stringify(categoriesBefore), JSON.stringify(ids(db, 'categories')));
    check('A: currencies are untouched', JSON.stringify(ids(db, 'currencies', 'code')) === JSON.stringify(currenciesBefore));
    check('A: V1 ledger tables were rebuilt empty (transactions, goals, recurring, snapshots)', ['transactions', 'goals', 'recurring_transactions', 'monthly_snapshots'].every((t) => countOf(db, t) === 0));
    check('A: reported counts match (2 milestones, 2 budgets, 2 rates, 1 origin, 1 savings category)', purged?.milestones === 2 && purged?.budgets === 2 && purged?.exchangeRates === 2 && purged?.origin === 1 && purged?.savingsCategories === 1, JSON.stringify(purged));
    check('A: user_version is now 3', version(db) === SCHEMA_VERSION && SCHEMA_VERSION === 3);
    check('A: milestones now has a goal_id column', (db.prepare('PRAGMA table_info(milestones)').all() as { name: string }[]).some((c) => c.name === 'goal_id'));
  }

  // ---- B. V2 device that already ran the first V2 build (user_version 2) ----------------------------------------
  {
    const db = v2Device();
    check('B: cutoff = the first monthly snapshot (first V2 launch)', findV2LaunchCutoff(runnerFor(db)) === T0);
    const currenciesBefore = ids(db, 'currencies', 'code');
    const goalsBefore = ids(db, 'goals');
    runMigrations(runnerFor(db), 2);
    check('B: V1 milestones removed, V2-era milestones kept', JSON.stringify(ids(db, 'milestones')) === JSON.stringify(['m-v2', 'm-v2-streak']), JSON.stringify(ids(db, 'milestones')));
    check('B: V1 budget removed, V1 budget you edited in V2 kept, V2 budget kept', JSON.stringify(ids(db, 'budgets')) === JSON.stringify(['b-old1', 'b-v2']), JSON.stringify(ids(db, 'budgets')));
    check('B: stale V1 rate removed, rate re-set in V2 kept', JSON.stringify(ids(db, 'exchange_rates')) === JSON.stringify(['EUR-ETB']), JSON.stringify(ids(db, 'exchange_rates')));
    check('B: V1 origin story removed, V2-edited one kept', JSON.stringify(ids(db, 'user_origin')) === JSON.stringify(['o-v2']));
    check('B: savings categories removed regardless of date (V1 default AND one made in V2)', !ids(db, 'categories').some((id) => id === 'savings' || id === 'v2-sav'));
    check('B: every non-savings category survives, including V1 and V2 custom ones', ['salary', 'food', 'v1-coffee', 'v1-side', 'v2-cat'].every((id) => ids(db, 'categories').includes(id)) && countOf(db, 'categories') === 9, String(countOf(db, 'categories')));
    check('B: currencies and V2 goals untouched', JSON.stringify(ids(db, 'currencies', 'code')) === JSON.stringify(currenciesBefore) && JSON.stringify(ids(db, 'goals')) === JSON.stringify(goalsBefore));
    const linked = db.prepare("SELECT goal_id FROM milestones WHERE id = 'm-v2'").get() as { goal_id: string | null };
    check('B: the kept V2 goal-completed milestone was linked to its goal id', linked.goal_id === 'g-v2', String(linked.goal_id));
    const streak = db.prepare("SELECT goal_id FROM milestones WHERE id = 'm-v2-streak'").get() as { goal_id: string | null };
    check('B: a streak milestone stays unlinked', streak.goal_id === null);
    check('B: user_version is now 3', version(db) === 3);

    // one-time: a later launch must never purge again
    db.prepare('INSERT INTO budgets VALUES (?,?,?,?,?,?)').run('b-late', 'Food', 1, 'ETB', V1, V1); // old-looking row added afterwards
    db.prepare('INSERT INTO categories (id,name,type,icon,color,is_default) VALUES (?,?,?,?,?,?)').run('late-sav', 'Late', 'savings', 'x', '#000', 0);
    const second = runMigrations(runnerFor(db), 3);
    check('B: re-running at version 3 is a no-op (nothing purged)', second === null && ids(db, 'budgets').includes('b-late') && ids(db, 'categories').includes('late-sav'));
  }

  // ---- C. fresh install -------------------------------------------------------------------------------------------
  {
    const db = new DatabaseSync(':memory:');
    runMigrations(runnerFor(db), 0);
    check('C: fresh install creates every table and ends at version 3', version(db) === 3 && ['categories', 'currencies', 'transactions', 'goals', 'budgets', 'milestones', 'user_origin', 'monthly_snapshots', 'exchange_rates', 'recurring_transactions'].every((t) => countOf(db, t) === 0));
  }

  // ---- D. all-or-nothing --------------------------------------------------------------------------------------------
  {
    const db = v2Device();
    const base = runnerFor(db);
    const failing: SqlRunner = { ...base, run: (sql, ...params) => { if (sql.includes('DELETE FROM user_origin')) throw new Error('disk full'); base.run(sql, ...params); } };
    let threw = false;
    try { runMigrations(failing, 2); } catch { threw = true; }
    check('D: a failure part-way throws, leaves user_version at 2, and rolls back every earlier delete', threw && version(db) === 2 && ids(db, 'milestones').length === 4 && ids(db, 'budgets').length === 3 && ids(db, 'categories').includes('savings'), `v${version(db)} milestones ${ids(db, 'milestones').length}`);
    runMigrations(base, 2);
    check('D: the next launch retries and completes', version(db) === 3 && ids(db, 'milestones').length === 2);
  }

  // ---- E. cutoff fallbacks --------------------------------------------------------------------------------------------
  {
    const db = new DatabaseSync(':memory:');
    db.exec(SCHEMA_DDL);
    check('E: no V2 footprint at all -> cutoff null (everything old is V1)', findV2LaunchCutoff(runnerFor(db)) === null);
    db.prepare('INSERT INTO goals (id,name,target_amount,deadline,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('g', 'x', 1, null, 'active', '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
    check('E: falls back to the oldest V2 goal when there is no snapshot', findV2LaunchCutoff(runnerFor(db)) === '2026-02-01T00:00:00.000Z');
    db.prepare('INSERT INTO monthly_snapshots VALUES (?,?,?,?,?,?,?)').run('s', '2026-01', 0, 0, 0, 'ETB', '2026-01-15T00:00:00.000Z');
    check('E: the snapshot wins when it exists', findV2LaunchCutoff(runnerFor(db)) === '2026-01-15T00:00:00.000Z');
  }

  // ---- F. milestones match by goal id, never title -------------------------------------------------------------------
  {
    const ms = (over: Partial<Milestone>): Milestone => ({ id: 'm', title: 'Laptop', description: '', date: '2026-01-01', type: 'goal_completed', goalId: null, createdAt: '', ...over });
    check('F: a leftover record titled "Laptop" (no goal id) no longer suppresses a new "Laptop" goal', !hasCompletionMilestone([ms({ goalId: null })], 'g-new'));
    check('F: a record for a DIFFERENT goal with the same title does not suppress it either', !hasCompletionMilestone([ms({ goalId: 'g-other' })], 'g-new'));
    check('F: a record for THIS goal id suppresses a duplicate, even if the goal was renamed', hasCompletionMilestone([ms({ goalId: 'g-new', title: 'Old name' })], 'g-new'));
    check('F: streak / manual milestones never count as a goal completion', !hasCompletionMilestone([ms({ type: 'streak', goalId: 'g-new' })], 'g-new'));
  }
}

console.log('\nNotifications: over-budget alerts and seen-state storage');
{
  const budget = (category: string, limit: number, currency = 'ETB'): Budget => ({ id: `b-${category}`, category, monthlyLimit: limit, currency, createdAt: '', updatedAt: '' });
  const jan = new Date(2026, 0, 15);
  const base = ledgerOf(income(100000, 'available', '2025-12-01'));
  const spend = (rows: Transaction[], amount: number, category: string, date: string): Transaction[] => [...rows, planAdd(rows, { type: 'expense', amount, currency: 'ETB', category, account: 'available', date }, RATES, GOALS)];

  // ---- alerts ----
  const over = spend(base, 1200, 'Food', '2026-01-05');
  const alerts = getBudgetAlerts([budget('Food', 1000)], over, RATES, jan);
  check('over budget: one alert with the right id, amount over, title and destination', alerts.length === 1 && alerts[0].id === 'budget-Food-2026-01' && alerts[0].amountOver === 200 && alerts[0].title === 'Over budget' && alerts[0].route === '/budgets', JSON.stringify(alerts));
  check('the description names the category and the amount', alerts[0].description === 'Food is over its monthly budget by ETB 200.00.', alerts[0].description);
  check('exactly at the limit is NOT over', getBudgetAlerts([budget('Food', 1200)], over, RATES, jan).length === 0);
  check('under the limit: no alert', getBudgetAlerts([budget('Food', 5000)], over, RATES, jan).length === 0);
  check('last month\'s spending does not alert this month', getBudgetAlerts([budget('Food', 1000)], spend(base, 1200, 'Food', '2025-12-20'), RATES, jan).length === 0);
  check('income and transfers are not spending', getBudgetAlerts([budget('Food', 100)], add(base, transfer(5000, 'available', 'saved', '2026-01-03')), RATES, jan).length === 0);
  check('only the budget\'s own category counts', getBudgetAlerts([budget('Food', 1000)], spend(base, 9999, 'Transport', '2026-01-05'), RATES, jan).length === 0);
  check('two budgets over -> two alerts, one each', getBudgetAlerts([budget('Food', 1000), budget('Fun', 100)], spend(over, 500, 'Fun', '2026-01-06'), RATES, jan).length === 2);
  check('a foreign-currency budget uses the stored rate (10 USD = 550 ETB; 600 spent is over)', getBudgetAlerts([budget('Food', 10, 'USD')], spend(base, 600, 'Food', '2026-01-05'), RATES, jan).length === 1);
  check('a budget in a currency with no rate cannot be compared, so it does not alert', getBudgetAlerts([budget('Food', 10, 'EUR')], over, RATES, jan).length === 0);
  check('the id includes the month: same budget, next month = a different notification', budgetNotificationId('Food', '2026-01') !== budgetNotificationId('Food', '2026-02'));
  check('the id follows the month of the date given (February -> 2026-02)', getBudgetAlerts([budget('Food', 1000)], spend(base, 1200, 'Food', '2026-02-05'), RATES, new Date(2026, 1, 20))[0].id === 'budget-Food-2026-02');

  // ---- seen state is stored (real SQLite) ----
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => { exec(sql: string): void; prepare(sql: string): { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown } } };
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA_DDL);
  const runner: SqlRunner = {
    exec: (sql) => db.exec(sql),
    all: <T,>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...params) as T[],
    run: (sql, ...params) => {
      db.prepare(sql).run(...params);
    },
  };
  check('the schema creates the notification_reads table', getReadIds(runner).length === 0);
  markRead(runner, ['budget-Food-2026-01', 'budget-Fun-2026-01'], '2026-01-10T00:00:00.000Z');
  check('read ids are stored and returned', JSON.stringify(getReadIds(runner).sort()) === JSON.stringify(['budget-Food-2026-01', 'budget-Fun-2026-01']));
  markRead(runner, ['budget-Food-2026-01'], '2026-02-01T00:00:00.000Z');
  check('marking the same id twice is harmless and keeps the first read time', getReadIds(runner).length === 2 && (db.prepare("SELECT read_at AS r FROM notification_reads WHERE id = 'budget-Food-2026-01'").all() as { r: string }[])[0].r === '2026-01-10T00:00:00.000Z');
  pruneReads(runner, '2026-01-20T00:00:00.000Z');
  check('old read flags are pruned', getReadIds(runner).length === 0);
  markRead(runner, ['recent'], '2026-03-01T00:00:00.000Z');
  pruneReads(runner, '2026-01-20T00:00:00.000Z');
  check('recent read flags survive pruning', getReadIds(runner).length === 1);

  // an already-migrated device gets the table on its next launch without a version bump
  const device = new DatabaseSync(':memory:');
  device.exec('CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT, type TEXT, icon TEXT, color TEXT, is_default INTEGER)');
  device.exec('PRAGMA user_version = 3');
  runMigrations({ exec: (sql) => device.exec(sql), all: <T,>(sql: string, ...params: unknown[]) => device.prepare(sql).all(...params) as T[], run: (sql, ...params) => { device.prepare(sql).run(...params); } }, 3);
  check('runMigrations on an already-v3 device still creates notification_reads (CREATE IF NOT EXISTS)', (device.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name = 'notification_reads'").all() as { c: number }[])[0].c === 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:\n  ' + failures.join('\n  '));
  process.exit(1);
}
