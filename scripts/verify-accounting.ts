// Accounting verification for V2_SPEC Part W (Test Cases 1-13) plus extra edge cases.
// Run:  TZ=Africa/Addis_Ababa npx tsx scripts/verify-accounting.ts
//
// It drives the same pure functions the store uses (planAdd / planEdit / planDelete +
// getBalances), so it checks the real validation and balance logic - not a copy of it. It cannot
// exercise React Native screens or SQLite; those are covered separately.

import { ExchangeRate, Transaction, TransactionInput } from '../types';
import { getBalances, LedgerError, LedgerErrorCode } from '../utils/balances';
import { calculateBuilderStreak, getBudgetProgress } from '../utils/currency';
import { toLocalDateKey } from '../utils/dates';
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:\n  ' + failures.join('\n  '));
  process.exit(1);
}
