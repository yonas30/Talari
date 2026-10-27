// Checks for the opening balance from messages (V2_SPEC Part Z, Phase 6C-3): what is derived from the oldest message (incoming, outgoing with a
// fee, never without a balance), which message counts as oldest, an account with no opening entry everywhere, moving the opening back and
// replacing it either way with a preview, every refusal, atomic saving with failure injection, the banner agreeing afterwards, restart safety
// and hidden balances. Every figure and name below is SYNTHETIC. Run: npx tsx scripts/verify-sms-opening.ts
import { readAccountsData, replaceAccountsData } from '../db/accountsRepo';
import { runMigrations, SqlRunner } from '../db/migrations';
import { commitOpeningChange, insertSuggestions, readSuggestions } from '../db/smsRepo';
import { AccountsState } from '../types/accounts';
import { SmsSuggestion } from '../types/sms';
import { getAccountBalances, validateEntries } from '../utils/accounts/balances';
import { Ctx } from '../utils/accounts/context';
import { planAddEntries, planAddEntry } from '../utils/accounts/entries';
import { planAddToGoal, planCreateGoal } from '../utils/accounts/goals';
import { planArchiveAccount, planCreateAccount, planDeleteAccount } from '../utils/accounts/manage';
import { getActivityDays, getCategoryTotals, getPeriodSummary, getTotals, calculateStreak } from '../utils/accounts/totals';
import { groupAccounts } from '../utils/accounts/groups';
import { HIDDEN_AMOUNT, maskAmount } from '../utils/format';
import { filterTransactions } from '../utils/search';
import { buildChains, chainItemOf, oldestOf, orderAccount } from '../utils/sms/chain';
import { findFeeCountedTwice } from '../utils/sms/feeRepair';
import { OpeningOffer, OpeningRefusal, openingCards, planOpeningChange, previousDay, proposeFromMessages, proposeTyped, reconcileSuppressed } from '../utils/sms/opening';
import { reconcileStatus } from '../utils/sms/reconcile';
import { beforeOpeningProblem, checkSuggestion, openingDateOf, planSuggestionSave } from '../utils/sms/saveSuggestion';

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

// ---- fixtures -----------------------------------------------------------------------------------------------------------------------------------------
let n = 0;
const ctx: Ctx = { now: () => new Date(2026, 10, 20, 9, 0, 0), newId: () => `id-${++n}` };
const empty: AccountsState = { accounts: [], entries: [], goals: [], allocations: [], notifications: [], rates: [], currencies: ['ETB'] };

// An ETB bank account. `opening` null = NO opening entry (a starting amount of zero); otherwise a typed opening of that amount on that day.
function account(base: AccountsState, name: string, opening: { amount: number; date: string } | null, sender = 'BOA') {
  const created = planCreateAccount(base, { name, type: 'bank', currency: 'ETB', openingAmount: opening?.amount ?? 0, date: opening?.date, smsSender: sender, lastDigits: null }, ctx);
  return { state: created.state, id: created.account.id };
}
function sug(id: string, accountId: string | null, p: Partial<SmsSuggestion> = {}): SmsSuggestion {
  return {
    id, rawHash: `h-${id}`, status: 'pending', service: 'boa', direction: 'in', kind: 'credit', amount: 100, fee: null, vat: null, otherCharge: null, totalDeducted: null,
    counterpartyName: null, counterpartyPhoneTail: null, counterpartyBank: null, counterpartyAccountTail: null, counterpartyCode: null, accountTail: null, reference: null,
    occurredAt: null, balanceAfter: null, note: null, flags: [], accountId, category: 'Uncategorised', feeAmount: null, date: '2026-09-10', dateSource: 'message',
    createdAt: '2026-09-10T00:00:00Z', confirmedEntryId: null, ...p,
  };
}
const credit = (id: string, acct: string | null, amount: number, balance: number | null, date: string, p: Partial<SmsSuggestion> = {}) => sug(id, acct, { direction: 'in', kind: 'credit', amount, balanceAfter: balance, date, ...p });
const debit = (id: string, acct: string | null, amount: number, balance: number | null, date: string, p: Partial<SmsSuggestion> = {}) => sug(id, acct, { direction: 'out', kind: 'debit', amount, balanceAfter: balance, date, ...p });
const cents = (value: number) => Math.round(value * 100);
const bal = (state: AccountsState, id: string) => getAccountBalances(state.entries, state.accounts)[id] ?? 0;
const offerOf = (p: ReturnType<typeof proposeFromMessages>): OpeningOffer => {
  if (p.kind !== 'offer') throw new Error(`expected an offer, got ${p.kind}${p.kind === 'refused' ? `: ${p.message}` : ''}`);
  return p;
};
const refusalOf = (p: ReturnType<typeof proposeFromMessages>): OpeningRefusal => {
  if (p.kind !== 'refused') throw new Error(`expected a refusal, got ${p.kind}`);
  return p;
};
const opts = { ctx };

