// Checks the pure rules behind the redesigned Home screen. Run: npx tsx scripts/verify-home.ts
import { ExchangeRate, Transaction, TransactionInput } from '../types';
import { getBalances } from '../utils/balances';
import { getCurrentPeriodSummary } from '../utils/currency';
import {
  buildSpendingSlices,
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
