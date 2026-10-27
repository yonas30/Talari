// Checks for Phase 6C-1 (V2_SPEC Part Z, "Pairing own-account transfers"): which messages are offered as one transfer and which are not,
// what saving a pair does (one transfer, its linked fee, both messages confirmed), the transfer's date, converting an existing entry,
// "not a pair" being remembered, schema 8, and the all-or-nothing save on real SQLite.
// Every message below is SYNTHETIC: invented names, numbers and balances in the same shapes as real ones.
// Run: npx tsx scripts/verify-sms-pairing.ts
import { defaultCategories, FEES_CATEGORY } from '../constants/categories';
import { readAccountsData, replaceAccountsData } from '../db/accountsRepo';
import { migrateToPairs, PAIR_SCHEMA_VERSION } from '../db/pairRejectionMigration';
import { runMigrations, SqlRunner } from '../db/migrations';
import { addPairRejection, commitPairSave, insertSuggestions, readPairRejections, readRules, readSuggestions } from '../db/smsRepo';
import { Category, ExchangeRate } from '../types';
import { AccountEntry, AccountsState, DateSource } from '../types/accounts';
import { SmsSuggestion } from '../types/sms';
import { getAccountBalances } from '../utils/accounts/balances';
import { formatAmount } from '../utils/accounts/money';
import { Ctx } from '../utils/accounts/context';
import { AccountsError } from '../utils/accounts/errors';
import { planAddEntry } from '../utils/accounts/entries';
import { planCreateGoal, planAddToGoal } from '../utils/accounts/goals';
import { AccountInput, planCreateAccount } from '../utils/accounts/manage';
import { decidePairDate, feeTolerance, findPairs, pairedSuggestionIds, PAIR_FEE_TOLERANCE_MIN, PAIR_FEE_TOLERANCE_PERCENT, PairSide, pairKey, searchPairs, selectPairs } from '../utils/sms/pairing';
import { checkPair, feeEffectText, planPairSave } from '../utils/sms/pairSave';
import { timestampFromOccurredAt } from '../utils/sms/dateSource';
import { planSuggestionSave } from '../utils/sms/saveSuggestion';
import { previewBatch, stageBatch } from '../utils/sms/staging';

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
function codeOf(fn: () => unknown): string {
  try {
    fn();
    return 'none';
  } catch (error) {
    return error instanceof AccountsError ? error.code : `other:${error instanceof Error ? error.message : String(error)}`;
  }
}

function makeClock(start = new Date(2026, 10, 20, 9, 0, 0)) {
  let t = start.getTime();
  let n = 0;
  const ctx: Ctx = { now: () => new Date(t), newId: () => `id-${++n}` };
  return { ctx, minute: () => (t += 60_000) };
}

// ---- synthetic messages ---------------------------------------------------------------------------------------------------------------------------
const TB_RECV_CBE = `Dear Abebe,
You have received  ETB 1,000.00 by transaction number KB9XWDT3AH on 2026-11-14 13:37:20 from Commercial Bank of Ethiopia to your telebirr Account 2519XXXXXX - Abebe MXXXXX NXXXXX. Your current balance is ETB 2,468.19.
Thank you for using telebirr
Ethio telecom`;
const CBE_DEBIT = (amount: string, total: string) =>
  `Dear Abebe  A debit transaction of ETB ${amount}. has occurred on your account 1****6213. Service charge of ETB 10.00 and VAT(15%) of ETB1.50 and Disaster Recovery(5%) of 0.50 with total of ETB${total} .Your current balance is ETB8,741.55. Thanks for Banking with CBE.`;
const CBE_DEBIT_1000 = CBE_DEBIT('1000.0', '1012.00');
const TB_OUT_AWASH = `Dear Abebe
You have transferred ETB 300.00 successfully from your telebirr account 251xxxxxxxx8 to Awash Bank account number 0132xxxxxxxx5512 on 12/11/2026 14:23:19. Your telebirr transaction number is DKF8ZQ2WRT and your bank transaction number is . The service fee is  ETB 0.87 and  15% VAT on the service fee is ETB 0.13. Your current balance is ETB 4,117.26. To download your payment information please click this link: `;
const AWASH_C2B = (date: string) =>
  `Dear Customer, your Account 01320xxxxxx5512 has been Credited with ETB 300.00 on ${date} by TeleBirr C2B to Awash with reference DKF8ZQ2WRT. Your balance now is ETB 12805.40. For any complaint or enquiry, please call 8980. Thank You. Awash Bank.`;
const TB_PERSON_RECV = `Dear Abebe,
You have received ETB 1,000.00 from Hxxxxx Nxxxxx(2519****7743)  on 14/11/2026 09:13:58. Your transaction number is MN4BVC8XZ2. Your current E-Money Account balance is ETB 2,468.19.`;
const TB_OUT_HIBRET = `Dear Abebe
You have transferred ETB 100.00 successfully from your telebirr account 251xxxxxxxx8 to Hibret Bank account number 4xxxxxxxxxxxxx3 on 15/11/2026 13:34:23. Your telebirr transaction number is NC6TGWB2S9 and your bank transaction number is . The service fee is  ETB 0.87 and  15% VAT on the service fee is ETB 0.13. Your current balance is ETB 5,208.34. To download your payment information please click this link: `;
// A Telebirr "received" whose transaction number has the shape of a CBE receipt reference, and the CBE debit whose receipt link carries it.
const TB_RECV_FT = (date: string) =>
  `Dear Abebe,
You have received  ETB 750.00 by transaction number FT26301ABCD1 on ${date} from Commercial Bank of Ethiopia to your telebirr Account 2519XXXXXX - Abebe MXXXXX NXXXXX. Your current balance is ETB 3,215.60.
Thank you for using telebirr
Ethio telecom`;
const CBE_FOR_FT = `Dear Mrs Abebe your Account 1****6213 has been debited for ABEBE MXXXXX NXXXXX with ETB 750. Your Current Balance is ETB 41208.77. Thank you for Banking with CBE!. For feedback https://example.invalid/s for Reciept https://example.invalid/BranchReceipt/FT26301ABCD1&17283940`;

const categories: Category[] = [...defaultCategories];
const rate: ExchangeRate = { id: 'USD-ETB', fromCurrency: 'USD', toCurrency: 'ETB', rate: 55, updatedAt: new Date(2026, 10, 19).toISOString() };
const empty = (): AccountsState => ({ accounts: [], entries: [], goals: [], allocations: [], notifications: [], rates: [rate], currencies: ['ETB', 'USD'] });

interface Fixture {
  state: AccountsState;
  clock: ReturnType<typeof makeClock>;
  tele: string;
  cbe: string;
  awash: string;
  hib: string;
  usd: string;
}

function fixture(open: { tele?: number; cbe?: number; awash?: number; hib?: number; teleOpening?: string; cbeOpening?: string } = {}): Fixture {
  const clock = makeClock();
  let state = empty();
  const add = (input: Partial<AccountInput> & { name: string; openingAmount: number }, openingDate = '2026-10-01') => {
    const created = planCreateAccount(state, { type: 'bank', currency: 'ETB', ...input }, clock.ctx);
    // The planner dates the opening "today"; move it so messages can be dated before or after it.
    state = { ...created.state, entries: created.state.entries.map((e) => (e.type === 'opening' && e.accountId === created.account.id ? { ...e, date: openingDate } : e)) };
    return created.account.id;
  };
  const tele = add({ name: 'Telebirr', type: 'wallet', openingAmount: open.tele ?? 5000, smsSender: '127' }, open.teleOpening);
  const cbe = add({ name: 'CBE', openingAmount: open.cbe ?? 20000, smsSender: 'CBE', lastDigits: '6213' }, open.cbeOpening);
  const awash = add({ name: 'Awash', openingAmount: open.awash ?? 3000, smsSender: 'Awash Bank', lastDigits: '5512' });
  const hib = add({ name: 'Hibret Bank', openingAmount: open.hib ?? 1000 });
  const usd = add({ name: 'Payoneer', currency: 'USD', openingAmount: 100 });
  return { state, clock, tele, cbe, awash, hib, usd };
}

// Pending suggestions for pasted text, matched to the fixture's accounts like the app does.
function suggestions(f: Fixture, texts: string[], batch = '2026-11-14', patch: Partial<SmsSuggestion> = {}): SmsSuggestion[] {
  const rows = stageBatch(previewBatch(texts.join('\n\n'), new Set(), null, f.clock.ctx.now()), batch, f.clock.ctx, { accounts: f.state.accounts, rules: [], categories });
  return rows.map((row) => ({ ...row, ...patch }));
}
const bal = (s: AccountsState) => getAccountBalances(s.entries, s.accounts);
const total = (s: AccountsState): number => Object.values(bal(s)).reduce((a, b) => a + b, 0);
const keys = (f: Fixture, rows: SmsSuggestion[], rejected: ReadonlySet<string> = new Set()) => findPairs(f.state, rows, rejected).map((c) => c.key);