// ======================================================= 1. oldest message: incoming ===============================================
console.log('Derived from an incoming oldest message');
const A = account(empty, 'BOA', null);
const a1 = credit('a1', A.id, 2000, 5000, '2026-09-10');
const a2 = debit('a2', A.id, 300, 4698, '2026-09-12', { fee: 2 });
const a3 = credit('a3', A.id, 1000, 5698, '2026-09-15');
{
  const offer = offerOf(proposeFromMessages(A.state, [a3, a1, a2], A.id, opts));
  check('the offer is "create": the account has no opening', offer.mode === 'create' && offer.before === null);
  check('opening = balance after minus what came in (5000 - 2000)', offer.after.amount === 3000, String(offer.after.amount));
  check('it is dated the day BEFORE the oldest message (date only)', offer.after.date === '2026-09-09' && previousDay('2026-03-01') === '2026-02-28' && previousDay('2027-01-01') === '2026-12-31');
  check('the oldest message is the one saved with it (not the later ones)', offer.saves.map((s) => s.id).join() === 'a1');
  check('the preview: nothing before, 0 now, 5000 after', offer.balanceNow === 0 && offer.balanceAfter === 5000);
  check('a brand-new account is not compared (nothing to compare with yet)', offer.check === null);
  check('it names the message it came from, and says nothing about estimates', offer.basis?.id === 'a1' && offer.estimatedWarning === null && offer.after.note === 'From the BOA message of 2026-09-10');
  const plan = planOpeningChange(A.state, [a3, a1, a2], offer, opts);
  const opening = plan.state.entries.find((e) => e.type === 'opening');
  check('confirming makes exactly one opening entry of 3000 on 2026-09-09', plan.state.entries.filter((e) => e.type === 'opening').length === 1 && opening?.amount === 3000 && opening?.date === '2026-09-09' && opening?.currency === 'ETB' && opening?.amountETB === 3000 && opening?.note === 'From the BOA message of 2026-09-10');
  check('...and the message as an income of 2000 on its day; the balance is the bank\'s 5000', plan.state.entries.filter((e) => e.type === 'income').length === 1 && plan.state.entries.find((e) => e.type === 'income')?.amount === 2000 && bal(plan.state, A.id) === 5000);
  check('...the message is confirmed against the income', plan.confirmations.length === 1 && plan.confirmations[0].suggestionId === 'a1' && plan.confirmations[0].entryId === plan.state.entries.find((e) => e.type === 'income')?.id);
  check('the ledger it makes is valid', validateEntries(plan.state.entries, plan.state.accounts) === null);

  // the rest of the messages then import normally on top, and the chain ends at the bank's balance
  let state = plan.state;
  let list = [{ ...a1, status: 'confirmed' as const, confirmedEntryId: plan.confirmations[0].entryId }, a2, a3];
  for (const m of [a2, a3]) {
    const saved = planSuggestionSave(state, list.find((s) => s.id === m.id) as SmsSuggestion, { remember: false }, ctx);
    state = saved.result.state;
    list = list.map((s) => (s.id === m.id ? { ...s, status: 'confirmed' as const, confirmedEntryId: saved.mainEntryId } : s));
  }
  check('importing the rest on top ends at the last message\'s balance, 5698', bal(state, A.id) === 5698, String(bal(state, A.id)));
  check('...and "your balance doesn\'t match" has nothing to say', reconcileStatus(state, list, A.id, null) === null);

  // opening entries stay out of income, expenses, categories and streak days
  const month = getPeriodSummary(state.entries, '2026-09');
  check('opening entries stay out of the month\'s income and expenses (2000 in, 300 + 2 out)', month.income === 3000 && Math.round(month.expenses * 100) === 30200, JSON.stringify(month));
  check('...and out of the income category totals', Object.values(getCategoryTotals(state.entries, '2026-09', 'income')).reduce((a, b) => a + b, 0) === 3000);
  check('...and the opening\'s day is not a streak day', !getActivityDays(state.entries, state.allocations).has('2026-09-09') && getActivityDays(state.entries, state.allocations).has('2026-09-10'));
}

// ======================================================= 2. oldest message: outgoing with a fee =====================================
console.log('Derived from an outgoing oldest message');
{
  const b1 = debit('b1', A.id, 400, 6000, '2026-09-10', { fee: 3, vat: 0.45 });
  const offer = offerOf(proposeFromMessages(A.state, [b1], A.id, opts));
  check('opening = balance after PLUS the total debited (6000 + 400 + 3.45 of charges)', cents(offer.after.amount) === 640345, String(offer.after.amount));
  const plan = planOpeningChange(A.state, [b1], offer, opts);
  check('saving it writes the payment of 400 and the fee of 3.45, and the balance is the bank\'s 6000', plan.state.entries.some((e) => e.type === 'expense' && e.amount === 400) && plan.state.entries.some((e) => e.category === 'Fees' && cents(e.amount) === 345) && bal(plan.state, A.id) === 6000, String(bal(plan.state, A.id)));
  const typedFee = offerOf(proposeFromMessages(A.state, [{ ...b1, feeAmount: 5 }], A.id, opts));
  check('a fee the owner typed on the card is the fee used (400 + 5)', cents(typedFee.after.amount) === 640500);
  const noFee = offerOf(proposeFromMessages(A.state, [debit('b2', A.id, 250, 750, '2026-09-10')], A.id, opts));
  check('a message with no fee at all: balance + amount (750 + 250 = 1000)', noFee.after.amount === 1000);
  const printedTotal = debit('b3', A.id, 3000, 2000, '2026-09-10', { fee: 1, vat: 0.15, otherCharge: 0.05, totalDeducted: 3001.2 });
  check('with the amount, charges and total all printed and agreeing: balance + the TOTAL (2000 + 3001.20)', cents(offerOf(proposeFromMessages(A.state, [printedTotal], A.id, opts)).after.amount) === 500120);
  const flagged = refusalOf(proposeFromMessages(A.state, [{ ...printedTotal, flags: ['total_mismatch'] }], A.id, opts));
  check('figures that do not add up are never used: refused, and the owner is asked to type it', flagged.code === 'figures' && flagged.askToType);
}

