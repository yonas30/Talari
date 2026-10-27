// Checks for the amount / charges / total rule (V2_SPEC Part Z, "Amount, charges and total"): the amount is the money that went to the other
// party WITHOUT charges, the fee is every charge, and the total debited is amount + fee, so a fee is never counted twice. Every message and
// figure below is SYNTHETIC. Run: npx tsx scripts/verify-sms-amounts.ts
import { FEES_CATEGORY } from '../constants/categories';
import { runMigrations, SqlRunner } from '../db/migrations';
import { insertSuggestions, readSuggestions } from '../db/smsRepo';
import { AccountsState } from '../types/accounts';
import { SmsSuggestion } from '../types/sms';
import { getAccountBalances } from '../utils/accounts/balances';
import { Ctx } from '../utils/accounts/context';
import { planCreateAccount } from '../utils/accounts/manage';
import { buildChains, feeProposals, gapNotes } from '../utils/sms/chain';
import { reconcileTotals } from '../utils/sms/amounts';
import { parseSms } from '../utils/sms/parse';
import { checkSuggestion, effectiveFee, planSuggestionSave, printedCharges } from '../utils/sms/saveSuggestion';
import { previewBatch, stageBatch } from '../utils/sms/staging';
import { ParsedSms } from '../utils/sms/types';

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
const cents = (v: number | null): number => Math.round((v ?? 0) * 100);

// ---- synthetic CBE-shaped messages -----------------------------------------------------------------------------------------------------------
// A transfer: "transferred ETB <first figure> ... Service charge of ETB c1 and VAT(15%) of ETB c2 and Disaster Recovery(5%) of c3 with total of ETB <total>"
const transfer = (first: string, charges: [string, string, string], total: string, balance: string) =>
  `Dear  Abebe Gxxx dxxxxx You have successfully transferred ETB${first} from account 1***4827 to account 1***7316 (Fiker Mulu Alem). Service charge of ETB ${charges[0]} and VAT(15%) of ETB${charges[1]} and Disaster Recovery(5%) of ${charges[2]} with total of ETB${total} .Your current balance is ETB${balance}. Thanks for Banking with CBE. `;
const debit = (first: string, charges: [string, string, string], total: string, balance: string) =>
  `Dear Abebe  A debit transaction of ETB ${first}. has occurred on your account 1****4827. Service charge of ETB ${charges[0]} and VAT(15%) of ETB${charges[1]} and Disaster Recovery(5%) of ${charges[2]} with total of ETB${total} .Your current balance is ETB${balance}. Thanks for Banking with CBE.`;
const credit = (amount: string, balance: string) => `Dear Mr Abebe your Account 1****4827 has been credited with ETB ${amount}. Your Current Balance is ETB ${balance}. Thank you for Banking with CBE`;
const parsed = (text: string): ParsedSms => {
  const r = parseSms(text);
  if (r.status !== 'parsed') throw new Error(`not parsed: ${r.status}`);
  return r.sms;
};

// the standard shape: the transferred figure EXCLUDES the charges
const STD = transfer('3,000.00', ['1.00', '0.15', '0.05'], '3,001.20', '21,998.80');
const STD2 = transfer('603.00', ['0.50', '0.08', '0.03'], '603.61', '24,396.39');
// the shape that caused the double count: the first figure printed IS the total
const TOT_TRANSFER = transfer('3,001.20', ['1.00', '0.15', '0.05'], '3,001.20', '21,998.80');
const TOT_TRANSFER2 = transfer('603.61', ['0.50', '0.08', '0.03'], '603.61', '24,396.39');
const TOT_DEBIT = debit('603.61', ['0.50', '0.08', '0.03'], '603.61', '24,396.39');

