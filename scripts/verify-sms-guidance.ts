// Checks for the small review/banner improvements: a card blocked by the opening says what to do (Move the opening back, or the reason), the banner and
// opening refusals point at the likely gaps (two largest, from the chain), Save asks once when a message seems to be missing and a batch leaves such cards
// alone, and "Add adjustment" takes a day and a note within the usual limits. Every figure and name below is SYNTHETIC.
// Run: npx tsx scripts/verify-sms-guidance.ts
import { UNCATEGORISED_NAME } from '../constants/categories';
import { AccountsState } from '../types/accounts';
import { SmsSuggestion } from '../types/sms';
import { getAccountBalances } from '../utils/accounts/balances';
import { Ctx } from '../utils/accounts/context';
import { planAddEntry } from '../utils/accounts/entries';
import { AccountsError } from '../utils/accounts/errors';
import { planCreateAccount } from '../utils/accounts/manage';
import { getPeriodSummary } from '../utils/accounts/totals';
import { HIDDEN_AMOUNT, maskAmount } from '../utils/format';
import { buildChains, gapSentence, gapSentences, heldForMissing, likelyGaps, MISSING_BEFORE_REASON, saveNeedsConfirm } from '../utils/sms/chain';
import { runBulkSave } from '../utils/sms/bulkRun';
import { proposeFromMessages } from '../utils/sms/opening';
import { MAX_ADJUSTMENT_NOTE, planReconcileAdjustment, reconcileStatus } from '../utils/sms/reconcile';
import { checkSuggestion } from '../utils/sms/saveSuggestion';

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
function errorOf(fn: () => unknown): AccountsError | null {
  try {
    fn();
    return null;
  } catch (error) {
    if (error instanceof AccountsError) return error;
    throw error;
  }
}

let n = 0;
const ctx: Ctx = { now: () => new Date(2026, 10, 20, 9, 0, 0), newId: () => `id-${++n}` };
const empty: AccountsState = { accounts: [], entries: [], goals: [], allocations: [], notifications: [], rates: [], currencies: ['ETB'] };
function account(opening: { amount: number; date: string } | null) {
  const created = planCreateAccount(empty, { name: 'BOA', type: 'bank', currency: 'ETB', openingAmount: opening?.amount ?? 0, date: opening?.date, smsSender: 'BOA', lastDigits: null }, ctx);
  return { state: created.state, id: created.account.id };
}
function sug(id: string, accountId: string, p: Partial<SmsSuggestion>): SmsSuggestion {
  return {
    id, rawHash: `h-${id}`, status: 'pending', service: 'boa', direction: 'in', kind: 'credit', amount: 100, fee: null, vat: null, otherCharge: null, totalDeducted: null,
    counterpartyName: null, counterpartyPhoneTail: null, counterpartyBank: null, counterpartyAccountTail: null, counterpartyCode: null, accountTail: null, reference: null,
    occurredAt: null, balanceAfter: null, note: null, flags: [], accountId, category: UNCATEGORISED_NAME, feeAmount: null, date: '2026-09-10', dateSource: 'message',
    createdAt: '2026-09-10T00:00:00Z', confirmedEntryId: null, ...p,
  };
}
const credit = (id: string, acct: string, amount: number, balance: number | null, date: string, p: Partial<SmsSuggestion> = {}) => sug(id, acct, { direction: 'in', kind: 'credit', amount, balanceAfter: balance, date, ...p });
const debit = (id: string, acct: string, amount: number, balance: number | null, date: string, p: Partial<SmsSuggestion> = {}) => sug(id, acct, { direction: 'out', kind: 'debit', amount, balanceAfter: balance, date, ...p });
const cents = (value: number) => Math.round(value * 100);

// Five messages with TWO real gaps and one small one: ETB 201.04 left between 12 June and 21 July, ETB 30 came in between 25 July and 2 August, ETB 5 left
// between 2 August and 10 August.
const A = account({ amount: 10000, date: '2026-05-01' });
const g = (status: SmsSuggestion['status'] = 'pending') => [
  credit('g1', A.id, 100, 10100, '2026-06-12', { status }),
  debit('g2', A.id, 50, 9848.96, '2026-07-21', { status }),
  credit('g3', A.id, 10, 9858.96, '2026-07-25', { status }),
  credit('g4', A.id, 5, 9893.96, '2026-08-02', { status }),
  debit('g5', A.id, 1, 9887.96, '2026-08-10', { status }),
];

