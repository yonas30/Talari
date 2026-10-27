// Checks for Phase 6C-2 (V2_SPEC Part Z): the balance chain between messages, same-day order, the fee proposal for messages that printed no
// charges, the time given to saved entries from the chain, and the "balance doesn't match your bank" status with its adjustment.
// Every balance and name below is SYNTHETIC. Run: npx tsx scripts/verify-sms-chain.ts
import { readAccountsData, replaceAccountsData } from '../db/accountsRepo';
import { runMigrations, SqlRunner } from '../db/migrations';
import { readReconcileDismissals, saveReconcileDismissal } from '../db/smsRepo';
import { AccountEntry, AccountsState } from '../types/accounts';
import { SmsSuggestion } from '../types/sms';
import { getAccountBalances } from '../utils/accounts/balances';
import { Ctx } from '../utils/accounts/context';
import { AccountsError } from '../utils/accounts/errors';
import { planAddEntry } from '../utils/accounts/entries';
import { planCreateAccount } from '../utils/accounts/manage';
import { getPeriodSummary } from '../utils/accounts/totals';
import { buildChain, buildChains, chainItemOf, chainTimestamps, effectCents, feeProposals, gapNotes, orderDay } from '../utils/sms/chain';
import { timestampFromOccurredAt } from '../utils/sms/dateSource';
import { planReconcileAdjustment, reconcileStatus } from '../utils/sms/reconcile';
import { bulkSave } from '../utils/sms/bulkRun';
import { checkSuggestion, effectiveFee, planSuggestionSave } from '../utils/sms/saveSuggestion';
import { previewBatch, stageBatch } from '../utils/sms/staging';

