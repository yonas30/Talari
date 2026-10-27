// Pure-function checks for the SMS parser (Phase 6A): number and date formats, every service template, the CBE total self-check,
// ignored and unreadable messages, hashing and splitting a pasted block.
// Every message below is SYNTHETIC: names, references, phone and account tails are invented with the same shape and length as real ones,
// and each account's balances are shifted by one constant so the balance chains still hold.
// Run: npx tsx scripts/verify-sms-parser.ts
import { fnv1a64, normalise } from '../utils/sms/normalise';
import { decodeReceiptDate } from '../utils/sms/receiptDate';
import { recipientKey } from '../utils/sms/recipient';
import { decodePercent } from '../utils/sms/shared';
import { parseAmount } from '../utils/sms/numbers';
import { parseSmsDate } from '../utils/sms/dates';
import { parseBatch, parseSms, serviceFromSender } from '../utils/sms/parse';
import { splitMessages } from '../utils/sms/split';
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

// Parses one message and compares only the fields listed (everything else is checked separately where it matters).
function expectParsed(name: string, text: string, expected: Partial<ParsedSms>, senderHint?: string) {
  const result = parseSms(text, senderHint);
  if (result.status !== 'parsed') {
    check(`${name}: parsed`, false, `got ${result.status}`);
    return;
  }
  check(`${name}: parsed`, true);
  for (const key of Object.keys(expected) as (keyof ParsedSms)[]) {
    const got = result.sms[key];
    const want = expected[key];
    check(`${name}: ${key}`, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
  return result.sms;
}

// ---- number formats ------------------------------------------------------------------------------------------------------
check('amount 630.00', parseAmount('630.00') === 630);
check('amount 1,000.00', parseAmount('1,000.00') === 1000);
check('amount with no decimals 2012', parseAmount('2012') === 2012);
check('amount 1000.0', parseAmount('1000.0') === 1000);
check('amount without thousands separator 5712.34', parseAmount('5712.34') === 5712.34);
check('amount without thousands separator 2486130.45', parseAmount('2486130.45') === 2486130.45);
check('negative sign is ignored', parseAmount('-40000.00') === 40000);
check('negative sign with a space is ignored', parseAmount('- 40000.00') === 40000);
check('amount 50', parseAmount('50') === 50);
check('amount 2,486,130.45', parseAmount('2,486,130.45') === 2486130.45);
check('misplaced comma is refused', parseAmount('1,00,0') === null);
check('three decimals are refused', parseAmount('1.234') === null);
check('letters are refused', parseAmount('abc') === null);
check('empty is refused', parseAmount('') === null);
check('undefined is refused', parseAmount(undefined) === null);

// ---- date formats --------------------------------------------------------------------------------------------------------
check('date dd/MM/yyyy', parseSmsDate('14/11/2026 13:52:15') === '2026-11-14T13:52:15');
check('date yyyy-MM-dd', parseSmsDate('2026-11-14 13:37:20') === '2026-11-14T13:37:20');
check('date has no timezone suffix', !/[Zz+]|-\d\d:\d\d$/.test(parseSmsDate('2026-11-14 13:37:20') ?? 'x'));
check('leap day is valid', parseSmsDate('29/02/2028 10:00:00') === '2028-02-29T10:00:00');
check('29 February in a normal year is refused', parseSmsDate('29/02/2026 10:00:00') === null);
check('31 April is refused', parseSmsDate('31/04/2026 10:00:00') === null);
check('month 13 is refused', parseSmsDate('2026-13-01 10:00:00') === null);
check('hour 25 is refused', parseSmsDate('2026-11-01 25:00:00') === null);
check('minute 60 is refused', parseSmsDate('2026-11-01 10:60:00') === null);
check('a date with no time is refused', parseSmsDate('2026-11-01') === null);
check('midnight is valid', parseSmsDate('01/01/2027 00:00:00') === '2027-01-01T00:00:00');

// ---- Telebirr ------------------------------------------------------------------------------------------------------------
const T1 = `Dear Abebe
You have transferred ETB 120.00 to BXXXXX NXXXX (2519****4410) on 14/11/2026 13:52:15. Your transaction number is TQ4RMZK8L2. The service fee is  ETB 1.74 and  15% VAT on the service fee is ETB 0.26. Your current E-Money Account  balance is ETB 6,855.94. To download your payment information please click this link:
Thank you for using telebirr
Ethio telecom`;
expectParsed('T1 person transfer out', T1, {
  service: 'telebirr',
  direction: 'out',
  kind: 'person_transfer',
  amount: 120,
  fee: 1.74,
  vat: 0.26,
  counterpartyName: 'BXXXXX NXXXX',
  counterpartyPhoneTail: '4410',
  reference: 'TQ4RMZK8L2',
  occurredAt: '2026-11-14T13:52:15',
  balanceAfter: 6855.94,
  otherCharge: null,
  totalDeducted: null,
  counterpartyBank: null,
  flags: [],
});

const T2 = `Dear Abebe,
You have received  ETB 1,000.00 by transaction number KB9XWDT3AH on 2026-11-14 13:37:20 from Commercial Bank of Ethiopia to your telebirr Account 2519XXXXXX - Abebe MXXXXX NXXXXX. Your current balance is ETB 7,265.94.
Thank you for using telebirr
Ethio telecom`;
expectParsed('T2 received from a bank', T2, {
  service: 'telebirr',
  direction: 'in',
  kind: 'received',
  amount: 1000,
  counterpartyBank: 'Commercial Bank of Ethiopia',
  counterpartyName: null,
  reference: 'KB9XWDT3AH',
  occurredAt: '2026-11-14T13:37:20',
  balanceAfter: 7265.94,
  fee: null,
});

const T3 = `Dear Abebe
You have transferred ETB 100.00 to CXXXX DXXXX (2519****3071) on 12/11/2026 20:50:01. Your transaction number is MZ2QPVC7E4. The service fee is  ETB 0.87 and  15% VAT on the service fee is ETB 0.13. Your current E-Money Account  balance is ETB 6,287.94. To download your payment information please click this link:
Thank you for using telebirr
Ethio telecom`;
expectParsed('T3 person transfer out (second sample)', T3, {
  kind: 'person_transfer',
  amount: 100,
  fee: 0.87,
  vat: 0.13,
  reference: 'MZ2QPVC7E4',
  balanceAfter: 6287.94,
  occurredAt: '2026-11-12T20:50:01',
  counterpartyPhoneTail: '3071',
});

const T4 = `Dear Abebe
You have paid ETB 3.00 for package Daily SMS Package 36 SMS purchase made for 9XXXXXXX2 on 14/11/2026 18:56:44. Your transaction number is  HR5NLXA0U6. Your current balance is ETB 6,702.94.To download your payment information please click this `;
expectParsed('T4 package payment', T4, {
  service: 'telebirr',
  direction: 'out',
  kind: 'package_payment',
  amount: 3,
  fee: null,
  vat: null,
  note: 'Daily SMS Package 36 SMS',
  reference: 'HR5NLXA0U6',
  occurredAt: '2026-11-14T18:56:44',
  balanceAfter: 6702.94,
});

const T4b = `Dear Abebe
You have paid ETB 70.00 for package Weekly Internet Package for 1.2GB purchase made for 9XXXXXXX2 on 16/11/2026 13:10:11. Your transaction number is  PW8DYJ3F1K. Your current balance is ETB 6,304.94.To download your payment information please click this `;
expectParsed('T4 weekly internet package', T4b, {
  kind: 'package_payment',
  amount: 70,
  note: 'Weekly Internet Package for 1.2GB',
  occurredAt: '2026-11-16T13:10:11',
  balanceAfter: 6304.94,
  reference: 'PW8DYJ3F1K',
});

const T5 = `Dear Abebe
You have transferred ETB 100.00 successfully from your telebirr account 251xxxxxxxx8 to Hibret Bank account number 4xxxxxxxxxxxxx3 on 15/11/2026 13:34:23. Your telebirr transaction number is NC6TGWB2S9 and your bank transaction number is . The service fee is  ETB 0.87 and  15% VAT on the service fee is ETB 0.13. Your current balance is ETB 6,449.94. To download your payment information please click this link: `;
expectParsed('T5 transfer to a bank account', T5, {
  direction: 'out',
  kind: 'bank_transfer',
  amount: 100,
  fee: 0.87,
  vat: 0.13,
  counterpartyBank: 'Hibret Bank',
  counterpartyAccountTail: '3',
  accountTail: '8',
  reference: 'NC6TGWB2S9',
  occurredAt: '2026-11-15T13:34:23',
  balanceAfter: 6449.94,
});

const T6 = `Dear Abebe,
You have received  ETB 1,000.00 by transaction number XE3VKQ7M5R on 2026-10-30 11:29:24 from Bank of Abyssinia to your telebirr Account 2519XXXXXX - Abebe MXXXXX NXXXXX. Your current balance is ETB 27,341.56.
Thank you for using telebirr
Ethio telecom`;
expectParsed('T6 received from Bank of Abyssinia', T6, {
  direction: 'in',
  kind: 'received',
  counterpartyBank: 'Bank of Abyssinia',
  balanceAfter: 27341.56,
  reference: 'XE3VKQ7M5R',
  occurredAt: '2026-10-30T11:29:24',
});

const T7 = `Dear Abebe,
You have received ETB 20,000.00 from Bxxxxx Cxxxxx(2519****6628)  on 30/10/2026 09:13:58. Your transaction number is LA7HZ4D9CP. Your current E-Money Account balance is ETB 26,341.56.`;
expectParsed('T7 received from a person', T7, {
  direction: 'in',
  kind: 'received',
  amount: 20000,
  counterpartyName: 'Bxxxxx Cxxxxx',
  counterpartyPhoneTail: '6628',
  reference: 'LA7HZ4D9CP',
  occurredAt: '2026-10-30T09:13:58',
  balanceAfter: 26341.56,
});

// ---- CBE (no date) -------------------------------------------------------------------------------------------------------
const cbeTransfer = (amount: string, charges: [string, string, string], total: string, balance: string, name = 'Abel Haile Gebre') =>
  `Dear  Abebe Gxxx dxxxxx You have successfully transferred ETB${amount} from account 1***4827 to account 1***7316 (${name}). Service charge of ETB ${charges[0]} and VAT(15%) of ETB${charges[1]} and Disaster Recovery(5%) of ${charges[2]} with total of ETB${total} .Your current balance is ETB${balance}. Thanks for Banking with CBE. `;

const C1 = cbeTransfer('630.00', ['0.50', '0.08', '0.03'], '630.61', '53,674.34');
const c1 = expectParsed('C1 transfer out', C1, {
  service: 'cbe',
  direction: 'out',
  kind: 'bank_transfer',
  amount: 630,
  fee: 0.5,
  vat: 0.08,
  otherCharge: 0.03,
  totalDeducted: 630.61,
  accountTail: '4827',
  counterpartyAccountTail: '7316',
  counterpartyName: 'Abel Haile Gebre',
  balanceAfter: 53674.34,
  occurredAt: null,
  flags: [],
});
check('C1 has no raw text field', c1 !== undefined && !('rawText' in c1) && !('text' in c1));

expectParsed('C1 500.00', cbeTransfer('500.00', ['0.50', '0.08', '0.03'], '500.61', '54,304.95'), { amount: 500, totalDeducted: 500.61, balanceAfter: 54304.95, flags: [] });
expectParsed('C1 350.00', cbeTransfer('350.00', ['0.50', '0.08', '0.03'], '350.61', '52,793.56'), { amount: 350, balanceAfter: 52793.56, flags: [] });
expectParsed('C1 1750.00 with 1.00 / 0.15 / 0.05', cbeTransfer('1750.00', ['1.00', '0.15', '0.05'], '1751.20', '59,144.20'), {
  amount: 1750,
  fee: 1,
  vat: 0.15,
  otherCharge: 0.05,
  totalDeducted: 1751.2,
  balanceAfter: 59144.20,
  flags: [],
});
expectParsed('C1 401.00', cbeTransfer('401.00', ['0.50', '0.08', '0.03'], '401.61', '62,907.40'), { amount: 401, balanceAfter: 62907.40, flags: [] });

const C2 = `Dear Abebe  A debit transaction of ETB 1000.0. has occurred on your account 1****4827. Service charge of ETB 10.00 and VAT(15%) of ETB1.50 and Disaster Recovery(5%) of 0.50 with total of ETB1012.00 .Your current balance is ETB77,690.44. Thanks for Banking with CBE.`;
expectParsed('C2 debit with no counterparty', C2, {
  service: 'cbe',
  direction: 'out',
  kind: 'debit',
  amount: 1000,
  fee: 10,
  vat: 1.5,
  otherCharge: 0.5,
  totalDeducted: 1012,
  accountTail: '4827',
  counterpartyName: null,
  counterpartyAccountTail: null,
  balanceAfter: 77690.44,
  occurredAt: null,
  flags: [],
});
const C2zero = `Dear Abebe  A debit transaction of ETB 3090.0. has occurred on your account 1****4827. Service charge of ETB 0.00 and VAT(15%) of ETB0.0 and Disaster Recovery(5%) of 0.00 with total of ETB3090.00 .Your current balance is ETB75,612.44. Thanks for Banking with CBE.`;
expectParsed('C2 debit with zero charges', C2zero, { amount: 3090, fee: 0, vat: 0, otherCharge: 0, totalDeducted: 3090, balanceAfter: 75612.44, flags: [] });

const C3 = `Dear Mr Abebe your Account 1****4827 has been credited with ETB 2012. Your Current Balance is ETB 54805.56. Thank you for Banking with CBE`;
expectParsed('C3 credit', C3, {
  service: 'cbe',
  direction: 'in',
  kind: 'credit',
  amount: 2012,
  accountTail: '4827',
  balanceAfter: 54805.56,
  reference: null,
  occurredAt: null,
  fee: null,
});
const C3empty = `Dear Mr Abebe your Account 1****4827 has been credited with ETB 100. Your Current Balance is ETB 54905.56. Thank you for Banking with CBE! for Reciept `;
expectParsed('C3 credit with an empty receipt link', C3empty, { amount: 100, reference: null, balanceAfter: 54905.56 });
const C3link = `Dear Mr Abebe your Account 1****4827 has been credited with ETB 100. Your Current Balance is ETB 55005.56. Thank you for Banking with CBE! for Reciept https://example.invalid/BranchReceipt/FT26301KQ4MZ&19283746`;
expectParsed('C3 credit with a receipt link', C3link, { amount: 100, reference: 'FT26301KQ4MZ', balanceAfter: 55005.56 });

// CBE self-check: amount + fee + vat + other charge must equal the printed total to the cent.
const cbeWrong = parseSms(cbeTransfer('630.00', ['0.50', '0.08', '0.03'], '630.62', '53,674.34'));
check('CBE wrong total is still parsed', cbeWrong.status === 'parsed');
check('CBE wrong total is flagged', cbeWrong.status === 'parsed' && cbeWrong.sms.flags.includes('total_mismatch'), JSON.stringify(cbeWrong));
const cbeWrong2 = parseSms(C2.replace('with total of ETB1012.00', 'with total of ETB1011.99'));
check('CBE debit with a wrong total is flagged', cbeWrong2.status === 'parsed' && cbeWrong2.sms.flags.includes('total_mismatch'));
check('CBE right total is not flagged', parseSms(C1).status === 'parsed' && (parseSms(C1) as { sms: ParsedSms }).sms.flags.length === 0);
// Floating point trap: 0.1 + 0.2 must still equal 0.3 when the sum is checked in cents.
const cbeCents = parseSms(cbeTransfer('100.00', ['0.10', '0.20', '0.00'], '100.30', '1,000.00'));
check('CBE cent arithmetic is exact', cbeCents.status === 'parsed' && cbeCents.sms.flags.length === 0);

// ---- BOA (no date, no fees) ----------------------------------------------------------------------------------------------
const B1 = `Dear Abebe, your account 2***64 was credited with ETB 3,300.00 by  Fiker Mulu Alem . Available Balance: ETB 72,005.70.`;
const B2 = `Dear Abebe, your account 2***64 was debited with ETB 12,230.00. Available Balance: ETB 68,705.70.`;
const b1 = expectParsed('B1 credit', B1, {
  service: 'boa',
  direction: 'in',
  kind: 'credit',
  amount: 3300,
  counterpartyName: 'Fiker Mulu Alem',
  accountTail: '64',
  balanceAfter: 72005.70,
  occurredAt: null,
  fee: null,
});
const b2 = expectParsed('B2 debit', B2, {
  service: 'boa',
  direction: 'out',
  kind: 'debit',
  amount: 12230,
  counterpartyName: null,
  accountTail: '64',
  balanceAfter: 68705.70,
  occurredAt: null,
  fee: null,
});
check('BOA chain: B2 then B1 is consistent', !!b1 && !!b2 && Math.round(((b2.balanceAfter ?? 0) + b1.amount) * 100) === Math.round((b1.balanceAfter ?? 0) * 100));

// ---- Awash Bank ----------------------------------------------------------------------------------------------------------
const A1 = `Dear Customer, your Account 01320xxxxxx5512 has been Debited with ETB -40000.00 on 2026-11-24 15:14:22. Your balance now is ETB 16549.55. For any complaint or enquiry, please call 8980. Thank You. Awash Bank.`;
expectParsed('A1 debit with a minus sign', A1, {
  service: 'awash',
  direction: 'out',
  kind: 'debit',
  amount: 40000,
  accountTail: '5512',
  occurredAt: '2026-11-24T15:14:22',
  balanceAfter: 16549.55,
  counterpartyName: null,
});

const A2 = `Dear Customer, your Account 01320xxxxxx5512 has been Credited with ETB 8000.00 on 2026-11-24 15:08:19 by Abebe Gxxx dxxxx via IPS Commercial Bank of Ethiopia. Your balance now is ETB 56549.55. For any complaint or enquiry, please call 8980. Thank You. Awash Bank.`;
expectParsed('A2 credit via IPS', A2, {
  direction: 'in',
  kind: 'credit',
  amount: 8000,
  counterpartyName: 'Abebe Gxxx dxxxx',
  counterpartyBank: 'Commercial Bank of Ethiopia',
  occurredAt: '2026-11-24T15:08:19',
  balanceAfter: 56549.55,
});

const A3 = `Dear Customer, ETB 36,000 has been credited to your account from Bnnn Wxxx on : 2026-11-03 14:27:39  with Txn ID: 261103091458213 . Your available balance is now ETB 46,986.17. Receipt  Link: . Contact center  8980.

Alert: Awash Bank will never ask for your PIN, password, or OTP. Do not share your confidential information with anyone.`;
const a3 = expectParsed('A3 second layout', A3, {
  direction: 'in',
  kind: 'credit',
  amount: 36000,
  counterpartyName: 'Bnnn Wxxx',
  reference: '261103091458213',
  occurredAt: '2026-11-03T14:27:39',
  balanceAfter: 46986.17,
  accountTail: null,
});
const A3noAlert = A3.split('\n\nAlert:')[0];
const a3b = parseSms(A3noAlert);
check('A3 hashes the same with or without the Alert paragraph', a3b.status === 'parsed' && !!a3 && a3b.sms.rawHash === a3.rawHash);
const A3small = `Dear Customer, ETB 50 has been credited to your account from Sosina Bekele on : 2026-11-05 13:37:37  with Txn ID: 261105133312407 . Your available balance is now ETB 10887.21. Receipt  Link: . Contact center  8980.`;
expectParsed('A3 small credit', A3small, { amount: 50, counterpartyName: 'Sosina Bekele', reference: '261105133312407', balanceAfter: 10887.21, occurredAt: '2026-11-05T13:37:37' });

const A4 = `Dear Customer, your Account 01320xxxxxx5512 has been Credited with ETB 300.00 on 2026-11-12 14:23:21 by TeleBirr C2B to Awash with reference DKF8ZQ2WRT. Your balance now is ETB 11187.21. For any complaint or enquiry, please call 8980. Thank You. Awash Bank.`;
expectParsed('A4 Telebirr to Awash', A4, {
  direction: 'in',
  kind: 'credit',
  amount: 300,
  counterpartyBank: 'Telebirr',
  reference: 'DKF8ZQ2WRT',
  occurredAt: '2026-11-12T14:23:21',
  balanceAfter: 11187.21,
  counterpartyName: null,
});

// ---- ignored: not transactions ------------------------------------------------------------------------------------------
const statusOf = (text: string) => {
  const r = parseSms(text);
  return r.status === 'ignored' ? `ignored:${r.reason}` : r.status;
};
check('OTP is ignored', statusOf('Dear Abebe, your OTP is 482913. Do not share it with anyone.') === 'ignored:otp');
check('an OTP that mentions an amount is still ignored', statusOf('Your one-time code 553201 confirms a transfer of ETB 500.00. Do not share it.') === 'ignored:otp');
check('a promotion with no amount is ignored', statusOf('Dear Customer, enjoy double data on every bundle this weekend. Dial *999# now.') === 'ignored:no_amount');
check('the Awash notice on its own is ignored', statusOf('Alert: Awash Bank will never ask for your PIN, password, or OTP. Do not share your confidential information with anyone.') === 'ignored:empty');
check('the notice without the Alert prefix is ignored', statusOf('Awash Bank will never ask for your PIN, password, or OTP.') === 'ignored:otp');
check('a message with no amount is ignored', statusOf('Dear Abebe, your statement is ready. Visit any branch.') === 'ignored:no_amount');
check('empty text is ignored', statusOf('') === 'ignored:empty');
check('whitespace only is ignored', statusOf('  \r\n \n  ') === 'ignored:empty');

// ---- unreadable: has an amount but no known template ---------------------------------------------------------------------
const odd = 'Dear Abebe, ETB 250.00 was moved around in an unfamiliar way on your account.';
const oddResult = parseSms(odd);
check('an amount with no template is unreadable', oddResult.status === 'unreadable');
check('unreadable keeps the text for the review screen', oddResult.status === 'unreadable' && oddResult.text === odd);
check('unreadable carries a hash', oddResult.status === 'unreadable' && /^[0-9a-f]{16}$/.test(oddResult.rawHash));
check('an impossible date makes a Telebirr message unreadable', statusOf(T1.replace('14/11/2026', '31/02/2026')) === 'unreadable');
check('a mangled amount makes a message unreadable', statusOf(T1.replace('ETB 120.00', 'ETB 1,2,0.00')) === 'unreadable');
check('a CBE-looking message without the CBE sign-off is unreadable', statusOf(C3.replace('Thank you for Banking with CBE', 'Thank you')) === 'unreadable');
check('a message that is cut off is unreadable, not guessed', statusOf('Dear Abebe You have transferred ETB 120.00 to BXXXXX') === 'unreadable');

// ---- sender hint only breaks ties ----------------------------------------------------------------------------------------
check('sender 127 maps to Telebirr', serviceFromSender('127') === 'telebirr');
check('sender CBE maps to CBE', serviceFromSender('CBE') === 'cbe');
check('sender BOA maps to BOA', serviceFromSender('BOA') === 'boa');
check('sender Awash Bank maps to Awash', serviceFromSender('Awash Bank') === 'awash');
check('an unknown sender maps to nothing', serviceFromSender('PROMO') === null && serviceFromSender(null) === null && serviceFromSender(undefined) === null);
const hinted = parseSms(T1, 'CBE');
check('a wrong sender hint does not change the service', hinted.status === 'parsed' && hinted.sms.service === 'telebirr');
check('a hint cannot make an unmatched message parse', parseSms(odd, '127').status === 'unreadable');
check('the right hint gives the same result', JSON.stringify(parseSms(T1, '127')) === JSON.stringify(parseSms(T1)));

// ---- hashing and normalising ---------------------------------------------------------------------------------------------
check('FNV-1a 64 of the empty string', fnv1a64('') === 'cbf29ce484222325');
check('FNV-1a 64 of "a"', fnv1a64('a') === 'af63dc4c8601ec8c');
check('FNV-1a 64 of "foobar"', fnv1a64('foobar') === '85944171f73967e8');
check('hash is 16 hex characters', /^[0-9a-f]{16}$/.test(fnv1a64('anything at all')));
check('non-ASCII text hashes without error', /^[0-9a-f]{16}$/.test(fnv1a64('ሰላም 😀')));
check('normalise collapses whitespace and line endings', normalise('  a \r\n\r\n b\t c  ') === 'a b c');
check('normalise drops the Alert paragraph', normalise('hello\n\nAlert: never share your PIN') === 'hello');
const hashOf = (text: string) => {
  const r = parseSms(text);
  return r.status === 'parsed' || r.status === 'unreadable' ? (r.status === 'parsed' ? r.sms.rawHash : r.rawHash) : '';
};
check('the same message hashes the same across line endings and spacing', hashOf(T7) === hashOf(T7.replace(/\n/g, '\r\n') + '\r\n\r\n') && hashOf(T7) === hashOf('  ' + T7.replace(/ /g, '  ')));
check('different messages hash differently', hashOf(T1) !== hashOf(T3) && hashOf(C1) !== hashOf(C2));

// ---- splitMessages -------------------------------------------------------------------------------------------------------
check('empty input gives no messages', splitMessages('').length === 0);
check('whitespace-only input gives no messages', splitMessages('  \n\r\n \n').length === 0);
check('one message stays one', splitMessages(T1).length === 1);
check('leading and trailing whitespace is trimmed', splitMessages('\n\n  ' + C3 + '  \n\n')[0] === C3.trim());
check('CRLF line endings are handled', splitMessages(T1.replace(/\n/g, '\r\n')).length === 1 && !splitMessages(T1.replace(/\n/g, '\r\n'))[0].includes('\r'));

const mixed = [T1, C2, A1, B2, T7].join('\n\n\n\n');
const mixedParts = splitMessages(mixed);
check('five messages from four services split into five', mixedParts.length === 5, `got ${mixedParts.length}`);
const mixedResults = parseBatch(mixed);
check(
  'a mixed batch parses to the right services in order',
  mixedResults.map((r) => (r.status === 'parsed' ? r.sms.service : r.status)).join(',') === 'telebirr,cbe,awash,boa,telebirr',
  JSON.stringify(mixedResults.map((r) => (r.status === 'parsed' ? r.sms.service : r.status))),
);

const crlfMixed = [T1, C3, A2].join('\r\n\r\n');
check('a CRLF batch splits and parses', parseBatch(crlfMixed).filter((r) => r.status === 'parsed').length === 3);

const noBlankLines = [T4, C3, B1].join('\n');
check('messages pasted with no blank line between them split on "Dear"', splitMessages(noBlankLines).length === 3, `got ${splitMessages(noBlankLines).length}`);
check('and still parse', parseBatch(noBlankLines).filter((r) => r.status === 'parsed').length === 3);

const withAlert = [A3, T7, A3small].join('\n\n');
const alertParts = splitMessages(withAlert);
check('the Alert paragraph stays attached to its own message', alertParts.length === 3 && alertParts[0].includes('Alert:') && !alertParts[1].includes('Alert:'), `got ${alertParts.length}`);
const alertResults = parseBatch(withAlert);
check('a batch with an Alert paragraph parses all three', alertResults.filter((r) => r.status === 'parsed').length === 3);
const alertFirst = alertResults[0];
check('and the Alert paragraph is dropped from the hash', alertFirst.status === 'parsed' && !!a3 && alertFirst.sms.rawHash === a3.rawHash);

const withGarbage = [T1, 'Hello, this is something Talari cannot read. It mentions ETB 99.00 only.', C3].join('\n\n');
const garbageResults = parseBatch(withGarbage);
check('an unreadable message in the middle stays in the middle', garbageResults.map((r) => r.status).join(',') === 'parsed,unreadable,parsed', garbageResults.map((r) => r.status).join(','));
check('and does not damage its neighbours', garbageResults[0].status === 'parsed' && garbageResults[2].status === 'parsed');

const leading = 'some stray words\n\n' + T1;
check('text before the first message becomes its own item', splitMessages(leading).length === 2 && splitMessages(leading)[0] === 'some stray words');
const otpBatch = [T1, 'Dear Abebe, your OTP is 482913. Do not share it.', C3].join('\n\n');
check('an OTP in a batch is ignored, not lost', parseBatch(otpBatch).map((r) => r.status).join(',') === 'parsed,ignored,parsed');

// ---- more Telebirr formats (merchant, airtime, bill) and a CBE "debited for" ------------------------------------------------------
const FOOTER = `For any support and information related to telebirr service
Send SMS to 126 or Contact us via
Telegram: https://t.me/telebirr
Facebook: https://facebook.com/telebirr or
Visit our website :https://www.ethiotelecom.et/telebirr/
Thank you for using telebirr
Ethio telecom`;

const M1 = `Dear Abebe
You have paid ETB 1,070.00 for Service Fee from 731284 - Lemlem Cafe and Pastry plc Bole Branch on 08/11/2026 16:15:35. Your transaction number is  QD27HKAXMN. Your current balance is ETB 4,903.51. To download your payment information please click this link: https://example.invalid/receipt/QD27HKAXMN
Thank you for using telebirr
Ethio telecom`;
expectParsed('M1 merchant payment (Service Fee from <code> - <name>)', M1, {
  service: 'telebirr',
  direction: 'out',
  kind: 'merchant_payment',
  amount: 1070,
  counterpartyCode: '731284',
  counterpartyName: 'Lemlem Cafe and Pastry plc Bole Branch',
  fee: null,
  vat: null,
  reference: 'QD27HKAXMN',
  occurredAt: '2026-11-08T16:15:35',
  balanceAfter: 4903.51,
  flags: [],
});

const M2 = `Dear Abebe
You have paid ETB 2,590.00 to Orion Data Services PLC with Payment number 0911223344 on 30/10/2026 13:36:31. The service fee is  ETB 0.00 and  15% VAT on the service fee is ETB 0.00. Your transaction number is MV5T2KQ8ZD
Your current telebirr balance is ETB 9,267.00. To download your payment information please click this link: https://example.invalid/receipt/MV5T2KQ8ZD
Thank you for using telebirr
Ethio telecom`;
expectParsed('M2 merchant payment (to <name> with Payment number <n>, zero fee, balance on a new line)', M2, {
  kind: 'merchant_payment',
  amount: 2590,
  counterpartyName: 'Orion Data Services PLC',
  counterpartyCode: '0911223344',
  fee: 0,
  vat: 0,
  reference: 'MV5T2KQ8ZD',
  occurredAt: '2026-10-30T13:36:31',
  balanceAfter: 9267,
});

const AIR = `Dear Abebe
You have recharged ETB 100.00 airtime for 911223355 on 05/11/2026 22:32:34. Your transaction number is HB48RWZC3T. Your current  balance is  ETB 7,431.62. To download your payment information please click this link: https://example.invalid/receipt/HB48RWZC3T
${FOOTER}`;
expectParsed('AIR airtime recharge (with the support footer)', AIR, {
  service: 'telebirr',
  direction: 'out',
  kind: 'airtime',
  amount: 100,
  counterpartyCode: '911223355',
  note: 'Airtime',
  reference: 'HB48RWZC3T',
  occurredAt: '2026-11-05T22:32:34',
  balanceAfter: 7431.62,
  fee: null,
});

const BILL = `Dear Abebe
You have paid ETB 18.01 to pay bill for 700112233 on 05/11/2026 09:49:10. Your transaction number is KX9PD36LWE. Your telebirr account balance is  ETB 3,846.05. To download your payment information please click this link: https://example.invalid/receipt/KX9PD36LWE
Thank you for using telebirr
Ethio telecom`;
expectParsed('BILL bill payment ("Your telebirr account balance is")', BILL, {
  kind: 'bill_payment',
  direction: 'out',
  amount: 18.01,
  counterpartyCode: '700112233',
  note: 'Bill payment',
  reference: 'KX9PD36LWE',
  occurredAt: '2026-11-05T09:49:10',
  balanceAfter: 3846.05,
});

const AIR_RECEIVED = `Dear Customer
You have received ETB 15.00 airtime from 251911223355 on 02/11/2026 22:30:04. Your transaction number is PN3TJ7YVQ6.
Thank you for using telebirr
ethio telecom`;
const AIR_RECHARGE = `Dear Abebe
You have recharged ETB 15.00 airtime for 911223355 on 02/11/2026 22:30:04. Your transaction number is PN3TJ7YVQ6. Your current  balance is  ETB 6,208.14. To download your payment information please click this link: https://example.invalid/receipt/PN3TJ7YVQ6
${FOOTER}`;
const received = parseSms(AIR_RECEIVED);
check('"received airtime" is ignored, with the reason airtime_received', received.status === 'ignored' && received.reason === 'airtime_received');
check('...carrying the shared transaction number', received.status === 'ignored' && received.reference === 'PN3TJ7YVQ6');
const recharge = parseSms(AIR_RECHARGE);
check('the matching recharge is a transaction with that same number', recharge.status === 'parsed' && recharge.sms.reference === 'PN3TJ7YVQ6' && recharge.sms.kind === 'airtime' && recharge.sms.amount === 15);
const pair = parseBatch([AIR_RECHARGE, AIR_RECEIVED].join('\n\n'));
check('pasted together, the recharge is one transaction and the notice is not a transaction', pair.map((r) => (r.status === 'parsed' ? 'parsed' : r.status === 'ignored' ? `ignored:${r.reason}` : r.status)).join() === 'parsed,ignored:airtime_received');
check('the notice is ignored on its own too (not money, no balance)', statusOf(AIR_RECEIVED) === 'ignored:airtime_received');

const CBE_FOR = `Dear Mrs Abebe your Account 1****6213 has been debited for MEKDES TADESSE GEBRE with ETB 22000. Your Current Balance is ETB 64218.93. Thank you for Banking with CBE!. For feedback https://example.invalid/s for Reciept https://example.invalid/BranchReceipt/FT26301ABCD1&17283940`;
expectParsed('CBE "has been debited for <NAME> with ETB x" (no fee)', CBE_FOR, {
  service: 'cbe',
  direction: 'out',
  kind: 'bank_transfer',
  amount: 22000,
  counterpartyName: 'MEKDES TADESSE GEBRE',
  accountTail: '6213',
  reference: 'FT26301ABCD1',
  balanceAfter: 64218.93,
  fee: null,
  vat: null,
  otherCharge: null,
  totalDeducted: null,
  occurredAt: null,
  flags: [],
});
check('the old CBE debit with charges still parses as before', parseSms(C2).status === 'parsed' && (parseSms(C2) as { sms: ParsedSms }).sms.fee === 10);

// ---- tolerance: chat-export prefixes and the support footer ------------------------------------------------------------------
const P = '[11/20/2026 3:42 PM] Abebe Kebede: ';
check('a chat prefix is stripped before "Dear"', splitMessages(P + T7)[0].startsWith('Dear Abebe'));
const prefixed = [P + T1, P + CBE_FOR, '[11/20/2026 3:45 PM] Abebe Kebede: ' + AIR].join('\n');
check('a pasted chat export with a prefix on every message splits into one message each', splitMessages(prefixed).length === 3, `got ${splitMessages(prefixed).length}`);
check('...and every message parses', parseBatch(prefixed).map((r) => r.status).join() === 'parsed,parsed,parsed');
check('a prefixed message is the same message as an unprefixed one (same hash)', hashOf(P + T7) === hashOf(T7) && hashOf(P + AIR) === hashOf(AIR));
const prefixed2 = '20/11/2026, 3:42 PM - Abebe Kebede: ' + T7;
check('the other common export style ("20/11/2026, 3:42 PM - Name: ") is stripped too', hashOf(prefixed2) === hashOf(T7) && splitMessages(prefixed2)[0].startsWith('Dear'));
check('a prefix in front of a line that is not "Dear" still starts a new message', splitMessages(T1 + '\n' + P + 'something else').length === 2);
check('a "[...]" or a colon in the middle of a message is not a prefix', normalise('Dear Abebe, a [note x]: b') === 'Dear Abebe, a [note x]: b');
check('the Telebirr support footer is dropped from the text', !normalise(AIR).includes('Send SMS to 126') && !normalise(AIR).includes('Telegram') && !normalise(AIR).includes('Facebook') && !normalise(AIR).includes('Visit our website'));
check('...but the message and its closing line are kept', normalise(AIR).includes('You have recharged ETB 100.00') && normalise(AIR).endsWith('Thank you for using telebirr Ethio telecom'));
check('a message with the footer and one without are the same message', hashOf(AIR) === hashOf(AIR.replace(FOOTER, 'Thank you for using telebirr\nEthio telecom')));
check('a footer at the very end with nothing after it is dropped too', !normalise('Dear A You have recharged ETB 1.00 airtime for 9 on 05/11/2026 22:32:34. For any support and information related to telebirr service Send SMS to 126').includes('126'));
const noisy = [P + M1, P + AIR, P + AIR_RECEIVED, P + CBE_FOR].join('\n');
check('a chat export with footers and every new format: 3 transactions and 1 notice', parseBatch(noisy).map((r) => (r.status === 'parsed' ? r.sms.kind : r.status === 'ignored' ? r.reason : r.status)).join() === 'merchant_payment,airtime,airtime_received,bank_transfer', parseBatch(noisy).map((r) => r.status).join());

// ---- percent-encoding in names (and anything else read from a link) -----------------------------------------------------------------------
const CBE_PCT = (name: string, link = 'https://example.invalid/BranchReceipt/FT26301ABCD1&17283940') =>
  `Dear Mrs Abebe your Account 1****6213 has been debited for ${name} with ETB 2200. Your Current Balance is ETB 64218.93. Thank you for Banking with CBE!. For feedback https://example.invalid/s for Reciept ${link}`;
const nameOf = (text: string): string | null => {
  const r = parseSms(text);
  return r.status === 'parsed' ? r.sms.counterpartyName : `(${r.status})`;
};
check('an encoded "&" (%26) in a name is decoded', nameOf(CBE_PCT('ABEBE %26 SONS TRADING')) === 'ABEBE & SONS TRADING', String(nameOf(CBE_PCT('ABEBE %26 SONS TRADING'))));
check('%20 is a space', nameOf(CBE_PCT('MEKDES%20TADESSE%20GEBRE')) === 'MEKDES TADESSE GEBRE');
check('accented letters (UTF-8, %C3%A9) are decoded', nameOf(CBE_PCT('ZOE CAF%C3%A9')) === 'ZOE CAFé');
check('Amharic letters (three-byte UTF-8) are decoded', nameOf(CBE_PCT('%E1%8A%A0%E1%89%A0%E1%89%A0 TRADING')) === 'አበበ TRADING');
check('lower-case hex digits work too', nameOf(CBE_PCT('ABEBE %e2%80%99S SHOP')) === 'ABEBE ’S SHOP');
check('several encoded characters in a row, and several runs, are all decoded', nameOf(CBE_PCT('A%26B%26C %28NORTH%29')) === 'A&B&C (NORTH)');
check('a name with no encoding is left exactly as it is', nameOf(CBE_PCT('ABEBE TADELE WOLDE')) === 'ABEBE TADELE WOLDE');
check('a plus sign and a lone percent sign are text, not encoding', nameOf(CBE_PCT('A+B 100% BAKERY')) === 'A+B 100% BAKERY');
check('"%ZZ" (not hex) is left as it is', nameOf(CBE_PCT('ABEBE %ZZ SONS')) === 'ABEBE %ZZ SONS');
check('a broken sequence (%E0%A4 is incomplete UTF-8) is left as it is, never an error', nameOf(CBE_PCT('ABEBE %E0%A4 SONS')) === 'ABEBE %E0%A4 SONS');
check('a good run and a broken one in the same name: the good one is decoded', nameOf(CBE_PCT('A%26B %E0%A4')) === 'A&B %E0%A4');
check('encoded control characters cannot put a line break into a name', nameOf(CBE_PCT('ABEBE%0ASONS')) === 'ABEBE SONS' && nameOf(CBE_PCT('ABEBE%00SONS')) === 'ABEBE SONS');
check('decoding gives the same message hash as before (the hash is of the text, not of the decoded name)', (() => { const a = parseSms(CBE_PCT('ABEBE %26 SONS')); const b = parseSms(CBE_PCT('ABEBE %26 SONS')); return a.status === 'parsed' && b.status === 'parsed' && a.sms.rawHash === b.sms.rawHash; })());

// the other places a name is read: Telebirr, the bank text, the package note
const TB_PCT = `Dear Abebe
You have transferred ETB 120.00 to BXXXXX%20%26%20NXXXX (2519****4410) on 14/11/2026 13:52:15. Your transaction number is TQ4RMZK8L2. The service fee is  ETB 1.74 and  15% VAT on the service fee is ETB 0.26. Your current E-Money Account  balance is ETB 4,318.26.`;
check('a Telebirr recipient name is decoded too', nameOf(TB_PCT) === 'BXXXXX & NXXXX');
const TB_BANK_PCT = `Dear Abebe,
You have received  ETB 1,000.00 by transaction number KB9XWDT3AH on 2026-11-14 13:37:20 from Commercial%20Bank%20of%20Ethiopia to your telebirr Account 2519XXXXXX - Abebe MXXXXX NXXXXX. Your current balance is ETB 2,468.19.`;
const tbBank = parseSms(TB_BANK_PCT);
check('a bank name is decoded too', tbBank.status === 'parsed' && tbBank.sms.counterpartyBank === 'Commercial Bank of Ethiopia');
const TB_PKG_PCT = `Dear Abebe
You have paid ETB 3.00 for package Daily%20SMS%20Package purchase made for 9XXXXXXX2 on 14/11/2026 18:56:44. Your transaction number is  ZP3LKJ9HG5. Your current balance is ETB 3,318.38.`;
const pkg = parseSms(TB_PKG_PCT);
check('a package name (the note) is decoded too', pkg.status === 'parsed' && pkg.sms.note === 'Daily SMS Package');

// the receipt link: the reference is the only thing read from it
const refOf = (link: string): string | null => { const r = parseSms(CBE_PCT('ABEBE SONS', link)); return r.status === 'parsed' ? r.sms.reference : `(${r.status})`; };
check('the receipt reference stops at an encoded "&" in the link', refOf('https://example.invalid/BranchReceipt/FT26301ABCD1%2617283940') === 'FT26301ABCD1', String(refOf('https://example.invalid/BranchReceipt/FT26301ABCD1%2617283940')));
check('an encoded slash in the link path is understood', refOf('https://example.invalid/BranchReceipt%2FFT26301ABCD1%2617283940') === 'FT26301ABCD1', String(refOf('https://example.invalid/BranchReceipt%2FFT26301ABCD1%2617283940')));
check('a reference in lower case is returned in upper case', refOf('https://example.invalid/BranchReceipt/ft26301abcd1&17283940') === 'FT26301ABCD1', String(refOf('https://example.invalid/BranchReceipt/ft26301abcd1&17283940')));
check('a plain link still works', refOf('https://example.invalid/BranchReceipt/FT26301ABCD1&17283940') === 'FT26301ABCD1');
check('an empty link gives no reference, never an error', refOf('') === null);
check('a link with nothing like a reference gives none', refOf('https://example.invalid/BranchReceipt/%2F%26') === null);
check('the date decoded from an encoded link is the same as from a plain one', (() => { const r = parseSms(CBE_PCT('ABEBE SONS', 'https://example.invalid/BranchReceipt%2FFT26301ABCD1%2617283940')); return r.status === 'parsed' && decodeReceiptDate(r.sms.reference, new Date(2026, 10, 20)) === '2026-10-28'; })());

// the helper itself
check('decodePercent: the cases above, directly', decodePercent('A%26B') === 'A&B' && decodePercent('plain') === 'plain' && decodePercent('') === '' && decodePercent('%') === '%' && decodePercent('%2') === '%2' && decodePercent('%E0%A4') === '%E0%A4' && decodePercent('50%25 off') === '50% off');
check('it never decodes twice (a decoded %25 stays as a % sign)', decodePercent('A%2526B') === 'A%26B');

// a recipient is the same recipient however its name arrived
check('the recipient key is the same for "ABEBE & SONS" and "ABEBE %26 SONS"', (() => { const a = parseSms(CBE_PCT('ABEBE & SONS')); const b = parseSms(CBE_PCT('ABEBE %26 SONS')); return a.status === 'parsed' && b.status === 'parsed' && recipientKey(a.sms) === recipientKey(b.sms) && recipientKey(a.sms) === 'name:abebe sons'; })());

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
