import { AMT, parseAmount } from './numbers';
import { blank, cleanName, tailOf } from './shared';
import { ParsedBody } from './types';

const CREDIT = new RegExp(`your account ([\\d*xX]+) was credited with ETB\\s*(${AMT}) by\\s+(.+?)\\s*\\.\\s*Available Balance:\\s*ETB\\s*(${AMT})`, 'i');
const DEBIT = new RegExp(`your account ([\\d*xX]+) was debited with ETB\\s*(${AMT})\\s*\\.\\s*Available Balance:\\s*ETB\\s*(${AMT})`, 'i');

// Bank of Abyssinia (sender BOA). No date and no fees are printed, only the balance after.
export function parseBoa(text: string): ParsedBody | null {
  let m = CREDIT.exec(text);
  if (m) {
    const amount = parseAmount(m[2]);
    if (amount === null) return null;
    const body = blank('boa', 'in', 'credit', amount);
    body.accountTail = tailOf(m[1]);
    body.counterpartyName = cleanName(m[3]);
    body.balanceAfter = parseAmount(m[4]);
    return body;
  }
  m = DEBIT.exec(text);
  if (m) {
    const amount = parseAmount(m[2]);
    if (amount === null) return null;
    const body = blank('boa', 'out', 'debit', amount);
    body.accountTail = tailOf(m[1]);
    body.balanceAfter = parseAmount(m[3]);
    return body;
  }
  return null;
}