// ======================================================= 3. refusals from the oldest message ===========================================
console.log('When it cannot be worked out');
{
  const none = refusalOf(proposeFromMessages(A.state, [], A.id, opts));
  check('no messages at all: says so', none.code === 'no_messages' && /No messages/.test(none.message));
  const noBal = refusalOf(proposeFromMessages(A.state, [credit('c1', A.id, 100, null, '2026-09-10'), credit('c2', A.id, 100, 900, '2026-09-11')], A.id, opts));
  check('the oldest message prints no balance: refused and the owner is asked to type the opening', noBal.code === 'no_balance' && noBal.askToType && /Type the opening/.test(noBal.message), noBal.message);
  check('...and Confirm, if the messages changed to that, throws the same words and writes nothing', /does not print a balance/.test(messageOf(() => planOpeningChange(A.state, [credit('c1', A.id, 100, null, '2026-09-10'), credit('c2', A.id, 100, 900, '2026-09-11')], offerOf(proposeFromMessages(A.state, [a1], A.id, opts)), opts))));
  const two = [credit('d1', A.id, 100, 1100, '2026-09-10'), credit('d2', A.id, 50, 9050, '2026-09-10')];
  const undecided = refusalOf(proposeFromMessages(A.state, two, A.id, opts));
  check('two unlinked messages on the same day with no time: the chain cannot decide which is oldest', undecided.code === 'undecided' && undecided.askToType, undecided.message);
  const timed = [credit('d1', A.id, 100, 1100, '2026-09-10', { occurredAt: '2026-09-10T08:00:00' }), credit('d2', A.id, 50, 9050, '2026-09-10', { occurredAt: '2026-09-10T09:00:00' })];
  check('...but printed times decide it (the earlier one is the oldest)', offerOf(proposeFromMessages(A.state, timed, A.id, opts)).basis?.id === 'd1');
  check('...and a later firm date decides it too', offerOf(proposeFromMessages(A.state, [credit('d1', A.id, 100, 1100, '2026-09-10'), credit('d2', A.id, 50, 9050, '2026-09-12')], A.id, opts)).basis?.id === 'd1');
  const guess = [credit('e1', A.id, 100, 1100, '2026-09-10'), credit('e2', A.id, 50, 9050, '2026-09-18', { dateSource: 'batch' })];
  check('a run whose date is only the batch date, not linked to the first, could be older: undecided', refusalOf(proposeFromMessages(A.state, guess, A.id, opts)).code === 'undecided');
  check('...but messages that link up decide it, even when their dates are guesses', offerOf(proposeFromMessages(A.state, [credit('e1', A.id, 100, 1100, '2026-09-18', { dateSource: 'batch' }), credit('e2', A.id, 50, 1150, '2026-09-18', { dateSource: 'batch' })], A.id, opts)).basis?.id === 'e1');
  const skipped = refusalOf(proposeFromMessages(A.state, [credit('f1', A.id, 100, 1100, '2026-09-10', { status: 'ignored' }), credit('f2', A.id, 50, 1150, '2026-09-11')], A.id, opts));
  check('the oldest message was skipped: refused ("restore it first")', skipped.code === 'skipped' && /Restore it/.test(skipped.message));
  const negative = refusalOf(proposeFromMessages(A.state, [credit('g1', A.id, 2000, 1000, '2026-09-10')], A.id, opts));
  check('a balance smaller than the money that came in is impossible: refused', negative.code === 'negative' && negative.askToType);
  const zero = refusalOf(proposeFromMessages(A.state, [credit('h1', A.id, 500, 500, '2026-09-10')], A.id, opts));
  check('an opening of exactly zero needs no opening entry (said plainly)', zero.code === 'same' && /starts at zero/.test(zero.message));
  check('...and the quiet card says nothing about it (the message imports normally)', proposeFromMessages(A.state, [credit('h1', A.id, 500, 500, '2026-09-10')], A.id, opts, false).kind === 'none');
  const archived = planArchiveAccount(A.state, A.id);
  check('an archived account is not offered anything', refusalOf(proposeFromMessages(archived, [a1], A.id, opts)).code === 'no_account' && proposeFromMessages(archived, [a1], A.id, opts, false).kind === 'none');
  check('a message with no account chosen is not part of any account\'s chain', refusalOf(proposeFromMessages(A.state, [credit('i1', null, 500, 900, '2026-09-10')], A.id, opts)).code === 'no_messages');
}

