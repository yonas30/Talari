import { DATE_SRC, parseSmsDate } from './dates';
import { AMT, parseAmount } from './numbers';
import { blank, cleanName, tailOf } from './shared';
import { ParsedBody } from './types';

// "Your current balance", "Your current E-Money Account balance", "Your telebirr account balance", "Your current telebirr balance".
const BALANCE = new RegExp(`Your (?:current )?(?:E-Money Account |telebirr )?(?:account )?balance is ETB\\s*(${AMT})`);
const FEE = new RegExp(`service fee is ETB\\s*(${AMT}) and \\d+% VAT on the service fee is ETB\\s*(${AMT})`);
const REFERENCE = /(?:Your (?:telebirr )?transaction number is|by transaction number) ([A-Z0-9]{6,14})/;

const PERSON_OUT = new RegExp(`You have transferred ETB\\s*(${AMT}) to (.+?)\\s*\\(([\\d*xX]+)\\)\\s*on ${DATE_SRC}\\.`);
const BANK_OUT = new RegExp(
  `You have transferred ETB\\s*(${AMT}) successfully from your telebirr account ([\\d*xX]+) to (.+?) account number ([\\d*xX]+) on ${DATE_SRC}\\.`,
);
const RECEIVED_BANK = new RegExp(`You have received ETB\\s*(${AMT}) by transaction number ([A-Z0-9]{6,14}) on ${DATE_SRC} from (.+?) to your telebirr Account`);
const RECEIVED_PERSON = new RegExp(`You have received ETB\\s*(${AMT}) from (.+?)\\s*\\(([\\d*xX]+)\\)\\s*on ${DATE_SRC}\\.`);
const MERCHANT_CODE = new RegExp(`You have paid ETB\\s*(${AMT}) for Service Fee from (\\d+) - (.+?) on ${DATE_SRC}\\.`);
const MERCHANT_NUMBER = new RegExp(`You have paid ETB\\s*(${AMT}) to (.+?) with Payment number (\\d+) on ${DATE_SRC}\\.`);
const AIRTIME = new RegExp(`You have recharged ETB\\s*(${AMT}) airtime for (\\d+) on ${DATE_SRC}\\.`);
const BILL = new RegExp(`You have paid ETB\\s*(${AMT}) to pay bill for (\\d+) on ${DATE_SRC}\\.`);
const PACKAGE = new RegExp(`You have paid ETB\\s*(${AMT}) for package (.+?)(?: purchase)? made for \\S+ on ${DATE_SRC}\\.`);