const bulkPromises: Array<Promise<void>> = [];
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
function codeOf(fn: () => unknown): string {
  try {
    fn();
    return 'none';
  } catch (error) {
    return error instanceof AccountsError ? error.code : `other:${error instanceof Error ? error.message : String(error)}`;
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
function makeClock(start = new Date(2026, 10, 20, 9, 0, 0)) {
  let t = start.getTime();
  let n = 0;
  const ctx: Ctx = { now: () => new Date(t), newId: () => `id-${++n}` };
  return { ctx, minute: () => (t += 60_000) };
}

// ---- fixtures ---------------------------------------------------------------------------------------------------------------------------------
const clock = makeClock();
const base: AccountsState = { accounts: [], entries: [], goals: [], allocations: [], notifications: [], rates: [], currencies: ['ETB'] };
function account(state: AccountsState, name: string, opening: number, openingDate: string, extra: { sender?: string; digits?: string; type?: 'bank' | 'wallet' } = {}) {
  const created = planCreateAccount(state, { name, type: extra.type ?? 'bank', currency: 'ETB', openingAmount: opening, smsSender: extra.sender ?? null, lastDigits: extra.digits ?? null }, clock.ctx);
  return { state: { ...created.state, entries: created.state.entries.map((e) => (e.type === 'opening' && e.accountId === created.account.id ? { ...e, date: openingDate } : e)) }, id: created.account.id };
}
const boa = account(base, 'BOA', 50000, '2026-10-01', { sender: 'BOA', digits: '64' });
const cbe = account(boa.state, 'CBE', 20000, '2026-10-01', { sender: 'CBE', digits: '6213' });
const tele = account(cbe.state, 'Telebirr', 3000, '2026-10-01', { sender: '127', type: 'wallet' });
const ledger = tele.state;

let counter = 0;
function sug(p: Partial<SmsSuggestion> & { accountId?: string | null }): SmsSuggestion {
  counter += 1;
  const id = p.id ?? `s${counter}`;
  return {
    service: 'boa', direction: 'out', kind: 'debit', amount: 0, fee: null, vat: null, otherCharge: null, totalDeducted: null, counterpartyName: null,
    counterpartyPhoneTail: null, counterpartyBank: null, counterpartyAccountTail: null, counterpartyCode: null, accountTail: null, reference: null,
    occurredAt: null, balanceAfter: null, note: null, flags: [], rawHash: `hash-${id}`, status: 'confirmed', category: 'Food', feeAmount: null, date: '2026-11-14',
    dateSource: 'batch', createdAt: '2026-11-14T00:00:00Z', confirmedEntryId: null, ...p, id, accountId: p.accountId === undefined ? boa.id : p.accountId,
  } as SmsSuggestion;
}
const debit = (id: string, amount: number, balance: number | null, extra: Partial<SmsSuggestion> = {}) => sug({ id, direction: 'out', amount, balanceAfter: balance, ...extra });
const credit = (id: string, amount: number, balance: number | null, extra: Partial<SmsSuggestion> = {}) => sug({ id, direction: 'in', kind: 'credit', amount, balanceAfter: balance, ...extra });
const chainOf = (rows: SmsSuggestion[], accountId = boa.id) => buildChains(rows, ledger.accounts).get(accountId)!;
const ids = (rows: { id: string }[]) => rows.map((r) => r.id).join();

// ======================================================= 1. the order within a day ===================================================
console.log('Order within a day');
{
  // 50,000 -> debit 1,000 -> 49,000 -> credit 300 -> 49,300 -> debit 2,000 -> 47,300
  const a = debit('a', 1000, 49000);
  const b = credit('b', 300, 49300);
  const c = debit('c', 2000, 47300);
  check('the chain puts same-day messages with no times in the order the balances follow', ids(chainOf([c, a, b]).ordered) === 'a,b,c');
  check('...whatever order they were pasted in', ids(chainOf([b, c, a]).ordered) === 'a,b,c' && ids(chainOf([a, b, c]).ordered) === 'a,b,c');
  check('a consistent chain has no gaps', chainOf([c, a, b]).gaps.length === 0 && chainOf([c, a, b]).unchecked.length === 0);

  const timed = [
    debit('t1', 1000, 49000, { occurredAt: '2026-11-14T10:00:00', dateSource: 'message' }),
    credit('t2', 300, 49300, { occurredAt: '2026-11-14T09:00:00', dateSource: 'message' }),
  ];
  check('when every message has a printed time, the times decide (even against the balances)', ids(chainOf(timed).ordered) === 't2,t1');
  const mixed = [credit('m2', 300, 49300), debit('m1', 1000, 49000, { occurredAt: '2026-11-14T10:00:00', dateSource: 'message' }), debit('m3', 2000, 47300)];
  check('with only some times, the chain decides', ids(chainOf(mixed).ordered) === 'm1,m2,m3');
  check('a printed time on an owner-edited date is not used as a time', chainItemOf(debit('x', 1, 1, { occurredAt: '2026-11-14T10:00:00', dateSource: 'manual' }), 0)!.occurredAt === null);

  const twoDays = [debit('d2b', 2000, 47300, { date: '2026-11-15' }), credit('d1b', 300, 49300), debit('d1a', 1000, 49000), credit('d2a', 500, 47800, { date: '2026-11-15' })];
  check('days come in date order, each ordered inside itself', ids(chainOf(twoDays).ordered) === 'd1a,d1b,d2b,d2a', ids(chainOf(twoDays).ordered));
  check('the chain crosses the day boundary without a gap', chainOf(twoDays).gaps.length === 0);

  const noBalance = [debit('n1', 1000, 49000), sug({ id: 'n2', direction: 'out', amount: 50, balanceAfter: null }), debit('n3', 2000, 47000)];
  check('a message with no balance goes last among untimed ones and is not checked', ids(chainOf(noBalance).ordered) === 'n1,n3,n2' && chainOf(noBalance).unchecked.includes('n2'));
  check('...and breaks nothing: the others still agree', chainOf(noBalance).gaps.length === 0);

  const tie = [debit('p1', 100, 48900), debit('p2', 100, 48900)];
  check('two messages that could follow each other equally keep the pasted order', ids(chainOf(tie).ordered) === 'p1,p2');
  check('orderDay of a single message is itself, of none is nothing', orderDay([]).length === 0 && orderDay([chainItemOf(a, 0)!]).length === 1);

  // a message in another account is not in this chain
  const other = debit('o1', 100, 19900, { accountId: cbe.id, service: 'cbe' });
  const chains = buildChains([a, b, other], ledger.accounts);
  check('each account has its own chain', chains.size === 2 && ids(chains.get(boa.id)!.ordered) === 'a,b' && ids(chains.get(cbe.id)!.ordered) === 'o1');
  check('a message with no account is in no chain', buildChains([debit('z', 1, 1, { accountId: null })], ledger.accounts).size === 0);
  const archived = { ...ledger, accounts: ledger.accounts.map((x) => (x.id === boa.id ? { ...x, archived: true } : x)) };
  check('an archived account has no chain', buildChains([a, b], archived.accounts).size === 0);
  check('skipped, pending and confirmed messages all count (a skipped one is still a real movement)', chainOf([a, { ...b, status: 'ignored' }, { ...c, status: 'pending' }]).gaps.length === 0 && chainOf([a, { ...b, status: 'ignored' }, { ...c, status: 'pending' }]).ordered.length === 3);
}

// ======================================================= 2. gaps ========================================================================
console.log('Gaps: something is missing');
{
  const a = debit('a', 1000, 49000);
  const c = debit('c', 2000, 47300); // 300 came in that no message explains
  const g = chainOf([a, c]);
  check('money that arrived with no message: a gap of +300', g.gaps.length === 1 && g.gaps[0].id === 'c' && g.gaps[0].previousId === 'a' && g.gaps[0].difference === 300);
  const g2 = chainOf([a, debit('d', 2000, 46000)]);
  check('money that left with no message: a gap of -1,000', g2.gaps.length === 1 && g2.gaps[0].difference === -1000);
  const notes = gapNotes(chainOf([a, c]) ? buildChains([a, c], ledger.accounts) : new Map());
  check('the note says what is missing and how much, in plain words', notes.get('c') === 'Something is missing after the ETB 1,000.00 message of 2026-11-14: ETB 300.00 came in that no message explains. This is expected if only some of your messages were imported.', notes.get('c'));
  check('...and "left" for money that left', gapNotes(buildChains([a, debit('d', 2000, 46000)], ledger.accounts)).get('d')?.includes('ETB 1,000.00 left that no message explains.') === true);
  check('the first message of an account has nothing before it, so no gap', g.gaps.every((x) => x.id !== 'a'));
  check('a gap is only a note: the card is still clean and can be saved', checkSuggestion(ledger, { ...c, status: 'pending', accountId: boa.id, date: '2026-11-14' }, clock.ctx).clean);
  const cents = chainOf([debit('e', 1000.5, 48999.5), debit('f', 99.99, 48899.51)]);
  check('cents are exact (no floating point drift)', cents.gaps.length === 0);
  const off = chainOf([debit('e', 1000.5, 48999.5), debit('f', 99.99, 48899.5)]);
  check('a single cent out is a gap (the bank is one cent lower than the chain says)', off.gaps.length === 1 && off.gaps[0].difference === -0.01, JSON.stringify(off.gaps));

  // fees
  const tb = (id: string, amount: number, fee: number, vat: number, balance: number) =>
    sug({ id, service: 'telebirr', accountId: tele.id, direction: 'out', kind: 'person_transfer', amount, fee, vat, balanceAfter: balance });
  const t1 = tb('t1', 120, 1.74, 0.26, 2878); // 3,000 - 120 - 2.00
  const t2 = tb('t2', 100, 0.87, 0.13, 2777); // 2,878 - 100 - 1.00
  const tc = chainOf([t2, t1], tele.id);
  check('printed fee and VAT are part of what left: the chain agrees', ids(tc.ordered) === 't1,t2' && tc.gaps.length === 0);
  check('effectCents: money in adds, money out takes amount and fees', effectCents(chainItemOf(t1, 0)!) === -12200 && effectCents(chainItemOf(credit('c', 5, 5), 0)!) === 500);
  const cbeOut = sug({ id: 'k1', service: 'cbe', accountId: cbe.id, direction: 'out', amount: 630, fee: 0.5, vat: 0.08, otherCharge: 0.03, balanceAfter: 19369.39 });
  check('CBE\'s three charges all count', chainOf([cbeOut], cbe.id).gaps.length === 0 && effectCents(chainItemOf(cbeOut, 0)!) === -(63000 + 50 + 8 + 3));
  const k2 = sug({ id: 'k2', service: 'cbe', accountId: cbe.id, direction: 'out', amount: 100, fee: 0.5, vat: 0.08, otherCharge: 0.03, balanceAfter: 19268.78 });
  check('a second CBE debit follows the first including its charges', chainOf([k2, cbeOut], cbe.id).gaps.length === 0 && ids(chainOf([k2, cbeOut], cbe.id).ordered) === 'k1,k2');
}

// ======================================================= 3. the fee proposal =============================================================
console.log('A fee the message did not print');
{
  const a = debit('a', 1000, 49000);
  const withFee = debit('b', 1000, 47990); // dropped 1,010: 10 more than the amount
  const ch = buildChains([a, withFee], ledger.accounts);
  const p = feeProposals(ch);
  check('a balance that dropped by more than the amount proposes the difference as a fee', p.get('b')?.fee === 10 && p.get('b')?.drop === 1010);
  check('...and it is only a proposal: the message still has no fee', effectiveFee(withFee) === 0 && withFee.feeAmount === null);
  check('the gap note is not also shown for that message (the fee IS the explanation)', !gapNotes(ch, new Set(p.keys())).has('b') && gapNotes(ch).has('b'));
  const cents = feeProposals(buildChains([a, debit('b', 1000, 47989.5)], ledger.accounts));
  check('the fee keeps its cents', cents.get('b')?.fee === 10.5);
  check('an exact drop proposes nothing', feeProposals(buildChains([a, debit('b', 1000, 48000)], ledger.accounts)).size === 0);
  check('a drop smaller than the amount proposes nothing (that is a gap, not a fee)', feeProposals(buildChains([a, debit('b', 1000, 48100)], ledger.accounts)).size === 0 && chainOf([a, debit('b', 1000, 48100)]).gaps.length === 1);
  check('incoming money never gets a fee proposal', feeProposals(buildChains([a, credit('b', 1000, 49500)], ledger.accounts)).size === 0);
  check('the first message has nothing to compare with: no proposal', feeProposals(buildChains([withFee], ledger.accounts)).size === 0);
  check('a message before it with no balance: no proposal', feeProposals(buildChains([sug({ id: 'x', amount: 5, balanceAfter: null }), withFee], ledger.accounts)).size === 0);
  const printed = sug({ id: 'c', service: 'cbe', accountId: cbe.id, direction: 'out', amount: 1000, fee: 10, vat: 1.5, otherCharge: 0.5, balanceAfter: 18000 });
  check('a message that printed its charges is never proposed a fee', feeProposals(buildChains([sug({ id: 'c0', service: 'cbe', accountId: cbe.id, amount: 1, balanceAfter: 19012 }), printed], ledger.accounts)).size === 0);
  check('a fee the owner already set (even 0) is never proposed again', feeProposals(buildChains([a, { ...withFee, feeAmount: 0 }], ledger.accounts)).size === 0 && feeProposals(buildChains([a, { ...withFee, feeAmount: 10 }], ledger.accounts)).size === 0);
  const applied = buildChains([a, { ...withFee, feeAmount: 10 }], ledger.accounts);
  check('once the fee is used, the chain agrees and there is no gap', applied.get(boa.id)!.gaps.length === 0);
  check('the same for an Awash-shaped message', feeProposals(buildChains([sug({ id: 'w0', service: 'awash', amount: 1, balanceAfter: 10000 }), sug({ id: 'w1', service: 'awash', amount: 400, balanceAfter: 9595 })], ledger.accounts)).get('w1')?.fee === 5);
  check('a transfer-out from a message with no fee (Telebirr merchant, zero fee fields printed) is not proposed anything', feeProposals(buildChains([sug({ id: 'm0', amount: 1, balanceAfter: 5000 }), sug({ id: 'm1', amount: 100, fee: 0, vat: 0, balanceAfter: 4850 })], ledger.accounts)).size === 0);
}

// ======================================================= 4. times for saved entries =========================================================
console.log('Same-day order of saved entries');
{
  const a = debit('a', 1000, 49000);
  const b = credit('b', 300, 49300);
  const c = debit('c', 2000, 47300);
  const times = chainTimestamps(buildChains([c, a, b], ledger.accounts));
  const dayStart = new Date(2026, 10, 14, 0, 0, 0).getTime();
  check('messages with no time get one inside their day, from the chain position', times.get('a') === new Date(dayStart + 1000).toISOString() && times.get('b') === new Date(dayStart + 2000).toISOString() && times.get('c') === new Date(dayStart + 3000).toISOString());
  check('they sort in the chain order', [...times.entries()].sort((x, y) => x[1].localeCompare(y[1])).map(([id]) => id).join() === 'a,b,c');
  const anchored = [credit('u1', 100, 50100), debit('t', 100, 50000, { occurredAt: '2026-11-14T13:37:20', dateSource: 'message' }), debit('u2', 100, 49900)];
  const at = chainTimestamps(buildChains(anchored, ledger.accounts));
  const printed = timestampFromOccurredAt('2026-11-14T13:37:20') as string;
  check('a message with a printed time keeps it, and is not given another', !at.has('t'));
  check('an untimed message after it is one second later', at.get('u2') === new Date(Date.parse(printed) + 1000).toISOString());
  check('an untimed message before it is just after midnight (and before the timed one)', (at.get('u1') ?? '') < printed);
  const manualDate = chainTimestamps(buildChains([debit('m', 100, 100, { occurredAt: '2026-11-14T13:37:20', dateSource: 'manual' })], ledger.accounts));
  check('a message whose date the owner edited is treated as having no time', manualDate.has('m'));
  check('different days are independent', (() => { const t = chainTimestamps(buildChains([debit('x1', 10, 90, { date: '2026-11-13' }), debit('x2', 10, 80, { date: '2026-11-14' })], ledger.accounts)); return new Date(t.get('x1') as string).getDate() === 13 && new Date(t.get('x2') as string).getDate() === 14; })());

  // saving in the wrong order still ends up in the right order
  const day = { ...ledger, entries: ledger.entries };
  const first = planSuggestionSave(day, { ...b, status: 'pending', category: 'Salary', feeAmount: 0, accountId: boa.id }, { remember: false, timestamp: times.get('b') }, clock.ctx);
  const both = planSuggestionSave(first.result.state, { ...a, status: 'pending', category: 'Food', accountId: boa.id }, { remember: false, timestamp: times.get('a') }, clock.ctx).result.state;
  const sameDay = both.entries.filter((e) => e.date === '2026-11-14').sort((x, y) => x.timestamp.localeCompare(y.timestamp));
  check('saved credit-first, the two entries still sort debit then credit (the bank\'s order)', sameDay.length === 2 && sameDay[0].amount === 1000 && sameDay[1].amount === 300);
  check('a message with a printed time ignores the chain time', planSuggestionSave(day, { ...a, status: 'pending', accountId: boa.id, occurredAt: '2026-11-14T13:37:20', dateSource: 'message' }, { remember: false, timestamp: '2020-01-01T00:00:00.000Z' }, clock.ctx).result.added[0].timestamp === printed);
  check('with no chain time the entry gets the time of saving, as before', planSuggestionSave(day, { ...a, status: 'pending', accountId: boa.id }, { remember: false }, clock.ctx).result.added[0].timestamp === clock.ctx.now().toISOString());
  const order: string[] = [];
  const bulkDone = bulkSave(day, [{ ...c, status: 'pending', accountId: boa.id }, { ...a, status: 'pending', accountId: boa.id }, { ...b, status: 'pending', accountId: boa.id, feeAmount: 0 }], (plan, s) => { order.push(`${s.id}:${plan.result.added[0].timestamp}`); }, clock.ctx, (s) => times.get(s.id) ?? null).then(() => {
    check('"Save all that are clean" passes each message its chain time', order.length === 3 && order.every((o) => o.split(':').slice(1).join(':') === times.get(o.split(':')[0])));
  });
  bulkPromises.push(bulkDone);
}

// ======================================================= 5. the reconcile status =========================================================
console.log('Balance doesn\'t match your bank');
{
  // BOA: opening 50,000 on 2026-10-01; one imported debit of 1,000 on 2026-11-14 -> Talari 49,000
  const saved = planAddEntry(ledger, { type: 'expense', accountId: boa.id, amount: 1000, currency: 'ETB', category: 'Food', date: '2026-11-14' }, clock.ctx).state;
  const bal = (s: AccountsState, id = boa.id) => getAccountBalances(s.entries, s.accounts)[id];
  check('(setup) Talari has 49,000 in BOA', bal(saved) === 49000);
  const agree = [debit('a', 1000, 49000)];
  check('when the newest message agrees with Talari there is no banner', reconcileStatus(saved, agree, boa.id, null) === null);
  const bank = [debit('a', 1000, 48000)];
  const st = reconcileStatus(saved, bank, boa.id, null)!;
  check('when it differs, the status says which message, the date, both balances and the difference', !!st && st.messageId === 'a' && st.date === '2026-11-14' && st.bankBalance === 48000 && st.talariBalance === 49000 && st.difference === -1000 && st.service === 'boa');
  check('a bank balance higher than Talari\'s is a positive difference', reconcileStatus(saved, [debit('a', 1000, 49500)], boa.id, null)?.difference === 500);
  check('the comparison is to the cent', reconcileStatus(saved, [debit('a', 1000, 49000.01)], boa.id, null)?.difference === 0.01);

  check('only the NEWEST message counts: an older mismatch is ignored when the newest agrees', reconcileStatus(saved, [debit('old', 10, 1, { date: '2026-11-01', balanceAfter: 123 }), ...agree], boa.id, null) === null);
  check('the newest one is the last in the chain, not the last pasted', reconcileStatus(saved, [debit('a', 1000, 49000), debit('old', 10, 999, { date: '2026-11-01' })], boa.id, null) === null);
  check('a newest message that is still pending: no comparison', reconcileStatus(saved, [debit('a', 1000, 48000, { status: 'pending' })], boa.id, null) === null);
  check('a newest message that was skipped: no comparison', reconcileStatus(saved, [debit('a', 1000, 48000, { status: 'ignored' })], boa.id, null) === null);
  check('a newer message with no balance that is still waiting: no comparison', reconcileStatus(saved, [debit('a', 1000, 48000), sug({ id: 'w', amount: 5, balanceAfter: null, status: 'pending', date: '2026-11-15' })], boa.id, null) === null);
  check('no messages: no banner', reconcileStatus(saved, [], boa.id, null) === null);
  check('messages that print no balance: no banner', reconcileStatus(saved, [sug({ id: 'n', amount: 1000, balanceAfter: null })], boa.id, null) === null);
  check('another account\'s messages do not count', reconcileStatus(saved, [debit('c', 1, 5, { accountId: cbe.id })], boa.id, null) === null);
  check('an archived account has no banner', reconcileStatus({ ...saved, accounts: saved.accounts.map((x) => (x.id === boa.id ? { ...x, archived: true } : x)) }, bank, boa.id, null) === null);

  // as of the message's day
  const later = planAddEntry(saved, { type: 'expense', accountId: boa.id, amount: 200, currency: 'ETB', category: 'Food', date: '2026-11-16' }, clock.ctx).state;
  check('entries made AFTER the message\'s day are not counted', reconcileStatus(later, agree, boa.id, null) === null);
  const sameDay = planAddEntry(saved, { type: 'expense', accountId: boa.id, amount: 100, currency: 'ETB', category: 'Food', date: '2026-11-14' }, clock.ctx).state;
  check('entries on the same day ARE counted (the ledger only knows days), so a small difference can show', reconcileStatus(sameDay, agree, boa.id, null)?.difference === 100);
  const before = planAddEntry(saved, { type: 'income', accountId: boa.id, amount: 300, currency: 'ETB', category: 'Salary', date: '2026-11-10' }, clock.ctx).state;
  check('entries before the message\'s day are counted', reconcileStatus(before, [debit('a', 1000, 49300)], boa.id, null) === null);

  // dismissing
  const hash = 'hash-a';
  check('a dismissed mismatch is hidden', reconcileStatus(saved, bank, boa.id, hash) === null);
  check('...but a different message\'s mismatch is not', reconcileStatus(saved, bank, boa.id, 'hash-other')?.difference === -1000);
  const newer = [debit('a', 1000, 48000), debit('b', 50, 47950, { date: '2026-11-15' })];
  const savedNewer = planAddEntry(saved, { type: 'expense', accountId: boa.id, amount: 50, currency: 'ETB', category: 'Food', date: '2026-11-15' }, clock.ctx).state;
  check('a NEWER message with the balances still differing brings the banner back', reconcileStatus(savedNewer, newer, boa.id, hash)?.messageId === 'b' && reconcileStatus(savedNewer, newer, boa.id, hash)?.difference === -1000);
  check('a newer message that agrees brings no banner', reconcileStatus(savedNewer, [debit('a', 1000, 48000), debit('b', 50, 48950, { date: '2026-11-15' })], boa.id, hash) === null);

  // the adjustment
  const before2 = getPeriodSummary(saved.entries, '2026-11');
  const adj = planReconcileAdjustment(saved, st, {}, clock.ctx);
  const entry = adj.state.entries.find((e) => e.id === adj.adjustmentId) as AccountEntry;
  check('"Add adjustment" adds ONE adjustment entry for the difference, dated that day, noted', adj.state.entries.length === saved.entries.length + 1 && entry.type === 'adjustment' && entry.amount === -1000 && entry.date === '2026-11-14' && entry.accountId === boa.id && /BOA message of 2026-11-14/.test(entry.note ?? ''));
  check('afterwards Talari agrees with the bank and the banner is gone', bal(adj.state) === 48000 && reconcileStatus(adj.state, bank, boa.id, null) === null);
  const after2 = getPeriodSummary(adj.state.entries, '2026-11');
  check('an adjustment is never income or spending', after2.income === before2.income && after2.expenses === before2.expenses);
  const up = planReconcileAdjustment(saved, reconcileStatus(saved, [debit('a', 1000, 49500)], boa.id, null)!, {}, clock.ctx);
  check('a positive difference adds money', up.state.entries.find((e) => e.id === up.adjustmentId)!.amount === 500 && bal(up.state) === 49500);
  check('the plan does not change the ledger it is given', saved.entries.length === ledger.entries.length + 1);

  // refusals
  const young = account(base, 'BOA', 50000, '2026-11-20', { sender: 'BOA', digits: '64' });
  const youngSaved = young.state;
  const youngMsg = [debit('a', 1000, 40000, { accountId: young.id })];
  const youngStatus = reconcileStatus(youngSaved, youngMsg, young.id, null);
  check('(setup) a message dated before the account\'s opening day can still show a mismatch', !!youngStatus);
  check('but the adjustment cannot be dated before the opening balance: refused with the usual message', messageOf(() => planReconcileAdjustment(youngSaved, youngStatus!, {}, clock.ctx)) === "This is dated before the account's opening balance on 2026-11-20." && codeOf(() => planReconcileAdjustment(youngSaved, youngStatus!, {}, clock.ctx)) === 'BEFORE_OPENING');
}

// ======================================================= 6. SQLite: dismissals ===========================================================
console.log('Dismissals on SQLite');
{
  interface NodeStatement { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown; get(...p: unknown[]): unknown }
  interface NodeDb { exec(sql: string): void; prepare(sql: string): NodeStatement }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => NodeDb };
  const db = new DatabaseSync(':memory:');
  const run: SqlRunner = { exec: (sql) => db.exec(sql), all: <T,>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as T[], run: (sql, ...p) => { db.prepare(sql).run(...p); } };
  runMigrations(run, 0);
  check('no dismissals to begin with', Object.keys(readReconcileDismissals(run)).length === 0);
  saveReconcileDismissal(run, 'acct-1', 'hash-a', '2026-11-20T09:00:00Z');
  saveReconcileDismissal(run, 'acct-2', 'hash-z', '2026-11-20T09:00:00Z');
  check('a dismissal is saved per account and read back', readReconcileDismissals(run)['acct-1'] === 'hash-a' && readReconcileDismissals(run)['acct-2'] === 'hash-z');
  saveReconcileDismissal(run, 'acct-1', 'hash-b', '2026-11-21T09:00:00Z');
  check('dismissing a newer message replaces the old one (one row per account)', readReconcileDismissals(run)['acct-1'] === 'hash-b' && (db.prepare('SELECT COUNT(*) AS c FROM reconcile_dismissals').get() as { c: number }).c === 2);
  replaceAccountsData(run, ledger);
  check('dismissals do not touch the ledger', readAccountsData(run).entries.length === ledger.entries.length);

  // through the parser: BOA messages in a row
  const f = ledger;
  const text = ['Dear Abebe, your account 2***64 was debited with ETB 1,000.00. Available Balance: ETB 49,000.00.', 'Dear Abebe, your account 2***64 was credited with ETB 300.00 by  Fiker Mulu Alem . Available Balance: ETB 49,300.00.', 'Dear Abebe, your account 2***64 was debited with ETB 2,000.00. Available Balance: ETB 47,285.00.'].join('\n\n');
  const rows = stageBatch(previewBatch(text, new Set(), null, clock.ctx.now()), '2026-11-14', clock.ctx, { accounts: f.accounts, rules: [], categories: [] });
  const chain = buildChains(rows, f.accounts).get(boa.id)!;
  check('parsed BOA messages in a row make a chain; the third is 15 short of what it should be', rows.length === 3 && chain.ordered.length === 3 && chain.gaps.length === 1 && chain.gaps[0].difference === -15, JSON.stringify(chain.gaps));
  check('and (a balance that dropped by 2,015 for a 2,000 debit) is proposed a fee of 15', feeProposals(buildChains(rows, f.accounts)).get(rows[2].id)?.fee === 15);
}

// ======================================================= 7. the notes: arithmetic, ordering across import days, wording =================
console.log('Gap notes: fees, ordering by estimated dates, wording');
{
  const tb = (id: string, p: Partial<SmsSuggestion>) => sug({ id, service: 'telebirr', accountId: tele.id, kind: 'person_transfer', ...p });
  const cb = (id: string, p: Partial<SmsSuggestion>) => sug({ id, service: 'cbe', accountId: cbe.id, ...p });
  const chainFor = (rows: SmsSuggestion[], accountId = tele.id) => buildChains(rows, ledger.accounts).get(accountId)!;
  const notesFor = (rows: SmsSuggestion[], accountId = tele.id) => gapNotes(new Map([[accountId, chainFor(rows, accountId)]]));
  const effects = (c: ReturnType<typeof chainFor>) => c.ordered.map((i) => effectCents(i) / 100).join();

  // (a) are fees double counted?  A debit with a fee, a credit, a debit with a fee; balances as a bank that includes the fee would print them.
  const A1 = tb('A1', { direction: 'out', amount: 120, fee: 1.74, vat: 0.26, balanceAfter: 2878 });
  const A2 = tb('A2', { direction: 'in', kind: 'received', amount: 500, balanceAfter: 3378 });
  const A3 = tb('A3', { direction: 'out', amount: 10, fee: 1.04, vat: 0.16, balanceAfter: 3366.8 });
  check('a fee-inclusive Telebirr chain (debit+fee, credit, debit+fee) has no gap, pasted in order or reversed', chainFor([A1, A2, A3]).gaps.length === 0 && chainFor([A3, A2, A1]).gaps.length === 0);
  check('...each fee is counted ONCE: the effects are -122.00, +500.00 and -11.20', effects(chainFor([A3, A2, A1])) === '-122,500,-11.2');
  const K1 = cb('K1', { direction: 'out', amount: 1000, fee: 10, vat: 1.5, otherCharge: 0.5, balanceAfter: 18988 });
  const K2 = cb('K2', { direction: 'in', kind: 'credit', amount: 2012, balanceAfter: 21000 });
  const K3 = cb('K3', { direction: 'out', amount: 630, fee: 0.5, vat: 0.08, otherCharge: 0.03, balanceAfter: 20369.39 });
  check('a CBE chain with printed charges (12.00, none, 0.61) has no gap and counts each charge once', chainFor([K3, K1, K2], cbe.id).gaps.length === 0 && effects(chainFor([K3, K1, K2], cbe.id)) === '-1012,2012,-630.61');

  // the symptom: "ETB 1.20 came in" on a card whose own fee is 1.20 appears exactly when the card's printed balance dropped by only its AMOUNT
  const B3 = tb('B3', { direction: 'out', amount: 10, fee: 1.04, vat: 0.16, balanceAfter: 3368 });
  const bChain = chainFor([A1, A2, B3]);
  check('(symptom) a balance that dropped by only the amount, with a fee of 1.20 on the card, is a gap of exactly +1.20', bChain.gaps.length === 1 && bChain.gaps[0].difference === 1.2);
  check('...and with the fee set to 0 (the amount already includes it) the same message agrees', chainFor([A1, A2, { ...B3, feeAmount: 0 }]).gaps.length === 0);
  const bNote = notesFor([A1, A2, B3]).get('B3') ?? '';
  check('the note for it says which message it follows and why it is probably not a missing message', bNote.startsWith('Something is missing after the ETB 500.00 message of 2026-11-14: ETB 1.20 came in that no message explains.') && /same as this message's own fee \(ETB 1\.20\)/.test(bNote) && /already includes the fee, set the fee to 0/.test(bNote), bNote);
  const plain = notesFor([A1, tb('A2b', { direction: 'in', kind: 'received', amount: 500, balanceAfter: 3678 })]).get('A2b') ?? '';
  check('a gap that is NOT the message\'s own fee has no fee hint', plain.length > 0 && !/own fee/.test(plain), plain);

  // wording
  const a = debit('a', 1000, 49000);
  const c = debit('c', 2000, 47300);
  const note = notesFor([a, c], boa.id).get('c') ?? '';
  check('the note names the message it follows: "after the ETB 1,000.00 message of 2026-11-14"', note.startsWith('Something is missing after the ETB 1,000.00 message of 2026-11-14: ETB 300.00 came in that no message explains.'), note);
  check('...and says this is expected when only some messages were imported', note.endsWith('This is expected if only some of your messages were imported.'), note);
  check('"left" for money that left, with the same two sentences', (notesFor([a, debit('d', 2000, 46000)], boa.id).get('d') ?? '').includes('ETB 1,000.00 left that no message explains. This is expected if only some of your messages were imported.'));

  // (b) the missing middle message pasted LATER, with a later estimated (batch) date, while its neighbours have firm (receipt) dates
  const D1 = cb('D1', { date: '2026-11-12', dateSource: 'receipt', direction: 'out', amount: 100, balanceAfter: 1000 });
  const D3 = cb('D3', { date: '2026-11-13', dateSource: 'receipt', direction: 'out', amount: 100, fee: 1.2, balanceAfter: 948.8 });
  check('before the missing message is pasted: one gap of +50, and a note on D3 that names D1', chainFor([D1, D3], cbe.id).gaps.length === 1 && (notesFor([D1, D3], cbe.id).get('D3') ?? '').startsWith('Something is missing after the ETB 100.00 message of 2026-11-12: ETB 50.00 came in'));
  const D2 = cb('D2', { date: '2026-11-20', dateSource: 'batch', direction: 'in', kind: 'credit', amount: 50, balanceAfter: 1050 });
  const withMissing = chainFor([D1, D3, D2], cbe.id);
  check('after it is pasted (batch-dated much later) it takes its place between its neighbours, by the balance chain', ids(withMissing.ordered) === 'D1,D2,D3', ids(withMissing.ordered));
  check('...so there is no gap left and the old note is gone (notes are recomputed from the new list)', withMissing.gaps.length === 0 && notesFor([D1, D3, D2], cbe.id).size === 0);
  check('the firm-dated messages keep their dates and their order', ids(withMissing.ordered.filter((i) => i.id !== 'D2')) === 'D1,D3');

  // (c) the same real run imported on two different days: batch dates 2026-11-18 and 2026-11-20 are both guesses
  const E1 = cb('E1', { date: '2026-11-18', direction: 'out', amount: 100, fee: 1.2, balanceAfter: 898.8 });
  const E2 = cb('E2', { date: '2026-11-20', direction: 'in', kind: 'credit', amount: 200, balanceAfter: 1098.8 });
  const E3 = cb('E3', { date: '2026-11-18', direction: 'out', amount: 50, fee: 1.2, balanceAfter: 1047.6 });
  const E4 = cb('E4', { date: '2026-11-20', direction: 'out', amount: 300, fee: 1.2, balanceAfter: 746.4 });
  check('messages imported on two days (estimated dates) are put back in the order the balances follow', ids(chainFor([E1, E3, E2, E4], cbe.id).ordered) === 'E1,E2,E3,E4', ids(chainFor([E1, E3, E2, E4], cbe.id).ordered));
  check('...with no gap, whatever order they were pasted in', chainFor([E1, E3, E2, E4], cbe.id).gaps.length === 0 && chainFor([E4, E2, E3, E1], cbe.id).gaps.length === 0 && ids(chainFor([E4, E2, E3, E1], cbe.id).ordered) === 'E1,E2,E3,E4');
  // several messages with the SAME estimated date
  const same = [E4, E2, E1, E3].map((m) => ({ ...m, date: '2026-11-18' }));
  check('several messages with the same estimated date are ordered by the chain', ids(chainFor(same, cbe.id).ordered) === 'E1,E2,E3,E4' && chainFor(same, cbe.id).gaps.length === 0);

  // an estimated date is only a guess, but a message that fits nowhere is left where its date puts it
  const stray = cb('stray', { date: '2026-11-19', direction: 'out', amount: 7, balanceAfter: 123456 });
  const withStray = chainFor([E1, E2, E3, E4, stray], cbe.id);
  check('a message that fits nowhere in the chain is not moved into the middle of it', ids(withStray.ordered) === 'stray,E1,E2,E3,E4', ids(withStray.ordered));
  check('...and it breaks only its own link: the others still agree with each other', withStray.gaps.length === 1 && withStray.gaps[0].id === 'E1');

  // firm dates are never reordered by the chain
  const F1 = cb('F1', { date: '2026-11-10', dateSource: 'message', occurredAt: '2026-11-10T09:00:00', direction: 'out', amount: 10, balanceAfter: 990 });
  const F2 = cb('F2', { date: '2026-11-12', dateSource: 'receipt', direction: 'out', amount: 10, balanceAfter: 980 });
  const F3 = cb('F3', { date: '2026-11-14', dateSource: 'manual', direction: 'out', amount: 10, balanceAfter: 975 });
  check('messages whose dates are firm (printed, receipt, set by the owner) are always in date order', ids(chainFor([F3, F1, F2], cbe.id).ordered) === 'F1,F2,F3');
  check('...even when their balances would fit another order', ids(chainFor([F3, F1, F2, cb('G', { date: '2026-11-11', dateSource: 'receipt', direction: 'out', amount: 1, balanceAfter: 5 })], cbe.id).ordered) === 'F1,G,F2,F3');
  const P1 = cb('P1', { date: '2026-11-10', dateSource: 'receipt', direction: 'out', amount: 10, balanceAfter: 990 });
  const P2 = cb('P2', { date: '2026-11-12', dateSource: 'receipt', direction: 'out', amount: 10, balanceAfter: 970 });
  const P3 = cb('P3', { date: '2026-11-14', dateSource: 'receipt', direction: 'out', amount: 10, balanceAfter: 980 });
  const wanderer = cb('wanderer', { date: '2026-11-15', direction: 'out', amount: 3, balanceAfter: 55555 });
  const firmOnly = chainFor([P1, P2, P3, wanderer], cbe.id).ordered.filter((x) => x.id !== 'wanderer');
  check('firm-dated messages are never reordered by the chain, even when a different order would have fewer gaps (and an estimated message is present)', ids(firmOnly) === 'P1,P2,P3', ids(firmOnly));
  const floatBetween = cb('fl', { date: '2026-11-30', direction: 'in', kind: 'credit', amount: 5, balanceAfter: 985 });
  check('an estimated message slots between firm ones where its balance fits', ids(chainFor([F1, F2, F3, floatBetween], cbe.id).ordered) === 'F1,F2,fl,F3' && chainFor([F1, F2, F3, floatBetween], cbe.id).gaps.length === 0, ids(chainFor([F1, F2, F3, floatBetween], cbe.id).ordered));
  check('...and the firm ones keep their relative order', ids(chainFor([F1, F2, F3, floatBetween], cbe.id).ordered.filter((i) => i.id !== 'fl')) === 'F1,F2,F3');

  // the times given to saved entries follow the final order
  const times = chainTimestamps(new Map([[cbe.id, chainFor([E1, E3, E2, E4], cbe.id)]]));
  check('chain times follow the corrected order within each date', [...times.entries()].filter(([id]) => id === 'E1' || id === 'E3').sort((x, y) => x[1].localeCompare(y[1])).map(([id]) => id).join() === 'E1,E3');

  // it stays fast with a lot of messages and a lot of estimated dates
  let bal = 1_000_000;
  const many: SmsSuggestion[] = [];
  for (let i = 0; i < 300; i += 1) {
    bal -= 10 + i;
    many.push(cb(`x${i}`, { date: `2026-11-${String(1 + (i % 28)).padStart(2, '0')}`, direction: 'out', amount: 10 + i, balanceAfter: bal }));
  }
  const shuffled = [...many].sort((p, q) => ((p.id.charCodeAt(1) * 7919) % 101) - ((q.id.charCodeAt(1) * 7919) % 101));
  const started = performance.now();
  const manyChain = chainFor(shuffled, cbe.id);
  const took = performance.now() - started;
  check('300 estimated-date messages in a shuffled order are put back in the chain order with no gap', manyChain.gaps.length === 0 && ids(manyChain.ordered) === ids(many), `${manyChain.gaps.length} gaps`);
  check('...in well under a second', took < 1000, `${took.toFixed(0)} ms`);
}

void Promise.all(bulkPromises).then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
});
