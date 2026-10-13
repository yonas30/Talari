// Checks the pure rules behind the redesigned Home screen. Run: npx tsx scripts/verify-home.ts
import { ExchangeRate, Transaction, TransactionInput } from '../types';
import { getBalances } from '../utils/balances';
import { getCurrentPeriodSummary } from '../utils/currency';
import {
  AMOUNT_COLUMN_MIN_LEGEND_WIDTH,
  buildSpendingSlices,
  DONUT_SLICE_GAP,
  DONUT_STROKE_SHARE,
  donutSizeFor,
  HOME_DONUT_RULE,
  showAmountColumn,
  formatNet,
  formatTransactionAmount,
  goalsLineText,
  goalsTotal,
  largestRemainderPercents,
  shouldShowGoalsLine,
  spendingAccessibilityLabel,
  transactionAmountRole,
} from '../utils/homeModel';
import { planAdd } from '../utils/transactions';

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
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const items = (...pairs: [string, number][]) => pairs.map(([label, amount]) => ({ label, amount }));

// ---- percentages ----------------------------------------------------------------------------------------------------
check('1/3 each: 34/33/33 (largest remainder, earliest first on equal remainders)', JSON.stringify(largestRemainderPercents([100, 100, 100])) === JSON.stringify([34, 33, 33]));
check('50.5 / 49.5 -> sums to 100', sum(largestRemainderPercents([50.5, 49.5])) === 100);
check('three equal thirds plus a sliver still sum to 100', sum(largestRemainderPercents([333.33, 333.33, 333.33, 0.01])) === 100);
check('zero total -> all zeros', JSON.stringify(largestRemainderPercents([0, 0, 0])) === JSON.stringify([0, 0, 0]) && largestRemainderPercents([]).length === 0);
check('a single amount is 100', JSON.stringify(largestRemainderPercents([42])) === JSON.stringify([100]));
let allSumTo100 = true;
for (let seed = 1; seed <= 500; seed += 1) {
  const count = 1 + (seed % 9);
  const amounts = Array.from({ length: count }, (_, i) => ((seed * (i + 7) * 7919) % 10007) / 3 + 0.01);
  allSumTo100 = allSumTo100 && sum(largestRemainderPercents(amounts)) === 100;
}
check('500 pseudo-random lists all sum to exactly 100', allSumTo100);

// ---- top 3 + Others -------------------------------------------------------------------------------------------------
const none = buildSpendingSlices([]);
check('0 categories: no slices, total 0', none.slices.length === 0 && none.total === 0);
check('categories with zero spend are ignored', buildSpendingSlices(items(['Food', 0])).slices.length === 0);
const one = buildSpendingSlices(items(['Food', 250]));
check('1 category: one slice at 100%, no Others', one.slices.length === 1 && one.slices[0].percent === 100 && !one.slices[0].isOthers && one.total === 250);
const two = buildSpendingSlices(items(['Food', 300], ['Rent', 100]));
check('2 categories: 75/25 in order, no Others', two.slices.map((s) => s.label).join() === 'Food,Rent' && two.slices.map((s) => s.percent).join() === '75,25');
const three = buildSpendingSlices(items(['A', 50], ['B', 30], ['C', 20]));
check('exactly 3 categories: all shown, NO Others row', three.slices.length === 3 && three.slices.every((s) => !s.isOthers) && sum(three.slices.map((s) => s.percent)) === 100);
const four = buildSpendingSlices(items(['A', 50], ['B', 30], ['C', 15], ['D', 5]));
check('4 categories: top 3 + Others (= the 4th)', four.slices.length === 4 && four.slices[3].isOthers && four.slices[3].label === 'Others' && four.slices[3].amount === 5);
const many = buildSpendingSlices(items(['A', 100], ['B', 90], ['C', 80], ['D', 70], ['E', 60], ['F', 50], ['G', 40], ['H', 10]));
check('many categories: top 3 + one Others holding the rest', many.slices.length === 4 && many.slices[3].isOthers && many.slices[3].amount === 230 && many.slices.slice(0, 3).map((s) => s.label).join() === 'A,B,C');
check('many categories: percentages sum to exactly 100', sum(many.slices.map((s) => s.percent)) === 100);
check('the slices add back up to the month total (nothing lost into Others)', Math.abs(sum(many.slices.map((s) => s.amount)) - many.total) < 0.005 && many.total === 500);
const unsorted = buildSpendingSlices(items(['Small', 1], ['Big', 900], ['Mid', 99]));
check('input order does not matter: biggest first', unsorted.slices.map((s) => s.label).join() === 'Big,Mid,Small');
const ties = buildSpendingSlices(items(['Zeta', 100], ['Alpha', 100], ['Mid', 100], ['Beta', 100], ['Omega', 100]));
check('ties: stable by name, Others holds the last two', ties.slices.slice(0, 3).map((s) => s.label).join() === 'Alpha,Beta,Mid' && ties.slices[3].isOthers && ties.slices[3].amount === 200);
check('ties: still sums to 100', sum(ties.slices.map((s) => s.percent)) === 100);
check('keys are unique and Others has a fixed key', new Set(many.slices.map((s) => s.key)).size === many.slices.length && many.slices[3].key === 'others');
check('does not modify its input', (() => {
  const input = items(['B', 2], ['A', 3]);
  const copy = JSON.stringify(input);
  buildSpendingSlices(input);
  return JSON.stringify(input) === copy;
})());