// Telebirr (sender 127). Every template needs its amount and date to read cleanly; the balance and the fee lines are optional because
// not every message type prints them.
export function parseTelebirr(text: string): ParsedBody | null {
  const balance = parseAmount(BALANCE.exec(text)?.[1]);
  const reference = REFERENCE.exec(text)?.[1] ?? null;

  let m = PERSON_OUT.exec(text);
  if (m) {
    const amount = parseAmount(m[1]);
    const occurredAt = parseSmsDate(m[4]);
    if (amount === null || occurredAt === null) return null;
    const body = blank('telebirr', 'out', 'person_transfer', amount);
    body.counterpartyName = cleanName(m[2]);
    body.counterpartyPhoneTail = tailOf(m[3]);
    return finish(body, text, occurredAt, reference, balance);
  }

  m = BANK_OUT.exec(text);
  if (m) {
    const amount = parseAmount(m[1]);
    const occurredAt = parseSmsDate(m[5]);
    if (amount === null || occurredAt === null) return null;
    const body = blank('telebirr', 'out', 'bank_transfer', amount);
    body.accountTail = tailOf(m[2]);
    body.counterpartyBank = cleanName(m[3]);
    body.counterpartyAccountTail = tailOf(m[4]);
    return finish(body, text, occurredAt, reference, balance);
  }

  m = RECEIVED_BANK.exec(text);
  if (m) {
    const amount = parseAmount(m[1]);
    const occurredAt = parseSmsDate(m[3]);
    if (amount === null || occurredAt === null) return null;
    const body = blank('telebirr', 'in', 'received', amount);
    body.counterpartyBank = cleanName(m[4]);
    return finish(body, text, occurredAt, reference, balance);
  }

  m = RECEIVED_PERSON.exec(text);
  if (m) {
    const amount = parseAmount(m[1]);
    const occurredAt = parseSmsDate(m[4]);
    if (amount === null || occurredAt === null) return null;
    const body = blank('telebirr', 'in', 'received', amount);
    body.counterpartyName = cleanName(m[2]);
    body.counterpartyPhoneTail = tailOf(m[3]);
    return finish(body, text, occurredAt, reference, balance);
  }

  m = PACKAGE.exec(text);
  if (m) {
    const amount = parseAmount(m[1]);
    const occurredAt = parseSmsDate(m[3]);
    if (amount === null || occurredAt === null) return null;
    const body = blank('telebirr', 'out', 'package_payment', amount);
    body.note = cleanName(m[2]);
    return finish(body, text, occurredAt, reference, balance);
  }

  m = MERCHANT_CODE.exec(text);
  if (m) {
    const amount = parseAmount(m[1]);
    const occurredAt = parseSmsDate(m[4]);
    if (amount === null || occurredAt === null) return null;
    const body = blank('telebirr', 'out', 'merchant_payment', amount);
    body.counterpartyCode = m[2];
    body.counterpartyName = cleanName(m[3]);
    return finish(body, text, occurredAt, reference, balance);
  }

  m = MERCHANT_NUMBER.exec(text);
  if (m) {
    const amount = parseAmount(m[1]);
    const occurredAt = parseSmsDate(m[4]);
    if (amount === null || occurredAt === null) return null;
    const body = blank('telebirr', 'out', 'merchant_payment', amount);
    body.counterpartyName = cleanName(m[2]);
    body.counterpartyCode = m[3];
    return finish(body, text, occurredAt, reference, balance);
  }

  m = AIRTIME.exec(text);
  if (m) {
    const amount = parseAmount(m[1]);
    const occurredAt = parseSmsDate(m[3]);
    if (amount === null || occurredAt === null) return null;
    const body = blank('telebirr', 'out', 'airtime', amount);
    body.counterpartyCode = m[2];
    body.note = 'Airtime';
    return finish(body, text, occurredAt, reference, balance);
  }

  m = BILL.exec(text);
  if (m) {
    const amount = parseAmount(m[1]);
    const occurredAt = parseSmsDate(m[3]);
    if (amount === null || occurredAt === null) return null;
    const body = blank('telebirr', 'out', 'bill_payment', amount);
    body.counterpartyCode = m[2];
    body.note = 'Bill payment';
    return finish(body, text, occurredAt, reference, balance);
  }

  return null;
}

// The notice that airtime ARRIVED on a number ("You have received ETB 15.00 airtime from 2519... on <date>. Your transaction number is
// ..."). It is the other half of a recharge the owner already has a message for: not money in, and it prints no balance.
const AIRTIME_RECEIVED = new RegExp(`You have received ETB\\s*(${AMT}) airtime from (\\d+) on ${DATE_SRC}\\.`);
export function airtimeReceivedNotice(text: string): { reference: string | null } | null {
  return AIRTIME_RECEIVED.test(text) ? { reference: REFERENCE.exec(text)?.[1] ?? null } : null;
}

function finish(body: ParsedBody, text: string, occurredAt: string, reference: string | null, balance: number | null): ParsedBody {
  const fee = FEE.exec(text);
  if (fee) {
    body.fee = parseAmount(fee[1]);
    body.vat = parseAmount(fee[2]);
  }
  body.occurredAt = occurredAt;
  body.reference = reference;
  body.balanceAfter = balance;
  return body;
}
