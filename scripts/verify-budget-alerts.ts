// Pure-function checks for the budget 80% warning: the threshold, the one-per-month id, the "seen" de-duplication, and that the
// warning and the existing "over budget" alert never overlap. Reads the budget figures from getBudgetProgress; changes none of them.
// Run: npx tsx scripts/verify-budget-alerts.ts
import { Budget, ExchangeRate } from '../types';
import { AccountEntry } from '../types/accounts';
import { EntryInput } from '../utils/accounts/entries';
import { getBudgetProgress } from '../utils/currency';
import {
  BUDGET_WARNING_PERCENT,
  budgetNotificationId,
  budgetWarningNotificationId,
  decideBudgetAlert,
  getBudgetAlertLevel,
  getBudgetAlerts,
  getBudgetWarnings,
} from '../utils/notifications';
import { newFixture } from './support/fixture';

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

const RATES: ExchangeRate[] = [{ id: 'USD-ETB', fromCurrency: 'USD', toCurrency: 'ETB', rate: 55, updatedAt: '2026-01-01T00:00:00Z' }];
const jan = new Date(2026, 0, 15);
const feb = new Date(2026, 1, 15);
const budget = (category: string, limit: number, currency = 'ETB'): Budget => ({ id: `b-${category}`, category, monthlyLimit: limit, currency, createdAt: '', updatedAt: '' });

// Every entry is recorded in one Cash account through the real ledger rules; a step is built once the account's id is known.
type Step = (accountId: string) => EntryInput;
function ledger(...steps: Step[]): AccountEntry[] {
  const f = newFixture(RATES);
  const cash = f.account('Cash', 'cash');
  for (const step of steps) f.add(step(cash));
  return f.state().entries;
}
const salary: Step = (accountId) => ({ type: 'income', accountId, amount: 100000, currency: 'ETB', category: 'Salary', source: 'Job', date: '2025-12-01' });
const spend = (amount: number, category = 'Food', date = '2026-01-05'): Step => (accountId) => ({
  type: 'expense', accountId, amount, currency: 'ETB', category, date,
});
const warnings = (limit: number, rows: AccountEntry[], today = jan, currency = 'ETB') => getBudgetWarnings([budget('Food', limit, currency)], rows, RATES, today);
const alerts = (limit: number, rows: AccountEntry[], today = jan) => getBudgetAlerts([budget('Food', limit)], rows, RATES, today);

console.log('Budget 80% warning');

// ---- the threshold (pure) -------------------------------------------------------------------------------------------------------
check('the threshold is 80', BUDGET_WARNING_PERCENT === 80);
check('below 80: none (79 of 100)', getBudgetAlertLevel(79, 100) === 'none');
check('just below 80: none (79.99 of 100)', getBudgetAlertLevel(79.99, 100) === 'none');
check('exactly 80: warning', getBudgetAlertLevel(80, 100) === 'warning');
check('exactly 80 with awkward decimals: warning (800.00 of 1000)', getBudgetAlertLevel(800, 1000) === 'warning');
check('between 80 and 100: warning (95 of 100)', getBudgetAlertLevel(95, 100) === 'warning');
check('just under 100: warning (99.99 of 100)', getBudgetAlertLevel(99.99, 100) === 'warning');
check('exactly 100: warning, not over (the budget is used up, not exceeded - same rule as the Over budget alert)', getBudgetAlertLevel(100, 100) === 'warning');
check('above 100: over', getBudgetAlertLevel(100.01, 100) === 'over');
check('far above 100: over', getBudgetAlertLevel(500, 100) === 'over');
check('nothing spent: none', getBudgetAlertLevel(0, 100) === 'none');
check('zero limit: never alerts', getBudgetAlertLevel(50, 0) === 'none');
check('negative limit: never alerts', getBudgetAlertLevel(50, -10) === 'none');
check('missing limit (no exchange rate): never alerts', getBudgetAlertLevel(50, null) === 'none');
check('NaN limit: never alerts', getBudgetAlertLevel(50, Number.NaN) === 'none');

// ---- ids and the "seen" rule (pure) ---------------------------------------------------------------------------------------------
check('warning id has the month and the threshold', budgetWarningNotificationId('Food', '2026-01') === 'budget-Food-2026-01-warning-80');
check('warning id differs from the over id, so their seen-state is independent', budgetWarningNotificationId('Food', '2026-01') !== budgetNotificationId('Food', '2026-01'));
check('the existing over id is unchanged (stored seen-state keeps working)', budgetNotificationId('Food', '2026-01') === 'budget-Food-2026-01');
check('a new month is a new warning id', budgetWarningNotificationId('Food', '2026-01') !== budgetWarningNotificationId('Food', '2026-02'));