// ---- accessibility summary ------------------------------------------------------------------------------------------
check('empty ring has a plain label', spendingAccessibilityLabel([], 0, false) === 'No expenses logged yet this month.');
const label = spendingAccessibilityLabel(four.slices, four.total, false);
check('summary names every slice with its percent and the total', label.includes('ETB 100.00') && four.slices.every((s) => label.includes(`${s.label} ${s.percent} percent`)));
check('hidden balances: amounts are not read out', !spendingAccessibilityLabel(four.slices, four.total, true).includes('ETB'));

// ---- signed amounts and colour roles --------------------------------------------------------------------------------
check('expense: minus sign, ETB, 2 decimals', formatTransactionAmount('expense', 200) === '−ETB 200.00');
check('income: plus sign', formatTransactionAmount('income', 1234.5) === '+ETB 1,234.50');
check('transfer: no sign at all', formatTransactionAmount('transfer', 50) === 'ETB 50.00');
check('sign never doubles if a stored amount were negative', formatTransactionAmount('expense', -200) === '−ETB 200.00' && formatTransactionAmount('income', -5) === '+ETB 5.00');
check('roles: income -> income colour, expense -> expense colour, transfer -> neutral', transactionAmountRole('income') === 'income' && transactionAmountRole('expense') === 'expense' && transactionAmountRole('transfer') === 'transfer');
check('Net positive: explicit +', formatNet(1234.5) === '+1,234.50');
check('Net negative: explicit minus (and it stays the Net role, see below)', formatNet(-1234.5) === '−1,234.50');
check('Net zero: no sign', formatNet(0) === '0.00' && formatNet(-0) === '0.00' && formatNet(0.004) === '0.00');
check('Net small negative rounds before signing', formatNet(-0.006) === '−0.01');

