// Checks the pure rules behind the redesigned Home screen. Run: npx tsx scripts/verify-home.ts
import { planAddToGoal, planCreateGoal } from '../utils/accounts/goals';
import { accountsRouteFor, accountSubtitle, groupAccounts, parseTypeFilter, reservedLabel, staleRateNote, tileAccessibilityLabel, typeSubtotals, unvaluedNote } from '../utils/accounts/groups';
import { getGoalAmounts } from '../utils/accounts/reserve';
import { getTotals } from '../utils/accounts/totals';
import { getCurrentPeriodSummary } from '../utils/currency';
import { balanceToggleLabel, INITIAL_BALANCES_HIDDEN, toggleBalancesHidden } from '../utils/balanceVisibility';
import { formatETB, formatMoney, formatNumber, HIDDEN_AMOUNT, maskAmount } from '../utils/format';
import { newFixture } from './support/fixture';
import {
  AMOUNT_COLUMN_MIN_LEGEND_WIDTH,
  buildSpendingSlices,
  DONUT_SLICE_GAP,
  DONUT_STROKE_SHARE,
  donutSizeFor,
  entryAmountRole,
  formatEntryAmount,
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

// ---- hero: Total = the sum of the accounts, the Cash / Wallet / Bank tiles, the notes -----------------------------------------------
const NOW = new Date(2026, 0, 20);
function rich() {
  const f = newFixture();
  const cash = f.account('Cash', 'cash', 'ETB', 1200, '2026-01-01');
  const tele = f.account('Telebirr', 'wallet', 'ETB', 8160, '2026-01-01');
  const paypal = f.account('PayPal', 'wallet', 'USD', 45, '2026-01-01');
  const cbe = f.account('CBE', 'bank', 'ETB', 78123, '2026-01-01');
  const boa = f.account('BOA', 'bank', 'ETB', 12400, '2026-01-01');
  return { f, cash, tele, paypal, cbe, boa };
}
{
  const { f, cbe } = rich();
  const totals = getTotals(f.state(), NOW);
  const subs = typeSubtotals(totals.accounts);
  check('Total = the sum of the Cash / Wallet / Bank tiles (every account counted once)', Math.round(totals.total * 100) === Math.round((subs.cash + subs.wallet + subs.bank) * 100), `${totals.total}`);
  check('tiles: Cash 1,200; Wallet 8,160 + 45 USD x 55 = 10,635; Bank 78,123 + 12,400 = 90,523', subs.cash === 1200 && subs.wallet === 10635 && subs.bank === 90523);
  check('Total = 102,358', totals.total === 102358);
  check('groups come in the order Cash, Wallet, Bank, each with its accounts', groupAccounts(totals.accounts).map((g) => `${g.label}:${g.accounts.length}`).join() === 'Cash:1,Wallet:2,Bank:2');
  const onlyCash = newFixture();
  onlyCash.account('Cash', 'cash', 'ETB', 50, '2026-01-01');
  const oneGroup = groupAccounts(getTotals(onlyCash.state(), NOW).accounts);
  check('a type with no accounts is left out of the tiles; its subtotal is 0', oneGroup.length === 1 && oneGroup[0].type === 'cash' && typeSubtotals(getTotals(onlyCash.state(), NOW).accounts).bank === 0);
  const empty = getTotals(newFixture().state(), NOW);
  check('no accounts: Total 0, no groups, no notes', empty.total === 0 && groupAccounts(empty.accounts).length === 0 && staleRateNote(empty) === null && unvaluedNote(empty) === null);

  // reserved money: part of the Total, never added again
  const withGoal = planCreateGoal(f.state(), { name: 'Car', targetAmount: 20000, heldInAccountId: cbe }, f.ctx);
  const reserved = planAddToGoal(withGoal.state, withGoal.goal.id, 4500, f.ctx).state;
  const after = getTotals(reserved, NOW);
  const goalAmounts = getGoalAmounts(reserved.allocations);
  check('reserving 4,500 for a goal leaves the Total at 102,358 (it is still in the account)', after.total === 102358);
  check('goalsTotal reads the per-goal amounts: 4,500', goalsTotal(goalAmounts) === 4500);
  check('the reserved pill names the goal when one goal holds it', reservedLabel(cbe, 4500, reserved.goals, goalAmounts, formatNumber) === '4,500.00 reserved for Car');
  const second = planCreateGoal(reserved, { name: 'Trip', targetAmount: 100, heldInAccountId: cbe }, f.ctx);
  const both = planAddToGoal(second.state, second.goal.id, 50, f.ctx).state;
  check('...and says "goals" when more than one holds money there', reservedLabel(cbe, 4550, both.goals, getGoalAmounts(both.allocations), formatNumber) === '4,550.00 reserved for goals');
  check('nothing reserved: no pill', reservedLabel(cbe, 0, reserved.goals, goalAmounts, formatNumber) === null);

  // the notes under the total
  const old = getTotals({ ...f.state(), rates: [{ id: 'USD-ETB', fromCurrency: 'USD', toCurrency: 'ETB', rate: 55, updatedAt: new Date(2026, 0, 10).toISOString() }] }, NOW);
  check('a foreign rate 10 days old shows "Rate last updated 10 days ago"', staleRateNote(old) === 'Rate last updated 10 days ago');
  check('a fresh rate shows no note', staleRateNote(getTotals(f.state(), new Date(2026, 0, 2))) === null);
  check('several old rates say so in one line', staleRateNote({ staleRates: [{ currency: 'USD', ageDays: 9 }, { currency: 'EUR', ageDays: 14 }] }) === 'Exchange rates last updated up to 14 days ago');
  const noRate = getTotals({ ...f.state(), rates: [] }, NOW);
  check('an account that cannot be valued is named and left out of the Total', unvaluedNote(noRate) === 'Not in the total (no exchange rate): PayPal' && noRate.total === 102358 - 2475);
  check('account lines: ETB shows its type, a foreign account its own balance', accountSubtitle(totals.accounts[0], formatMoney) === 'Cash' && accountSubtitle(totals.accounts.find((x) => x.account.currency === 'USD')!, formatMoney) === 'Wallet · USD 45.00');
}
// ---- the Home tiles are the way into the accounts (there is no separate accounts card) ------------------------------------------------
check('each tile leads to the Accounts screen on its own type', (['cash', 'wallet', 'bank'] as const).every((type) => accountsRouteFor(type).pathname === '/accounts' && accountsRouteFor(type).params.type === type));
check('the type a tile passes is read back as the same filter (round trip for all three)', (['cash', 'wallet', 'bank'] as const).every((type) => parseTypeFilter(accountsRouteFor(type).params.type) === type));
check('no filter, an empty param (the "Show all" link), a wrong case or an unknown type all mean "show every account"', parseTypeFilter(undefined) === null && parseTypeFilter('') === null && parseTypeFilter('Bank') === null && parseTypeFilter('savings') === null && parseTypeFilter('goal') === null);
check('a repeated param uses the first value', parseTypeFilter(['wallet', 'cash']) === 'wallet' && parseTypeFilter([]) === null);
check('tile label: name, subtotal and where it leads', tileAccessibilityLabel({ label: 'Bank', subtotalETB: 90523 }, false, formatETB) === 'Bank, ETB 90,523.00. Opens your bank accounts.');
check('tile label with balances hidden does not read the amount out', tileAccessibilityLabel({ label: 'Cash', subtotalETB: 1200 }, true, formatETB) === 'Cash, amount hidden. Opens your cash accounts.' && !tileAccessibilityLabel({ label: 'Cash', subtotalETB: 1200 }, true, formatETB).includes('1,200'));
check('the tiles are still exactly the account groups that exist (one tile per type that has an account)', (() => {
  const { f } = rich();
  return groupAccounts(getTotals(f.state(), NOW).accounts).map((g) => g.type).join() === 'cash,wallet,bank';
})());
// ---- hidden balances: ONE shared flag, so Home and the Accounts screens always agree -------------------------------------------------
console.log('Hidden balances: the shared flag');
check('balances start hidden (every launch)', INITIAL_BALANCES_HIDDEN === true);
check('the eye flips it, and flips it back', toggleBalancesHidden(true) === false && toggleBalancesHidden(false) === true && toggleBalancesHidden(toggleBalancesHidden(true)) === true);
check('the eye button says what it will do: "Show balances" while hidden, "Hide balances" while shown', balanceToggleLabel(true) === 'Show balances' && balanceToggleLabel(false) === 'Hide balances');
check('hidden: an amount becomes the mask and none of its digits survive; shown: the text is untouched', maskAmount('ETB 1,200.00', true) === HIDDEN_AMOUNT && !/\d/.test(maskAmount('ETB 1,200.00', true)) && maskAmount('ETB 1,200.00', false) === 'ETB 1,200.00');
check('opening an account from a Home tile cannot change the flag: the route carries only the type', (['cash', 'wallet', 'bank'] as const).every((type) => Object.keys(accountsRouteFor(type).params).join() === 'type'));

// The screens must really use that one flag and one masking helper (a screen with its own copy of the state, or its own mask, would drift).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('node:fs') as { readFileSync(path: string, encoding: 'utf8'): string };
const source = (file: string): string => fs.readFileSync(`${process.cwd()}/${file}`, 'utf8');
const readsSharedFlag = /useUiStore\(\((\w+)\) => \1\.isBalanceHidden\)/;
const hasOwnHiddenState = /useState(<boolean>)?\([^)]*\)[^\n]*[Hh]idden|[Hh]idden[^\n]*useState/;
for (const file of ['app/(tabs)/index.tsx', 'app/accounts.tsx', 'app/account/[id].tsx']) {
  const text = source(file);
  check(`${file}: reads the shared hidden flag from the UI store`, readsSharedFlag.test(text));
  check(`${file}: has no hidden-balances state of its own`, !hasOwnHiddenState.test(text));
}
for (const file of ['components/home/HeroCard.tsx', 'components/accounts/AccountRow.tsx', 'app/accounts.tsx', 'app/account/[id].tsx']) {
  const text = source(file);
  check(`${file}: masks amounts with the shared maskAmount (no private mask)`, text.includes('maskAmount(') && !text.includes('HIDDEN_AMOUNT'));
}
const ui = source('store/ui.ts');
check('the UI store holds the flag with the shared start value and toggle rule', ui.includes('isBalanceHidden: INITIAL_BALANCES_HIDDEN') && ui.includes('toggleBalancesHidden(state.isBalanceHidden)'));
check('the Accounts screen has the eye in its header', /<AppHeader[^>]*title="Accounts"[^>]*showBalanceToggle/.test(source('app/accounts.tsx')));
const header = source('components/AppHeader.tsx');
check('the header eye toggles the shared flag and is labelled by the shared rule', header.includes('onPress={toggleBalanceVisibility}') && header.includes('accessibilityLabel={balanceToggleLabel(isBalanceHidden)}') && header.includes('state.isBalanceHidden'));
check('Home keeps its own eye on the same flag', source('app/(tabs)/index.tsx').includes('onToggleHidden={toggleBalanceVisibility}'));
check('what is hidden is unchanged: the Accounts total, the group subtotals and every row amount go through the mask', (() => {
  const text = source('app/accounts.tsx');
  return text.includes('mask(formatETB(totals.total))') && text.includes('mask(formatNumber(group.subtotalETB))') && text.includes('hidden={isBalanceHidden}');
})());
check('transaction lists are untouched: their amounts do not read the hidden flag', !source('components/home/RecentList.tsx').includes('isBalanceHidden') && !source('app/(tabs)/transactions.tsx').includes('isBalanceHidden'));

