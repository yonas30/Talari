import { MoneyAccount } from '../../types/accounts';
import { serviceFromSender } from './parse';
import { SmsService } from './types';

// What an account's "SMS sender" is pre-filled with for each service (also used when linking an account from a review card).
export const SERVICE_SENDER: Record<SmsService, string> = {
  telebirr: '127',
  cbe: 'CBE',
  boa: 'BOA',
  awash: 'Awash Bank',
};

export const SERVICE_LABEL: Record<SmsService, string> = {
  telebirr: 'Telebirr',
  cbe: 'CBE',
  boa: 'BOA',
  awash: 'Awash Bank',
};

// Messages are in ETB, so only an active ETB account can take them.
export function eligibleAccounts(accounts: MoneyAccount[]): MoneyAccount[] {
  return accounts.filter((account) => !account.archived && account.currency === 'ETB');
}

const digitsOf = (value: string | null | undefined): string => (value ?? '').replace(/\D/g, '');

// Two masked tails agree when one ends with the other (a message may print two digits where the account stores four).
function tailsAgree(a: string, b: string): boolean {
  return a !== '' && b !== '' && (a.endsWith(b) || b.endsWith(a));
}

// Which account a message belongs to, or null when it cannot be told (the card then asks). Never guesses between two candidates:
//   1. accounts whose SMS sender maps to the message's service;
//   2. among them, the one whose last digits match the digits the message printed;
//   3. otherwise the only account for that service.
export function matchAccount(accounts: MoneyAccount[], message: { service: SmsService; accountTail: string | null }): string | null {
  const forService = eligibleAccounts(accounts).filter((account) => serviceFromSender(account.smsSender) === message.service);
  const printed = digitsOf(message.accountTail);
  if (printed !== '') {
    const byDigits = forService.filter((account) => tailsAgree(digitsOf(account.lastDigits), printed));
    if (byDigits.length === 1) {
      return byDigits[0].id;
    }
    if (byDigits.length > 1) {
      return null;
    }
  }
  return forService.length === 1 ? forService[0].id : null;
}

// The sender and digits to store on an account when the owner links it from a card.
export function linkDetails(message: { service: SmsService; accountTail: string | null }): { smsSender: string; lastDigits: string | null } {
  const digits = digitsOf(message.accountTail);
  return { smsSender: SERVICE_SENDER[message.service], lastDigits: digits === '' ? null : digits.slice(-4) };
}