// ======================================================= 2. where a difference likely comes from ==============================================
console.log('Likely gaps');
{
  const chain = buildChains(g(), A.state.accounts).get(A.id);
  const gaps = likelyGaps(chain);
  check('three gaps exist, and only the two largest are named', chain?.gaps.length === 3 && gaps.length === 2);
  check('the largest first: ETB 201.04 left between 12 June and 21 July', gaps[0].amount === 201.04 && gaps[0].direction === 'left' && gaps[0].fromDate === '2026-06-12' && gaps[0].toDate === '2026-07-21');
  check('then ETB 30 that came in between 25 July and 2 August', gaps[1].amount === 30 && gaps[1].direction === 'came in' && gaps[1].toDate === '2026-08-02');
  check('the sentence is exactly the wording asked for', gapSentence(gaps[0]) === 'ETB 201.04 left between your 12 June message and your 21 July message that no message explains.', gapSentence(gaps[0]));
  check('a gap across New Year carries the years', gapSentence({ amount: 5, direction: 'came in', fromDate: '2025-12-30', toDate: '2026-01-03' }) === 'ETB 5.00 came in between your 30 December 2025 message and your 3 January 2026 message that no message explains.');
  check('while balances are hidden the figure is hidden and the words stay', gapSentence(gaps[0], (t) => maskAmount(t, true)) === `${HIDDEN_AMOUNT} left between your 12 June message and your 21 July message that no message explains.`);
  check('a skipped message still counts (as in the chain) and gives the same lines', JSON.stringify(likelyGaps(buildChains([g()[0], { ...g()[1], status: 'ignored' }, ...g().slice(2)], A.state.accounts).get(A.id))) === JSON.stringify(gaps));
  check('no gap, no line', gapSentences(buildChains([credit('x1', A.id, 100, 10100, '2026-06-12'), credit('x2', A.id, 50, 10150, '2026-06-13')], A.state.accounts).get(A.id)).length === 0 && likelyGaps(undefined).length === 0);
  check('a missing message pasted later makes its line go away', (() => {
    const fill = debit('fill', A.id, 201.04, 9898.96, '2026-07-01');
    return !gapSentences(buildChains([...g(), fill], A.state.accounts).get(A.id)).some((line) => line.startsWith('ETB 201.04'));
  })());

  // the banner
  const imported = g('confirmed');
  const status = reconcileStatus(A.state, imported, A.id, null);
  check('the banner status carries the same two gaps', status !== null && status.gaps.length === 2 && status.gaps[0].amount === 201.04, JSON.stringify(status?.gaps));
  check('...and none when the chain has no gap', (() => {
    const s = reconcileStatus(A.state, [credit('y1', A.id, 100, 9000, '2026-06-12', { status: 'confirmed' })], A.id, null);
    return s !== null && s.gaps.length === 0;
  })());
}

