// Checks for "Copy this message with names and numbers hidden" (V2_SPEC Part Z, Phase 6D-2): amounts, balances, dates and times survive; names, phone
// numbers, account tails, ids and links do not; all four formats (Telebirr, CBE, BOA, Awash with its "Alert:" paragraph and receipt link); a leak test
// with planted values; the function never throws and is stable. Every message, name and number below is SYNTHETIC.
// Run: npx tsx scripts/verify-sms-hide.ts
import { HIDDEN, HIDDEN_COPY_NOTE, hideMessageText } from '../utils/sms/hideText';
import { parseBatch } from '../utils/sms/parse';
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

interface Sample {
  label: string;
  text: string;
  // Must still be there after hiding: amounts, balances, dates, times.
  keep: string[];
  // Must NOT be there: planted names, phone numbers, account tails, ids, links.
  leak: string[];
}

const LINK = 'https://example.invalid/receipt/FT26301KQ4MZ&19283746';
const samples: Sample[] = [
  {
    label: 'Telebirr (sent, with a link and an id)',
    text: `Dear Zelalem\nYou have transferred ETB 120.00 to Mulugeta Wondimu Desta (2519****5521) on 14/11/2026 13:52:15. Your transaction number is TX5KQ82M9PZ. The service fee is  ETB 1.74 and  15% VAT on the service fee is ETB 0.26. Your current E-Money Account  balance is ETB 3,321.38. To download your payment information please click this link: ${LINK}\nThank you for using telebirr\nEthio telecom`,
    keep: ['ETB 120.00', '14/11/2026 13:52:15', 'ETB 1.74', '15%', 'ETB 0.26', 'ETB 3,321.38', 'Thank you for using telebirr'],
    leak: ['Zelalem', 'Mulugeta', 'Wondimu', 'Desta', '5521', 'TX5KQ82M9PZ', 'FT26301KQ4MZ', '19283746', 'example.invalid'],
  },
  {
    label: 'Telebirr (received, from a person with half-hidden name)',
    text: `Dear Zelalem,\nYou have received ETB 2,000.00 from Hxxxxx Nxxxxx(2519****7743)  on 15/11/2026 09:13:58. Your transaction number is MN4BVC8XZ2. Your current E-Money Account balance is ETB 5,318.38.`,
    keep: ['ETB 2,000.00', '15/11/2026 09:13:58', 'ETB 5,318.38'],
    leak: ['Zelalem', 'Hxxxxx', 'Nxxxxx', '7743', 'MN4BVC8XZ2'],
  },
  {
    label: 'Telebirr (received from a bank, name after a dash)',
    text: `You have received  ETB 1,000.00 by transaction number XE3VKQ7M5R on 2026-10-30 11:29:24 from Bank of Abyssinia to your telebirr Account 2519XXXXXX - Zelalem MXXXXX NXXXXX. Your current balance is ETB 27,341.56.`,
    keep: ['ETB 1,000.00', '2026-10-30 11:29:24', 'ETB 27,341.56', 'Bank of Abyssinia'],
    leak: ['XE3VKQ7M5R', '2519XXXXXX', 'Zelalem', 'MXXXXX', 'NXXXXX'],
  },
  {
    label: 'CBE (sent, with charges and total)',
    text: `Dear  Zelalem Gxxx dxxxxx You have successfully transferred ETB500.00 from account 1***9081 to account 1***4417 (Mulugeta Wondimu Desta). Service charge of ETB 0.50 and VAT(15%) of ETB0.08 and Disaster Recovery(5%) of 0.03 with total of ETB500.61 .Your current balance is ETB9,415.20. Thanks for Banking with CBE. `,
    keep: ['ETB500.00', 'ETB 0.50', 'VAT(15%)', 'ETB0.08', '(5%)', '0.03', 'ETB500.61', 'ETB9,415.20', 'Thanks for Banking with CBE'],
    leak: ['Zelalem', 'Gxxx', 'dxxxxx', '9081', '4417', 'Mulugeta', 'Wondimu', 'Desta'],
  },
  {
    label: 'CBE (credit with a receipt link)',
    text: `Dear Mr Zelalem your Account 1****9081 has been credited with ETB 100. Your Current Balance is ETB 55005.56. Thank you for Banking with CBE! for Reciept ${LINK}`,
    keep: ['ETB 100', 'ETB 55005.56', 'Thank you for Banking with CBE'],
    leak: ['Zelalem', '9081', 'FT26301KQ4MZ', '19283746', 'example.invalid'],
  },
  {
    label: 'BOA (credit by a person)',
    text: `Dear Zelalem, your account 2***64 was credited with ETB 3,300.00 by  Mulugeta Wondimu Desta . Available Balance: ETB 72,005.70.`,
    keep: ['ETB 3,300.00', 'ETB 72,005.70', 'Available Balance'],
    leak: ['Zelalem', 'Mulugeta', 'Wondimu', 'Desta'],
  },
  {
    label: 'BOA (debit)',
    text: `Dear Zelalem, your account 2***64 was debited with ETB 12,230.00. Available Balance: ETB 68,705.70.`,
    keep: ['ETB 12,230.00', 'ETB 68,705.70'],
    leak: ['Zelalem'],
  },
  {
    label: 'Awash (debit)',
    text: `Dear Customer, your Account 01320xxxxxx5512 has been Debited with ETB -40000.00 on 2026-11-24 15:14:22. Your balance now is ETB 16549.55. For any complaint or enquiry, please call 8980. Thank You. Awash Bank.`,
    keep: ['ETB -40000.00', '2026-11-24 15:14:22', 'ETB 16549.55', 'Dear Customer', 'Awash Bank'],
    leak: ['01320', '5512', '8980'],
  },
  {
    label: 'Awash (credit by a person via IPS)',
    text: `Dear Customer, your Account 01320xxxxxx5512 has been Credited with ETB 8000.00 on 2026-11-24 15:08:19 by Zelalem Gxxx dxxxx via IPS Commercial Bank of Ethiopia. Your balance now is ETB 56549.55. For any complaint or enquiry, please call 8980. Thank You. Awash Bank.`,
    keep: ['ETB 8000.00', '2026-11-24 15:08:19', 'ETB 56549.55', 'via IPS Commercial Bank of Ethiopia'],
    leak: ['Zelalem', 'Gxxx', 'dxxxx', '5512', '01320'],
  },
  {
    label: 'Awash (second layout: "Txn ID", receipt link, and the Alert paragraph)',
    text: `Dear Customer, ETB 36,000 has been credited to your account from Bnnn Wxxx on : 2026-11-03 14:27:39  with Txn ID: 261103091458213 . Your available balance is now ETB 46,986.17. Receipt  Link: ${LINK} . Contact center  8980.\n\nAlert: Awash Bank will never ask for your PIN, password, or OTP. Do not share your confidential information with anyone.`,
    keep: ['ETB 36,000', '2026-11-03 14:27:39', 'ETB 46,986.17', 'Alert: Awash Bank will never ask for your PIN, password, or OTP.'],
    leak: ['Bnnn', 'Wxxx', '261103091458213', 'FT26301KQ4MZ', '19283746', 'example.invalid', '8980'],
  },
  {
    label: 'Awash (Telebirr to Awash with a reference)',
    text: `Dear Customer, your Account 01320xxxxxx5512 has been Credited with ETB 300.00 on 2026-11-12 14:23:21 by TeleBirr C2B to Awash with reference DKF8ZQ2WRT. Your balance now is ETB 11187.21. For any complaint or enquiry, please call 8980. Thank You. Awash Bank.`,
    keep: ['ETB 300.00', '2026-11-12 14:23:21', 'ETB 11187.21', 'by TeleBirr', 'to Awash'],
    leak: ['DKF8ZQ2WRT', '5512', '01320'],
  },
];