// ---- hero: Total = Available + Saved + goals, and the goals line ----------------------------------------------------------
const RATES: ExchangeRate[] = [{ id: 'USD-ETB', fromCurrency: 'USD', toCurrency: 'ETB', rate: 55, updatedAt: '2026-01-01T00:00:00Z' }];
const GOAL_NAMES = { laptop: 'Laptop', trip: 'Trip' };
function ledgerOf(...inputs: TransactionInput[]): Transaction[] {
  const ledger: Transaction[] = [];
  for (const input of inputs) {
    ledger.push(planAdd(ledger, input, RATES, GOAL_NAMES));
  }
  return ledger;
}
const inc = (amount: number, account: 'available' | 'saved', date = '2026-01-01', currency = 'ETB'): TransactionInput => ({
  type: 'income', amount, currency, category: 'Salary', source: 'Job', account, date,
});
const exp = (amount: number, date = '2026-01-02'): TransactionInput => ({ type: 'expense', amount, currency: 'ETB', category: 'Food', account: 'available', date });
const move = (amount: number, from: 'available' | 'saved' | 'goal', to: 'available' | 'saved' | 'goal', goalId = 'laptop', date = '2026-01-03'): TransactionInput => ({
  type: 'transfer', amount, currency: 'ETB', fromAccount: from, toAccount: to,
  fromGoalId: from === 'goal' ? goalId : null, toGoalId: to === 'goal' ? goalId : null, date,
});

const scenarios: [string, Transaction[]][] = [
  ['empty ledger', []],
  ['income only', ledgerOf(inc(70000, 'available'), inc(30000, 'saved'))],
  ['with a goal holding money', ledgerOf(inc(70000, 'available'), inc(30000, 'saved'), move(5000, 'saved', 'goal'))],
  ['two goals, an expense and a foreign-currency income', ledgerOf(inc(100000, 'available'), inc(100, 'saved', '2026-01-01', 'USD'), move(2500.5, 'available', 'goal', 'laptop'), move(1000, 'available', 'goal', 'trip'), exp(333.33))],
  ['goal money moved back out', ledgerOf(inc(10000, 'available'), move(4000, 'available', 'goal'), move(1500, 'goal', 'saved'))],
  ['cents', ledgerOf(inc(0.1, 'available'), inc(0.2, 'saved'), move(0.05, 'available', 'goal'))],
];
for (const [name, ledger] of scenarios) {
  const balances = getBalances(ledger);
  const goalsAmount = goalsTotal(balances.goals);
  const lhs = Math.round(balances.total * 100);
  const rhs = Math.round(balances.available * 100) + Math.round(balances.saved * 100) + Math.round(goalsAmount * 100);
  check(`Total = Available + Saved + goals (${name})`, lhs === rhs, `${lhs} vs ${rhs}`);
}
const withGoal = getBalances(scenarios[2][1]);
check('goalsTotal reads the per-goal balances', goalsTotal(withGoal.goals) === 5000 && withGoal.saved === 25000 && withGoal.total === 100000);
check('goalsTotal of nothing is 0', goalsTotal({}) === 0);
check('goalsTotal sums in cents (no float drift)', goalsTotal({ a: 0.1, b: 0.2 }) === 0.3);
check('goals line: shown only when goals > 0 AND balances visible', shouldShowGoalsLine(5000, false) && !shouldShowGoalsLine(5000, true) && !shouldShowGoalsLine(0, false) && !shouldShowGoalsLine(0, true));
check('goals line text', goalsLineText(5000) === 'Includes ETB 5,000.00 in goals' && goalsLineText(2500.5) === 'Includes ETB 2,500.50 in goals');

// ---- this month: Net = Income - Expenses --------------------------------------------------------------------------------
const now = new Date(2026, 0, 20);
const month = getCurrentPeriodSummary(ledgerOf(inc(5000, 'available', '2025-12-01'), inc(1000, 'available', '2026-01-05'), exp(1200, '2026-01-06')), now);
check('Net comes from the existing summary and is negative here', month.net === -200 && formatNet(month.net) === '−200.00');
const calm = getCurrentPeriodSummary(ledgerOf(inc(5000, 'available', '2025-12-01'), inc(1000, 'available', '2026-01-05'), exp(400, '2026-01-06')), now);
check('Net positive here', calm.net === 600 && formatNet(calm.net) === '+600.00');