// ======================================================= 1. a card blocked by the opening ====================================================
console.log('A card blocked by the opening balance');
{
  const young = account({ amount: 10000, date: '2026-06-20' });
  const old = credit('o1', young.id, 100, 10100, '2026-06-12');
  const blocked = checkSuggestion(young.state, old, ctx);
  check('a message dated before the opening is blocked with the usual words, and says it is the opening that blocks it', blocked.blocked === "This is dated before the account's opening balance on 2026-06-20." && blocked.beforeOpening);
  check('other blocks are not marked that way', !checkSuggestion(young.state, debit('o2', young.id, 99999, null, '2026-06-25'), ctx).beforeOpening && !checkSuggestion(young.state, credit('o3', young.id, 5, null, '2026-06-25'), ctx).beforeOpening);
  // the account's chain lines up: the card offers the same preview as "Get it from my messages"
  const fits = [old, credit('o4', young.id, 9900, 20000, '2026-06-18')];
  const young2 = { ...young.state, entries: young.state.entries.map((e) => (e.type === 'opening' ? { ...e, amount: 20000 } : e)) };
  const offer = proposeFromMessages(young2, fits, young.id, { ctx });
  check('when the messages fit, the button leads to a "move" preview (the same one as Get it from my messages)', offer.kind === 'offer' && offer.mode === 'move' && offer.saves.length === 2, offer.kind);
  // the messages do not fit: the reason is shown right on the card
  const mismatch = proposeFromMessages(young.state, [old, credit('o5', young.id, 50, 9000, '2026-06-18')], young.id, { ctx });
  check('when it is refused, the card shows the reason in the words asked for', mismatch.kind === 'refused' && mismatch.code === 'mismatch' && /^Talari is ETB [\d,.]+ away from your bank's balance on 2026-06-18 \(it would show ETB [\d,.]+, your BOA message says ETB 9,000\.00\), so the opening cannot be moved safely\./.test(mismatch.message), mismatch.kind === 'refused' ? mismatch.message : '');
  // the refusal also points at the gap
  const withGaps = account({ amount: 10000, date: '2026-06-20' });
  const messages = g().map((s) => ({ ...s, accountId: withGaps.id }));
  const refused = proposeFromMessages(withGaps.state, messages, withGaps.id, { ctx });
  check('the refusal names where the difference likely comes from, two lines at most', refused.kind === 'refused' && refused.message.includes('ETB 201.04 left between your 12 June message and your 21 July message that no message explains.') && refused.message.includes('ETB 30.00 came in between your 25 July message and your 2 August message') && !refused.message.includes('ETB 5.00 left'), refused.kind === 'refused' ? refused.message : refused.kind);
  const hidden = proposeFromMessages(withGaps.state, messages, withGaps.id, { ctx, mask: (t) => maskAmount(t, true) });
  check('hidden balances: the refusal shows no figure', hidden.kind === 'refused' && !/\d,?\d*\.\d\d/.test(hidden.message) && hidden.message.includes(HIDDEN_AMOUNT), hidden.kind === 'refused' ? hidden.message : '');
}

// ======================================================= 3. Save asks once; a batch leaves the card alone =====================================
console.log('A message seems to be missing');
{
  check('a card that shows the note asks before saving', saveNeedsConfirm('Something is missing after ...', false));
  check('...once: after "Save anyway" it does not ask again', !saveNeedsConfirm('Something is missing after ...', true));
  check('a card with no note never asks', !saveNeedsConfirm(null, false));

  const B = account({ amount: 1000, date: '2026-09-01' });
  const b1 = credit('b1', B.id, 100, 1100, '2026-09-10');
  const b2 = credit('b2', B.id, 50, 1180, '2026-09-11'); // 30 came in that no message explains: the note is on b2
  const b3 = credit('b3', B.id, 10, 1190, '2026-09-12');
  const held = heldForMissing([b1, b2, b3], B.state.accounts);
  check('only the card that shows the note is held, with the reason', held.size === 1 && held.get('b2') === MISSING_BEFORE_REASON);
  check('once the missing message is pasted nothing is held', heldForMissing([b1, credit('fill', B.id, 30, 1130, '2026-09-10'), b2, b3], B.state.accounts).size === 0 && buildChains([b1, b2, b3], B.state.accounts).get(B.id)?.gaps.length === 1);
  const saved: string[] = [];
  void runBulkSave({ state: B.state, suggestions: [b1, b2, b3], held, commit: (plan) => { saved.push(plan.confirmation.suggestionId); } }).then((r) => {
    check('"Save all that are clean" leaves that card alone: b1 and b3 are saved, b2 is not', saved.join() === 'b1,b3', saved.join());
    check('...and the result lists it with the reason', r.failures.length === 1 && r.failures[0].id === 'b2' && r.failures[0].reason === MISSING_BEFORE_REASON);
  });
  const proposalSet = [debit('f1', B.id, 100, 900, '2026-09-10'), debit('f2', B.id, 50, 840, '2026-09-11')];
  check('a card with a fee proposal instead of a note is not held (the gap is its fee, not a missing message)', heldForMissing(proposalSet, B.state.accounts).size === 0 && buildChains(proposalSet, B.state.accounts).get(B.id)?.gaps.length === 1);
}

// ======================================================= 5. Add adjustment: a day and a note ==================================================
console.log('Add adjustment');
{
  const C = account({ amount: 5000, date: '2026-09-01' });
  const spent = planAddEntry(C.state, { type: 'expense', accountId: C.id, amount: 4000, currency: 'ETB', category: 'Food', date: '2026-09-10' }, ctx).state;
  const messages = [debit('s1', C.id, 4000, 600, '2026-09-10', { status: 'confirmed' })];
  const status = reconcileStatus(spent, messages, C.id, null);
  check('(setup) Talari has 1,000, the bank 600: a difference of -400 on 10 September', status !== null && status.difference === -400 && status.date === '2026-09-10');
  const bal = (state: AccountsState) => getAccountBalances(state.entries, state.accounts)[C.id];
  const adjustmentOf = (plan: ReturnType<typeof planReconcileAdjustment>) => plan.state.entries.find((e) => e.id === plan.adjustmentId)!;

  const plain = planReconcileAdjustment(spent, status!, {}, ctx);
  check('with nothing chosen it stays the message\'s day and keeps the usual note', adjustmentOf(plain).date === '2026-09-10' && adjustmentOf(plain).amount === -400 && adjustmentOf(plain).note === 'To match the BOA message of 2026-09-10');
  check('afterwards the balance is the bank\'s and the banner is gone', bal(plain.state) === 600 && reconcileStatus(plain.state, messages, C.id, null) === null);

  const later = planReconcileAdjustment(spent, status!, { date: '2026-09-15' }, ctx);
  const earlier = planReconcileAdjustment(spent, status!, { date: '2026-09-05' }, ctx);
  check('a later day and an earlier day (after the opening) are both accepted, and are the entry\'s date', adjustmentOf(later).date === '2026-09-15' && adjustmentOf(earlier).date === '2026-09-05' && bal(later.state) === 600);
  check('the opening day itself is allowed', adjustmentOf(planReconcileAdjustment(spent, status!, { date: '2026-09-01' }, ctx)).date === '2026-09-01');

  const noted = planReconcileAdjustment(spent, status!, { note: '  failed ATM withdrawal,   refund pending ' }, ctx);
  check('the owner\'s note is kept (tidied) and the message it matches follows it', adjustmentOf(noted).note === 'failed ATM withdrawal, refund pending · to match the BOA message of 2026-09-10', String(adjustmentOf(noted).note));
  check('a blank note is the usual note', adjustmentOf(planReconcileAdjustment(spent, status!, { note: '   ' }, ctx)).note === 'To match the BOA message of 2026-09-10');
  const long = 'x'.repeat(300);
  check('a long note is cut to the limit', (adjustmentOf(planReconcileAdjustment(spent, status!, { note: long }, ctx)).note ?? '').startsWith('x'.repeat(MAX_ADJUSTMENT_NOTE) + ' ·') && !(adjustmentOf(planReconcileAdjustment(spent, status!, { note: long }, ctx)).note ?? '').includes('x'.repeat(MAX_ADJUSTMENT_NOTE + 1)));

  const early = errorOf(() => planReconcileAdjustment(spent, status!, { date: '2026-08-30' }, ctx));
  check('before the opening balance: refused with the usual words', early?.code === 'BEFORE_OPENING' && early.message === "This is dated before the account's opening balance on 2026-09-01.");
  const future = errorOf(() => planReconcileAdjustment(spent, status!, { date: '2026-12-31' }, ctx));
  check('in the future: refused', future?.code === 'INVALID_ENTRY' && /future/.test(future.message));
  check('not a day: refused', errorOf(() => planReconcileAdjustment(spent, status!, { date: 'soon' }, ctx))?.code === 'INVALID_ENTRY');
  const big = { ...status!, difference: -6000 };
  const overdraw = errorOf(() => planReconcileAdjustment(spent, big, { date: '2026-09-02' }, ctx));
  check('a day that would take the account below zero is refused with the usual words, and nothing is written', overdraw?.code === 'NEGATIVE_BALANCE' && /Not enough money in BOA/.test(overdraw.message) && spent.entries.length === 2);

  const month = getPeriodSummary(plain.state.entries, '2026-09');
  const base = getPeriodSummary(spent.entries, '2026-09');
  check('an adjustment is still never income or spending, whatever its day or note', month.income === base.income && month.expenses === base.expenses && getPeriodSummary(noted.state.entries, '2026-09').expenses === base.expenses);
  check('the plan does not change the ledger it is given', spent.entries.length === 2 && cents(bal(spent)) === 100000);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