// ======================================================= 1. what is offered ====================================================
console.log('Which messages are offered as one transfer');
{
  const f = fixture();
  const rows = suggestions(f, [TB_RECV_CBE, CBE_DEBIT_1000]);
  check('(setup) both messages are matched to their accounts', rows[0].accountId === f.tele && rows[1].accountId === f.cbe && rows[0].direction === 'in' && rows[1].direction === 'out');
  const pairs = findPairs(f.state, rows);
  check('rule 2: same amount, same day, and Telebirr names the Commercial Bank: offered', pairs.length === 1 && pairs[0].rule === 'names');
  const p = pairs[0];
  check('...from the outgoing account to the incoming one', p.fromAccountId === f.cbe && p.toAccountId === f.tele && p.out.direction === 'out' && p.inn.direction === 'in' && p.amount === 1000);
  check('...as a suggestion only: finding it changes nothing', f.state.entries.length === 5 && rows.every((r) => r.status === 'pending'));

  const awash = suggestions(f, [TB_OUT_AWASH, AWASH_C2B('2026-11-12 14:23:21')], '2026-11-12');
  check('(setup) the Telebirr transfer and the Awash credit are matched to their accounts', awash[0].accountId === f.tele && awash[1].accountId === f.awash && awash[0].reference === 'DKF8ZQ2WRT' && awash[1].reference === 'DKF8ZQ2WRT');
  const ref = findPairs(f.state, awash);
  check('rule 1: the same transaction number on both: offered, and it wins as the rule', ref.length === 1 && ref[0].rule === 'reference' && ref[0].fromAccountId === f.tele && ref[0].toAccountId === f.awash);
  const nextDay = suggestions(f, [TB_OUT_AWASH, AWASH_C2B('2026-11-13 09:00:00')], '2026-11-12');
  const crossDay = findPairs(f.state, nextDay);
  check('rule 1 does not need the same day', crossDay.length === 1 && crossDay[0].rule === 'reference');

  // near misses
  check('different amount: not offered', findPairs(f.state, suggestions(f, [TB_RECV_CBE, CBE_DEBIT('1200.0', '1212.00')])).length === 0);
  check('different day (the batch date is another day): not offered', findPairs(f.state, suggestions(f, [TB_RECV_CBE, CBE_DEBIT_1000], '2026-11-15')).length === 0);
  check('same amount, same day, but neither names the other: not offered', findPairs(f.state, suggestions(f, [TB_PERSON_RECV, CBE_DEBIT_1000])).length === 0);
  check('same number but a different amount: not offered', findPairs(f.state, suggestions(f, [TB_OUT_AWASH, AWASH_C2B('2026-11-12 14:23:21').replace('ETB 300.00', 'ETB 310.00')], '2026-11-12')).length === 0);
  check('two outgoing messages: not offered', findPairs(f.state, suggestions(f, [CBE_DEBIT_1000, CBE_DEBIT_1000.replace('8,741.55', '7,000.00')])).length === 0);
  check('two incoming messages: not offered', findPairs(f.state, suggestions(f, [TB_RECV_CBE, TB_RECV_CBE.replace('KB9XWDT3AH', 'KB9XWDT3AZ')])).length === 0);
  const sameAccount = suggestions(f, [TB_RECV_CBE, CBE_DEBIT_1000]).map((r) => ({ ...r, accountId: f.tele }));
  check('both sides in the same account: not offered', findPairs(f.state, sameAccount).length === 0);
  const foreign = suggestions(f, [TB_RECV_CBE, CBE_DEBIT_1000]);
  foreign[1] = { ...foreign[1], accountId: f.usd };
  check('a foreign-currency account on one side: not offered', findPairs(f.state, foreign).length === 0);
  const noAccount = suggestions(f, [TB_RECV_CBE, CBE_DEBIT_1000]);
  noAccount[1] = { ...noAccount[1], accountId: null };
  check('a message with no account yet: not offered', findPairs(f.state, noAccount).length === 0);
  const archivedState = { ...f.state, accounts: f.state.accounts.map((a) => (a.id === f.cbe ? { ...a, archived: true } : a)) };
  check('an archived account: not offered', findPairs(archivedState, suggestions(f, [TB_RECV_CBE, CBE_DEBIT_1000])).length === 0);
  const confirmed = suggestions(f, [TB_RECV_CBE, CBE_DEBIT_1000]);
  confirmed[1] = { ...confirmed[1], status: 'confirmed' };
  check('a message that is already confirmed is never offered', findPairs(f.state, confirmed).length === 0);
  const skipped = suggestions(f, [TB_RECV_CBE, CBE_DEBIT_1000]);
  skipped[1] = { ...skipped[1], status: 'ignored' };
  check('a skipped message is not offered', findPairs(f.state, skipped).length === 0);

  // one message in two candidates is shown once
  const dupIn = suggestions(f, [TB_RECV_CBE, TB_RECV_CBE.replace('KB9XWDT3AH', 'KB9XWDT3AZ'), CBE_DEBIT_1000]);
  check('one debit that two receipts could match gives two candidates...', findPairs(f.state, dupIn).length === 2);
  check('...but only one card, so the debit is never in two at once', selectPairs(findPairs(f.state, dupIn)).length === 1);
  check('and the paired messages have no cards of their own', pairedSuggestionIds(selectPairs(findPairs(f.state, dupIn))).size === 2);
  check('every candidate marks its messages as needing a decision (bulk save leaves them)', pairedSuggestionIds(findPairs(f.state, dupIn)).size === 3);
}

// ======================================================= 2. the transfer's date =================================================
console.log('The transfer\'s date: message > paired > receipt > batch');
{
  const side = (source: DateSource, date: string, occurredAt: string | null = null, kind: 'suggestion' | 'entry' = 'suggestion'): PairSide => ({
    kind, id: `${source}-${date}`, accountId: 'a', direction: 'out', amount: 1, date, dateSource: source, occurredAt, reference: null, counterpartyBank: null, counterpartyName: null, printedFee: 0, service: null, rawHash: 'h', label: 'x',
  });
  const order: DateSource[] = ['manual', 'message', 'paired', 'receipt', 'batch'];
  let ranked = true;
  for (let i = 0; i < order.length; i += 1) {
    for (let j = i + 1; j < order.length; j += 1) {
      ranked = ranked && decidePairDate(side(order[j], '2026-11-02'), side(order[i], '2026-11-01')).source === order[i] && decidePairDate(side(order[i], '2026-11-01'), side(order[j], '2026-11-02')).source === order[i];
    }
  }
  check('the better source wins whichever side it is on (manual > message > paired > receipt > batch)', ranked);
  const tie = decidePairDate(side('message', '2026-11-01', null), side('message', '2026-11-01', '2026-11-01T10:00:00'));
  check('on a tie the side with a printed time is taken', tie.from.occurredAt === '2026-11-01T10:00:00');
  const out = side('batch', '2026-11-01');
  const inn = side('batch', '2026-11-01');
  check('on a full tie the outgoing side is taken', decidePairDate(out, inn).from === out);
  check('two batch dates: the transfer is still an estimate', decidePairDate(out, inn).source === 'batch' && decidePairDate(out, inn).upgraded.length === 0);

  const up = decidePairDate(side('batch', '2026-11-05'), side('message', '2026-11-04', '2026-11-04T10:00:00'));
  check('a batch-dated side is upgraded to "paired" with the other side\'s date', up.date === '2026-11-04' && up.upgraded.length === 1 && up.upgraded[0].dateSource === 'batch');
  check('a receipt-dated side is upgraded too', decidePairDate(side('receipt', '2026-11-05'), side('message', '2026-11-04', '2026-11-04T10:00:00')).upgraded.length === 1);
  check('a message-dated side is never "upgraded"', decidePairDate(side('message', '2026-11-05', '2026-11-05T01:00:00'), side('message', '2026-11-04', '2026-11-04T10:00:00')).upgraded.length === 0);
  check('an entry side is never upgraded (it is converted, not re-dated as a message)', decidePairDate(side('batch', '2026-11-05', null, 'entry'), side('message', '2026-11-04', '2026-11-04T10:00:00')).upgraded.length === 0);

  check('a receipt date more than a day from the paired date: the dates disagree', decidePairDate(side('receipt', '2026-10-28'), side('message', '2026-11-14', '2026-11-14T10:00:00')).disagrees);
  check('exactly a day apart: no warning', !decidePairDate(side('receipt', '2026-11-13'), side('message', '2026-11-14', '2026-11-14T10:00:00')).disagrees);
  check('the same day: no warning', !decidePairDate(side('receipt', '2026-11-14'), side('message', '2026-11-14', '2026-11-14T10:00:00')).disagrees);
  check('a batch date that differs is not a "disagreement" (it is only an estimate)', !decidePairDate(side('batch', '2026-10-28'), side('message', '2026-11-14', '2026-11-14T10:00:00')).disagrees);
  check('the disagreeing receipt date is not the one kept', decidePairDate(side('receipt', '2026-10-28'), side('message', '2026-11-14', '2026-11-14T10:00:00')).date === '2026-11-14');
}