console.log('The four formats');
for (const sample of samples) {
  const hidden = hideMessageText(sample.text);
  const lost = sample.keep.filter((piece) => !hidden.includes(piece));
  const leaked = sample.leak.filter((piece) => hidden.includes(piece));
  check(`${sample.label}: amounts, balances, dates and times survive`, lost.length === 0, `lost: ${lost.join(' | ')}\n${hidden}`);
  check(`${sample.label}: names, numbers, tails, ids and links do not`, leaked.length === 0, `leaked: ${leaked.join(' | ')}\n${hidden}`);
  check(`${sample.label}: something was actually hidden`, hidden.includes(HIDDEN) || sample.leak.length === 0);
}

console.log('A leak test with planted values');
{
  const NAME = 'Zelalem Tadesse Worku';
  const PHONE = '0911223344';
  const PHONE_INTL = '+251911223344';
  const TAIL = '9081';
  const TXN = 'TX5KQ82M9PZ';
  const planted = [
    `Dear Mr ${NAME}\nYou sent ETB 77.00 to ${NAME} (${PHONE}) on 02/12/2026 08:05:00 from account 1***${TAIL}. Your transaction number is ${TXN}. Balance is ETB 1,234.50.`,
    `Dear Customer, your Account 0132xxxx${TAIL} has been Debited with ETB -77.00 on 2026-12-02 08:05:00 by ${NAME} with reference ${TXN}. Your balance now is ETB 1,157.50. Call ${PHONE_INTL}.`,
    `[12/2/2026 8:05 AM] ${NAME}: Dear Customer your account ${TAIL} was credited with ETB 5.00 from ${NAME}. Txn ID: ${TXN}`,
    `Dear ${NAME}, your account 2***${TAIL.slice(2)} was debited with ETB 12.00 - ${NAME}. Available Balance: ETB 3.00.`,
  ];
  for (const [index, text] of planted.entries()) {
    const hidden = hideMessageText(text);
    const found = [NAME, 'Zelalem', 'Tadesse', 'Worku', PHONE, '911223344', TAIL, TXN].filter((secret) => hidden.includes(secret));
    check(`planted message ${index + 1}: the name, the phone number, the account tail and the transaction id are all gone`, found.length === 0, `survived: ${found.join(' | ')}\n${hidden}`);
  }
  check('...and the planted amounts and balances are all still there', ['ETB 77.00', 'ETB 1,234.50', 'ETB -77.00', 'ETB 1,157.50', 'ETB 5.00', 'ETB 12.00', 'ETB 3.00'].every((piece) => planted.map(hideMessageText).join('\n').includes(piece)));
  check('...and so are the dates and times', ['02/12/2026 08:05:00', '2026-12-02 08:05:00', '12/2/2026 8:05 AM'].every((piece) => planted.map(hideMessageText).join('\n').includes(piece)));
}