// ======================================================= 4. estimated date =====================================================
console.log('An estimated date');
{
  const guessed = [credit('j1', A.id, 2000, 5000, '2026-09-10', { dateSource: 'batch' }), debit('j2', A.id, 300, 4700, '2026-09-10', { dateSource: 'batch' })];
  const offer = offerOf(proposeFromMessages(A.state, guessed, A.id, opts));
  check('the oldest message\'s date is only the batch date: the preview carries a clear warning naming the opening day', offer.estimatedWarning !== null && /only a guess/.test(offer.estimatedWarning) && offer.estimatedWarning.includes('2026-09-09'), String(offer.estimatedWarning));
  check('...but it can still be confirmed', planOpeningChange(A.state, guessed, offer, opts).state.entries.some((e) => e.type === 'opening'));
  check('a firm date has no warning', offerOf(proposeFromMessages(A.state, [a1], A.id, opts)).estimatedWarning === null);
}

// ======================================================= 5. oldestOf ================================================================
console.log('Which message is the oldest');
{
  const items = (list: SmsSuggestion[]) => orderAccount(list.map((s, i) => chainItemOf(s, i)!));
  check('no messages: none', oldestOf([]).kind === 'none');
  check('one linked run: the first is the oldest', oldestOf(items([a3, a1, a2])).kind === 'oldest');
  check('a message pasted later that fits between its neighbours does not change the answer', (() => {
    const r = oldestOf(items([a1, a3]));
    return r.kind === 'oldest' && r.item.id === 'a1';
  })());
  check('two runs, the second on a later firm date: decided', oldestOf(items([credit('p', A.id, 1, 100, '2026-09-10'), credit('q', A.id, 1, 900, '2026-09-11')])).kind === 'oldest');
  check('two runs on the same day with no times: undecided', oldestOf(items([credit('p', A.id, 1, 100, '2026-09-10'), credit('q', A.id, 1, 900, '2026-09-10')])).kind === 'undecided');
  check('...with only one of them timed: still undecided', oldestOf(items([credit('p', A.id, 1, 100, '2026-09-10', { occurredAt: '2026-09-10T08:00:00' }), credit('q', A.id, 1, 900, '2026-09-10')])).kind === 'undecided');
}

// ======================================================= 6. no opening entry everywhere ================================================
console.log('An account with no opening entry');
{
  const base = account(empty, 'Cash', { amount: 1000, date: '2026-09-01' });
  const withBoa = account(base.state, 'BOA', null);
  const state = withBoa.state;
  const id = withBoa.id;
  check('its balance is zero and there is no opening day', bal(state, id) === 0 && openingDateOf(state, id) === null);
  check('the "dated before the opening balance" block does not apply (any date)', beforeOpeningProblem(state, id, '2001-01-01') === null);
  const totals = getTotals(state);
  check('the totals count only the other account (1000) and do not break', totals.total === 1000 && totals.accounts.find((a) => a.account.id === id)?.balance === 0, JSON.stringify(totals.total));
  check('the groups on Home list it with a zero balance', groupAccounts(totals.accounts).flatMap((g) => g.accounts).some((a) => a.account.id === id && a.balance === 0));
  check('month, category, streak and activity functions are all fine with no entries for it', getPeriodSummary(state.entries, '2026-09').income === 0 && Object.keys(getCategoryTotals(state.entries, '2026-09', 'expense')).length === 0 && calculateStreak(state.entries, state.allocations, new Date(2026, 8, 20)) === 0);
  check('search over it is fine', filterTransactions(state.entries, 'boa', state.accounts).length === 0);
  check('the banner has nothing to say, and nothing is "counted twice"', reconcileStatus(state, [], id, null) === null && findFeeCountedTwice(state, []).length === 0);
  const incoming = credit('k1', id, 500, null, '2026-09-10');
  const outgoing = debit('k2', id, 500, null, '2026-09-10');
  check('an income can be saved into it (no opening needed)', checkSuggestion(state, incoming, ctx).blocked === null && planSuggestionSave(state, incoming, { remember: false }, ctx).result.state.entries.length === 2);
  check('an expense is refused because there is no money in it, not because of any opening', /Not enough money in BOA/.test(checkSuggestion(state, outgoing, ctx).blocked ?? ''));
  check('it can be archived (zero balance) and deleted (no entries)', planArchiveAccount(state, id).accounts.find((a) => a.id === id)?.archived === true && planDeleteAccount(state, id).accounts.length === 1);
  check('no card when it has no messages', openingCards(state, [], opts).size === 0);
  check('...an offer card when it has messages that work out', openingCards(state, [credit('k3', id, 500, 900, '2026-09-10')], opts).get(id)?.kind === 'offer');
  check('...a "type it" card when they cannot be used', (() => {
    const card = openingCards(state, [credit('k3', id, 500, null, '2026-09-10')], opts).get(id);
    return card?.kind === 'refused' && card.askToType;
  })());
  check('...and the banner steps aside while that card shows and there is no opening', reconcileSuppressed(state, id, openingCards(state, [credit('k3', id, 500, 900, '2026-09-10')], opts)) && !reconcileSuppressed(base.state, base.id, new Map([[base.id, 1]])) && !reconcileSuppressed(state, id, new Map()));
}