// ======================================================= 3. accepting: one transfer ===============================================
console.log('Accepting a pair: one transfer, its fee, both messages');
{
  const f = fixture();
  const rows = suggestions(f, [TB_RECV_CBE, CBE_DEBIT_1000]);
  const key = findPairs(f.state, rows)[0].key;
  const before = total(f.state);
  const plan = planPairSave(f.state, key, rows, 'new', f.clock.ctx);
  const added = plan.result.added ?? [];
  const transfer = added[0];
  const fee = added[1];
  check('exactly two rows are added: one transfer and its fee', added.length === 2 && transfer.type === 'transfer' && fee.type === 'expense');
  check('NOT an expense plus an income: no income and no expense of 1,000', !plan.result.state.entries.some((e) => (e.type === 'income' || e.type === 'expense') && e.amount === 1000));
  check('the transfer goes from CBE to Telebirr for 1,000 both ways', transfer.fromAccountId === f.cbe && transfer.toAccountId === f.tele && transfer.amount === 1000 && transfer.toAmount === 1000 && transfer.accountId === null);
  check('the sending side\'s fee (10 + 1.50 + 0.50) is the transfer\'s linked Fees expense in CBE', fee.amount === 12 && fee.category === FEES_CATEGORY.name && fee.linkedTransferId === transfer.id && fee.accountId === f.cbe);
  check('balances: CBE -1,012, Telebirr +1,000', bal(plan.result.state)[f.cbe] === 20000 - 1012 && bal(plan.result.state)[f.tele] === 6000);
  check('Total changes only by the fee', total(plan.result.state) === before - 12);
  check('the transfer takes the better date: the Telebirr message (2026-11-14, source "message")', transfer.date === '2026-11-14' && transfer.dateSource === 'message');
  check('...and its printed time as the timestamp', transfer.timestamp === timestampFromOccurredAt('2026-11-14T13:37:20'));
  check('the fee shares the date, source and time', fee.date === transfer.date && fee.dateSource === 'message' && fee.timestamp === transfer.timestamp);
  check('both messages are confirmed against the ONE transfer', plan.confirmation.suggestions.length === 2 && plan.confirmation.entryId === transfer.id);
  const cbeSide = plan.confirmation.suggestions.find((s) => s.id === rows[1].id)!;
  const teleSide = plan.confirmation.suggestions.find((s) => s.id === rows[0].id)!;
  check('the batch-dated CBE message is recorded as "paired" with the Telebirr date', cbeSide.dateSource === 'paired' && cbeSide.date === '2026-11-14');
  check('the Telebirr message keeps its own date and source', teleSide.dateSource === 'message' && teleSide.date === '2026-11-14');
  check('each side points at the other', cbeSide.pairedWithId === rows[0].id && teleSide.pairedWithId === rows[1].id);
  check('no recipient memory is written by a pair', !('rule' in plan.confirmation));
  check('the plan does not change the state it was given', f.state.entries.length === 5);
  check('the transfer is a normal transfer: its fee is linked and valid for the usual rules', plan.result.state.entries.filter((e) => e.linkedTransferId === transfer.id).length === 1);

  // fee handling
  const noFee = planPairSave(f.state, key, rows.map((r) => (r.id === rows[1].id ? { ...r, feeAmount: 0 } : r)), 'new', f.clock.ctx);
  check('a fee edited to 0 saves no fee row', (noFee.result.added ?? []).length === 1 && noFee.feeEntryId === null && total(noFee.result.state) === before);
  const bigFee = planPairSave(f.state, key, rows.map((r) => (r.id === rows[1].id ? { ...r, feeAmount: 5 } : r)), 'new', f.clock.ctx);
  check('an edited fee is used instead of the printed one', (bigFee.result.added ?? [])[1].amount === 5);
  const incomingFee = planPairSave(f.state, key, rows.map((r) => (r.id === rows[0].id ? { ...r, feeAmount: 9 } : r)), 'new', f.clock.ctx);
  check('a fee typed on the receiving side is ignored (only the sender pays)', (incomingFee.result.added ?? []).length === 2 && (incomingFee.result.added ?? [])[1].amount === 12);
  const awashRows = suggestions(f, [TB_OUT_AWASH, AWASH_C2B('2026-11-12 14:23:21')], '2026-11-12');
  const awashPlan = planPairSave(f.state, findPairs(f.state, awashRows)[0].key, awashRows, 'new', f.clock.ctx);
  const awashAdded = awashPlan.result.added ?? [];
  check('Telebirr -> Awash: one transfer, fee 0.87 + 0.13 = 1.00 in Telebirr', awashAdded[0].type === 'transfer' && awashAdded[0].fromAccountId === f.tele && awashAdded[0].toAccountId === f.awash && awashAdded[1].amount === 1 && awashAdded[1].accountId === f.tele);
  check('...and both printed dates agree, so there is no disagreement', !checkPair(f.state, findPairs(f.state, awashRows)[0].key, awashRows, f.clock.ctx).decided.disagrees);

  // the date warning, end to end (rule 1, a CBE receipt date far from the Telebirr message)
  const ftRows = suggestions(f, [TB_RECV_FT('2026-11-14 10:00:00'), CBE_FOR_FT], '2026-11-14');
  const ftKey = findPairs(f.state, ftRows)[0].key;
  const ftCheck = checkPair(f.state, ftKey, ftRows, f.clock.ctx);
  check('(setup) the CBE message has a receipt date, the Telebirr one a printed date', ftRows[1].dateSource === 'receipt' && ftRows[1].date === '2026-10-28' && ftRows[0].dateSource === 'message');
  check('a receipt date more than a day away: the card says the dates disagree, as a warning', ftCheck.warnings.some((w) => w.kind === 'dates_disagree') && ftCheck.canAddNew && ftCheck.newBlocked === null);
  const ftPlan = planPairSave(f.state, ftKey, ftRows, 'new', f.clock.ctx);
  check('...and the paired date (the message) is kept, the CBE side recorded as "paired"', (ftPlan.result.added ?? [])[0].date === '2026-11-14' && ftPlan.confirmation.suggestions.find((s) => s.id === ftRows[1].id)?.dateSource === 'paired');
  const nearRows = suggestions(f, [TB_RECV_FT('2026-10-29 10:00:00'), CBE_FOR_FT], '2026-11-14');
  check('a receipt date a day away gives no warning', !checkPair(f.state, findPairs(f.state, nearRows)[0].key, nearRows, f.clock.ctx).warnings.some((w) => w.kind === 'dates_disagree'));

  // never saved twice
  check('a pair that is no longer pending cannot be saved again', codeOf(() => planPairSave(f.state, key, rows.map((r) => ({ ...r, status: 'confirmed' as const })), 'new', f.clock.ctx)) === 'INVALID_ENTRY');
  check('a pair that is not there at all cannot be saved', codeOf(() => planPairSave(f.state, 'nope', rows, 'new', f.clock.ctx)) === 'INVALID_ENTRY');
  const afterState = plan.result.state;
  check('after saving, the same two messages (now confirmed) are not offered again', findPairs(afterState, rows.map((r) => ({ ...r, status: 'confirmed' as const }))).length === 0);
  check('...and a message saved on its own after the pair is refused', codeOf(() => planSuggestionSave(afterState, { ...rows[1], status: 'confirmed', category: 'Food' }, { remember: false }, f.clock.ctx)) === 'INVALID_ENTRY');
  check('the same pair planned again from the saved ledger finds one transfer, not a second', findPairs(afterState, rows).every((c) => c.existingEntryId === null) && (afterState.entries.filter((e) => e.type === 'transfer').length === 1));

  // opening dates: each side
  const g = fixture({ teleOpening: '2026-11-20' });
  const gRows = suggestions(g, [TB_RECV_CBE, CBE_DEBIT_1000]);
  const gKey = findPairs(g.state, gRows)[0].key;
  check('a transfer dated before the receiving account\'s opening day is blocked, naming the account', messageOf(() => planPairSave(g.state, gKey, gRows, 'new', g.clock.ctx)) === "This is dated before the account's opening balance on 2026-11-20 (Telebirr).");
  check('...with its own error code and nothing written', codeOf(() => planPairSave(g.state, gKey, gRows, 'new', g.clock.ctx)) === 'BEFORE_OPENING' && g.state.entries.length === 5);
  check('the card says so, and offers neither way of saving', (() => { const c = checkPair(g.state, gKey, gRows, g.clock.ctx); return !c.canAddNew && c.newBlocked !== null; })());
  const h = fixture({ cbeOpening: '2026-11-20' });
  const hRows = suggestions(h, [TB_RECV_CBE, CBE_DEBIT_1000]);
  check('the same for the sending account\'s opening day', messageOf(() => planPairSave(h.state, findPairs(h.state, hRows)[0].key, hRows, 'new', h.clock.ctx)).endsWith('(CBE).'));
  const dayOf = fixture({ teleOpening: '2026-11-14', cbeOpening: '2026-11-14' });
  const dRows = suggestions(dayOf, [TB_RECV_CBE, CBE_DEBIT_1000]);
  check('dated on both opening days it is allowed', (planPairSave(dayOf.state, findPairs(dayOf.state, dRows)[0].key, dRows, 'new', dayOf.clock.ctx).result.added ?? []).length === 2);
  const poor = fixture({ cbe: 500 });
  const pRows = suggestions(poor, [TB_RECV_CBE, CBE_DEBIT_1000]);
  check('a transfer that would take the sending account below zero is blocked (fee included)', codeOf(() => planPairSave(poor.state, findPairs(poor.state, pRows)[0].key, pRows, 'new', poor.clock.ctx)) === 'NEGATIVE_BALANCE');
  const edge = fixture({ cbe: 1005 });
  const eRows = suggestions(edge, [TB_RECV_CBE, CBE_DEBIT_1000]);
  check('the payment and its fee are validated as one set: 1,000 fits in 1,005 but 1,012 does not', codeOf(() => planPairSave(edge.state, findPairs(edge.state, eRows)[0].key, eRows, 'new', edge.clock.ctx)) === 'NEGATIVE_BALANCE');

  // reserved goal money: a NEW transfer warns, it does not block
  const goal = planCreateGoal(f.state, { name: 'Laptop', targetAmount: 30000, heldInAccountId: f.cbe }, f.clock.ctx);
  const reserved = planAddToGoal(goal.state, goal.goal.id, 19500, f.clock.ctx).state;
  const rRows = suggestions({ ...f, state: reserved }, [TB_RECV_CBE, CBE_DEBIT_1000]);
  const rCheck = checkPair(reserved, findPairs(reserved, rRows)[0].key, rRows, f.clock.ctx);
  check('using reserved goal money is a warning on a new transfer, not a block', rCheck.canAddNew && rCheck.warnings.some((w) => w.kind === 'reserved') && rCheck.newBlocked === null);
}