console.log('Amounts, balances and dates survive');
{
  const text = 'Your balance is 1,500 and ETB 20 was paid. ETB 3,000.50 left on 3 Nov 2026 at 10:15 PM, Nov 4, 2026 and 5th March 2027. Ratio 12.5%. Fee of 0.15.';
  const hidden = hideMessageText(text);
  check('the figure after "balance" survives even with no ETB and no decimals', hidden.includes('balance is 1,500'), hidden);
  check('an amount after ETB survives with and without decimals', hidden.includes('ETB 20') && hidden.includes('ETB 3,000.50'));
  check('a bare figure with decimals ("of 0.15") survives', hidden.includes('Fee of 0.15'));
  check('dates in words, times with AM/PM and percentages survive', hidden.includes('3 Nov 2026') && hidden.includes('10:15 PM') && hidden.includes('Nov 4, 2026') && hidden.includes('5th March 2027') && hidden.includes('12.5%'), hidden);
  check('a negative amount keeps its sign', hideMessageText('debited ETB -40000.00 today').includes('ETB -40000.00'));
  check('an amount written after the number ("250 ETB") survives', hideMessageText('paid 250 ETB for it').includes('250 ETB'));
}

console.log('What else is hidden, and what is not a name');
{
  check('any other run of digits is hidden (a package size, a call-centre number)', !/\d/.test(hideMessageText('Package 36 SMS, call 8980 or 0911 223344')));
  check('a phone number the bank wrote with stars or x\'s is hidden', !/\d/.test(hideMessageText('to 2519****5521 and 9XXXXXXX5 and 01320xxxxxx5512')));
  check('a bank or service after "from" or "to" is not a person and stays', hideMessageText('received from Commercial Bank of Ethiopia to Awash').includes('Commercial Bank of Ethiopia') && hideMessageText('sent to Telebirr').includes('Telebirr'));
  check('lower-case words after "to" are not taken for names', hideMessageText('click to download your information from the app at once').includes('to download your information from the app at once'));
  check('a receipt link is hidden whole', !/https?:|example|receipt/i.test(hideMessageText(`see ${LINK} now`)) && hideMessageText(`see ${LINK} now`) === `see ${HIDDEN} now`);
  check('"Dear Customer" is not a name', hideMessageText('Dear Customer, hello').startsWith('Dear Customer'));
  check('the chat prefix name is hidden, its date and time are not', (() => {
    const hidden = hideMessageText('[12/2/2026 8:05 AM] Mulugeta Wondimu: hello ETB 5.00');
    return !hidden.includes('Mulugeta') && hidden.includes('[12/2/2026 8:05 AM]') && hidden.includes('ETB 5.00');
  })());
  check('a name the bank half-hid is hidden even with no keyword before it', !/Hxxxxx|Nxxxxx/.test(hideMessageText('Payer Hxxxxx Nxxxxx paid ETB 5.00 today')) && hideMessageText('Payer Hxxxxx Nxxxxx paid ETB 5.00 today').includes('ETB 5.00'));
  check('line breaks stay', hideMessageText('Dear Zelalem\nYou paid ETB 5.00').split('\n').length === 2);
  check('an id with only capitals after "reference" is hidden too', hideMessageText('with reference ABCDEFGHIJ done') === `with reference ${HIDDEN} done`);
}