// ---- the shared donut: Home keeps exactly today's numbers (before/after) ---------------------------------------------------
// "Before" is the formula Home's card used inline (commit 3cb18ff and since): a third of the card width, 96-168, 0 until measured.
const oldDonutSize = (inner: number) => (inner > 0 ? Math.max(96, Math.min(168, Math.round(inner * 0.33))) : 96);
const oldShowAmounts = (legend: number) => legend === 0 || legend >= 194;
let sizesSame = true;
for (const width of [0, 1, 96, 100, 240, 243, 288, 290, 318, 340, 375, 400, 450, 510, 520, 600, 1000, 317.6]) {
  sizesSame = sizesSame && donutSizeFor(width) === oldDonutSize(width);
}
check('Home donut diameter is unchanged for every card width (a third of it, 96 to 168; 96 before it is measured)', sizesSame);
check('Home donut at the common widths: 320 dp phone 96, 360 dp 96, 390 dp 105, 412 dp 112, tablet 168', [240, 288, 318, 340, 700].map((w) => donutSizeFor(w)).join() === '96,96,105,112,168');
let amountsSame = true;
for (const width of [0, 50, 193, 193.9, 194, 195, 300]) {
  amountsSame = amountsSame && showAmountColumn(width) === oldShowAmounts(width);
}
check('the amount column appears under exactly the same condition as before (unmeasured, or a legend of 194 dp or more)', amountsSame && AMOUNT_COLUMN_MIN_LEGEND_WIDTH === 194);
check('stroke is 14% of the diameter and slices are 2 px apart (Home today)', DONUT_STROKE_SHARE === 0.14 && DONUT_SLICE_GAP === 2 && HOME_DONUT_RULE.share === 0.33 && HOME_DONUT_RULE.min === 96 && HOME_DONUT_RULE.max === 168);
check('Home ring at its sizes: stroke 13 / 15 / 24 dp', [96, 105, 168].map((d) => Math.round(d * DONUT_STROKE_SHARE)).join() === '13,15,24');
check('Insights ring: fixed 160 dp, stroke 22 dp', Math.round(160 * DONUT_STROKE_SHARE) === 22);

// Insights lists every category (no "Others"), with the same percentage rule
const coloured = [
  { label: 'Rent', amount: 5000, color: '#f97316' },
  { label: 'Food', amount: 3000, color: '#f59e0b' },
  { label: 'Transport', amount: 1200, color: '#ef4444' },
  { label: 'Fun', amount: 800, color: '#8b5cf6' },
  { label: 'Health', amount: 600, color: '#3b82f6' },
  { label: 'Gifts', amount: 250, color: '#10b981' },
  { label: 'Misc', amount: 150, color: '#14b8a6' },
];
const everything = buildSpendingSlices(coloured, Number.POSITIVE_INFINITY);
check('Insights: all 7 categories listed, none folded into Others', everything.slices.length === 7 && everything.slices.every((slice) => !slice.isOthers));
check('Insights: percentages add to exactly 100 and the total is the sum', sum(everything.slices.map((slice) => slice.percent)) === 100 && everything.total === 11000);
check('Insights: each slice keeps the colour the breakdown gave it', everything.slices.map((slice) => slice.color).join() === coloured.map((item) => item.color).join());
const homeView = buildSpendingSlices(coloured);
check('Home view of the same data is still top 3 + Others (4 slices)', homeView.slices.length === 4 && homeView.slices[3].isOthers && homeView.slices[3].amount === 1800);
check('Home: the first three slices carry the breakdown colours, Others has none (it is drawn grey)', homeView.slices.slice(0, 3).map((slice) => slice.color).join() === '#f97316,#f59e0b,#ef4444' && homeView.slices[3].color === undefined);
check('one category and empty data work for Insights too', buildSpendingSlices([{ label: 'A', amount: 10 }], Number.POSITIVE_INFINITY).slices[0].percent === 100 && buildSpendingSlices([], Number.POSITIVE_INFINITY).slices.length === 0);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