// ======================================================= 4. converting an existing entry ==========================================
console.log('An existing entry for one side');
{
  // the owner already typed the CBE side by hand: an expense of 1,000 on 2026-11-14
  const f = fixture();
  const manual = planAddEntry(f.state, { type: 'expense', accountId: f.cbe, amount: 1000, currency: 'ETB', category: 'Food', source: 'Cash out', date: '2026-11-14' }, f.clock.ctx);
  const state = manual.state;
  const manualEntry = state.entries[state.entries.length - 1];
  const rows = suggestions(f, [TB_RECV_CBE]);
  const pairs = findPairs(state, rows);
  check('a pending Telebirr "received from CBE" and your own CBE expense of the same amount and day are offered together', pairs.length === 1 && pairs[0].existingEntryId === manualEntry.id && pairs[0].out.kind === 'entry' && pairs[0].inn.kind === 'suggestion');
  const check1 = checkPair(state, pairs[0].key, rows, f.clock.ctx);
  check('a side that is already an entry cannot be added a second time as a new transfer', !check1.canAddNew && check1.canConvert && check1.existingEntry?.id === manualEntry.id);
  check('...and a new transfer is refused if it is tried anyway', codeOf(() => planPairSave(state, pairs[0].key, rows, 'new', f.clock.ctx)) === 'INVALID_ENTRY');
  const plan = planPairSave(state, pairs[0].key, rows, 'convert', f.clock.ctx);
  const converted = plan.result.state.entries.find((e) => e.id === manualEntry.id)!;
  check('the entry becomes the transfer: same id, now from CBE to Telebirr', converted.type === 'transfer' && converted.fromAccountId === f.cbe && converted.toAccountId === f.tele && converted.accountId === null && plan.transferId === manualEntry.id);
  check('...no extra row for the same movement', plan.result.state.entries.length === state.entries.length && plan.result.state.entries.filter((e) => e.type === 'expense' && e.amount === 1000).length === 0);
  check('...it stops being spending (no 1,000 expense is left)', !plan.result.state.entries.some((e) => e.type === 'expense' && e.category === 'Food'));
  check('balances: CBE is unchanged (it was already out 1,000), Telebirr gains 1,000', bal(plan.result.state)[f.cbe] === bal(state)[f.cbe] && bal(plan.result.state)[f.tele] === bal(state)[f.tele] + 1000);
  check('the converted entry keeps its timestamp, and its date is the owners own (a typed date outranks a message date)', converted.timestamp === manualEntry.timestamp && converted.date === '2026-11-14' && converted.dateSource === 'manual');
  check('...and the message side is not re-labelled: it already had a better source than "paired"', plan.confirmation.suggestions[0].dateSource === 'message');
  check('the one message is confirmed against the converted entry, paired with it', plan.confirmation.suggestions.length === 1 && plan.confirmation.entryId === manualEntry.id && plan.confirmation.suggestions[0].pairedWithId === manualEntry.id);
  check('the card says what will change', check1.changes.length >= 3 && check1.changes[0].includes('becomes a transfer from CBE to Telebirr') && check1.changes.some((line) => line.includes('Telebirr changes by +ETB 1,000.00')));
  check('after converting, the entry is a transfer and is no longer offered', findPairs(plan.result.state, rows.map((r) => ({ ...r, status: 'confirmed' as const }))).length === 0 && findPairs(plan.result.state, rows).length === 0);

  // both messages are pasted AND the owner typed one side: convert, so it is recorded once
  const both = suggestions(f, [TB_RECV_CBE, CBE_DEBIT_1000]);
  const bothPairs = findPairs(state, both);
  const shown = selectPairs(bothPairs);
  check('two messages plus a manual entry for one of them: one card, with the entry as the thing to convert', shown.length === 1 && shown[0].existingEntryId === manualEntry.id && shown[0].existingDuplicatesAMessage);
  const bothCheck = checkPair(state, shown[0].key, both, f.clock.ctx);
  check('both ways are offered, and the "new" one says it records it twice', bothCheck.canAddNew && bothCheck.canConvert);
  const bothPlan = planPairSave(state, shown[0].key, both, 'convert', f.clock.ctx);
  const transfers = bothPlan.result.state.entries.filter((e) => e.type === 'transfer');
  check('converting saves ONE transfer for the one movement, and both messages are confirmed', transfers.length === 1 && transfers[0].id === manualEntry.id && bothPlan.confirmation.suggestions.length === 2);
  check('...the fee from the sending message becomes the linked Fees expense', bothPlan.result.state.entries.some((e) => e.linkedTransferId === manualEntry.id && e.amount === 12));
  check('...and no income or expense of 1,000 remains', !bothPlan.result.state.entries.some((e) => (e.type === 'expense' || e.type === 'income') && e.amount === 1000));
  const doubled = planPairSave(state, shown[0].key, both, 'new', f.clock.ctx);
  check('"add as new" on top of an existing entry would record the movement twice (the owner is warned, and it is allowed)', doubled.result.state.entries.filter((e) => e.type === 'expense' && e.amount === 1000).length === 1 && doubled.result.state.entries.filter((e) => e.type === 'transfer').length === 1);

  // refusals
  // (a) the conversion would take an account below zero: the owner typed an INCOME in Hibret for 100, and Telebirr has only 50
  const low = fixture({ tele: 50 });
  const incomeHib = planAddEntry(low.state, { type: 'income', accountId: low.hib, amount: 100, currency: 'ETB', category: 'Salary', date: '2026-11-15' }, low.clock.ctx).state;
  const lowRows = suggestions(low, [TB_OUT_HIBRET], '2026-11-15');
  const lowPair = findPairs(incomeHib, lowRows);
  check('(setup) a Telebirr transfer to Hibret Bank and your own income in an account named Hibret Bank are offered together', lowPair.length === 1 && lowPair[0].rule === 'names' && lowPair[0].inn.kind === 'entry');
  const lowCheck = checkPair(incomeHib, lowPair[0].key, lowRows, low.clock.ctx);
  check('converting would take Telebirr below zero: refused, with the reason', !lowCheck.canConvert && lowCheck.convertBlocked !== null && lowCheck.convertBlocked.startsWith('Not enough money in Telebirr'), String(lowCheck.convertBlocked));
  check('...and so is the attempt itself, with nothing written', codeOf(() => planPairSave(incomeHib, lowPair[0].key, lowRows, 'convert', low.clock.ctx)) === 'NEGATIVE_BALANCE');
  // (b) reserved goal money
  const rich = fixture({ tele: 500 });
  const goal = planCreateGoal(rich.state, { name: 'Phone', targetAmount: 900, heldInAccountId: rich.tele }, rich.clock.ctx);
  const reserved = planAddToGoal(goal.state, goal.goal.id, 480, rich.clock.ctx).state;
  const incomeHib2 = planAddEntry(reserved, { type: 'income', accountId: rich.hib, amount: 100, currency: 'ETB', category: 'Salary', date: '2026-11-15' }, rich.clock.ctx).state;
  const richRows = suggestions({ ...rich, state: incomeHib2 }, [TB_OUT_HIBRET], '2026-11-15');
  const richPair = findPairs(incomeHib2, richRows)[0];
  const richCheck = checkPair(incomeHib2, richPair.key, richRows, rich.clock.ctx);
  check('converting would use money reserved for goals: refused, and the card says how much', !richCheck.canConvert && /reserved for goals/.test(String(richCheck.convertBlocked)), String(richCheck.convertBlocked));
  check('...the attempt throws and nothing is written (no goal shrinks)', codeOf(() => planPairSave(incomeHib2, richPair.key, richRows, 'convert', rich.clock.ctx)) === 'INVALID_ENTRY' && incomeHib2.allocations.length === reserved.allocations.length);
  const fine = fixture({ tele: 5000 });
  const okState = planAddEntry(fine.state, { type: 'income', accountId: fine.hib, amount: 100, currency: 'ETB', category: 'Salary', date: '2026-11-15' }, fine.clock.ctx).state;
  const okRows = suggestions(fine, [TB_OUT_HIBRET], '2026-11-15');
  const okPlan = planPairSave(okState, findPairs(okState, okRows)[0].key, okRows, 'convert', fine.clock.ctx);
  const okEntry = okPlan.result.state.entries.find((e) => e.type === 'transfer')!;
  check('with enough money the same conversion works, and the sending side\'s fee comes along', okEntry.fromAccountId === fine.tele && okEntry.toAccountId === fine.hib && okPlan.result.state.entries.some((e) => e.linkedTransferId === okEntry.id && e.amount === 1));

  // entries that are never converted
  const opening = findPairs(state, rows).length;
  const feeRow = planAddEntry(f.state, { type: 'expense', accountId: f.cbe, amount: 1000, currency: 'ETB', category: 'Fees', date: '2026-11-14' }, f.clock.ctx).state;
  check('a Fees expense is never offered for conversion', findPairs(feeRow, rows).length === 0);
  // Built directly: a 1,000 USD expense would not fit in the fixture's 100 USD account, and the point is only that it is never offered.
  const foreignEntry: AccountsState = { ...f.state, entries: [...f.state.entries, { ...manualEntry, id: 'usd-entry', accountId: f.usd, currency: 'USD' }] };
  check('an entry in a foreign-currency account is never offered', findPairs(foreignEntry, rows).length === 0);
  const otherDay = planAddEntry(f.state, { type: 'expense', accountId: f.cbe, amount: 1000, currency: 'ETB', category: 'Food', date: '2026-11-13' }, f.clock.ctx).state;
  check('an entry on another day is not offered', findPairs(otherDay, rows).length === 0);
  const otherAmount = planAddEntry(f.state, { type: 'expense', accountId: f.cbe, amount: 999, currency: 'ETB', category: 'Food', date: '2026-11-14' }, f.clock.ctx).state;
  check('an entry of another amount is not offered', findPairs(otherAmount, rows).length === 0);
  check('without the manual entry there is nothing to pair with (the opening balances are never offered)', opening === 1 && findPairs(f.state, rows).length === 0);
}