check('goalsTotal of nothing is 0', goalsTotal({}) === 0);
check('goalsTotal sums in cents (no float drift)', goalsTotal({ a: 0.1, b: 0.2 }) === 0.3);
check('goals line: shown only when goals > 0 AND balances visible', shouldShowGoalsLine(5000, false) && !shouldShowGoalsLine(5000, true) && !shouldShowGoalsLine(0, false) && !shouldShowGoalsLine(0, true));
check('goals line text', goalsLineText(5000) === 'Includes ETB 5,000.00 reserved for goals' && goalsLineText(2500.5) === 'Includes ETB 2,500.50 reserved for goals');

// ---- list rows: the system rows are neutral and signed ----------------------------------------------------------------------------
check('opening balance: neutral colour, plus sign', entryAmountRole({ type: 'opening' }) === 'transfer' && formatEntryAmount({ type: 'opening', amountETB: 100 }) === '+ETB 100.00');
check('adjustment: neutral colour, its own sign', entryAmountRole({ type: 'adjustment' }) === 'transfer' && formatEntryAmount({ type: 'adjustment', amountETB: -5 }) === '−ETB 5.00' && formatEntryAmount({ type: 'adjustment', amountETB: 5 }) === '+ETB 5.00');
check('income / expense / transfer rows are drawn as before', formatEntryAmount({ type: 'income', amountETB: 1234.5 }) === '+ETB 1,234.50' && formatEntryAmount({ type: 'expense', amountETB: 200 }) === '−ETB 200.00' && formatEntryAmount({ type: 'transfer', amountETB: 50 }) === 'ETB 50.00' && entryAmountRole({ type: 'income' }) === 'income' && entryAmountRole({ type: 'expense' }) === 'expense');

// ---- this month: Net = Income - Expenses --------------------------------------------------------------------------------
function monthOf(expense: number) {
  const f = newFixture();
  const id = f.account('Cash', 'cash', 'ETB', 0);
  f.add({ type: 'income', accountId: id, amount: 5000, currency: 'ETB', category: 'Salary', source: 'Job', date: '2025-12-01' });
  f.add({ type: 'income', accountId: id, amount: 1000, currency: 'ETB', category: 'Salary', source: 'Job', date: '2026-01-05' });
  f.add({ type: 'expense', accountId: id, amount: expense, currency: 'ETB', category: 'Food', date: '2026-01-06' });
  f.add({ type: 'adjustment', accountId: id, amount: -300, date: '2026-01-07' });
  return getCurrentPeriodSummary(f.state().entries, f.state().allocations, NOW);
}
const month = monthOf(1200);
check('Net is negative here, and an adjustment is not an expense', month.net === -200 && month.income === 1000 && month.expenses === 1200 && formatNet(month.net) === '−200.00');
const calm = monthOf(400);
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