console.log('Safety');
{
  const inputs = ['', '   ', 'ETB', '(((', 'Dear', 'to', '- - -', 'ETB -', '', '😀 Dear Zelalem 😀', 'x'.repeat(5000), '1'.repeat(5000)];
  check('it never throws, whatever the text', inputs.every((input) => { try { hideMessageText(input); return true; } catch { return false; } }));
  const once = hideMessageText(samples[0].text);
  check('hiding the hidden text again changes nothing', hideMessageText(once) === once);
  check('the same text always gives the same copy', hideMessageText(samples[3].text) === hideMessageText(samples[3].text));
  check('the note says "hidden as far as possible", asks to check before sharing and never says anonymous', /Hidden as far as possible/.test(HIDDEN_COPY_NOTE) && /Check it before you share it/.test(HIDDEN_COPY_NOTE) && /not guaranteed/.test(HIDDEN_COPY_NOTE) && !/anonymous/i.test(HIDDEN_COPY_NOTE));

  // the paste screen's groups carry the text, so each card can offer the copy
  const paste = `Dear Zelalem, your OTP is 482913. Do not share it.\n\nDear Zelalem, your airtime of 5 birr was received on 0911223344.\n\nDear Zelalem, ETB 250.00 was moved around in an unfamiliar way on your account.`;
  const preview = previewBatch(paste, new Set());
  check('the paste preview keeps the text of "Not transactions" for the screen (a code, an airtime notice)', preview.ignored >= 1 && preview.ignoredItems.length === preview.ignored && preview.ignoredItems.every((item) => item.text.length > 0), JSON.stringify(preview.ignoredItems.map((i) => i.reason)));
  check('...and the unreadable one', preview.unreadable.length === 1 && preview.unreadable[0].text.includes('ETB 250.00'));
  const hiddenOtp = preview.ignoredItems.filter((item) => item.reason === 'otp').map((item) => hideMessageText(item.text)).join(' ');
  check('the hidden copy of a code message has no digits left', hiddenOtp !== '' && !/\d/.test(hiddenOtp), hiddenOtp);
  check('a parsed batch result for an ignored message carries its text, an empty one does not', parseBatch('Dear Zelalem, your OTP is 482913.').every((r) => r.status === 'ignored' && r.text !== undefined) && parseBatch('   ').length === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