// ======================================================= 5. "not a pair" is remembered =============================================
console.log('Not a pair / keep separate');
{
  const f = fixture();
  const rows = suggestions(f, [TB_RECV_CBE, CBE_DEBIT_1000]);
  const [candidate] = findPairs(f.state, rows);
  const swapped = pairKey(candidate.inn, candidate.out);
  check('the key is the same whichever side is first', swapped === candidate.key && candidate.key === pairKey(candidate.out, candidate.inn));
  check('the key uses the message hashes, not ids, so a re-staged copy has the same key', candidate.key.includes(`s:${rows[0].rawHash}`) && candidate.key.includes(`s:${rows[1].rawHash}`));
  check('once rejected, the same two messages are not offered again', findPairs(f.state, rows, new Set([candidate.key])).length === 0);
  const restaged = rows.map((r, i) => ({ ...r, id: `new-${i}` }));
  check('...even as freshly staged rows with new ids', findPairs(f.state, restaged, new Set([candidate.key])).length === 0);
  check('a different pair is still offered', findPairs(f.state, rows, new Set(['s:other|s:pair'])).length === 1);
  check('rejecting a pair puts its messages back as ordinary cards (they are in no pair)', pairedSuggestionIds(findPairs(f.state, rows, new Set([candidate.key]))).size === 0);
  const third = suggestions(f, [TB_RECV_CBE, TB_RECV_CBE.replace('KB9XWDT3AH', 'KB9XWDT3AZ'), CBE_DEBIT_1000]);
  const firstShown = selectPairs(findPairs(f.state, third))[0];
  const afterReject = selectPairs(findPairs(f.state, third, new Set([firstShown.key])));
  check('rejecting the pair that was shown brings the other candidate for that message forward', afterReject.length === 1 && afterReject[0].key !== firstShown.key);
  // dedupe by hash still applies
  const again = previewBatch([TB_RECV_CBE, CBE_DEBIT_1000].join('\n\n'), new Set(rows.map((r) => r.rawHash)), null, f.clock.ctx.now());
  check('pasting the same two messages again does not make new suggestions (hash dedupe is unchanged)', again.fresh.length === 0 && again.alreadyHandled === 2);
}

// ======================================================= 6. SQLite =========================================================================
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
const versionOf = (db: NodeDb): number => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
const tableExists = (db: NodeDb, name: string): boolean => (db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { c: number }).c > 0;
const countOf = (db: NodeDb, sql: string): number => (db.prepare(`SELECT COUNT(*) AS c FROM ${sql}`).get() as { c: number }).c;
const canon = (value: unknown): string =>
  JSON.stringify(value, (_key, item) => (item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item));

console.log('Schema 8 and the all-or-nothing pair save');
{
  check('the pair schema is version 8', PAIR_SCHEMA_VERSION === 8);
  const device = new DatabaseSync(':memory:');
  const run = runnerFor(device);
  runMigrations(run, 0);
  const f = fixture();
  replaceAccountsData(run, f.state);
  const sRows = suggestions(f, [TB_RECV_CBE, CBE_DEBIT_1000]);
  insertSuggestions(run, sRows);
  device.exec('DROP TABLE pair_rejections; PRAGMA user_version = 7');
  const snapshot = () => canon({ ledger: readAccountsData(run), suggestions: readSuggestions(run), rules: readRules(run), categories: run.all('SELECT * FROM categories ORDER BY id') });
  const before = snapshot();
  const failing: SqlRunner = { ...run, exec: (sql) => { if (sql.startsWith('PRAGMA user_version = 8')) throw new Error('disk full'); run.exec(sql); } };
  check('(setup) a schema 7 device has no pair_rejections table', versionOf(device) === 7 && !tableExists(device, 'pair_rejections'));
  check('a failure part-way throws', messageOf(() => migrateToPairs(failing, 7)) === 'disk full');
  check('...and rolls back: no table, still version 7, nothing else changed', versionOf(device) === 7 && !tableExists(device, 'pair_rejections') && snapshot() === before);
  check('the retry creates the table and reaches 8', migrateToPairs(run, 7) === true && versionOf(device) === 8 && tableExists(device, 'pair_rejections'));
  check('NO existing row was touched', snapshot() === before);
  check('running it again does nothing', migrateToPairs(run, 8) === false && versionOf(device) === 8);
  runMigrations(run, 7);
  check('runMigrations from 7 again changes nothing', snapshot() === before && versionOf(device) === 9);
  check('the step refuses to run below 7', messageOf(() => migrateToPairs(run, 6)).includes('date source migration'));
  const fresh = new DatabaseSync(':memory:');
  runMigrations(runnerFor(fresh), 0);
  check('a fresh install reaches 9 with the table', versionOf(fresh) === 9 && tableExists(fresh, 'pair_rejections'));

  // rejections
  check('no rejections to begin with', readPairRejections(run).size === 0);
  const key = findPairs(f.state, sRows)[0].key;
  addPairRejection(run, key, 'not_pair', '2026-11-20T09:00:00Z');
  check('a rejection is saved and read back', readPairRejections(run).has(key) && countOf(device, 'pair_rejections') === 1);
  addPairRejection(run, key, 'keep_separate', '2026-11-20T09:05:00Z');
  check('rejecting again replaces it (still one row, the later reason)', countOf(device, 'pair_rejections') === 1 && (run.all<{ reason: string }>('SELECT reason FROM pair_rejections')[0].reason === 'keep_separate'));
  check('the saved rejection stops the pair being offered after a restart', findPairs(f.state, readSuggestions(run), readPairRejections(run)).length === 0);
  run.run('DELETE FROM pair_rejections');

  // the atomic save
  const plan = planPairSave(f.state, key, sRows, 'new', f.clock.ctx);
  const pending = () => readSuggestions(run).filter((s) => s.status === 'pending').length;
  const injections: Array<[string, (sql: string, n: { tx: number; up: number }) => boolean]> = [
    ['the transfer row', (sql, n) => sql.includes('INTO transactions') && n.tx === 1],
    ['the SECOND write (the fee row)', (sql, n) => sql.includes('INTO transactions') && n.tx === 2],
    ['marking the FIRST message confirmed', (sql, n) => sql.includes('UPDATE sms_suggestions') && n.up === 1],
    ['marking the SECOND message confirmed', (sql, n) => sql.includes('UPDATE sms_suggestions') && n.up === 2],
  ];
  for (const [label, shouldFail] of injections) {
    const dev = new DatabaseSync(':memory:');
    const r = runnerFor(dev);
    runMigrations(r, 0);
    replaceAccountsData(r, f.state);
    insertSuggestions(r, sRows);
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
    check(`failure on ${label}: the save throws`, messageOf(() => commitPairSave(bad, f.state, plan.result.state, plan.confirmation)) === 'disk full');
    check(`failure on ${label}: nothing was saved (only the five opening entries remain)`, countOf(dev, 'transactions') === 5 && countOf(dev, "transactions WHERE type = 'transfer'") === 0);
    check(`failure on ${label}: BOTH messages are still pending, with no entry id`, readSuggestions(r).every((s) => s.status === 'pending' && s.confirmedEntryId === null) && readSuggestions(r).length === 2);
    check(`failure on ${label}: no recipient rule and no goal change`, countOf(dev, 'recipient_rules') === 0 && countOf(dev, 'goal_allocations') === 0);
    commitPairSave(r, f.state, plan.result.state, plan.confirmation);
    check(`failure on ${label}: a retry produces exactly ONE transfer and one fee`, countOf(dev, "transactions WHERE type = 'transfer'") === 1 && countOf(dev, "transactions WHERE category = 'Fees'") === 1 && countOf(dev, 'transactions') === 7);
    const done = readSuggestions(r);
    check(`failure on ${label}: ...both messages are confirmed against that transfer and point at each other`, done.every((s) => s.status === 'confirmed' && s.confirmedEntryId === plan.transferId) && done.find((s) => s.service === 'cbe')?.dateSource === 'paired' && countOf(dev, 'recipient_rules') === 0);
    check(`failure on ${label}: ...the ledger read back has the balances of the plan`, bal({ ...f.state, ...readAccountsData(r) })[f.cbe] === 20000 - 1012 && bal({ ...f.state, ...readAccountsData(r) })[f.tele] === 6000);
    check(`failure on ${label}: committing the same plan again is refused and writes nothing`, messageOf(() => commitPairSave(r, f.state, plan.result.state, plan.confirmation)).includes('no longer pending') && countOf(dev, "transactions WHERE type = 'transfer'") === 1);
  }

  // a half-handled pair is refused: one message already confirmed elsewhere
  {
    const dev = new DatabaseSync(':memory:');
    const r = runnerFor(dev);
    runMigrations(r, 0);
    replaceAccountsData(r, f.state);
    insertSuggestions(r, sRows);
    r.run("UPDATE sms_suggestions SET status = 'confirmed' WHERE id = ?", sRows[0].id);
    check('if one of the two messages is no longer pending the whole pair is refused, with nothing written', messageOf(() => commitPairSave(r, f.state, plan.result.state, plan.confirmation)).includes('no longer pending') && countOf(dev, 'transactions') === 5);
  }

  // converting an existing entry through SQLite
  {
    const manual = planAddEntry(f.state, { type: 'expense', accountId: f.cbe, amount: 1000, currency: 'ETB', category: 'Food', date: '2026-11-14' }, f.clock.ctx).state;
    const dev = new DatabaseSync(':memory:');
    const r = runnerFor(dev);
    runMigrations(r, 0);
    replaceAccountsData(r, manual);
    const rows = suggestions(f, [TB_RECV_CBE]);
    insertSuggestions(r, rows);
    const [pair] = findPairs(manual, rows);
    const conv = planPairSave(manual, pair.key, rows, 'convert', f.clock.ctx);
    commitPairSave(r, manual, conv.result.state, conv.confirmation);
    const read = readAccountsData(r);
    const row = read.entries.find((e) => e.id === pair.existingEntryId) as AccountEntry;
    check('the converted entry is stored as a transfer under the same id', row.type === 'transfer' && row.accountId === null && row.fromAccountId === f.cbe && row.toAccountId === f.tele);
    check('the number of entries did not grow: the movement is recorded once', countOf(dev, 'transactions') === manual.entries.length);
    check('the message is confirmed against the converted entry', readSuggestions(r)[0].confirmedEntryId === pair.existingEntryId && readSuggestions(r)[0].status === 'confirmed');
    check('balances after the conversion: CBE unchanged, Telebirr +1,000', bal({ ...manual, ...read })[f.cbe] === bal(manual)[f.cbe] && bal({ ...manual, ...read })[f.tele] === bal(manual)[f.tele] + 1000);
  }
}