console.log('Amount, charges and total');
{
  const std = parsed(STD);
  check('standard shape (3,000 transferred, charges 1.00 + 0.15 + 0.05, total 3,001.20): amount 3,000, fee parts, total', std.amount === 3000 && std.fee === 1 && std.vat === 0.15 && std.otherCharge === 0.05 && std.totalDeducted === 3001.2, JSON.stringify([std.amount, std.fee, std.vat, std.otherCharge, std.totalDeducted]));
  check('...amount + charges equals the printed total, no flags', cents(std.amount) + cents(std.fee) + cents(std.vat) + cents(std.otherCharge) === cents(std.totalDeducted) && std.flags.length === 0);
  const std2 = parsed(STD2);
  check('standard shape (603.00, charges 0.50 + 0.08 + 0.03, total 603.61)', std2.amount === 603 && printedCharges(std2) === 0.61 && std2.totalDeducted === 603.61 && std2.flags.length === 0);

  const t1 = parsed(TOT_TRANSFER);
  check('(the bug) a transfer whose first figure is the TOTAL 3,001.20: the amount is 3,000.00, not 3,001.20', t1.amount === 3000, String(t1.amount));
  check('...the fee is the charges, 1.20, and the total is still 3,001.20', printedCharges(t1) === 1.2 && t1.totalDeducted === 3001.2);
  check('...amount + fee equals the total (so 3,001.20 leaves the account, not 3,002.40)', cents(t1.amount) + cents(printedCharges(t1)) === cents(t1.totalDeducted));
  check('...and the card is told what was done', t1.flags.includes('amount_was_total') && !t1.flags.includes('total_mismatch'), t1.flags.join());
  const t2 = parsed(TOT_TRANSFER2);
  check('(the bug) 603.61 printed as the amount with a 0.61 fee: the amount is 603.00', t2.amount === 603 && printedCharges(t2) === 0.61 && t2.flags.includes('amount_was_total'), JSON.stringify([t2.amount, printedCharges(t2), t2.flags]));
  const d = parsed(TOT_DEBIT);
  check('the same for the "debit transaction" wording: 603.00 + 0.61', d.amount === 603 && printedCharges(d) === 0.61 && d.flags.includes('amount_was_total'), JSON.stringify([d.amount, printedCharges(d), d.flags]));
  check('the standard shape is NOT touched by the rule (it is not the total)', std.flags.length === 0 && std2.flags.length === 0 && parsed(debit('1000.0', ['10.00', '1.50', '0.50'], '1012.00', '9,000.00')).amount === 1000);

  const zeroItemised = parsed(transfer('3,000.00', ['0.00', '0.00', '0.00'], '3,001.20', '21,998.80'));
  check('a total larger than the amount with the charges all zero: the fee is the difference', zeroItemised.amount === 3000 && printedCharges(zeroItemised) === 1.2 && zeroItemised.totalDeducted === 3001.2 && zeroItemised.flags.includes('fee_from_total'), JSON.stringify([zeroItemised.amount, printedCharges(zeroItemised), zeroItemised.flags]));
  const zeroAll = parsed(debit('3090.0', ['0.00', '0.0', '0.00'], '3090.00', '9,000.00'));
  check('charges zero and the total equal to the amount: no fee, no flag', zeroAll.amount === 3090 && printedCharges(zeroAll) === 0 && zeroAll.flags.length === 0);

  const off = parsed(transfer('3,000.00', ['1.00', '0.15', '0.05'], '3,005.00', '21,998.80'));
  check('figures that do not add up in any way are NOT guessed: amount unchanged, flagged', off.amount === 3000 && printedCharges(off) === 1.2 && off.flags.includes('total_mismatch'), JSON.stringify([off.amount, off.flags]));
  const over = parsed(transfer('3,010.00', ['1.00', '0.15', '0.05'], '3,001.20', '21,998.80'));
  check('an amount larger than the total is flagged too', over.flags.includes('total_mismatch'));

  // applying the rule again changes nothing (a stored row that was already corrected keeps its note)
  check('applying the rule twice is the same as once: the flag that says what was done is kept', JSON.stringify(reconcileTotals(reconcileTotals(t1))) === JSON.stringify(reconcileTotals(t1)) && reconcileTotals(t1).flags.includes('amount_was_total') && reconcileTotals(reconcileTotals(zeroItemised)).flags.includes('fee_from_total'));
  check('a stale mismatch flag is dropped when the figures do add up', reconcileTotals({ ...std, flags: ['total_mismatch'] }).flags.length === 0);

  // messages that print only one figure
  const boa = parsed('Dear Abebe, your account 2***64 was debited with ETB 3,001.20. Available Balance: ETB 45,000.00.');
  check('BOA prints only the total debited: that is the amount and there is no fee', boa.amount === 3001.2 && boa.fee === null && boa.vat === null && boa.otherCharge === null && boa.totalDeducted === null && boa.flags.length === 0);
  const awash = parsed('Dear Customer, your Account 01320xxxxxx5512 has been Debited with ETB -3001.20 on 2026-11-24 15:14:22. Your balance now is ETB 14148.00. For any complaint or enquiry, please call 8980. Thank You. Awash Bank.');
  check('Awash prints only the figure debited: amount, no fee', awash.amount === 3001.2 && awash.fee === null && awash.flags.length === 0);
  const debitedFor = parsed('Dear Mrs Abebe your Account 1****6213 has been debited for MEKDES TADESSE GEBRE with ETB 3001.20. Your Current Balance is ETB 64218.93. Thank you for Banking with CBE!. For feedback https://example.invalid/s for Reciept https://example.invalid/BranchReceipt/FT26301ABCD1&17283940');
  check('a CBE "debited for" message prints one figure: amount, no fee, no total', debitedFor.amount === 3001.2 && debitedFor.fee === null && debitedFor.totalDeducted === null && debitedFor.flags.length === 0);
  const tb = parsed(`Dear Abebe
You have transferred ETB 120.00 to BXXXXX NXXXX (2519****4410) on 14/11/2026 13:52:15. Your transaction number is TQ4RMZK8L2. The service fee is  ETB 1.74 and  15% VAT on the service fee is ETB 0.26. Your current E-Money Account  balance is ETB 5,621.00.`);
  check('Telebirr prints the transferred amount and the charges separately: amount 120, fee 1.74 + 0.26, no total', tb.amount === 120 && printedCharges(tb) === 2 && tb.totalDeducted === null && tb.flags.length === 0);

  // a property over every message above that prints a total: when nothing is flagged as a mismatch, amount + charges == total
  const withTotals = [STD, STD2, TOT_TRANSFER, TOT_TRANSFER2, TOT_DEBIT, transfer('3,000.00', ['0.00', '0.00', '0.00'], '3,001.20', '1.00'), debit('1000.0', ['10.00', '1.50', '0.50'], '1012.00', '9,000.00'), debit('3090.0', ['0.00', '0.0', '0.00'], '3090.00', '9,000.00')];
  check('whenever a message prints a total and is not flagged as a mismatch, amount + fee equals that total to the cent', withTotals.every((text) => { const s = parsed(text); return s.totalDeducted === null || s.flags.includes('total_mismatch') || cents(s.amount) + cents(printedCharges(s)) === cents(s.totalDeducted); }));
  check('...and none of the well-formed ones is flagged as a mismatch', withTotals.every((text) => !parsed(text).flags.includes('total_mismatch')));
}

