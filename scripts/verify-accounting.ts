// Accounting verification for everything around the ledger: Insights periods and trends, goal progress and status, the streak, budgets
// against real entries, recurring schedules, category icons, layout, the schema 3 migration steps, notification storage and search.
// The accounts ledger itself (V2_SPEC Part W: balances, transfers and fees, foreign currency, reserved goal money, backup, the schema 4
// migration) is checked by scripts/verify-accounts.ts. The old Available / Saved ledger tests were retired with that model.
// Run:  TZ=Africa/Addis_Ababa npx tsx scripts/verify-accounting.ts

import { findV2LaunchCutoff, migrateToSchema3, SCHEMA_DDL, SqlRunner } from '../db/migrations';
import { getReadIds, markRead, pruneReads } from '../db/notificationReads';
import { Budget, ExchangeRate, Milestone } from '../types';
import { AccountEntry, GoalAllocation } from '../types/accounts';
import { EntryInput } from '../utils/accounts/entries';
import { planAddEntry, planDeleteEntry, planEditEntry } from '../utils/accounts/entries';
import { planAddToGoal, planCreateGoal, planDeleteGoal, planWithdrawFromGoal } from '../utils/accounts/goals';
import { getGoalAmount } from '../utils/accounts/reserve';
import { calculateStreak, getPeriodSummary } from '../utils/accounts/totals';
import { getBudgetProgress, getGoalProgress, getProjectedCompletionDate, nextGoalStatus } from '../utils/currency';
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
import {
  clearAllNotifications,
  forgetReadIds,
  GOAL_MISSING_MESSAGE,
  goalNotificationItems,
  markAllRead,
  markRead as markListRead,
  mergeNotifications,
  notificationActionLabel,
  notificationOpensLabel,
  notificationTarget,
  notificationVisualState,
  replaceGoalItems,
  resolveGoalFocus,
  sortNewestFirst,
  unreadCount,
} from '../utils/notificationList';
import { AppNotification } from '../types/notifications';
import { forgetReads } from '../db/notificationReads';
import { expiredIds, markReserveRead, pruneExpired } from '../utils/accounts/notificationRetention';
import { filterByType, filterTransactions, TypeFilter } from '../utils/search';
import { newFixture, USD_55 } from './support/fixture';

const RATES: ExchangeRate[] = USD_55;

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

// Entries recorded through the real ledger rules in two ETB accounts: Cash (a cash account) and Savings (a bank account), both starting
// empty. A step is built once the accounts' ids are known.
interface Ids {
  cash: string;
  bank: string;
}
type Step = (ids: Ids) => EntryInput;
type Which = keyof Ids;

function ledgerOf(...steps: Step[]): AccountEntry[] {
  const f = newFixture(RATES);
  const ids: Ids = { cash: f.account('Cash', 'cash'), bank: f.account('Savings', 'bank') };
  for (const step of steps) {
    f.add(step(ids));
  }
  return f.state().entries;
}

const income = (amount: number, account: Which = 'cash', date = '2026-01-01'): Step => (ids) => ({
  type: 'income', accountId: ids[account], amount, currency: 'ETB', category: 'Salary', source: 'Job', date,
});
const expense = (amount: number, account: Which = 'cash', date = '2026-01-02', currency = 'ETB', category = 'Food'): Step => (ids) => ({
  type: 'expense', accountId: ids[account], amount, currency, category, date,
});
const transfer = (amount: number, from: Which, to: Which, date = '2026-01-02'): Step => (ids) => ({
  type: 'transfer', fromAccountId: ids[from], toAccountId: ids[to], fromAmount: amount, toAmount: amount, date,
});

console.log('\nStreak, budgets and arithmetic on real entries');
{
  // streak: local day keys. Run under TZ=Africa/Addis_Ababa (UTC+3) to exercise the old UTC bug.
  const at1am = new Date(2026, 0, 10, 1, 0, 0);
  const rows = ledgerOf(income(100, 'cash', '2026-01-08'), income(100, 'cash', '2026-01-09'), income(100, 'cash', '2026-01-10'));
  check(`streak at 01:00 local (TZ=${process.env.TZ ?? 'system'}) counts 3 consecutive days`, calculateStreak(rows, [], at1am) === 3, `got ${calculateStreak(rows, [], at1am)}`);
  const noToday = rows.slice(0, 2);
  check('streak survives a day with nothing logged yet (yesterday active)', calculateStreak(noToday, [], at1am) === 2);
  check('streak breaks after a gap', calculateStreak(ledgerOf(income(1, 'cash', '2026-01-05')), [], at1am) === 0);
  const one = ledgerOf(income(100, 'cash', '2026-01-01'))[0];
  const withAuto = [one, { ...one, id: 'auto', date: '2026-01-10', isAutomatic: true }];
  check('automatically generated (recurring) rows do not count toward the streak', calculateStreak(withAuto, [], at1am) === 0, `got ${calculateStreak(withAuto, [], at1am)}`);
  const transferRows = ledgerOf(income(100, 'cash', '2026-01-01'), transfer(10, 'cash', 'bank', '2026-01-09'));
  const manual: GoalAllocation = { id: 'a1', goalId: 'g', accountId: 'a', amount: 10, date: '2026-01-10', kind: 'manual', createdAt: '2026-01-10T10:00:00.000Z' };
  check('transfers and manual goal additions count toward the streak', calculateStreak(transferRows, [manual], at1am) === 2, `got ${calculateStreak(transferRows, [manual], at1am)}`);
}
{
  // budgets use amountETB and a converted limit
  const l = ledgerOf(income(100000), expense(10, 'cash', '2026-01-02', 'USD', 'Food'));
  const budget = { id: 'b', category: 'Food', monthlyLimit: 10, currency: 'USD', createdAt: '', updatedAt: '' };
  const progress = getBudgetProgress(budget, l, RATES, new Date(2026, 0, 15));
  check('budget spent = 550 ETB vs limit 10 USD = 550 ETB (not over)', progress.spentAmount === 550 && progress.limitETB === 550 && !progress.isOverBudget);
  check('budget in a currency with no rate is not compared', getBudgetProgress({ ...budget, currency: 'EUR' }, l, RATES, new Date(2026, 0, 15)).limitETB === null);
}
{
  // arithmetic
  const l = ledgerOf(income(0.1, 'cash', '2026-01-01'), income(0.2, 'cash', '2026-01-01'));
  check('0.1 + 0.2 = 0.3 exactly (cent arithmetic)', getPeriodSummary(l, '2026-01').income === 0.3);
}

