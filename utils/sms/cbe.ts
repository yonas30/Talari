import { AMT, parseAmount } from './numbers';
import { blank, cleanName, tailOf } from './shared';
import { ParsedBody } from './types';

const MARKER = /Banking with CBE/i;
const BALANCE = new RegExp(`Your current balance is ETB\\s*(${AMT})`, 'i');
const CHARGES = new RegExp(
  `Service charge of ETB\\s*(${AMT}) and VAT\\(\\d+%\\) of ETB\\s*(${AMT}) and Disaster Recovery\\(\\d+%\\) of (?:ETB\\s*)?(${AMT}) with total of ETB\\s*(${AMT})`,
);
const TRANSFER = new RegExp(`You have successfully transferred ETB\\s*(${AMT}) from account ([\\d*xX]+) to account ([\\d*xX]+) \\((.+?)\\)\\.`);
const DEBIT = new RegExp(`A debit transaction of ETB\\s*(${AMT})\\.? has occurred on your account ([\\d*xX]+)\\.`);
// "Your Account 1****6213 has been debited for <NAME> with ETB 22000." - a payment to a named person, with no charges printed.
const DEBITED_FOR = new RegExp(`Account ([\\d*xX]+) has been debited for (.+?) with ETB\\s*(${AMT})\\.`, 'i');
const CREDIT = new RegExp(`Account ([\\d*xX]+) has been credited with ETB\\s*(${AMT})\\.`, 'i');
// The reference is the only thing read from the receipt link. The slash after BranchReceipt may arrive as %2F, and the reference stops at the
// first character that is not a letter or digit (an "&" or its encoding %26).
const RECEIPT = /BranchReceipt(?:\/|%2F)(FT[0-9A-Z]+)/i;
const receiptOf = (text: string): string | null => RECEIPT.exec(text)?.[1]?.toUpperCase() ?? null;

// CBE (sender CBE). The messages carry no date at all, so occurredAt stays null and the review step supplies one.
export function parseCbe(text: string): ParsedBody | null {
  if (!MARKER.test(text)) return null;
  const balance = parseAmount(BALANCE.exec(text)?.[1]);

  let m = TRANSFER.exec(text);
  if (m) {
    const amount = parseAmount(m[1]);
    if (amount === null) return null;
    const body = blank('cbe', 'out', 'bank_transfer', amount);
    body.accountTail = tailOf(m[2]);
    body.counterpartyAccountTail = tailOf(m[3]);
    body.counterpartyName = cleanName(m[4]);
    return withCharges(body, text, balance);
  }

  m = DEBIT.exec(text);
  if (m) {
    const amount = parseAmount(m[1]);
    if (amount === null) return null;
    const body = blank('cbe', 'out', 'debit', amount);
    body.accountTail = tailOf(m[2]);
    return withCharges(body, text, balance);
  }

  m = DEBITED_FOR.exec(text);
  if (m) {
    const amount = parseAmount(m[3]);
    if (amount === null) return null;
    const body = blank('cbe', 'out', 'bank_transfer', amount);
    body.accountTail = tailOf(m[1]);
    body.counterpartyName = cleanName(m[2]);
    body.reference = receiptOf(text);
    body.balanceAfter = balance;
    return body;
  }

  m = CREDIT.exec(text);
  if (m) {
    const amount = parseAmount(m[2]);
    if (amount === null) return null;
    const body = blank('cbe', 'in', 'credit', amount);
    body.accountTail = tailOf(m[1]);
    body.reference = receiptOf(text);
    body.balanceAfter = balance;
    return body;
  }

  return null;
}

function withCharges(body: ParsedBody, text: string, balance: number | null): ParsedBody {
  body.balanceAfter = balance;
  const c = CHARGES.exec(text);
  if (!c) return body;
  body.fee = parseAmount(c[1]);
  body.vat = parseAmount(c[2]);
  body.otherCharge = parseAmount(c[3]);
  body.totalDeducted = parseAmount(c[4]);
  // Amount + charges is checked against the printed total for every bank in parse.ts (utils/sms/amounts.ts).
  return body;
}