// ======================================================= the chain across debits with fees ======================================================
console.log('The balance chain across debits with fees');
let n = 0;
const ctx: Ctx = { now: () => new Date(2026, 10, 20, 9, 0, 0), newId: () => `id-${++n}` };
const created = planCreateAccount({ accounts: [], entries: [], goals: [], allocations: [], notifications: [], rates: [], currencies: ['ETB'] }, { name: 'CBE', type: 'bank', currency: 'ETB', openingAmount: 25000, smsSender: 'CBE', lastDigits: '4827' }, ctx);
const state: AccountsState = { ...created.state, entries: created.state.entries.map((e) => ({ ...e, date: '2026-10-01' })) };
const acct = created.account.id;
const stage = (texts: string[]): SmsSuggestion[] =>
  stageBatch(previewBatch(texts.join('\n\n'), new Set(), null, ctx.now()), '2026-11-14', ctx, { accounts: state.accounts, rules: [], categories: [] });
{
  // 25,000.00 -> debit 3,000.00 + 1.20 = 21,998.80 -> credit 500.00 = 22,498.80 -> debit 603.00 + 0.61 = 21,895.19
  const seed = credit('25,000.00', '25,000.00');
  const standard = stage([seed, transfer('3,000.00', ['1.00', '0.15', '0.05'], '3,001.20', '21,998.80'), credit('500.00', '22,498.80'), transfer('603.00', ['0.50', '0.08', '0.03'], '603.61', '21,895.19')]);
  const gaps = (rows: SmsSuggestion[]) => buildChains(rows, state.accounts).get(acct)!.gaps;
  check('(setup) all four messages are matched to the CBE account', standard.length === 4 && standard.every((s) => s.accountId === acct));
  check('debit with a fee, credit, debit with a fee: no gap', gaps(standard).length === 0);
  check('...in any paste order', gaps([standard[3], standard[0], standard[2], standard[1]]).length === 0 && gaps([standard[2], standard[3], standard[1], standard[0]]).length === 0);

  const totalShape = stage([seed, TOT_TRANSFER, credit('500.00', '22,498.80'), TOT_TRANSFER2.replace('24,396.39', '21,895.19')]);
  check('the SAME chain with the messages that print the total first: still no gap, because the amounts are corrected', gaps(totalShape).length === 0 && totalShape[1].amount === 3000 && totalShape[3].amount === 603, JSON.stringify(gaps(totalShape)));
  check('...so there is no "ETB 1.20 came in" note and no fee proposal', gapNotes(buildChains(totalShape, state.accounts)).size === 0 && feeProposals(buildChains(totalShape, state.accounts)).size === 0);
  // what the OLD reading would have produced: the total as the amount AND the charges as a fee
  const old = totalShape.map((s) => (s.flags.includes('amount_was_total') ? { ...s, amount: s.totalDeducted ?? s.amount } : s));
  check('(for the record) reading the total as the amount and ALSO adding the fee leaves exactly the gaps that were seen: +1.20 and +0.61', gaps(old).map((g) => g.difference).join() === '1.2,0.61', gaps(old).map((g) => g.difference).join());
}