// ======================================================= 7. moving the opening back =====================================================
console.log('Extending history backwards');
const B = account(empty, 'BOA', { amount: 10000, date: '2026-09-20' });
const withSpend = planAddEntry(B.state, { type: 'expense', accountId: B.id, amount: 7000, currency: 'ETB', category: 'Food', date: '2026-09-22' }, ctx).state;
const m1 = credit('m1', B.id, 2000, 6000, '2026-09-10');
const m2 = debit('m2', B.id, 1000, 5000, '2026-09-12');
const m3 = credit('m3', B.id, 5000, 10000, '2026-09-18');
const oldMessages = [m3, m1, m2];
{
  const offer = offerOf(proposeFromMessages(withSpend, oldMessages, B.id, opts));
  check('the offer is "move": the new opening is derived from the oldest message (6000 - 2000) the day before it', offer.mode === 'move' && offer.after.amount === 4000 && offer.after.date === '2026-09-09' && offer.before?.amount === 10000 && offer.before?.date === '2026-09-20');
  check('all three older messages are saved with it, oldest first', offer.saves.map((s) => s.id).join() === 'm1,m2,m3', offer.saves.map((s) => s.id).join());
  check('before and after: balance now 3000, after 3000 (history was added, nothing else moved)', offer.balanceNow === 3000 && offer.balanceAfter === 3000);
  check('...compared with the newest message that prints a balance: 10,000 on 2026-09-18', offer.check?.date === '2026-09-18' && offer.check.bankBalance === 10000);
  const plan = planOpeningChange(withSpend, oldMessages, offer, opts);
  const before = withSpend.entries.find((e) => e.type === 'opening')!;
  const after = plan.state.entries.find((e) => e.type === 'opening')!;
  check('the SAME opening entry moved (same id), now 4000 on 2026-09-09', after.id === before.id && after.amount === 4000 && after.date === '2026-09-09' && plan.state.entries.filter((e) => e.type === 'opening').length === 1);
  const expense = withSpend.entries.find((e) => e.type === 'expense')!;
  check('existing entries are never changed (the very same objects)', plan.state.entries.includes(expense));
  check('three message entries were added, and the ledger is valid', plan.state.entries.length === withSpend.entries.length + 3 && validateEntries(plan.state.entries, plan.state.accounts) === null);
  check('every one of the three messages is confirmed against its own entry', plan.confirmations.length === 3 && new Set(plan.confirmations.map((c) => c.entryId)).size === 3);
  // why all three are saved: only the oldest would leave the later 7,000 expense without its money
  const onlyOldest = { ...withSpend, entries: [...withSpend.entries.map((e) => (e.type === 'opening' ? { ...e, amount: 4000, date: '2026-09-09' } : e)), ...planAddEntries({ ...withSpend, entries: withSpend.entries.filter((e) => e.type === 'opening') }, [{ type: 'income', accountId: B.id, amount: 2000, currency: 'ETB', category: 'Uncategorised', date: '2026-09-10' }], ctx).added] };
  check('(saving only the oldest would leave the 7,000 expense short, which is why the older messages go with it)', validateEntries(onlyOldest.entries, onlyOldest.accounts)?.code === 'NEGATIVE_BALANCE');
  const quiet = openingCards(withSpend, oldMessages, opts).get(B.id);
  check('the quiet card appears because messages older than the opening are waiting', quiet?.kind === 'offer' && quiet.mode === 'move');
  check('...and not when nothing is older than the opening', openingCards(withSpend, [credit('n1', B.id, 100, 10100, '2026-09-25')], opts).size === 0);

  // refusals
  const early = planAddEntry(withSpend, { type: 'income', accountId: B.id, amount: 300, currency: 'ETB', category: 'Salary', date: '2026-09-05' }, ctx).state;
  const conflict = refusalOf(proposeFromMessages(early, oldMessages, B.id, opts));
  check('an existing entry dated before the proposed opening is refused, and named', conflict.code === 'conflict' && conflict.message.includes('The income of ETB 300.00 on 2026-09-05'), conflict.message);
  check('...it is not shown on the quiet card, but it is what the owner gets when they ask', openingCards(early, oldMessages, opts).size === 0);
  check('...and the confirm refuses it as well, writing nothing', /dated before the new opening balance/.test(messageOf(() => planOpeningChange(early, oldMessages, offer, opts))));
  const mismatched = refusalOf(proposeFromMessages(withSpend, [m1, m2, credit('m3', B.id, 5000, 9000, '2026-09-18')], B.id, opts));
  check('a final balance that would not match the bank is refused with both figures', mismatched.code === 'mismatch' && mismatched.message.includes('ETB 10,000.00') && mismatched.message.includes('ETB 9,000.00') && mismatched.message.includes('1,000.00'), mismatched.message);
  check('a waiting message held for a pair answer refuses the whole change, naming it', refusalOf(proposeFromMessages(withSpend, oldMessages, B.id, { ...opts, held: new Map([['m2', 'pair']]) })).code === 'held');
  check('a waiting message whose figures do not add up refuses it too', refusalOf(proposeFromMessages(withSpend, [m1, { ...m2, flags: ['total_mismatch'] }, m3], B.id, opts)).code === 'figures');
  check('a skipped older message leaves the balance short of the bank: refused', refusalOf(proposeFromMessages(withSpend, [m1, { ...m2, status: 'ignored' }, m3], B.id, opts)).code === 'mismatch');
  // reserved goal money is never shrunk
  const goal = planCreateGoal(withSpend, { name: 'Laptop', targetAmount: 3000, heldInAccountId: B.id }, ctx);
  const reserved = planAddToGoal(goal.state, goal.goal.id, 3000, ctx).state;
  const typedLow = proposeTyped(reserved, [], B.id, { amount: 8000, date: '2026-09-20' }, opts);
  check('an opening change that would use money reserved for goals is refused (no goal shrinks)', typedLow.kind === 'refused' && typedLow.code === 'reserved' && /reserved for goals/.test(typedLow.message), JSON.stringify(typedLow));
  const typedNegative = refusalOf(proposeTyped(withSpend, [], B.id, { amount: 100, date: '2026-09-20' }, opts));
  check('an opening that leaves a day below zero is refused with the ledger\'s own words', typedNegative.code === 'ledger' && /Not enough money in BOA/.test(typedNegative.message), typedNegative.message);

  // things change between the preview and the confirm
  const changedState = planAddEntry(withSpend, { type: 'income', accountId: B.id, amount: 50, currency: 'ETB', category: 'Salary', date: '2026-09-21' }, ctx).state;
  check('if the ledger changed after the preview, confirm refuses ("things changed") and writes nothing', /Things changed|difference/.test(messageOf(() => planOpeningChange(changedState, oldMessages, offer, opts))));
  check('if a message was handled meanwhile (it is confirmed but has no entry here), confirm refuses and says why', /Things changed|away from your bank/.test(messageOf(() => planOpeningChange(withSpend, [{ ...m1, status: 'confirmed' }, m2, m3], offer, opts))));
  check('confirming the unchanged preview twice gives the same plan', planOpeningChange(withSpend, oldMessages, offer, opts).state.entries.length === plan.state.entries.length);
}

