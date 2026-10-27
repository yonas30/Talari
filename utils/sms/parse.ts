import { parseAwash } from './awash';
import { parseBoa } from './boa';
import { parseCbe } from './cbe';
import { reconcileTotals } from './amounts';
import { hashNormalised, normalise } from './normalise';
import { splitMessages } from './split';
import { airtimeReceivedNotice, parseTelebirr } from './telebirr';
import { ParsedBody, ParseResult, SmsService } from './types';

const PARSERS: { service: SmsService; parse: (text: string) => ParsedBody | null }[] = [
  { service: 'telebirr', parse: parseTelebirr },
  { service: 'cbe', parse: parseCbe },
  { service: 'boa', parse: parseBoa },
  { service: 'awash', parse: parseAwash },
];

// The sender names the service only when the message came from the inbox. In paste mode there is none, so the text decides.
export function serviceFromSender(sender: string | null | undefined): SmsService | null {
  const s = (sender ?? '').trim().toLowerCase();
  if (s === '127' || s === 'telebirr') return 'telebirr';
  if (s === 'cbe') return 'cbe';
  if (s === 'boa') return 'boa';
  if (s === 'awash bank' || s === 'awash') return 'awash';
  return null;
}

const HAS_AMOUNT = /ETB\s*-?\s*\d/i;
const OTP = /\b(?:otp|one[- ]time|verification code|passcode)\b/i;

// One message in, one of three answers out. The sender hint only breaks a tie between services whose templates both match; it never
// makes a message parse that no template matches. An amount with no matching template is "unreadable", never a guess.
export function parseSms(text: string, senderHint?: string | null): ParseResult {
  const normalised = normalise(text);
  if (normalised === '') return { status: 'ignored', reason: 'empty' };
  const rawHash = hashNormalised(normalised);

  // Not money: airtime arriving on a number, the other half of a recharge. Checked first, so it can never become a suggestion.
  const notice = airtimeReceivedNotice(normalised);
  if (notice) {
    return { status: 'ignored', reason: 'airtime_received', reference: notice.reference, text: text.trim() };
  }

  const hits = PARSERS.map((p) => ({ service: p.service, body: p.parse(normalised) })).filter(
    (h): h is { service: SmsService; body: ParsedBody } => h.body !== null,
  );
  if (hits.length > 0) {
    const hinted = serviceFromSender(senderHint);
    const chosen = hits.find((h) => h.service === hinted) ?? hits[0];
    // One rule for every bank: amount + fee = the printed total, or the card says it does not.
    return { status: 'parsed', sms: { ...reconcileTotals(chosen.body), rawHash } };
  }

  // Checked only after the templates, so a real transaction is never dropped because it happens to mention a code word.
  if (OTP.test(normalised)) return { status: 'ignored', reason: 'otp', text: text.trim() };
  if (!HAS_AMOUNT.test(normalised)) return { status: 'ignored', reason: 'no_amount', text: text.trim() };
  return { status: 'unreadable', text: text.trim(), rawHash };
}

// A pasted block: split it, then parse every piece, in order.
export function parseBatch(text: string, senderHint?: string | null): ParseResult[] {
  return splitMessages(text).map((message) => parseSms(message, senderHint));
}