console.log('\nStep 5: Insights periods, navigation, custom range, trend');
{
  // Fixture across several months. Transfers and a USD expense (on an ETB account, converted at the stored rate) are included on purpose.
  const L = ledgerOf(
    income(100000, 'cash', '2025-12-31'),
    income(5000, 'cash', '2026-01-01'),
    expense(300, 'cash', '2026-01-05'),
    expense(200, 'cash', '2026-01-31'),
    transfer(1000, 'cash', 'bank', '2026-01-31'),
    income(7000, 'bank', '2026-02-01'),
    expense(10, 'cash', '2026-02-10', 'USD', 'Food'),
    expense(400, 'cash', '2026-02-28'),
    income(2000, 'cash', '2026-03-15'),
    expense(50, 'cash', '2026-03-15'),
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
  // --- system rows are neither income nor spending ---
  const sys = newFixture(RATES);
  const sysAccount = sys.account('Cash', 'cash', 'ETB', 500, '2026-01-05');
  sys.add({ type: 'adjustment', accountId: sysAccount, amount: -100, date: '2026-01-06' });
  const sysRows = sys.state().entries;
  check('trend ignores the opening balance and adjustments (neither is income or spending)', getTrendSeries(sysRows, '2026-01-05', '2026-01-06').every((point) => point.income === 0 && point.expense === 0));
  check('period totals and the category breakdown ignore them too', getPeriodTotals(sysRows).income === 0 && getPeriodTotals(sysRows).expenses === 0 && getCategoryBreakdown(sysRows).length === 0 && getSourceBreakdown(sysRows).length === 0);
}

console.log('\nStep 6: status bar contrast');
{
  check('app background (#F7F7F3) gets dark icons', statusBarStyleForBackground('#F7F7F3') === 'dark');
  check('white gets dark icons', statusBarStyleForBackground('#FFFFFF') === 'dark');
  check('navy (#172033) gets light icons', statusBarStyleForBackground('#172033') === 'light');
  check('black gets light icons', statusBarStyleForBackground('#000') === 'light');
  check('orange accent (#E87532) gets dark icons', statusBarStyleForBackground('#E87532') === 'dark');
}

console.log('\nStep 7: Goals - progress from allocations, completion status, projected date');
{
  const f = newFixture(RATES);
  const cbe = f.account('CBE', 'bank', 'ETB', 100000, '2026-01-01');
  const created = planCreateGoal(f.state(), { name: 'Laptop', targetAmount: 10000, heldInAccountId: cbe }, f.ctx);
  const goal = { id: created.goal.id, targetAmount: 10000, status: 'active' as const };
  const added = (state: typeof created.state, amount: number) => planAddToGoal(state, goal.id, amount, f.ctx).state;
  const taken = (state: typeof created.state, amount: number) => planWithdrawFromGoal(state, goal.id, amount, f.ctx).state;

  const four = added(created.state, 4000);
  check('goal progress = the sum of its allocations (4,000 of 10,000 = 40%)', (() => { const p = getGoalProgress(goal, four.allocations); return p.savedAmount === 4000 && p.percent === 40; })());
  check('money merely sitting in the account is not goal progress', getGoalProgress(goal, created.state.allocations).savedAmount === 0);
  const seven = added(four, 3000);
  const five = taken(seven, 2000);
  check('adding 3,000 then freeing 2,000 leaves 5,000', getGoalAmount(five.allocations, goal.id) === 5000 && getGoalProgress(goal, five.allocations).percent === 50);
  check('progress is capped at 100% even if more is set aside', getGoalProgress(goal, added(five, 8000).allocations).percent === 100);

  // status transitions
  const full = added(created.state, 10000);
  check('reaching the target completes an active goal', nextGoalStatus(goal, full.allocations) === 'completed');
  check('exceeding the target keeps it completed (no change)', nextGoalStatus({ ...goal, status: 'completed' as const }, added(full, 500).allocations) === null);
  const reopened = taken(full, 1);
  check('withdrawing below the target reopens a completed goal', nextGoalStatus({ ...goal, status: 'completed' as const }, reopened.allocations) === 'active');
  check('an active goal below target is left alone', nextGoalStatus(goal, five.allocations) === null);
  check('raising the target above what is held reopens a completed goal', nextGoalStatus({ ...goal, status: 'completed' as const, targetAmount: 20000 }, full.allocations) === 'active');
  check('lowering the target to what is held completes the goal', nextGoalStatus({ ...goal, targetAmount: 5000 }, five.allocations) === 'completed');
  check('abandoned goals are never changed', nextGoalStatus({ ...goal, status: 'abandoned' as const }, full.allocations) === null);

  // reserved money being used up by spending reopens a completed goal too (the allocation falls back below the target)
  const spent = f.add;
  void spent;

  // projected completion: pace of what the owner has set aside, by month
  const ref = new Date(2026, 0, 20);
  check('no manual additions: no projection', getProjectedCompletionDate(goal, created.state.allocations, ref) === null);
  const projected = getProjectedCompletionDate(goal, added(created.state, 5000).allocations, ref);
  check('5,000 of 10,000 set aside this month projects one more month (2026-02-20)', projected !== null && toLocalDateKey(projected) === '2026-02-20', projected ? toLocalDateKey(projected) : 'null');
  check('a goal that is already full projects "today"', getProjectedCompletionDate(goal, full.allocations, ref)?.getTime() === ref.getTime());
  check('automatic reductions are not "pace": with only a withdrawal there is no projection', getProjectedCompletionDate(goal, [{ id: 'w', goalId: goal.id, accountId: cbe, amount: -100, date: '2026-01-10', kind: 'auto_reduce', createdAt: '' }], ref) === null);
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

console.log('\nMigration schema 3 step: V1 leftovers (real SQLite via node:sqlite) + milestone matching by goal id');
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
    const purged = migrateToSchema3(runnerFor(db), 0);
    check('A: every V1 milestone is gone', countOf(db, 'milestones') === 0, JSON.stringify(ids(db, 'milestones')));
    check('A: every V1 budget is gone', countOf(db, 'budgets') === 0);
    check('A: every V1 exchange rate is gone (placeholder defaults are re-seeded by initializeDatabase, not kept)', countOf(db, 'exchange_rates') === 0);
    check('A: the V1 origin story is gone', countOf(db, 'user_origin') === 0);
    check('A: the legacy Savings category is gone', !ids(db, 'categories').includes('savings'));
    check('A: all other categories (defaults AND custom) are untouched', JSON.stringify(ids(db, 'categories')) === JSON.stringify(categoriesBefore), JSON.stringify(ids(db, 'categories')));
    check('A: currencies are untouched', JSON.stringify(ids(db, 'currencies', 'code')) === JSON.stringify(currenciesBefore));
    check('A: V1 ledger tables were rebuilt empty (transactions, goals, recurring, snapshots)', ['transactions', 'goals', 'recurring_transactions', 'monthly_snapshots'].every((t) => countOf(db, t) === 0));
    check('A: reported counts match (2 milestones, 2 budgets, 2 rates, 1 origin, 1 savings category)', purged?.milestones === 2 && purged?.budgets === 2 && purged?.exchangeRates === 2 && purged?.origin === 1 && purged?.savingsCategories === 1, JSON.stringify(purged));
    check('A: user_version is now 3', version(db) === 3);
    check('A: milestones now has a goal_id column', (db.prepare('PRAGMA table_info(milestones)').all() as { name: string }[]).some((c) => c.name === 'goal_id'));
  }

  // ---- B. V2 device that already ran the first V2 build (user_version 2) ----------------------------------------
  {
    const db = v2Device();
    check('B: cutoff = the first monthly snapshot (first V2 launch)', findV2LaunchCutoff(runnerFor(db)) === T0);
    const currenciesBefore = ids(db, 'currencies', 'code');
    const goalsBefore = ids(db, 'goals');
    migrateToSchema3(runnerFor(db), 2);
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
    const second = migrateToSchema3(runnerFor(db), 3);
    check('B: re-running at version 3 is a no-op (nothing purged)', second === null && ids(db, 'budgets').includes('b-late') && ids(db, 'categories').includes('late-sav'));
  }

  // ---- C. fresh install -------------------------------------------------------------------------------------------
  {
    const db = new DatabaseSync(':memory:');
    migrateToSchema3(runnerFor(db), 0);
    check('C: fresh install creates every table and ends at version 3', version(db) === 3 && ['categories', 'currencies', 'transactions', 'goals', 'budgets', 'milestones', 'user_origin', 'monthly_snapshots', 'exchange_rates', 'recurring_transactions'].every((t) => countOf(db, t) === 0));
  }

  // ---- D. all-or-nothing --------------------------------------------------------------------------------------------
  {
    const db = v2Device();
    const base = runnerFor(db);
    const failing: SqlRunner = { ...base, run: (sql, ...params) => { if (sql.includes('DELETE FROM user_origin')) throw new Error('disk full'); base.run(sql, ...params); } };
    let threw = false;
    try { migrateToSchema3(failing, 2); } catch { threw = true; }
    check('D: a failure part-way throws, leaves user_version at 2, and rolls back every earlier delete', threw && version(db) === 2 && ids(db, 'milestones').length === 4 && ids(db, 'budgets').length === 3 && ids(db, 'categories').includes('savings'), `v${version(db)} milestones ${ids(db, 'milestones').length}`);
    migrateToSchema3(base, 2);
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
  const base: Step[] = [income(100000, 'cash', '2025-12-01')];
  const spend = (steps: Step[], amount: number, category: string, date: string): Step[] => [...steps, expense(amount, 'cash', date, 'ETB', category)];

  // ---- alerts ----
  const over = spend(base, 1200, 'Food', '2026-01-05');
  const overRows = ledgerOf(...over);
  const alerts = getBudgetAlerts([budget('Food', 1000)], overRows, RATES, jan);
  check('over budget: one alert with the right id, amount over, title and destination', alerts.length === 1 && alerts[0].id === 'budget-Food-2026-01' && alerts[0].amountOver === 200 && alerts[0].title === 'Over budget' && alerts[0].route === '/budgets', JSON.stringify(alerts));
  check('the description names the category and the amount', alerts[0].description === 'Food is over its monthly budget by ETB 200.00.', alerts[0].description);
  check('exactly at the limit is NOT over', getBudgetAlerts([budget('Food', 1200)], overRows, RATES, jan).length === 0);
  check('under the limit: no alert', getBudgetAlerts([budget('Food', 5000)], overRows, RATES, jan).length === 0);
  check('last month\'s spending does not alert this month', getBudgetAlerts([budget('Food', 1000)], ledgerOf(...spend(base, 1200, 'Food', '2025-12-20')), RATES, jan).length === 0);
  check('income and transfers are not spending', getBudgetAlerts([budget('Food', 100)], ledgerOf(...base, transfer(5000, 'cash', 'bank', '2026-01-03')), RATES, jan).length === 0);
  check('only the budget\'s own category counts', getBudgetAlerts([budget('Food', 1000)], ledgerOf(...spend(base, 9999, 'Transport', '2026-01-05')), RATES, jan).length === 0);
  check('two budgets over -> two alerts, one each', getBudgetAlerts([budget('Food', 1000), budget('Fun', 100)], ledgerOf(...spend(over, 500, 'Fun', '2026-01-06')), RATES, jan).length === 2);
  check('a foreign-currency budget uses the stored rate (10 USD = 550 ETB; 600 spent is over)', getBudgetAlerts([budget('Food', 10, 'USD')], ledgerOf(...spend(base, 600, 'Food', '2026-01-05')), RATES, jan).length === 1);
  check('a budget in a currency with no rate cannot be compared, so it does not alert', getBudgetAlerts([budget('Food', 10, 'EUR')], overRows, RATES, jan).length === 0);
  check('a transfer fee is an expense (category Fees) and counts toward a Fees budget', (() => {
    const f = newFixture(RATES);
    const cash = f.account('Cash', 'cash', 'ETB', 1000, '2025-12-01');
    const bank = f.account('Savings', 'bank');
    f.add({ type: 'transfer', fromAccountId: cash, toAccountId: bank, fromAmount: 100, toAmount: 100, fee: { amount: 60, currency: 'ETB' }, date: '2026-01-05' });
    return getBudgetAlerts([budget('Fees', 50)], f.state().entries, RATES, jan).length === 1;
  })());
  check('the id includes the month: same budget, next month = a different notification', budgetNotificationId('Food', '2026-01') !== budgetNotificationId('Food', '2026-02'));
  check('the id follows the month of the date given (February -> 2026-02)', getBudgetAlerts([budget('Food', 1000)], ledgerOf(...spend(base, 1200, 'Food', '2026-02-05')), RATES, new Date(2026, 1, 20))[0].id === 'budget-Food-2026-02');

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
  migrateToSchema3({ exec: (sql) => device.exec(sql), all: <T,>(sql: string, ...params: unknown[]) => device.prepare(sql).all(...params) as T[], run: (sql, ...params) => { device.prepare(sql).run(...params); } }, 3);
  check('the schema 3 step on an already-v3 device still creates notification_reads (CREATE IF NOT EXISTS)', (device.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name = 'notification_reads'").all() as { c: number }[])[0].c === 1);
}

console.log('\nGoal notifications: listing, unread count, tap-through, deleted goal, multi-goal overspend');
{
  // A bank account with two goals; Laptop was set aside first, Car second (the most recent contribution).
  const f = newFixture(RATES);
  const cbe = f.account('CBE', 'bank', 'ETB', 100000, '2026-01-01');
  const laptop = planCreateGoal(f.state(), { name: 'Laptop', targetAmount: 50000, heldInAccountId: cbe }, f.ctx);
  const car = planCreateGoal(laptop.state, { name: 'Car', targetAmount: 20000, heldInAccountId: cbe }, f.ctx);
  f.setState(planAddToGoal(planAddToGoal(car.state, laptop.goal.id, 30000, f.ctx).state, car.goal.id, 20000, f.ctx).state);

  // ---- overspend touching two goals: one notification per goal, listed newest first ----
  const spend = f.add({ type: 'expense', accountId: cbe, amount: 80000, currency: 'ETB', category: 'Food', date: '2026-01-10' });
  const after = spend.state;
  const items = goalNotificationItems(after.notifications, after.goals, {});
  check('spending 80,000 of 100,000 with 50,000 reserved saves one notification per goal affected (2)', after.notifications.length === 2 && spend.notifications.length === 2 && items.length === 2);
  check('every item is a goal notification carrying its goal id and time', items.every((item) => item.type === 'goal' && item.createdAt && item.goalId) && items[0].goalId === car.goal.id && items[1].goalId === laptop.goal.id);
  const listed = sortNewestFirst(items);
  check('the page lists the newest first (Laptop was reduced after Car)', listed[0].goalId === laptop.goal.id && listed[1].goalId === car.goal.id);
  check('Car\'s text: all 20,000 used, now 0 of 20,000', items[0].description === 'ETB 20,000.00 reserved for Car was used. Car is now ETB 0.00 of ETB 20,000.00.', items[0].description);
  check('Laptop\'s text: 10,000 used, now 20,000 of 50,000', items[1].description === 'ETB 10,000.00 reserved for Laptop was used. Laptop is now ETB 20,000.00 of ETB 50,000.00.', items[1].description);
  check('the title is the same short line for both', items.every((item) => item.title === 'Reserved money used'));
  check('the page sorting does not change the list it was given', items[0].goalId === car.goal.id);

  // ---- unread count (the bell badge) and the read tracking ----
  check('new goal notifications are unread: the badge counts both', unreadCount(items) === 2);
  check('a saved read flag counts (it travels with a backup)', unreadCount(goalNotificationItems(after.notifications.map((n, i) => (i === 0 ? { ...n, read: true } : n)), after.goals, {})) === 1);
  check('the existing seen-state (notification_reads) counts too', unreadCount(goalNotificationItems(after.notifications, after.goals, { [after.notifications[1].id]: true })) === 1);
  check('opening the page marks them all read: the badge drops to 0', unreadCount(markAllRead(items)) === 0);
  check('marking one read leaves the other unread', unreadCount(markListRead(items, [items[0].id])) === 1);
  const budget: AppNotification = { id: 'budget-Food-2026-01', title: 'Over budget', description: 'Food is over.', isRead: false, type: 'budget', route: '/budgets' };
  const combined = mergeNotifications([], [budget, ...items], {}, '2026-01-12T08:00:00.000Z');
  check('budget alerts and goal notifications share one list and one badge (3 unread)', combined.length === 3 && unreadCount(combined) === 3);
  check('an item with no time is stamped with when it was first seen, and keeps that stamp', combined.find((n) => n.id === budget.id)?.createdAt === '2026-01-12T08:00:00.000Z' && mergeNotifications(combined, [budget], {}, '2026-02-01T00:00:00.000Z').find((n) => n.id === budget.id)?.createdAt === '2026-01-12T08:00:00.000Z');
  check('budget alerts first seen now are newer than older goal events, so they list first', sortNewestFirst(combined)[0].id === budget.id);
  const readOnce = markAllRead(combined);
  check('re-merging the same items does not duplicate them or make a read one unread', (() => {
    const again = mergeNotifications(readOnce, [budget, ...items], {}, '2026-02-01T00:00:00.000Z');
    return again.length === 3 && unreadCount(again) === 0;
  })());
  check('a seen id from an earlier launch keeps a recomputed alert read', unreadCount(mergeNotifications([], [budget], { [budget.id]: true }, '2026-01-12T08:00:00.000Z')) === 0);
  check('two notifications from the same moment keep their order, later one first', sortNewestFirst([{ ...budget, id: 'a', createdAt: 't' }, { ...budget, id: 'b', createdAt: 't' }]).map((n) => n.id).join() === 'b,a');

  // ---- tap-through ----
  const target = notificationTarget(items[1]);
  check('tapping a goal notification opens the Goals tab with that goal in the route param', target?.pathname === '/goals' && target?.params?.goal === laptop.goal.id);
  check('budget alerts still open Budgets; a plain system notice opens nothing', notificationTarget(budget)?.pathname === '/budgets' && notificationTarget({ type: 'system' }) === null);
  check('the link line follows the kind: View goal / Review budgets / none', notificationActionLabel(items[0]) === 'View goal →' && notificationActionLabel(budget) === 'Review budgets →' && notificationActionLabel({ type: 'system' }) === null);
  check('the spoken hint follows the kind too (no "budgets" on a goal)', notificationOpensLabel(items[0]) === 'Opens the goal.' && notificationOpensLabel(budget) === 'Opens budgets.' && notificationOpensLabel({ type: 'system' }) === '');
  const focus = resolveGoalFocus(target?.params?.goal, after.goals);
  check('the Goals tab finds the goal and says which tab it is on (active)', focus.kind === 'goal' && focus.goalId === laptop.goal.id && focus.tab === 'active');
  check('a completed goal is found on the Completed tab', (() => { const done = resolveGoalFocus(laptop.goal.id, after.goals.map((g) => (g.id === laptop.goal.id ? { ...g, status: 'completed' as const } : g))); return done.kind === 'goal' && done.tab === 'completed'; })());
  check('no param, an empty param (cleared after use) and an empty list mean "do nothing"', resolveGoalFocus(undefined, after.goals).kind === 'none' && resolveGoalFocus('', after.goals).kind === 'none' && resolveGoalFocus([], after.goals).kind === 'none');
  check('a repeated param uses the first value', (() => { const r = resolveGoalFocus([laptop.goal.id, 'x'], after.goals); return r.kind === 'goal' && r.goalId === laptop.goal.id; })());

  // ---- the goal is gone: deleted (its notifications go with it) or missing from a restored backup (the fallback message) ----
  const withoutCar = planDeleteGoal(after, car.goal.id);
  check('deleting a goal removes its saved notifications; the other goal keeps its own', withoutCar.notifications.length === 1 && withoutCar.notifications[0].goalId === laptop.goal.id && after.notifications.length === 2);
  // A restored backup can still carry a notification whose goal is not in it: the fallback below.
  const goneItems = goalNotificationItems(after.notifications, withoutCar.goals, {});
  check('a notification whose goal is missing (a restored backup) still reads sensibly', goneItems.length === 2 && goneItems[0].description === 'ETB 20,000.00 reserved for a goal was used.', goneItems[0].description);
  check('...and tapping it still goes to the Goals tab, with the missing goal\'s id', notificationTarget(goneItems[0])?.pathname === '/goals' && notificationTarget(goneItems[0])?.params?.goal === car.goal.id);
  const missing = resolveGoalFocus(car.goal.id, withoutCar.goals);
  check('...where the tab says "That goal no longer exists." instead of failing', missing.kind === 'missing' && GOAL_MISSING_MESSAGE === 'That goal no longer exists.');
  check('the other goal\'s notification still finds its goal', resolveGoalFocus(laptop.goal.id, withoutCar.goals).kind === 'goal');
  check('a goal notification with no goal id at all still opens the Goals tab (nothing to find)', notificationTarget({ type: 'goal', goalId: null })?.pathname === '/goals' && notificationTarget({ type: 'goal', goalId: null })?.params === undefined);
}
{
  // ---- the same behaviour when an EDIT or a DELETE breaks the reserved rule, and the Add-form warning before saving ----
  const f = newFixture(RATES);
  const cbe = f.account('CBE', 'bank', 'ETB', 30000, '2026-01-01');
  f.add({ type: 'income', accountId: cbe, amount: 70000, currency: 'ETB', category: 'Salary', source: 'Job', date: '2026-01-02' });
  const goal = planCreateGoal(f.state(), { name: 'Laptop', targetAmount: 90000, heldInAccountId: cbe }, f.ctx);
  f.setState(planAddToGoal(goal.state, goal.goal.id, 60000, f.ctx).state);
  const base = f.state();
  const incomeId = base.entries.find((e) => e.type === 'income')!.id;

  const warn = planAddEntry(base, { type: 'expense', accountId: cbe, amount: 50000, currency: 'ETB', category: 'Food', date: '2026-01-03' }, f.ctx);
  check('before saving: an expense of 50,000 reports it uses 10,000 of the 60,000 reserved (the warning under the amount)', warn.reserveUsed.length === 1 && warn.reserveUsed[0].shortfall === 10000 && warn.reserveUsed[0].reservedBefore === 60000);
  check('...planning it saved nothing: no notification exists yet and the badge stays at 0', base.notifications.length === 0 && unreadCount(goalNotificationItems(base.notifications, base.goals, {})) === 0);
  check('after saving it: the goal shrank by 10,000 and one notification exists (badge 1)', warn.notifications.length === 1 && unreadCount(goalNotificationItems(warn.state.notifications, warn.state.goals, {})) === 1 && getGoalAmount(warn.state.allocations, goal.goal.id) === 50000);

  const edited = planEditEntry(base, incomeId, { type: 'income', accountId: cbe, amount: 20000, currency: 'ETB', category: 'Salary', source: 'Job', date: '2026-01-02' }, f.ctx);
  check('editing the income down behaves the same: the goal shrinks and one notification is listed', edited.notifications.length === 1 && goalNotificationItems(edited.state.notifications, edited.state.goals, {})[0].description === 'ETB 10,000.00 reserved for Laptop was used. Laptop is now ETB 50,000.00 of ETB 90,000.00.');
  const deleted = planDeleteEntry(base, incomeId, f.ctx);
  const deletedItems = goalNotificationItems(deleted.state.notifications, deleted.state.goals, {});
  check('deleting the income behaves the same: 30,000 used, one notification', deleted.reserveUsed[0]?.shortfall === 30000 && deletedItems.length === 1 && deletedItems[0].description === 'ETB 30,000.00 reserved for Laptop was used. Laptop is now ETB 30,000.00 of ETB 90,000.00.');
  check('an edit that does not touch reserved money lists nothing', planEditEntry(base, incomeId, { type: 'income', accountId: cbe, amount: 80000, currency: 'ETB', category: 'Salary', source: 'Job', date: '2026-01-02' }, f.ctx).notifications.length === 0);
  const second = planAddEntry(edited.state, { type: 'expense', accountId: cbe, amount: 20000, currency: 'ETB', category: 'Food', date: '2026-01-04' }, f.ctx);
  const both = goalNotificationItems(second.state.notifications, second.state.goals, {});
  check('a second overspend later adds a second item (two in the list, newest first, badge 2)', both.length === 2 && sortNewestFirst(both)[0].id === second.notifications[0].id && unreadCount(both) === 2);
}
{
  // ---- the screens really use these rules (a page with its own hard-coded text or order would drift) ----
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as { readFileSync(path: string, encoding: 'utf8'): string };
  const source = (file: string): string => fs.readFileSync(`${process.cwd()}/${file}`, 'utf8');
  const page = source('app/notifications.tsx');
  check('the Notifications page sorts newest first and takes its link text and target from the shared rules', page.includes('sortNewestFirst(') && page.includes('notificationActionLabel(') && page.includes('notificationTarget(') && page.includes('notificationOpensLabel('));
  check('the page no longer hard-codes "Review budgets" or "Opens budgets" for every item', !page.includes('Review budgets') && !page.includes('Opens budgets'));
  check('the page saves the goal notifications as read as well as the seen-state', page.includes('markReserveNotificationsRead'));
  const store = source('store/finance.ts');
  check('the store shows saved goal notifications after loading AND after every ledger write', (store.match(/syncReserveNotifications\(\);/g) ?? []).length >= 2 && store.includes('goalNotificationItems('));
  const goalsScreen = source('app/(tabs)/goals.tsx');
  check('the Goals tab reads the goal route param, resolves it with the shared rule and shows the shared message', goalsScreen.includes('useLocalSearchParams') && goalsScreen.includes('resolveGoalFocus(') && goalsScreen.includes('GOAL_MISSING_MESSAGE'));
  check('the Goals tab scrolls to the goal and clears the param so the same tap works again', goalsScreen.includes('scrollTo(') && goalsScreen.includes("router.setParams({ goal: '' })"));
  check('the bell badge counts the shared notification list (so goal items reach it)', source('components/AppHeader.tsx').includes('state.notifications.filter((notification) => !notification.isRead).length'));
}

console.log('\nNotifications page: unread look, read on tap and on leave, badge timing, goal deleted, Clear all');
{
  const f = newFixture(RATES);
  const cbe = f.account('CBE', 'bank', 'ETB', 100000, '2026-01-01');
  const laptop = planCreateGoal(f.state(), { name: 'Laptop', targetAmount: 50000, heldInAccountId: cbe }, f.ctx);
  const car = planCreateGoal(laptop.state, { name: 'Car', targetAmount: 20000, heldInAccountId: cbe }, f.ctx);
  f.setState(planAddToGoal(planAddToGoal(car.state, laptop.goal.id, 30000, f.ctx).state, car.goal.id, 20000, f.ctx).state);
  const after = f.add({ type: 'expense', accountId: cbe, amount: 80000, currency: 'ETB', category: 'Food', date: '2026-01-10' }).state;
  const goalItems = goalNotificationItems(after.notifications, after.goals, {});
  const budget: AppNotification = { id: 'budget-Food-2026-01', title: 'Over budget', description: 'Food is over.', isRead: false, type: 'budget', route: '/budgets' };
  const list = mergeNotifications([], [budget, ...goalItems], {}, '2026-01-12T08:00:00.000Z');

  // ---- the unread look: a dot, a slightly stronger background and "Unread." - for budget alerts AND goal notifications ----
  const unreadLook = { dot: true, tinted: true, accessibilityPrefix: 'Unread. ' };
  check('an unread budget alert shows the dot, the stronger background and "Unread."', JSON.stringify(notificationVisualState(list.find((n) => n.type === 'budget')!)) === JSON.stringify(unreadLook));
  check('an unread goal notification looks the same', list.filter((n) => n.type === 'goal').every((n) => JSON.stringify(notificationVisualState(n)) === JSON.stringify(unreadLook)));
  check('a read one has none of the three', JSON.stringify(notificationVisualState({ isRead: true })) === JSON.stringify({ dot: false, tinted: false, accessibilityPrefix: '' }));
  check('the unread look is never colour alone (the spoken prefix is always there with the dot)', list.every((n) => notificationVisualState(n).dot === (notificationVisualState(n).accessibilityPrefix !== '')));

  // ---- opening the page marks nothing; a tap marks that item; leaving marks the rest; the badge follows ----
  check('on arrival nothing has changed: the badge still counts all three and every row is unread', unreadCount(list) === 3 && list.every((n) => notificationVisualState(n).dot));
  const afterTap = markListRead(list, [goalItems[1].id]);
  check('tapping one marks only that one read: badge 2, the others still look unread', unreadCount(afterTap) === 2 && notificationVisualState(afterTap.find((n) => n.id === goalItems[1].id)!).dot === false && afterTap.filter((n) => n.id !== goalItems[1].id).every((n) => notificationVisualState(n).dot));
  const afterLeave = markAllRead(afterTap);
  check('leaving the page marks all the rest read: the badge drops to 0 only now', unreadCount(afterLeave) === 0 && afterLeave.every((n) => !notificationVisualState(n).dot));
  check('tapping a budget alert marks it read too', unreadCount(markListRead(list, [budget.id])) === 2 && markListRead(list, [budget.id]).find((n) => n.id === budget.id)!.isRead);
  check('read stays read when the same items are merged again (a later load or ledger write)', unreadCount(mergeNotifications(afterLeave, [budget, ...goalItems], {}, '2026-02-01T00:00:00.000Z')) === 0);

  // the saved flag on the goal notifications (the one a backup keeps)
  const saved = markReserveRead(after.notifications, [after.notifications[0].id]);
  check('the saved read flag: a tap saves just that notification as read', saved[0].read && !saved[1].read && saved[1] === after.notifications[1]);
  check('...and leaving saves all of them (no ids = all); already-read ones are left as they are', markReserveRead(saved).every((n) => n.read) && markReserveRead(saved)[0] === saved[0]);

  // the page really works that way (a mount-time "mark all read" is what hid the unread items before)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as { readFileSync(path: string, encoding: 'utf8'): string };
  const page = fs.readFileSync(`${process.cwd()}/app/notifications.tsx`, 'utf8');
  check('the page does not mark anything read when it opens (no effect that marks all)', !/useEffect\([\s\S]{0,200}markAllNotificationsAsRead/.test(page) && !page.includes('useEffect'));
  check('the page marks the rest read when it is LEFT (the cleanup of a focus effect)', page.includes('useFocusEffect') && /\(\)\s*=>\s*\(\)\s*=>\s*\{[\s\S]{0,200}markAllNotificationsAsRead\(\)/.test(page));
  check('the page marks a notification read on tap, and its saved flag for goal items', page.includes('markNotificationAsRead(notification.id)') && page.includes('markReserveNotificationsRead([notification.id])'));
  check('the page draws unread rows from the shared state (dot, stronger background, spoken prefix)', page.includes('notificationVisualState(') && page.includes('visual.dot') && page.includes('visual.tinted') && page.includes('visual.accessibilityPrefix'));

  // ---- deleting a goal: its notifications go, and their read records ----
  const gone = planDeleteGoal(after, car.goal.id);
  check('deleting a goal deletes its saved notifications only', gone.notifications.length === 1 && gone.notifications.every((n) => n.goalId !== car.goal.id));
  check('...and the page\'s list loses that goal item (the replace rule) but keeps the budget alert and the other goal\'s item', (() => {
    const next = replaceGoalItems(list, goalNotificationItems(gone.notifications, gone.goals, {}), {}, '2026-01-13T00:00:00.000Z');
    return next.length === 2 && next.some((n) => n.id === budget.id) && next.every((n) => n.goalId !== car.goal.id);
  })());
  const readRecords = { [goalItems[0].id]: true as const, [goalItems[1].id]: true as const, [budget.id]: true as const };
  check('their read records are forgotten; others stay', JSON.stringify(Object.keys(forgetReadIds(readRecords, [goalItems[0].id])).sort()) === JSON.stringify([goalItems[1].id, budget.id].sort()));
  {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => { exec(sql: string): void; prepare(sql: string): { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown } } };
    const db = new DatabaseSync(':memory:');
    db.exec(SCHEMA_DDL);
    const runner: SqlRunner = { exec: (sql) => db.exec(sql), all: <T,>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...params) as T[], run: (sql, ...params) => { db.prepare(sql).run(...params); } };
    markRead(runner, ['a', 'b', 'c'], '2026-01-10T00:00:00.000Z');
    forgetReads(runner, ['a', 'c']);
    check('in the database the read records of deleted notifications are removed (the rest stay)', JSON.stringify(getReadIds(runner)) === JSON.stringify(['b']));
    forgetReads(runner, []);
    check('forgetting nothing is harmless', getReadIds(runner).length === 1);
  }
  const store = fs.readFileSync(`${process.cwd()}/store/finance.ts`, 'utf8');
  check('the store deletes the notifications, their read records and the list copies when a goal is deleted', /deleteGoal: async[\s\S]{0,500}deleteReserveNotifications\(gone\)[\s\S]{0,120}forgetReadIds\(gone\)/.test(store));
  check('...and removes expired ones when the app loads, with their read records', store.includes('expiredIds(ledger.notifications') && /deleteReserveNotifications\(\[\.\.\.expired\]\)/.test(store));
  check('the goal-gone message is still the fallback for a notification whose goal is missing', resolveGoalFocus(car.goal.id, gone.goals).kind === 'missing' && GOAL_MISSING_MESSAGE === 'That goal no longer exists.');

  // ---- Clear all ----
  const cleared = clearAllNotifications(list);
  check('Clear all removes every goal notification from the list', cleared.every((n) => n.type !== 'goal') && cleared.length === 1);
  check('...a budget alert cannot be deleted (it is recomputed), so it stays and is marked read', cleared[0].id === budget.id && cleared[0].isRead && unreadCount(cleared) === 0);
  check('...so the badge is 0 and the list is just the read budget alert', unreadCount(cleared) === 0);
  check('...and after it the saved goal notifications are none', replaceGoalItems(list, [], {}, '2026-01-13T00:00:00.000Z').filter((n) => n.type === 'goal').length === 0);
  check('Clear all on an empty list is harmless', clearAllNotifications([]).length === 0);
  check('the page asks first, and names what it does', page.includes('Alert.alert(') && page.includes("'Clear all notifications?'") && page.includes('clearReserveNotifications') && page.includes('marked as read instead'));
  check('the store clears the saved rows (an empty list), their read records, and marks budget alerts read', /clearReserveNotifications: async[\s\S]{0,600}notifications: \[\][\s\S]{0,300}clearAllNotifications\(\)/.test(store));
}
{
  // ---- expiry (the rule itself is in verify-accounts; here, how it is used) ----
  const NOW_X = new Date(2026, 2, 1, 12);
  const mk = (id: string, daysAgo: number, read: boolean) => ({ id, kind: 'goal_reserve_used' as const, goalId: 'g', accountId: 'a', amount: 1, amountAfter: 0, createdAt: new Date(NOW_X.getTime() - daysAgo * 86_400_000).toISOString(), read });
  const saved = [mk('d29', 29, false), mk('d30', 30, true), mk('d31', 31, false), mk('d31r', 31, true)];
  check('app load: day 29 stays, day 31 goes, read or not', pruneExpired(saved, NOW_X).map((n) => n.id).join() === 'd29,d30' && expiredIds(saved, NOW_X).join() === 'd31,d31r');
  check('budget alerts are not touched by expiry (it only handles saved goal notifications)', replaceGoalItems([{ id: 'budget-x', title: 't', description: 'd', isRead: false, type: 'budget' }], [], {}, '2026-03-01T00:00:00.000Z').length === 1);
}

console.log('\nTransactions search: merchant / category / note / transfer / amount');
{
  const f = newFixture(RATES);
  const cash = f.account('Cash', 'cash');
  const savings = f.account('Savings', 'bank');
  const put = (input: EntryInput): string => {
    const result = f.add(input);
    return result.state.entries[result.state.entries.length - 1].id;
  };
  const salary0 = put({ type: 'income', accountId: cash, amount: 10000000, currency: 'ETB', category: 'Salary', source: 'Job', date: '2025-12-01' });
  const t1 = put({ type: 'expense', accountId: cash, amount: 1250.5, currency: 'ETB', category: 'Food', source: 'Bole Taxi', note: 'airport run', date: '2026-01-02' });
  const t2 = put({ type: 'expense', accountId: cash, amount: 300, currency: 'ETB', category: 'Transport', source: 'Ride', date: '2026-01-03' });
  const t3 = put({ type: 'income', accountId: cash, amount: 75000, currency: 'ETB', category: 'Salary', source: 'Acme Ltd', date: '2026-01-04' });
  const t4 = put({ type: 'transfer', fromAccountId: cash, toAccountId: savings, fromAmount: 5000, toAmount: 5000, date: '2026-01-05' });
  const t5 = put({ type: 'expense', accountId: cash, amount: 10, currency: 'USD', category: 'Coffee', source: 'Café Moka', note: 'meeting', date: '2026-01-06' });
  const t6 = put({ type: 'expense', accountId: cash, amount: 12500, currency: 'ETB', category: 'Rent', source: 'Landlord', date: '2026-01-07' });
  const rows = f.state().entries;
  const accounts = f.state().accounts;
  const find = (query: string): string[] => filterTransactions(rows, query, accounts).map((r) => r.id);
  const same = (got: string[], want: string[]) => JSON.stringify([...got].sort()) === JSON.stringify([...want].sort());

  check('empty or whitespace-only query returns everything, in the original order', find('').length === rows.length && find('   ').length === rows.length && JSON.stringify(find('')) === JSON.stringify(rows.map((r) => r.id)));
  check('merchant / source', same(find('bole'), [t1]) && same(find('landlord'), [t6]) && same(find('acme'), [t3]));
  check('case-insensitive', same(find('BOLE'), [t1]) && same(find('aCmE LtD'), [t3]));
  check('partial words match as you type ("bo" finds Bole Taxi; "lan" finds Landlord)', find('bo').includes(t1) && same(find('lan'), [t6]));
  check('category name', same(find('food'), [t1]) && same(find('transport'), [t2]) && same(find('salary'), [salary0, t3]));
  check('note text', same(find('airport'), [t1]) && same(find('meeting'), [t5]));
  check('accent-insensitive: "cafe" finds Café Moka, and "café" does too', same(find('cafe'), [t5]) && same(find('café'), [t5]));
  check('a transfer is found by its destination account and by its From -> To labels', same(find('savings'), [t4]) && find('cash').includes(t4));
  check('an entry is found by the name of its account ("cash" finds the Cash entries)', same(find('cash'), rows.map((r) => r.id)));
  check('every word must match (AND): "food bole" -> the taxi; "food acme" -> nothing', same(find('food bole'), [t1]) && find('food acme').length === 0);
  check('words can match different fields (category + note)', same(find('coffee meeting'), [t5]));
  check('amount: exact value, with or without thousands separators', same(find('1250.50'), [t1]) && same(find('1,250.50'), [t1]) && same(find('1250.5'), [t1]));
  check('amount: a whole number finds the entries whose whole part equals it ("1250" -> 1,250.50, NOT 12,500)', same(find('1250'), [t1]) && same(find('12500'), [t6]));
  check('amount: typed "300" finds only the 300 entry', same(find('300'), [t2]));
  check('amount: finds by the ETB value of a foreign entry (550) and by the entered amount (10)', same(find('550'), [t5]) && same(find('10'), [t5]));
  check('amount with a currency prefix ("etb300") works', same(find('etb300'), [t2]));
  check('type words match the type: "income" and a 3-letter prefix "inc"', find('income').includes(t3) && find('inc').includes(t3) && !find('income').includes(t1));
  check('currency is matched as a whole word: "usd" -> the USD entry only; "etb" -> every ETB entry', same(find('usd'), [t5]) && find('etb').length === rows.length - 1);
  check('single letters do not match every entry through the currency/type labels', filterTransactions(rows, 'q', accounts).length === 0);
  check('no match returns an empty list; regex characters in the query are harmless', find('zzz').length === 0 && find('(').length === 0 && find('[a-z]+').length === 0 && find('.*').length === 0);
  check('filtering thousands of entries is fast (5,000 rows, 3-word query)', (() => {
    const many: AccountEntry[] = Array.from({ length: 5000 }, (_, i) => ({ ...rows[1], id: `m${i}`, accountId: 'x', source: i % 7 === 0 ? 'Bole Taxi' : 'Ride', note: i % 11 === 0 ? 'airport' : null }));
    const start = Date.now();
    const out = filterTransactions(many, 'bole airport food', accounts);
    // i divisible by both 7 and 11 -> 65 of 5,000 carry the merchant, the note AND the Food category
    return Date.now() - start < 250 && out.length === 65;
  })());
}

console.log('\nTransactions type tabs combined with search');
{
  const f = newFixture(RATES);
  const cash = f.account('Cash', 'cash');
  const savings = f.account('Savings', 'bank');
  const put = (input: EntryInput): string => {
    const result = f.add(input);
    return result.state.entries[result.state.entries.length - 1].id;
  };
  const salary0 = put({ type: 'income', accountId: cash, amount: 10000000, currency: 'ETB', category: 'Salary', source: 'Job', date: '2025-12-01' });
  const e1 = put({ type: 'expense', accountId: cash, amount: 120, currency: 'ETB', category: 'Food', source: 'Bole Cafe', date: '2026-01-02' });
  const e2 = put({ type: 'expense', accountId: cash, amount: 80, currency: 'ETB', category: 'Transport', source: 'Ride', date: '2026-01-02' });
  const i1 = put({ type: 'income', accountId: cash, amount: 5000, currency: 'ETB', category: 'Food', source: 'Food stall sale', date: '2026-01-03' });
  const t1 = put({ type: 'transfer', fromAccountId: cash, toAccountId: savings, fromAmount: 1000, toAmount: 1000, date: '2026-01-04', note: 'food fund' });
  const rows = f.state().entries;
  const accounts = f.state().accounts;
  const ids = (list: AccountEntry[]) => list.map((r) => r.id).sort();
  const tab = (type: TypeFilter, query = '') => ids(filterTransactions(filterByType(rows, type), query, accounts));

  check('All is the identity: every entry, original order', JSON.stringify(filterByType(rows, 'all').map((r) => r.id)) === JSON.stringify(rows.map((r) => r.id)));
  check('Income tab: only income', JSON.stringify(tab('income')) === JSON.stringify(ids(rows.filter((r) => r.type === 'income'))) && !tab('income').includes(e1));
  check('Expense tab: only expenses', JSON.stringify(tab('expense')) === JSON.stringify([e1, e2].sort()));
  check('Transfer tab: only transfers', JSON.stringify(tab('transfer')) === JSON.stringify([t1]));
  check('the tabs partition the ledger (every entry is in exactly one non-All tab)', tab('income').length + tab('expense').length + tab('transfer').length === rows.length);
  check('"food" on All finds expense + income + the transfer note; on Expense ONLY the expense; on Income ONLY the income', tab('all', 'food').length === 3 && JSON.stringify(tab('expense', 'food')) === JSON.stringify([e1]) && JSON.stringify(tab('income', 'food')) === JSON.stringify([i1]));
  check('searching inside a tab never reaches outside it ("food" on Transfer finds only the transfer whose note says food)', JSON.stringify(tab('transfer', 'food')) === JSON.stringify([t1]) && !tab('transfer', 'ride').includes(e2) && tab('transfer', 'ride').length === 0);
  check('search + tab can be empty even when the word exists elsewhere', tab('income', 'ride').length === 0 && tab('expense', 'stall').length === 0);
  check('switching tabs keeps the query: the same word gives each tab its own result', tab('expense', 'bole').length === 1 && tab('income', 'bole').length === 0 && tab('all', 'bole').length === 1);
  check('the Salary income from setup is only on Income/All', tab('income').includes(salary0) && !tab('expense').includes(salary0));
  check('the opening balance and adjustments are on All only (no type tab)', (() => {
    const g = newFixture(RATES);
    const id = g.account('Cash', 'cash', 'ETB', 100, '2026-01-01');
    g.add({ type: 'adjustment', accountId: id, amount: 5, date: '2026-01-02' });
    const list = g.state().entries;
    return filterByType(list, 'all').length === 2 && filterByType(list, 'income').length === 0 && filterByType(list, 'expense').length === 0 && filterByType(list, 'transfer').length === 0;
  })());
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:\n  ' + failures.join('\n  '));
  process.exit(1);
}