// ======================================================= 8. replacing a typed opening, and the reverse ==================================
console.log('Replacing the opening');
const C = account(empty, 'BOA', { amount: 3200, date: '2026-09-01' });
const r1 = credit('r1', C.id, 2000, 5000, '2026-09-10');
{
  const saved = planSuggestionSave(C.state, r1, { remember: false }, ctx);
  const state = saved.result.state;
  const list = [{ ...r1, status: 'confirmed' as const, confirmedEntryId: saved.mainEntryId }];
  const before = reconcileStatus(state, list, C.id, null);
  check('before: the banner says Talari is 200 too high (typed opening 3200, bank 5000 after a 2000 credit)', before !== null && before.difference === -200, JSON.stringify(before));
  const offer = offerOf(proposeFromMessages(state, list, C.id, opts));
  check('the offer is "replace": 3000 on 2026-09-09 instead of 3200 on 2026-09-01; nothing waiting to save', offer.mode === 'replace' && offer.after.amount === 3000 && offer.before?.amount === 3200 && offer.saves.length === 0);
  check('preview: balance now 5200, after 5000, compared with the bank\'s 5000 on 2026-09-10', offer.balanceNow === 5200 && offer.balanceAfter === 5000 && offer.check?.bankBalance === 5000 && offer.check.date === '2026-09-10');
  const plan = planOpeningChange(state, list, offer, opts);
  check('confirming replaces the one opening and keeps the imported income', plan.state.entries.filter((e) => e.type === 'opening').length === 1 && plan.state.entries.find((e) => e.type === 'opening')?.amount === 3000 && plan.state.entries.includes(state.entries.find((e) => e.type === 'income')!));
  check('the banner and the new opening AGREE afterwards: nothing to say', reconcileStatus(plan.state, list, C.id, null) === null);
  check('...and the chain notes are unchanged by it', buildChains(list, plan.state.accounts).get(C.id)?.gaps.length === 0);

  const extra = planAddEntry(state, { type: 'income', accountId: C.id, amount: 100, currency: 'ETB', category: 'Salary', date: '2026-09-10' }, ctx).state;
  const mismatch = refusalOf(proposeFromMessages(extra, list, C.id, opts));
  check('if the final balance would still not match the bank, it is not offered, with the numbers', mismatch.code === 'mismatch' && mismatch.message.includes('ETB 5,100.00') && mismatch.message.includes('ETB 5,000.00'), mismatch.message);
  const between = planAddEntry(state, { type: 'income', accountId: C.id, amount: 70, currency: 'ETB', category: 'Salary', date: '2026-09-05' }, ctx).state;
  check('an entry between the old opening and the new one blocks it, named', refusalOf(proposeFromMessages(between, list, C.id, opts)).code === 'conflict');

  // the reverse: a typed opening in place of the one from messages
  const afterState = plan.state;
  const typedSame = proposeTyped(afterState, list, C.id, { amount: 3000, date: '2026-09-09' }, opts);
  check('typing exactly the opening it already has says so', typedSame.kind === 'refused' && typedSame.code === 'same');
  const typed = offerOf(proposeTyped(afterState, list, C.id, { amount: 3000, date: '2026-09-08' }, opts));
  check('typing another day gives a "move" preview with no note and no messages', typed.mode === 'move' && typed.source === 'typed' && typed.after.note === null && typed.saves.length === 0 && typed.basis === null);
  check('...and applying it moves the same entry', planOpeningChange(afterState, list, typed, opts).state.entries.find((e) => e.type === 'opening')?.date === '2026-09-08');
  const wrong = refusalOf(proposeTyped(afterState, list, C.id, { amount: 3100, date: '2026-09-09' }, opts));
  check('a typed opening that leaves the bank\'s balance wrong is refused as well', wrong.code === 'mismatch');
  check('typed validation: a negative amount, a bad day, a day in the future', refusalOf(proposeTyped(afterState, list, C.id, { amount: -1, date: '2026-09-09' }, opts)).code === 'invalid' && refusalOf(proposeTyped(afterState, list, C.id, { amount: 5, date: 'soon' }, opts)).code === 'invalid' && refusalOf(proposeTyped(afterState, list, C.id, { amount: 5, date: '2026-12-31' }, opts)).code === 'invalid');

  // a waiting message dated before a TYPED opening can never be saved, so it does not count towards the balance the bank is compared with
  const x = credit('x1', C.id, 100, null, '2026-09-05');
  check('a waiting message older than the typed opening (it could never be saved) is not counted in the comparison', proposeTyped(afterState, [x, ...list], C.id, { amount: 3000, date: '2026-09-08' }, opts).kind === 'offer');

  // reserved goal money is never shrunk by the messages saved with a change either
  const D = account(empty, 'BOA', { amount: 3200, date: '2026-09-01' });
  const dGoal = planCreateGoal(D.state, { name: 'Trip', targetAmount: 3000, heldInAccountId: D.id }, ctx);
  const dReserved = planAddToGoal(dGoal.state, dGoal.goal.id, 3000, ctx).state;
  const big = debit('big', D.id, 1000, 500, '2026-09-10');
  const shrinking = refusalOf(proposeFromMessages(dReserved, [big], D.id, opts));
  check('a change whose saved messages would take the account below its reserved goal money is refused, naming the account', shrinking.code === 'reserved' && /reserved for goals in BOA/.test(shrinking.message), shrinking.message);
  check('...and without the goal the same change is fine (the balance is the bank balance of 500)', offerOf(proposeFromMessages(D.state, [big], D.id, opts)).balanceAfter === 500);

  // typing zero removes the opening (an account with no messages)
  const lone = account(empty, 'Cash', { amount: 400, date: '2026-09-01' });
  const removed = offerOf(proposeTyped(lone.state, [], lone.id, { amount: 0, date: '2026-09-01' }, opts));
  const removedPlan = planOpeningChange(lone.state, [], removed, opts);
  check('typing zero removes the opening: balance 400 -> 0, the account has none', removed.after.amount === 0 && removed.balanceAfter === 0 && removedPlan.state.entries.filter((e) => e.type === 'opening').length === 0 && removedPlan.openingEntryId === null);
  check('...and typing zero again says there is nothing to change', refusalOf(proposeTyped(removedPlan.state, [], lone.id, { amount: 0, date: '2026-09-01' }, opts)).code === 'same');
  const fresh = offerOf(proposeTyped(removedPlan.state, [], lone.id, { amount: 900, date: '2026-09-02' }, opts));
  check('typing an opening for an account with none creates one', fresh.mode === 'create' && planOpeningChange(removedPlan.state, [], fresh, opts).state.entries.some((e) => e.type === 'opening' && e.amount === 900));
}