// ======================================================= 5b. an entry that includes the fee =========================================
console.log('An entry that includes the fee');
{
  const BOA_DEBIT_1000 = `Dear Abebe, your account 2***64 was debited with ETB 1,000.00. Available Balance: ETB 44,010.25.`;
  const TB_RECV_BOA = TB_RECV_CBE.replace('Commercial Bank of Ethiopia', 'Bank of Abyssinia').replace('KB9XWDT3AH', 'KB9XWDT3AQ');
  const withBoa = (f: Fixture): Fixture => {
    const created = planCreateAccount(f.state, { name: 'BOA', type: 'bank', currency: 'ETB', openingAmount: 20000, smsSender: 'BOA', lastDigits: '64' }, f.clock.ctx);
    const state = { ...created.state, entries: created.state.entries.map((e) => (e.type === 'opening' && e.accountId === created.account.id ? { ...e, date: '2026-10-01' } : e)) };
    return { ...f, state, boa: created.account.id } as Fixture & { boa: string };
  };
  const addExpense = (f: Fixture, accountId: string, amount: number, extra: Partial<{ date: string; category: string; type: 'expense' | 'income' }> = {}): AccountsState =>
    planAddEntry(f.state, { type: extra.type ?? 'expense', accountId, amount, currency: 'ETB', category: extra.category ?? 'Food', source: 'Cash out', date: extra.date ?? '2026-11-14' }, f.clock.ctx).state;
  const lastOf = (s: AccountsState): AccountEntry => s.entries[s.entries.length - 1];
  const received = (f: Fixture, text = TB_RECV_CBE) => suggestions(f, [text]);

  check('the tolerance is the larger of 2% and ETB 100', PAIR_FEE_TOLERANCE_PERCENT === 2 && PAIR_FEE_TOLERANCE_MIN === 100 && feeTolerance(1000) === 100 && feeTolerance(10000) === 200 && feeTolerance(50) === 100 && feeTolerance(6000) === 120 && feeTolerance(5000) === 100);

  // ---- only the receiving message is pasted ------------------------------------------------------------------------------------------------
  const f = fixture();
  const state = addExpense(f, f.cbe, 1012);
  const entry = lastOf(state);
  const rows = received(f);
  const search = searchPairs(state, rows);
  const c = search.candidates[0];
  check('an expense of 1,012 on the sending account and a received 1,000 are offered together', search.candidates.length === 1 && c.out.kind === 'entry' && c.existingEntryId === entry.id && c.rule === 'names');
  check('the transfer is the received amount, and the difference is carried as the fee', c.amount === 1000 && c.feeFromEntry === 12 && c.ambiguousEntryIds.length === 0);
  const ck = checkPair(state, c.key, rows, f.clock.ctx);
  check('the card says it plainly', ck.feeDifference?.entry === 1012 && ck.feeDifference?.transfer === 1000 && ck.feeDifference?.difference === 12 && ck.changes[0] === 'Your entry is ETB 1,012.00. The transfer is ETB 1,000.00. The difference ETB 12.00 becomes the fee.', ck.changes[0]);
  check('the fee shown is the difference, and converting (not adding new) is what is offered', ck.fee === 12 && ck.canConvert && !ck.canAddNew && ck.convertBlocked === null);
  const plan = planPairSave(state, c.key, rows, 'convert', f.clock.ctx);
  const after = plan.result.state;
  const converted = after.entries.find((e) => e.id === entry.id)!;
  const feeRow = after.entries.find((e) => e.linkedTransferId === entry.id)!;
  check('the entry keeps its id and becomes the transfer of 1,000 from CBE to Telebirr', converted.type === 'transfer' && converted.fromAccountId === f.cbe && converted.toAccountId === f.tele && converted.amount === 1000 && converted.toAmount === 1000 && plan.transferId === entry.id);
  check('the difference of 12 is a NEW linked Fees expense in the sending account', !!feeRow && feeRow.amount === 12 && feeRow.category === FEES_CATEGORY.name && feeRow.accountId === f.cbe && feeRow.type === 'expense' && plan.feeEntryId === feeRow.id);
  check('the sending account\'s balance does not change by the conversion', bal(after)[f.cbe] === bal(state)[f.cbe]);
  check('the receiving account gains the amount, so Total gains exactly that', bal(after)[f.tele] === bal(state)[f.tele] + 1000 && total(after) === total(state) + 1000);
  check('one entry became a transfer and one fee row was added: nothing else changed', after.entries.length === state.entries.length + 1 && after.entries.filter((e) => e.id !== entry.id && e.id !== feeRow.id).every((e, i) => e === state.entries.filter((x) => x.id !== entry.id)[i]));
  check('it stops being spending: no 1,012 expense is left', !after.entries.some((e) => e.type === 'expense' && e.amount === 1012));
  check('the message is confirmed against the converted entry', plan.confirmation.entryId === entry.id && plan.confirmation.suggestions.length === 1);
  check('adding it as a NEW transfer is refused (the entry already records the sending side)', codeOf(() => planPairSave(state, c.key, rows, 'new', f.clock.ctx)) === 'INVALID_ENTRY');

  // the fee stays editable
  const five = planPairSave(state, c.key, rows, 'convert', f.clock.ctx, { fee: 5 });
  check('an edited fee of 5 is used instead of the difference', five.result.state.entries.find((e) => e.linkedTransferId === entry.id)?.amount === 5 && bal(five.result.state)[f.cbe] === bal(state)[f.cbe] + 7);
  const none = planPairSave(state, c.key, rows, 'convert', f.clock.ctx, { fee: 0 });
  check('a fee of 0 saves no fee row (the account then keeps the 12)', !none.result.state.entries.some((e) => e.linkedTransferId === entry.id) && bal(none.result.state)[f.cbe] === bal(state)[f.cbe] + 12);
  check('a null or missing fee means "use the difference"', planPairSave(state, c.key, rows, 'convert', f.clock.ctx, { fee: null }).feeEntryId !== null);

  // exact match still works
  const exact = addExpense(f, f.cbe, 1000);
  const exactC = findPairs(exact, rows)[0];
  const exactPlan = planPairSave(exact, exactC.key, rows, 'convert', f.clock.ctx);
  check('an entry of exactly the transfer amount still converts, with no fee row', exactC.feeFromEntry === 0 && exactPlan.feeEntryId === null && exactPlan.result.state.entries.length === exact.entries.length && bal(exactPlan.result.state)[f.cbe] === bal(exact)[f.cbe]);
  check('...and its card has no "difference" line', checkPair(exact, exactC.key, rows, f.clock.ctx).feeDifference === null);

  // how big a difference is believable
  const bounds = (amount: number, entryAmount: number, text = TB_RECV_CBE) => {
    const g = fixture({ cbe: 50000 });
    const s = addExpense(g, g.cbe, entryAmount);
    return findPairs(s, received(g, text)).length;
  };
  check('a difference of exactly ETB 100 on 1,000 is offered', bounds(1000, 1100) === 1);
  check('a difference of ETB 101 on 1,000 is too large and is not offered', bounds(1000, 1101) === 0);
  const TB_10K = TB_RECV_CBE.replace('ETB 1,000.00', 'ETB 10,000.00');
  check('on 10,000 the limit is 2% = 200: 10,200 is offered, 10,201 is not', bounds(10000, 10200, TB_10K) === 1 && bounds(10000, 10201, TB_10K) === 0);
  const TB_50 = TB_RECV_CBE.replace('ETB 1,000.00', 'ETB 50.00');
  check('on 50 the limit is ETB 100: 150 is offered, 151 is not', bounds(50, 150, TB_50) === 1 && bounds(50, 151, TB_50) === 0);
  check('a smaller entry (999 for a 1,000 transfer) is never offered', bounds(1000, 999) === 0);

  // entries that are never offered
  const never = (mutate: (s: AccountsState) => AccountsState) => findPairs(mutate(addExpense(f, f.cbe, 1012)), rows).length;
  check('an income of 1,012 is not the sending side', findPairs(addExpense(f, f.cbe, 1012, { type: 'income' }), rows).length === 0);
  check('an entry on another day is not offered', findPairs(addExpense(f, f.cbe, 1012, { date: '2026-11-13' }), rows).length === 0);
  check('a Fees expense is not offered', findPairs(addExpense(f, f.cbe, 1012, { category: 'Fees' }), rows).length === 0);
  check('an entry that is already a transfer is not offered', never((s) => ({ ...s, entries: s.entries.map((e) => (e.id === lastOf(s).id ? { ...e, type: 'transfer' as const, accountId: null, fromAccountId: f.cbe, toAccountId: f.awash, toAmount: e.amount, toAmountETB: e.amount } : e)) })) === 0);
  check('a recurring-generated entry is not offered', never((s) => ({ ...s, entries: s.entries.map((e) => (e.id === lastOf(s).id ? { ...e, isAutomatic: true } : e)) })) === 0);
  check('an entry in a foreign currency is not offered', never((s) => ({ ...s, entries: s.entries.map((e) => (e.id === lastOf(s).id ? { ...e, accountId: f.usd, currency: 'USD' } : e)) })) === 0);
  check('an entry in a different account that the message does not name is not offered', findPairs(addExpense(f, f.awash, 1012), rows).length === 0);

  // ---- both messages pasted, the sending one prints a fee -------------------------------------------------------------------------------
  const both = suggestions(f, [TB_RECV_CBE, CBE_DEBIT_1000]);
  const s1012 = addExpense(f, f.cbe, 1012);
  const bothC = selectPairs(findPairs(s1012, both))[0];
  check('with the sending message printing a fee of 12, an entry of exactly 1,012 stands for it', bothC.existingEntryId === lastOf(s1012).id && bothC.existingDuplicatesAMessage && bothC.feeFromEntry === 12 && bothC.ambiguousEntryIds.length === 0);
  const bothPlan = planPairSave(s1012, bothC.key, both, 'convert', f.clock.ctx);
  check('converting uses the PRINTED fee, saves one transfer, and confirms both messages', bothPlan.result.state.entries.filter((e) => e.type === 'transfer').length === 1 && bothPlan.result.state.entries.find((e) => e.linkedTransferId === lastOf(s1012).id)?.amount === 12 && bothPlan.confirmation.suggestions.length === 2);
  check('...and the sending account\'s balance does not change by the conversion', bal(bothPlan.result.state)[f.cbe] === bal(s1012)[f.cbe]);
  check('...nor is the movement recorded twice (no 1,012 or 1,000 income/expense is left)', !bothPlan.result.state.entries.some((e) => (e.type === 'expense' || e.type === 'income') && (e.amount === 1012 || e.amount === 1000)));
  for (const wrong of [1011, 1013, 1020, 1100]) {
    check(`with a printed fee of 12, an entry of ${wrong} is not matched (it must be exactly amount + fee)`, selectPairs(findPairs(addExpense(f, f.cbe, wrong), both))[0].existingEntryId === null);
  }
  const exactBoth = selectPairs(findPairs(addExpense(f, f.cbe, 1000), both))[0];
  check('an entry of exactly the amount (no fee in it) still matches, and the printed fee is then added as new money', exactBoth.existingEntryId !== null && exactBoth.feeFromEntry === 0);
  const noEntry = selectPairs(findPairs(f.state, both))[0];
  check('with no entry at all the pair is just two messages', noEntry.existingEntryId === null && noEntry.feeFromEntry === 0);

  // ---- both messages pasted, the sending one prints NO fee (BOA) ----------------------------------------------------------------------
  const b = withBoa(f) as Fixture & { boa: string };
  const boaMsgs = suggestions(b, [TB_RECV_BOA, BOA_DEBIT_1000]);
  check('(setup) the BOA debit and the Telebirr "received from Bank of Abyssinia" are matched and paired', boaMsgs[0].accountId === b.tele && boaMsgs[1].accountId === b.boa && findPairs(b.state, boaMsgs).length === 1);
  const boaState = planAddEntry(b.state, { type: 'expense', accountId: b.boa, amount: 1015, currency: 'ETB', category: 'Food', date: '2026-11-14' }, b.clock.ctx).state;
  const boaC = selectPairs(findPairs(boaState, boaMsgs))[0];
  check('a sending message with no printed fee: an entry larger by up to the tolerance stands for it', boaC.existingEntryId === lastOf(boaState).id && boaC.feeFromEntry === 15);
  const boaPlan = planPairSave(boaState, boaC.key, boaMsgs, 'convert', b.clock.ctx);
  check('...and the difference of 15 becomes the fee, with the BOA balance unchanged', boaPlan.result.state.entries.find((e) => e.linkedTransferId === lastOf(boaState).id)?.amount === 15 && bal(boaPlan.result.state)[b.boa] === bal(boaState)[b.boa]);
  const boaBig = planAddEntry(b.state, { type: 'expense', accountId: b.boa, amount: 1101, currency: 'ETB', category: 'Food', date: '2026-11-14' }, b.clock.ctx).state;
  check('a difference above the tolerance is not matched', selectPairs(findPairs(boaBig, boaMsgs))[0].existingEntryId === null);

  // ---- two entries qualify: none is offered, and it says why -----------------------------------------------------------------------------------
  const ambiguousCases: Array<[string, number[]]> = [
    ['two different amounts within the tolerance', [1012, 1008]],
    ['two identical entries', [1012, 1012]],
    ['one exact and one with the fee', [1000, 1012]],
    ['two exact entries', [1000, 1000]],
  ];
  for (const [label, amounts] of ambiguousCases) {
    let s = f.state;
    for (const amount of amounts) s = planAddEntry(s, { type: 'expense', accountId: f.cbe, amount, currency: 'ETB', category: 'Food', date: '2026-11-14' }, f.clock.ctx).state;
    const result = searchPairs(s, rows);
    check(`${label}: nothing is offered for the received message`, result.candidates.length === 0, String(result.candidates.length));
    check(`${label}: a notice says why, naming the entries and what to do`, result.notices.length === 1 && /more than one of your entries/.test(result.notices[0].message) && /Remove or change the extra one/.test(result.notices[0].message) && amounts.every((a) => result.notices[0].message.includes(formatAmount(a))), result.notices[0]?.message);
    if (amounts.join() === '1012,1008') {
      // With the sending message pasted it prints a fee of 12, so only 1,012 (amount + fee) qualifies: the 1,008 is not a match and the pair is not ambiguous.
      check(`${label}: with the sending message pasted (fee 12) only the 1,012 qualifies, so it is offered for conversion`, selectPairs(findPairs(s, both))[0].ambiguousEntryIds.length === 0 && selectPairs(findPairs(s, both))[0].existingEntryId !== null);
      continue;
    }
    const withBoth = selectPairs(findPairs(s, both));
    check(`${label}: with both messages pasted the pair is shown, but neither saving way is offered`, withBoth.length === 1 && withBoth[0].ambiguousEntryIds.length === 2);
    const cc = checkPair(s, withBoth[0].key, both, f.clock.ctx);
    check(`${label}: ...the card says so`, !cc.canAddNew && !cc.canConvert && cc.ambiguous !== null && cc.newBlocked === cc.ambiguous);
    check(`${label}: ...and saving either way throws and writes nothing`, codeOf(() => planPairSave(s, withBoth[0].key, both, 'convert', f.clock.ctx)) === 'INVALID_ENTRY' && codeOf(() => planPairSave(s, withBoth[0].key, both, 'new', f.clock.ctx)) === 'INVALID_ENTRY');
  }
  let two = f.state;
  for (const amount of [1012, 1008]) two = planAddEntry(two, { type: 'expense', accountId: f.cbe, amount, currency: 'ETB', category: 'Food', date: '2026-11-14' }, f.clock.ctx).state;
  const oneGone = { ...two, entries: two.entries.filter((e) => e.amount !== 1008) };
  check('once the extra entry is removed, the offer appears', findPairs(oneGone, rows).length === 1 && searchPairs(oneGone, rows).notices.length === 0);

  // ---- refusals still apply -----------------------------------------------------------------------------------------------------------------
  const tight = fixture({ cbe: 1100 });
  const tightState = addExpense(tight, tight.cbe, 1012);
  const tightRows = received(tight);
  const tightKey = findPairs(tightState, tightRows)[0].key;
  check('(setup) the sending account is left with only ETB 88', bal(tightState)[tight.cbe] === 88);
  check('the plain conversion (fee = difference) does not change the balance, so it is allowed even when tight', planPairSave(tightState, tightKey, tightRows, 'convert', tight.clock.ctx).result.state.entries.some((e) => e.type === 'transfer'));
  check('a fee edited up so that the account would go below zero is refused, nothing written', codeOf(() => planPairSave(tightState, tightKey, tightRows, 'convert', tight.clock.ctx, { fee: 200 })) === 'NEGATIVE_BALANCE');
  check('...and the card, which plans the default, still offers it', checkPair(tightState, tightKey, tightRows, tight.clock.ctx).canConvert);
  const goal = planCreateGoal(tightState, { name: 'Laptop', targetAmount: 5000, heldInAccountId: tight.cbe }, tight.clock.ctx);
  const reserved = planAddToGoal(goal.state, goal.goal.id, 80, tight.clock.ctx).state;
  check('(setup) 80 of the 88 is reserved for a goal', bal(reserved)[tight.cbe] === 88);
  check('the plain conversion still works: it uses none of the reserved money', planPairSave(reserved, findPairs(reserved, tightRows)[0].key, tightRows, 'convert', tight.clock.ctx).result.autoReductions.length === 0);
  check('a fee edited up so that it would use reserved goal money is refused, with the reason', /reserved for goals/.test(messageOf(() => planPairSave(reserved, findPairs(reserved, tightRows)[0].key, tightRows, 'convert', tight.clock.ctx, { fee: 30 }))));
  check('...and no goal was shrunk by the attempt', reserved.allocations.length === goal.state.allocations.length + 1);

  // ---- all-or-nothing on SQLite ------------------------------------------------------------------------------------------------------------------
  {
    const dev = new DatabaseSync(':memory:');
    const r = runnerFor(dev);
    runMigrations(r, 0);
    replaceAccountsData(r, state);
    insertSuggestions(r, rows);
    const [cand] = findPairs(state, rows);
    const p = planPairSave(state, cand.key, rows, 'convert', f.clock.ctx);
    let writes = 0;
    const bad: SqlRunner = { ...r, run: (sql, ...params) => { if (sql.includes('INTO transactions')) writes += 1; if (sql.includes('INTO transactions') && writes === 2) throw new Error('disk full'); r.run(sql, ...params); } };
    check('a failure while writing the fee row throws', messageOf(() => commitPairSave(bad, state, p.result.state, p.confirmation)) === 'disk full');
    check('...and the entry is still the expense, no fee row exists, the message is pending', countOf(dev, "transactions WHERE type = 'transfer'") === 0 && countOf(dev, "transactions WHERE category = 'Fees'") === 0 && countOf(dev, `transactions WHERE id = '${entry.id}' AND type = 'expense'`) === 1 && readSuggestions(r)[0].status === 'pending');
    commitPairSave(r, state, p.result.state, p.confirmation);
    check('the retry converts it and adds exactly one fee row', countOf(dev, "transactions WHERE type = 'transfer'") === 1 && countOf(dev, "transactions WHERE category = 'Fees'") === 1 && countOf(dev, 'transactions') === state.entries.length + 1);
    const read = readAccountsData(r);
    check('the stored ledger has the same sending balance as before the conversion', bal({ ...state, ...read })[f.cbe] === bal(state)[f.cbe] && readSuggestions(r)[0].confirmedEntryId === entry.id);
  }
}

