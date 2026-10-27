// Checks that known footers and greetings are not counted as "Not transactions" (V2_SPEC Part Z, "Boilerplate pieces"): Telebirr, CBE, BOA and
// Awash blocks with their footers, a lone greeting, a real promotion still counted, blank lines everywhere, the word "Thank" inside a real
// sentence, unknown fragments kept, and that no parsed amount, date, balance or hash changes.
// Every name, number and message below is SYNTHETIC. Run: npx tsx scripts/verify-sms-boilerplate.ts
import { isBoilerplate } from '../utils/sms/boilerplate';
import { parseBatch } from '../utils/sms/parse';
import { splitMessages } from '../utils/sms/split';
import { previewBatch } from '../utils/sms/staging';

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

const NONE: ReadonlySet<string> = new Set();
const counts = (text: string) => {
  const p = previewBatch(text, NONE, null, new Date('2026-10-28T12:00:00'));
  return { fresh: p.fresh.length, ignored: p.ignored, unreadable: p.unreadable.length, handled: p.alreadyHandled };
};
const same = (text: string, fresh: number, ignored: number, unreadable = 0) => {
  const c = counts(text);
  return c.fresh === fresh && c.ignored === ignored && c.unreadable === unreadable;
};

const TELEBIRR_FOOTER = 'Thank you for using telebirr\nEthio telecom';
const telebirr = (i: number, greeting = 'Dear Test ') =>
  `${greeting}\nYou have transferred ETB ${450 + i}.00 to Test Person (2519****0000) on ${String(10 + i).padStart(2, '0')}/10/2026 14:19:30. Your transaction number is DXX0TEST0${i}. The service fee is ETB 1.74 and 15% VAT on the service fee is ETB 0.26. Your current E-Money Account balance is ETB ${800 + i}.38. To download your payment information please click this link: https://example.test/receipt/DXX0TEST0${i}.`;
const cbe = (i: number) =>
  `Dear Test  A debit transaction of ETB ${1000 + i}.0. has occurred on your account 1****0001. Service charge of ETB 10.00 and VAT(15%) of ETB1.50 and Disaster Recovery(5%) of 0.50 with total of ETB${1012 + i}.00 .Your current balance is ETB7,${600 + i}.44. Thanks for Banking with CBE.`;
const CBE_FOOTER = 'Thanks for Banking with CBE!\nFor feedback https://example.test/feedback';
const boa = (i: number) => `Dear Test, your account 2***64 was debited with ETB ${12000 + i}.00. Available Balance: ETB 68,${700 + i}.70.`;
const BOA_FOOTER = 'Link your Fayda to your account.\nFor help, call 0000.';
const awash = (i: number) =>
  `Dear Customer, your Account 01320xxxxxx0001 has been Debited with ETB -${40000 + i}.00 on 2026-10-${String(10 + i).padStart(2, '0')} 15:14:22. Your balance now is ETB 1${6000 + i}.55. For any complaint or enquiry, please call 8980. Thank You. Awash Bank.`;
const AWASH_ALERT = 'Alert: Awash Bank will never ask for your PIN, password, or OTP. Do not share your confidential information with anyone.';

const seven = (make: (i: number) => string, footer: string, joiner = '\n\n') => Array.from({ length: 7 }, (_, i) => make(i) + joiner + footer).join(joiner);

// ---- the four shapes, seven messages each ----------------------------------------------------------------------------------
check('Telebirr: seven messages with footers give New 7, Not transactions 0', same(seven(telebirr, TELEBIRR_FOOTER), 7, 0), JSON.stringify(counts(seven(telebirr, TELEBIRR_FOOTER))));
check('CBE: seven messages with footers give New 7, Not transactions 0', same(seven(cbe, CBE_FOOTER), 7, 0), JSON.stringify(counts(seven(cbe, CBE_FOOTER))));
check('BOA: seven messages with footers give New 7, Not transactions 0', same(seven(boa, BOA_FOOTER), 7, 0), JSON.stringify(counts(seven(boa, BOA_FOOTER))));
check('Awash: seven messages with the Alert paragraph give New 7, Not transactions 0', same(seven(awash, AWASH_ALERT), 7, 0), JSON.stringify(counts(seven(awash, AWASH_ALERT))));
check('all four shapes mixed in one paste', same([seven(telebirr, TELEBIRR_FOOTER), seven(cbe, CBE_FOOTER), seven(boa, BOA_FOOTER), seven(awash, AWASH_ALERT)].join('\n\n'), 28, 0));