const none: Record<string, true> = {};
const first = decideBudgetAlert({ category: 'Food', monthKey: '2026-01', spentETB: 80, limitETB: 100, seenIds: none });
check('first crossing: a warning, new (unread)', first.level === 'warning' && first.id === 'budget-Food-2026-01-warning-80' && first.isNew);
const seen: Record<string, true> = { [first.id as string]: true };
const second = decideBudgetAlert({ category: 'Food', monthKey: '2026-01', spentETB: 90, limitETB: 100, seenIds: seen });
check('crossing again in the same month: the SAME id and not new (no second notification)', second.id === first.id && !second.isNew);
const afterDrop = decideBudgetAlert({ category: 'Food', monthKey: '2026-01', spentETB: 50, limitETB: 100, seenIds: seen });
check('dropped back below 80: no notification', afterDrop.level === 'none' && afterDrop.id === null && !afterDrop.isNew);
const recross = decideBudgetAlert({ category: 'Food', monthKey: '2026-01', spentETB: 85, limitETB: 100, seenIds: seen });
check('...and crossing again after the drop is still not new (same month, already seen)', recross.id === first.id && !recross.isNew);
const nextMonth = decideBudgetAlert({ category: 'Food', monthKey: '2026-02', spentETB: 85, limitETB: 100, seenIds: seen });
check('a new month starts fresh: different id, new', nextMonth.id === 'budget-Food-2026-02-warning-80' && nextMonth.isNew);
const over = decideBudgetAlert({ category: 'Food', monthKey: '2026-01', spentETB: 120, limitETB: 100, seenIds: seen });
check('over the limit: the existing over id, and the (seen) warning does not make it unseen-proof', over.level === 'over' && over.id === 'budget-Food-2026-01' && over.isNew);
check('a different category does not share the warning id', decideBudgetAlert({ category: 'Fun', monthKey: '2026-01', spentETB: 80, limitETB: 100, seenIds: seen }).isNew);
check('zero limit: no id at all', decideBudgetAlert({ category: 'Food', monthKey: '2026-01', spentETB: 10, limitETB: 0, seenIds: none }).id === null);
check('missing limit: no id at all', decideBudgetAlert({ category: 'Food', monthKey: '2026-01', spentETB: 10, limitETB: null, seenIds: none }).id === null);

// ---- against a real ledger (getBudgetProgress is the source of the figures) --------------------------------------------------------
const at = (amount: number) => ledger(salary, spend(amount));
check('799 of 1000: no warning', warnings(1000, at(799)).length === 0);
{
  const w = warnings(1000, at(800));
  check('exactly 800 of 1000: one warning', w.length === 1);
  check('...with the right id, route and percent', w[0]?.id === 'budget-Food-2026-01-warning-80' && w[0]?.route === '/budgets' && w[0]?.percent === 80);
  check('...title names the category and the percentage', w[0]?.title === 'Food budget is at 80%', w[0]?.title);
  check('...description has spent, limit and what is left in the app currency format', w[0]?.description === 'ETB 800.00 of ETB 1,000.00 spent, ETB 200.00 left.', w[0]?.description);
  check('...spoken label starts with "Warning." and says percent in words', w[0]?.accessibilityLabel === 'Warning. Food budget is at 80 percent. ETB 800.00 of ETB 1,000.00 spent, ETB 200.00 left.', w[0]?.accessibilityLabel);
  check('...and the same figures come from getBudgetProgress', (() => { const p = getBudgetProgress(budget('Food', 1000), at(800), RATES, jan); return p.spentAmount === 800 && p.limitETB === 1000; })());
}
check('950 of 1000: warning at 95%', warnings(1000, at(950))[0]?.percent === 95);
check('999.99 of 1000: warning shows 99%, never rounds up to 100', warnings(1000, at(999.99))[0]?.percent === 99);
{
  const w = warnings(1000, at(1000));
  check('exactly 1000 of 1000: warning at 100%, and NOT an over alert', w.length === 1 && w[0].percent === 100 && alerts(1000, at(1000)).length === 0);
}
{
  const rows = at(1200);
  check('above 100: no warning; the existing over alert is there instead (one notification per budget)', warnings(1000, rows).length === 0 && alerts(1000, rows).length === 1);
  check('the over alert is exactly as before (id and text unchanged)', alerts(1000, rows)[0].id === 'budget-Food-2026-01' && alerts(1000, rows)[0].description === 'Food is over its monthly budget by ETB 200.00.');
}
{
  // Every spend level: the warning and the over alert are never both present.
  let overlap = false;
  for (let amount = 25; amount <= 1300; amount += 25) {
    const rows = at(amount);
    if (warnings(1000, rows).length > 0 && alerts(1000, rows).length > 0) overlap = true;
  }
  check('warning and over alert never overlap at any spend level (25 to 1300 in steps of 25)', !overlap);
}
check('edited/deleted down: 900 -> 500 removes the warning', warnings(1000, at(900)).length === 1 && warnings(1000, at(500)).length === 0);
check('edited/deleted down from over: 1200 -> 850 swaps the over alert for the warning', alerts(1000, at(1200)).length === 1 && alerts(1000, at(850)).length === 0 && warnings(1000, at(850)).length === 1);
check('edited/deleted down from over to under 80: neither', alerts(1000, at(1200)).length === 1 && alerts(1000, at(300)).length === 0 && warnings(1000, at(300)).length === 0);
check('crossing twice in one month: both crossings give the same id', warnings(1000, at(850))[0].id === warnings(1000, at(900))[0].id);
check('last month\'s spending does not warn this month; a new month has its own id', warnings(1000, ledger(salary, spend(900, 'Food', '2025-12-20'))).length === 0 && warnings(1000, ledger(salary, spend(900, 'Food', '2026-02-03')), feb)[0]?.id === 'budget-Food-2026-02-warning-80');
check('spending adds up across several expenses (500 + 300 = 80%)', warnings(1000, ledger(salary, spend(500), spend(300, 'Food', '2026-01-06'))).length === 1);
check('income and other categories are not spending', warnings(100, ledger(salary, spend(900, 'Transport'))).length === 0);
check('a foreign-currency limit uses the stored rate (10 USD = 550 ETB; 440 spent = 80%)', warnings(10, ledger(salary, spend(440)), jan, 'USD').length === 1);
check('a budget in a currency with no rate cannot be compared: no warning', warnings(10, at(900), jan, 'EUR').length === 0);
check('a zero limit: no warning', warnings(0, at(900)).length === 0);
check('two budgets at 80%+: one warning each', getBudgetWarnings([budget('Food', 1000), budget('Fun', 100)], ledger(salary, spend(850), spend(90, 'Fun', '2026-01-06')), RATES, jan).length === 2);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