// ======================================================= 5c. the typed fee on the card: effect and what is saved ====================
console.log('The fee typed on the card');
{
  const f = fixture();
  const state = planAddEntry(f.state, { type: 'expense', accountId: f.cbe, amount: 1012, currency: 'ETB', category: 'Food', source: 'Cash out', date: '2026-11-14' }, f.clock.ctx).state;
  const entry = state.entries[state.entries.length - 1];
  const rows = suggestions(f, [TB_RECV_CBE]);
  const key = findPairs(state, rows)[0].key;
  const cbeBalance = (s: AccountsState) => bal(s)[f.cbe];
  const effectOf = (fee?: number | null) => checkPair(state, key, rows, f.clock.ctx, fee === undefined ? {} : { fee }).feeEffect;

  check('with no typed fee the effect is "no change" (the difference of 12 stays the fee)', effectOf()?.change === 0 && effectOf()?.text === 'Your CBE balance will not change.', JSON.stringify(effectOf()));
  check('typing the same 12 changes nothing', effectOf(12)?.change === 0 && effectOf(12)?.text === 'Your CBE balance will not change.');
  check('typing 5: the balance goes UP by 7 and the card says so', effectOf(5)?.change === 7 && effectOf(5)?.text === 'Your CBE balance will go up by ETB 7.00.', JSON.stringify(effectOf(5)));
  check('typing 0: the balance goes UP by 12', effectOf(0)?.change === 12 && effectOf(0)?.text === 'Your CBE balance will go up by ETB 12.00.');
  check('typing 20: the balance goes DOWN by 8', effectOf(20)?.change === -8 && effectOf(20)?.text === 'Your CBE balance will go down by ETB 8.00.');
  check('null means "use the difference"', effectOf(null)?.change === 0);
  check('a negative or non-numeric fee is ignored (the difference is used)', effectOf(-3)?.change === 0 && effectOf(Number.NaN)?.change === 0);
  check('the fee the check reports is the typed one', checkPair(state, key, rows, f.clock.ctx, { fee: 5 }).fee === 5 && checkPair(state, key, rows, f.clock.ctx, { fee: 0 }).fee === 0 && checkPair(state, key, rows, f.clock.ctx, {}).fee === 12);

  // the card's promise is what the conversion does
  for (const typed of [12, 5, 0, null, 20]) {
    const plan = planPairSave(state, key, rows, 'convert', f.clock.ctx, { fee: typed });
    const expectedFee = typed === null ? 12 : typed;
    const feeRow = plan.result.state.entries.find((e) => e.linkedTransferId === entry.id);
    check(`fee ${typed === null ? 'null' : typed}: the conversion saves ${expectedFee === 0 ? 'no fee row' : `a Fees expense of ${expectedFee}`}`, expectedFee === 0 ? feeRow === undefined && plan.feeEntryId === null : feeRow?.amount === expectedFee && feeRow.category === FEES_CATEGORY.name && feeRow.accountId === f.cbe);
    check(`fee ${typed === null ? 'null' : typed}: the sending balance moves by exactly what the card said`, cbeBalance(plan.result.state) - cbeBalance(state) === effectOf(typed)?.change);
    check(`fee ${typed === null ? 'null' : typed}: the transfer itself is still 1,000 from CBE to Telebirr and keeps the entry's id`, plan.transferId === entry.id && plan.result.state.entries.find((e) => e.id === entry.id)?.amount === 1000);
  }

  // a NEW transfer (both messages, nothing typed by hand)
  const both = suggestions(f, [TB_RECV_CBE, CBE_DEBIT_1000]);
  const newKey = findPairs(f.state, both)[0].key;
  const newEffect = (fee?: number | null) => checkPair(f.state, newKey, both, f.clock.ctx, fee === undefined ? {} : { fee }).feeEffect;
  check('a new transfer: the printed fee of 12 means CBE goes down by 1,012', newEffect()?.change === -1012 && newEffect()?.text === 'Your CBE balance will go down by ETB 1,012.00.');
  check('...typing 5 means 1,005, typing 0 means 1,000', newEffect(5)?.change === -1005 && newEffect(0)?.change === -1000);
  const newPlan = planPairSave(f.state, newKey, both, 'new', f.clock.ctx, { fee: 5 });
  check('...and that is what saving does', cbeBalance(newPlan.result.state) - cbeBalance(f.state) === -1005 && (newPlan.result.added ?? [])[1]?.amount === 5);

  // an entry of exactly the amount: any fee typed is new money leaving the account
  const exactState = planAddEntry(f.state, { type: 'expense', accountId: f.cbe, amount: 1000, currency: 'ETB', category: 'Food', date: '2026-11-14' }, f.clock.ctx).state;
  const exactKey = findPairs(exactState, rows)[0].key;
  check('an entry of exactly the amount with a fee typed: the balance goes down by that fee', checkPair(exactState, exactKey, rows, f.clock.ctx, { fee: 3 }).feeEffect?.change === -3 && checkPair(exactState, exactKey, rows, f.clock.ctx, {}).feeEffect?.change === 0);

  // the words
  check('feeEffectText: up, down and no change', feeEffectText('CBE', 7) === 'Your CBE balance will go up by ETB 7.00.' && feeEffectText('CBE', -8.5) === 'Your CBE balance will go down by ETB 8.50.' && feeEffectText('CBE', 0) === 'Your CBE balance will not change.' && feeEffectText('Telebirr', 1234.5) === 'Your Telebirr balance will go up by ETB 1,234.50.');
  check('a change that is only floating-point dust counts as no change', feeEffectText('CBE', 1e-12) === 'Your CBE balance will not change.');

  // a refused plan has no effect line (it says why instead)
  const tight = fixture({ cbe: 1100 });
  const tightState = planAddEntry(tight.state, { type: 'expense', accountId: tight.cbe, amount: 1012, currency: 'ETB', category: 'Food', date: '2026-11-14' }, tight.clock.ctx).state;
  const tightRows = suggestions(tight, [TB_RECV_CBE]);
  const tightKey = findPairs(tightState, tightRows)[0].key;
  const refused = checkPair(tightState, tightKey, tightRows, tight.clock.ctx, { fee: 200 });
  check('a typed fee that would overdraw is refused on the card, with the reason and no effect line', !refused.canConvert && /Not enough money in CBE/.test(String(refused.convertBlocked)) && refused.feeEffect === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