// ======================================================= 9. atomic, with failure injection =============================================
console.log('All or nothing');
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
{
  const offer = offerOf(proposeFromMessages(withSpend, oldMessages, B.id, opts));
  const plan = planOpeningChange(withSpend, oldMessages, offer, opts);
  const rows = [m1, m2, m3];
  const rowsFor = (r: SqlRunner) => readSuggestions(r);
  const injections: Array<[string, (sql: string, c: { tx: number; up: number }) => boolean]> = [
    ['the opening row (the first write)', (sql, c) => sql.includes('INTO transactions') && c.tx === 1],
    ['the first message entry', (sql, c) => sql.includes('INTO transactions') && c.tx === 2],
    ['the LAST entry written', (sql, c) => sql.includes('INTO transactions') && c.tx === 4],
    ['marking the FIRST message confirmed', (sql, c) => sql.includes('UPDATE sms_suggestions') && c.up === 1],
    ['marking the LAST message confirmed', (sql, c) => sql.includes('UPDATE sms_suggestions') && c.up === 3],
  ];
  for (const [label, shouldFail] of injections) {
    const dev = new DatabaseSync(':memory:');
    const r = runnerFor(dev);
    runMigrations(r, 0);
    replaceAccountsData(r, withSpend);
    insertSuggestions(r, rows);
    const counters = { tx: 0, up: 0 };
    const bad: SqlRunner = {
      ...r,
      run: (sql, ...params) => {
        if (sql.includes('INTO transactions')) counters.tx += 1;
        if (sql.includes('UPDATE sms_suggestions')) counters.up += 1;
        if (shouldFail(sql, counters)) throw new Error('disk full');
        r.run(sql, ...params);
      },
    };
    const rowsOfDb = () => ({ ...withSpend, ...readAccountsData(r) });
    check(`failure on ${label}: the save throws`, messageOf(() => commitOpeningChange(bad, withSpend, plan.state, plan.confirmations)) === 'disk full');
    const kept = rowsOfDb();
    check(`failure on ${label}: the opening is exactly as it was (10000 on 2026-09-20) and nothing was added`, kept.entries.length === 2 && kept.entries.find((e) => e.type === 'opening')?.amount === 10000 && kept.entries.find((e) => e.type === 'opening')?.date === '2026-09-20');
    check(`failure on ${label}: all three messages are still pending, with no entry`, rowsFor(r).length === 3 && rowsFor(r).every((s) => s.status === 'pending' && s.confirmedEntryId === null));
    commitOpeningChange(r, withSpend, plan.state, plan.confirmations);
    const done = rowsOfDb();
    check(`failure on ${label}: a retry makes exactly ONE opening (4000 on 2026-09-09) and one entry per message`, done.entries.filter((e) => e.type === 'opening').length === 1 && done.entries.find((e) => e.type === 'opening')?.amount === 4000 && countOf(dev, 'transactions') === 5);
    check(`failure on ${label}: ...and all three messages confirmed`, rowsFor(r).every((s) => s.status === 'confirmed' && s.confirmedEntryId !== null));
    check(`failure on ${label}: committing the same plan again is refused and writes nothing`, messageOf(() => commitOpeningChange(r, withSpend, plan.state, plan.confirmations)).includes('no longer pending') && countOf(dev, 'transactions') === 5);
  }

  // a message handled elsewhere before the confirm: the whole change is refused
  {
    const dev = new DatabaseSync(':memory:');
    const r = runnerFor(dev);
    runMigrations(r, 0);
    replaceAccountsData(r, withSpend);
    insertSuggestions(r, rows);
    r.run("UPDATE sms_suggestions SET status = 'ignored' WHERE id = ?", 'm2');
    check('if one message is no longer waiting, the whole change is refused and nothing is written', messageOf(() => commitOpeningChange(r, withSpend, plan.state, plan.confirmations)).includes('no longer pending') && countOf(dev, 'transactions') === 2 && ({ ...withSpend, ...readAccountsData(r) }).entries.find((e) => e.type === 'opening')?.amount === 10000);
  }

  // restart safety: everything is read back from the database, and nothing is offered again
  {
    const dev = new DatabaseSync(':memory:');
    const r = runnerFor(dev);
    runMigrations(r, 0);
    replaceAccountsData(r, withSpend);
    insertSuggestions(r, rows);
    commitOpeningChange(r, withSpend, plan.state, plan.confirmations);
    const restarted: AccountsState = { ...withSpend, ...readAccountsData(r) };
    const messages = readSuggestions(r);
    check('after a restart the balance is what it was before it (3000)', bal(restarted, B.id) === 3000 && getTotals(restarted).total === 3000);
    check('...the quiet card is gone and asking again says the opening already matches', openingCards(restarted, messages, opts).size === 0 && refusalOf(proposeFromMessages(restarted, messages, B.id, opts)).code === 'same');
    check('...and the banner has nothing to say', reconcileStatus(restarted, messages, B.id, null) === null);
    check('...the opening stays out of the month\'s income (only the incomes of the messages: 2000 + 5000)', getPeriodSummary(restarted.entries, '2026-09').income === 7000, JSON.stringify(getPeriodSummary(restarted.entries, '2026-09')));
  }
}

