import { AccountEntry, MoneyAccount } from '../types/accounts';
import { parseDateKey } from './dates';

export const HIDDEN_AMOUNT = '••••••••••';

// An amount as shown on a balance: the text itself, or the mask while balances are hidden.
export function maskAmount(text: string, hidden: boolean): string {
  return hidden ? HIDDEN_AMOUNT : text;
}

export function formatNumber(value: number, fractionDigits = 2): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
}

export function formatETB(value: number): string {
  return `ETB ${formatNumber(value)}`;
}

// An amount in any currency: "USD 45.00". ETB reads "ETB 1,200.00" like formatETB.
export function formatMoney(value: number, currency: string): string {
  return `${currency} ${formatNumber(value)}`;
}

// Transaction dates are local day keys; parse them as local, not UTC, before formatting.
export function formatDateKey(key: string): string {
  return parseDateKey(key).toLocaleDateString();
}

export function accountName(accountId: string | null, accounts: MoneyAccount[]): string {
  if (accountId === null) {
    return '';
  }
  return accounts.find((account) => account.id === accountId)?.name ?? 'Deleted account';
}

// Row title: the category for income/expense, "From → To" for a transfer, and a plain name for the two system rows.
export function transactionTitle(entry: AccountEntry, accounts: MoneyAccount[]): string {
  if (entry.type === 'transfer') {
    return `${accountName(entry.fromAccountId, accounts)} → ${accountName(entry.toAccountId, accounts)}`;
  }
  if (entry.type === 'opening') {
    return 'Opening balance';
  }
  if (entry.type === 'adjustment') {
    return 'Adjustment';
  }
  return entry.category;
}