// ======================================================= what gets saved ====================================================================
console.log('What gets saved');
{
  const [s] = stage([TOT_TRANSFER]);
  const card: SmsSuggestion = { ...s, accountId: acct, category: 'Food' };
  const plan = planSuggestionSave(state, card, { remember: false }, ctx);
  const [main, fee] = plan.result.added;
  const before = getAccountBalances(state.entries, state.accounts)[acct];
  const after = getAccountBalances(plan.result.state.entries, plan.result.state.accounts)[acct];
  check('saving it records an expense of 3,000.00 and a Fees expense of 1.20', main.amount === 3000 && fee.amount === 1.2 && fee.category === FEES_CATEGORY.name);
  check('...so the account goes down by the printed total, 3,001.20 (not 3,002.40)', Math.round((before - after) * 100) === 300120, String(before - after));
  check('the card\'s fee is 1.20 and its amount 3,000.00 (what the screen shows)', effectiveFee(card) === 1.2 && card.amount === 3000);

  const check1 = checkSuggestion(state, card, ctx);
  check('a message that was corrected is still clean (it adds up)', check1.clean && check1.warnings.length === 0);
  const mismatch: SmsSuggestion = { ...card, flags: ['total_mismatch'] };
  const check2 = checkSuggestion(state, mismatch, ctx);
  check('a message whose figures do not add up is NOT clean: it carries a warning, so "Save all that are clean" leaves it', !check2.clean && check2.warnings.some((w) => w.kind === 'mismatch'), JSON.stringify(check2.warnings));
  check('...but it can still be saved by hand (a warning, not a block)', check2.blocked === null && planSuggestionSave(state, mismatch, { remember: false }, ctx).result.added.length === 2);
}

