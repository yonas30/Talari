import { DATE_SRC, parseSmsDate } from './dates';
import { AMT, parseAmount } from './numbers';
import { blank, cleanName, tailOf } from './shared';
import { ParsedBody } from './types';

const MAIN = new RegExp(`Account ([\\d*xX]+) has been (Debited|Credited) with ETB\\s*(${AMT}) on\\s*:?\\s*${DATE_SRC}`, 'i');
const SECOND_LAYOUT = new RegExp(`ETB\\s*(${AMT}) has been credited to your account from (.+?)\\s+on\\s*:?\\s*${DATE_SRC}\\s+with Txn ID:\\s*(\\d+)`, 'i');
const BALANCE = new RegExp(`Your (?:available )?balance (?:now is|is now) ETB\\s*(${AMT})`, 'i');
const VIA_IPS = /by (.+?) via IPS (.+?)\.\s*Your balance/i;
const C2B = /by TeleBirr C2B to Awash with reference ([A-Z0-9]{6,14})/i;

// Awash Bank. Two layouts: "Account ... has been Debited/Credited with ETB ... on <date>" and "ETB ... has been credited to your account from <name> on : <date>".
export function parseAwash(text: string): ParsedBody | null {
  const balance = parseAmount(BALANCE.exec(text)?.[1]);

  const main = MAIN.exec(text);
  if (main) {
    const amount = parseAmount(main[3]);
    const occurredAt = parseSmsDate(main[4]);
    if (amount === null || occurredAt === null) return null;
    const incoming = main[2].toLowerCase() === 'credited';
    const body = blank('awash', incoming ? 'in' : 'out', incoming ? 'credit' : 'debit', amount);
    body.accountTail = tailOf(main[1]);
    body.occurredAt = occurredAt;
    body.balanceAfter = balance;
    const ips = VIA_IPS.exec(text);
    const c2b = C2B.exec(text);
    if (c2b) {
      body.counterpartyBank = 'Telebirr';
      body.reference = c2b[1];
    } else if (ips) {
      body.counterpartyName = cleanName(ips[1]);
      body.counterpartyBank = cleanName(ips[2]);
    }
    return body;
  }

  const second = SECOND_LAYOUT.exec(text);
  if (second) {
    const amount = parseAmount(second[1]);
    const occurredAt = parseSmsDate(second[3]);
    if (amount === null || occurredAt === null) return null;
    const body = blank('awash', 'in', 'credit', amount);
    body.counterpartyName = cleanName(second[2]);
    body.reference = second[4];
    body.occurredAt = occurredAt;
    body.balanceAfter = balance;
    return body;
  }

  return null;
}