// ======================================================= 10. hidden balances ==========================================================
console.log('Hidden balances');
{
  const mask = (text: string) => maskAmount(text, true);
  const figure = /\d{1,3}(,\d{3})*\.\d\d/;
  const early = planAddEntry(withSpend, { type: 'income', accountId: B.id, amount: 300, currency: 'ETB', category: 'Salary', date: '2026-09-05' }, ctx).state;
  const texts = [
    refusalOf(proposeFromMessages(early, oldMessages, B.id, { ctx, mask })).message,
    refusalOf(proposeFromMessages(withSpend, [m1, m2, credit('m3', B.id, 5000, 9000, '2026-09-18')], B.id, { ctx, mask })).message,
    refusalOf(proposeTyped(withSpend, [], B.id, { amount: 100, date: '2026-09-20' }, { ctx, mask })).message,
    refusalOf(proposeFromMessages(A.state, [credit('c1', A.id, 100, null, '2026-09-10')], A.id, { ctx, mask })).message,
    refusalOf(proposeFromMessages(withSpend, oldMessages, B.id, { ctx, mask, held: new Map([['m2', 'x']]) })).message,
  ];
  check('while balances are hidden no refusal shows a single figure', texts.every((t) => !figure.test(t) && !/ETB \d/.test(t)), texts.join(' | '));
  check('...they show the mask where the figure was, and the words are still there', texts.every((t) => t.includes(HIDDEN_AMOUNT)) && /dated before the new opening balance/.test(texts[0]) && /cannot be moved safely/.test(texts[1]) && /Not enough money/.test(texts[2]));
  check('(shown, the same refusals do have the figures)', figure.test(refusalOf(proposeFromMessages(early, oldMessages, B.id, opts)).message));
  const hiddenOffer = offerOf(proposeFromMessages(withSpend, oldMessages, B.id, { ctx, mask }));
  check('an offer carries its figures as numbers for the screen to mask, and its own warning text has none', hiddenOffer.estimatedWarning === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
