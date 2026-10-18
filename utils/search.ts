import { TransactionType } from '../types';
import { AccountEntry, MoneyAccount } from '../types/accounts';
import { accountName, transactionTitle } from './format';

// Live search for the Transactions list. A query is split into words and EVERY word has to match something on the
// entry ("food bole" finds a Food expense at Bole Taxi). A word matches if it appears in the merchant/source, the
// category, the note, a transfer's From -> To names, the entry type or the currency - or, if it is a number, if it
// equals the amount (in the entered currency or in ETB), or the whole-number part of it ("1250" finds 1,250.50).

function fold(value: string): string {
  // Case- and accent-insensitive.
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function parseAmount(word: string): number | null {
  // "1,250.50", "1250", "etb1250" -> a number; anything else is not an amount query.
  const cleaned = word.replace(/,/g, '').replace(/^(etb|usd|eur|gbp)/i, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return null;
  }
  return Number(cleaned);
}

function amountMatches(query: number, transaction: AccountEntry): boolean {
  const isWhole = Number.isInteger(query);
  return [transaction.amount, transaction.amountETB, transaction.toAmount ?? Number.NaN].some(
    (value) => Math.abs(value - query) < 0.005 || (isWhole && Math.trunc(value) === query),
  );
}

export type TypeFilter = 'all' | TransactionType;

// The Transactions type tabs. Applied BEFORE the text search, so a search only looks inside the selected tab. The system rows
// (opening balance, adjustment) are on All only.
export function filterByType(transactions: AccountEntry[], type: TypeFilter): AccountEntry[] {
  return type === 'all' ? transactions : transactions.filter((transaction) => transaction.type === type);
}

export function filterTransactions(transactions: AccountEntry[], query: string, accounts: MoneyAccount[]): AccountEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return transactions;
  }

  return transactions.filter((transaction) => {
    const haystack = fold(
      [
        transaction.source,
        transaction.category,
        transaction.note ?? '',
        transactionTitle(transaction, accounts),
        accountName(transaction.accountId, accounts),
        accountName(transaction.fromAccountId, accounts),
        accountName(transaction.toAccountId, accounts),
      ].join(' \n '),
    );
    // Type and currency are tiny vocabularies ("expense", "ETB"): matched as whole words (or a 3+ letter prefix) so
    // that typing "e" or "t" doesn't match every ETB entry.
    const labels = [fold(transaction.type), fold(transaction.currency)];

    return words.every((word) => {
      if (haystack.includes(word) || labels.some((label) => label === word || (word.length >= 3 && label.startsWith(word)))) {
        return true;
      }
      const amount = parseAmount(word);
      return amount !== null && amountMatches(amount, transaction);
    });
  });
}