// ======================================================= suggestions already waiting ==========================================================
console.log('Waiting suggestions saved before the rule');
{
  interface NodeStatement { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown; get(...p: unknown[]): unknown }
  interface NodeDb { exec(sql: string): void; prepare(sql: string): NodeStatement }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => NodeDb };
  const db = new DatabaseSync(':memory:');
  const run: SqlRunner = { exec: (sql) => db.exec(sql), all: <T,>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...p) as T[], run: (sql, ...p) => { db.prepare(sql).run(...p); } };
  runMigrations(run, 0);
  const [fresh] = stage([STD]);
  // what the earlier build stored for a TOTAL-shaped message: the amount is the total, the charges are separate, nothing flagged
  const stale = (id: string, status: SmsSuggestion['status']): SmsSuggestion => ({ ...fresh, id, rawHash: `h-${id}`, status, amount: 3001.2, fee: 1, vat: 0.15, otherCharge: 0.05, totalDeducted: 3001.2, flags: [] });
  insertSuggestions(run, [stale('pending-one', 'pending'), stale('confirmed-one', 'confirmed'), stale('skipped-one', 'ignored')]);
  const back = readSuggestions(run);
  const get = (id: string) => back.find((s) => s.id === id)!;
  check('a WAITING suggestion that has the total as its amount reads back corrected (3,000.00 + 1.20)', get('pending-one').amount === 3000 && printedCharges(get('pending-one')) === 1.2 && get('pending-one').flags.includes('amount_was_total'));
  check('a skipped one is corrected too (so Restore shows the right figures)', get('skipped-one').amount === 3000);
  check('a CONFIRMED one is left exactly as it was saved: it is the record of what was done, and the repair needs it to find the affected entries', get('confirmed-one').amount === 3001.2 && get('confirmed-one').flags.length === 0);
  check('nothing in the database was rewritten by reading', (run.all<{ a: number }>("SELECT amount AS a FROM sms_suggestions WHERE id = 'pending-one'")[0]).a === 3001.2);
  insertSuggestions(run, [{ ...fresh, id: 'stored-corrected', rawHash: 'h-stored', status: 'pending', amount: 3000, flags: ['amount_was_total'], totalDeducted: 3001.2, fee: 1, vat: 0.15, otherCharge: 0.05 }]);
  check('a waiting suggestion saved by the corrected build keeps its note when read back', readSuggestions(run).find((x) => x.id === 'stored-corrected')?.flags.join() === 'amount_was_total' && readSuggestions(run).find((x) => x.id === 'stored-corrected')?.amount === 3000);
  const good = { ...fresh, id: 'good', rawHash: 'h-good' };
  insertSuggestions(run, [good]);
  check('a suggestion that is already right is not touched', readSuggestions(run).find((s) => s.id === 'good')?.amount === 3000);
}

// ======================================================= entries saved before the rule ===========================================================
console.log('Entries saved by the earlier build (what they look like, and what deleting one does)');
{
  const [fresh] = stage([TOT_TRANSFER]);
  // what the earlier build did with a TOTAL-shaped message: amount = the total, charges saved again as a separate Fees expense
  const oldReading: SmsSuggestion = { ...fresh, accountId: acct, category: 'Food', amount: 3001.2, flags: [] };
  const plan = planSuggestionSave(state, oldReading, { remember: false }, ctx);
  const [main, fee] = plan.result.added;
  const balance = (s: AccountsState) => getAccountBalances(s.entries, s.accounts)[acct];
  check('(a) such an entry is an expense of the TOTAL (3,001.20), with a separate Fees expense of 1.20 beside it, not linked to it', main.type === 'expense' && main.amount === 3001.2 && fee.category === FEES_CATEGORY.name && fee.amount === 1.2 && fee.linkedTransferId === null);
  check('...so the account went down by 3,002.40 instead of 3,001.20: too much by exactly the fee', Math.round((balance(state) - balance(plan.result.state)) * 100) === 300240);

  // the confirmed message remembers what it was, which is how an affected entry can be told from a correct one
  const confirmed: SmsSuggestion = { ...oldReading, status: 'confirmed', confirmedEntryId: main.id, totalDeducted: 3001.2, fee: 1, vat: 0.15, otherCharge: 0.05 };
  const affected = (s: SmsSuggestion): boolean => s.status === 'confirmed' && s.totalDeducted !== null && cents(s.amount) === cents(s.totalDeducted) && cents(printedCharges(s)) > 0;
  check('the stored message of an affected entry has amount == printed total with charges (a correct one does not)', affected(confirmed) && !affected({ ...confirmed, amount: 3000 }) && !affected({ ...confirmed, totalDeducted: null }));

  // (b) deleting the entry does not make the message importable again
  const afterDelete = { ...plan.result.state, entries: plan.result.state.entries.filter((e) => e.id !== main.id) };
  const handled = new Set([confirmed.rawHash]);
  const again = previewBatch(TOT_TRANSFER, handled, null, ctx.now());
  check('(b) deleting the entry leaves its Fees row behind, and the message record is untouched', afterDelete.entries.some((e) => e.id === fee.id) && !afterDelete.entries.some((e) => e.id === main.id));
  check('...so the same message pasted again is "already handled", not offered again: its record is still confirmed', again.fresh.length === 0 && again.alreadyHandled === 1);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