// ---- blank lines everywhere -------------------------------------------------------------------------------------------------
const everyLine = (text: string) => text.split('\n').filter((l) => l.trim() !== '').join('\n\n');
check('Telebirr with a blank line between every line: all seven are still read', counts(everyLine(seven(telebirr, TELEBIRR_FOOTER, '\n'))).fresh === 7);
check('...and nothing else is counted (the greeting and the footer lines are boilerplate)', counts(everyLine(seven(telebirr, TELEBIRR_FOOTER, '\n'))).ignored === 0);
check('no blank line anywhere', same(seven(telebirr, TELEBIRR_FOOTER, '\n'), 7, 0));
check('three blank lines and CRLF', same(seven(telebirr, TELEBIRR_FOOTER, '\r\n\r\n\r\n'), 7, 0));
check('"Dear Test " with a trailing space and a blank line after it', same(`Dear Test \n\n${telebirr(0, '').trim()}`, 1, 0));
check('no "Dear" line at all', same(seven((i) => telebirr(i, '').trim(), TELEBIRR_FOOTER), 7, 0));
check('a lone greeting before the block is not counted', same(`Dear Test\n\n${telebirr(0)}`, 1, 0));

// ---- what must still be counted ----------------------------------------------------------------------------------------------
const PROMO = 'Win a free gift this weekend! Visit any shop and show this message to collect it.';
check('a real promotion in the block gives Not transactions 1', same([telebirr(0), TELEBIRR_FOOTER, PROMO, telebirr(1), TELEBIRR_FOOTER].join('\n\n'), 2, 1));
check('a code message is still counted', same(`Your verification code is 123456.\n\n${telebirr(0)}`, 1, 1));
check('an unknown lone fragment is still counted', same(`${telebirr(0)}\n\nSee you soon\n\n${telebirr(1)}`, 2, 1));
check('a lone piece that only starts like a footer is still counted', same(`${telebirr(0)}\n\nThank you for using telebirr, your wallet is now larger.`, 1, 1));
check('a message that merely contains "Thank" in a real sentence is not dropped', same('Thank you for your payment of ETB 500.00 to the shop.', 0, 0, 1));
check('"Thank you for using telebirr" inside a message with text around it is kept', splitMessages(`${telebirr(0)}\nThank you for using telebirr and please rate us`).length === 1);
check('a "Dear" sentence of more than three words after Dear is kept', splitMessages('Dear Test your code has expired please request a new one').length === 1);
check('a "Dear" line with a number is kept', splitMessages('Dear Test 1234').length === 1);
check('an Alert paragraph that says something else is kept', splitMessages('Alert: your account was opened today').length === 1);
check('a lone footer on its own gives no message and nothing in the summary', splitMessages(TELEBIRR_FOOTER).length === 0 && same(TELEBIRR_FOOTER, 0, 0));

// ---- nothing about a real message changes -------------------------------------------------------------------------------------
const withFooter = parseBatch(`${telebirr(3)}\n\n${TELEBIRR_FOOTER}`);
const without = parseBatch(telebirr(3));
const a = withFooter[0];
const b = without[0];
check('one message with and without its footer gives one result each', withFooter.length === 1 && without.length === 1);
check('the hash is identical (a message already saved is still recognised)', a.status === 'parsed' && b.status === 'parsed' && a.sms.rawHash === b.sms.rawHash);
check(
  'amount, fee, date, balance and reference are unchanged',
  a.status === 'parsed' &&
    a.sms.amount === 453 &&
    a.sms.fee === 1.74 &&
    a.sms.vat === 0.26 &&
    a.sms.occurredAt === '2026-10-13T14:19:30' &&
    a.sms.balanceAfter === 803.38 &&
    a.sms.reference === 'DXX0TEST03',
  JSON.stringify(a),
);
const attached = parseBatch(`${telebirr(3)}\n${TELEBIRR_FOOTER}`)[0];
check('a footer attached with no blank line still parses the same, as before', attached.status === 'parsed' && attached.sms.amount === 453 && attached.sms.balanceAfter === 803.38);

// ---- the matcher itself --------------------------------------------------------------------------------------------------------
for (const text of [
  'Thank you for using telebirr',
  'Thank you for using telebirr\nEthio telecom',
  'Ethio telecom',
  'Dear Test',
  'Dear Test ',
  'Dear Test Person,',
  'Dear Customer',
  AWASH_ALERT,
  'Thanks for Banking with CBE!',
  'Thank you for Banking with CBE',
  'For feedback https://example.test/feedback',
  'Thanks for Banking with CBE!\nFor feedback https://example.test/feedback',
  'Link your Fayda to your account.',
  'For help, call 0000.',
]) {
  check(`boilerplate: ${text.replace(/\n/g, ' / ')}`, isBoilerplate(text));
}
for (const text of ['', ' ', 'Thank you', 'Thank you for your payment', 'Dear Test your code has expired', 'ETB 10.00', 'Ethio telecom will call you tomorrow', 'Call me']) {
  check(`not boilerplate: ${JSON.stringify(text)}`, !isBoilerplate(text));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
