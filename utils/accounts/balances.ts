import { BASE_CURRENCY } from '../../constants/accounts';
import { AccountEntry, MoneyAccount } from '../../types/accounts';
import { AccountsError } from './errors';
import { formatAmount, fromCents, toCents } from './money';

// V2_SPEC Part C: an account's balance is NEVER stored. It is the sum of the ledger rows that touch it, in the account's own
// currency. Editing a row changes that one row; deleting drops it from the sum. Nothing is reversed.

export type AccountMap = Map<string, MoneyAccount>;

export function mapAccounts(accounts: MoneyAccount[]): AccountMap {
  return new Map(accounts.map((account) => [account.id, account]));
}

// The signed effect (in cents, in that account's own currency) a row has on each account.
//  - income / expense in an ETB account move the account by the ETB value, because the original amount may be a foreign one
//    that was converted at entry (V2_SPEC Part D); in a foreign account they move it by the native amount.
//  - opening / adjustment / transfer legs are always in the account's own currency.
export function entryEffects(entry: AccountEntry, accounts: AccountMap): Array<[string, number]> {
  if (entry.type === 'transfer') {
    const effects: Array<[string, number]> = [];
    if (entry.fromAccountId && accounts.has(entry.fromAccountId)) {
      effects.push([entry.fromAccountId, -toCents(entry.amount)]);
    }
    if (entry.toAccountId && accounts.has(entry.toAccountId) && entry.toAmount !== null) {
      effects.push([entry.toAccountId, toCents(entry.toAmount)]);
    }
    return effects;
  }

  const account = entry.accountId ? accounts.get(entry.accountId) : undefined;
  if (!account || !entry.accountId) {
    return [];
  }
  if (entry.type === 'income' || entry.type === 'expense') {
    const cents = toCents(account.currency === BASE_CURRENCY ? entry.amountETB : entry.amount);
    return [[entry.accountId, entry.type === 'income' ? cents : -cents]];
  }
  // opening is positive; adjustment carries its own sign.
  return [[entry.accountId, toCents(entry.amount)]];
}

// Every account gets a balance (0 when it has no rows). Balances are in each account's own currency.
export function getAccountBalances(entries: AccountEntry[], accounts: MoneyAccount[]): Record<string, number> {
  const byId = mapAccounts(accounts);
  const cents = new Map<string, number>(accounts.map((account) => [account.id, 0]));
  for (const entry of entries) {
    for (const [accountId, delta] of entryEffects(entry, byId)) {
      cents.set(accountId, (cents.get(accountId) ?? 0) + delta);
    }
  }
  return Object.fromEntries(Array.from(cents, ([id, value]) => [id, fromCents(value)]));
}

// Structural rules that do not depend on the rest of the ledger (V2_SPEC Part F).
function checkEntry(entry: AccountEntry, accounts: AccountMap): AccountsError | null {
  const amountOk = Number.isFinite(entry.amount) && Number.isFinite(entry.amountETB);

  if (entry.type === 'transfer') {
    const from = entry.fromAccountId ? accounts.get(entry.fromAccountId) : undefined;
    const to = entry.toAccountId ? accounts.get(entry.toAccountId) : undefined;
    if (!from || !to) {
      return new AccountsError('UNKNOWN_ACCOUNT', 'A transfer needs a From and a To account.');
    }
    if (from.id === to.id) {
      return new AccountsError('SAME_ACCOUNT', 'From and To cannot be the same account.');
    }
    if (!amountOk || toCents(entry.amount) <= 0 || entry.toAmount === null || !(toCents(entry.toAmount) > 0)) {
      return new AccountsError('INVALID_AMOUNT', 'Amount must be greater than zero.');
    }
    if (entry.currency !== from.currency) {
      return new AccountsError('WRONG_CURRENCY', `A transfer out of ${from.name} is in ${from.currency}.`);
    }
    if (from.currency === to.currency && toCents(entry.amount) !== toCents(entry.toAmount)) {
      return new AccountsError(
        'TRANSFER_AMOUNT_MISMATCH',
        'Between accounts in the same currency the two amounts must be equal.',
      );
    }
    return null;
  }

  const account = entry.accountId ? accounts.get(entry.accountId) : undefined;
  if (!account) {
    return new AccountsError('UNKNOWN_ACCOUNT', 'Choose an account.');
  }

  if (entry.type === 'adjustment') {
    if (!amountOk || toCents(entry.amount) === 0) {
      return new AccountsError('INVALID_AMOUNT', 'An adjustment cannot be zero.');
    }
  } else if (!amountOk || toCents(entry.amount) <= 0 || toCents(entry.amountETB) <= 0) {
    return new AccountsError('INVALID_AMOUNT', 'Amount must be greater than zero.');
  }

  // A foreign account only takes its own currency. An ETB account takes any listed currency for income/expense (converted to ETB).
  const mustMatch = account.currency !== BASE_CURRENCY || entry.type === 'opening' || entry.type === 'adjustment';
  if (mustMatch && entry.currency !== account.currency) {
    return new AccountsError('WRONG_CURRENCY', `${account.name} holds ${account.currency}, so this entry must be in ${account.currency}.`);
  }
  return null;
}

// A fee is an expense in the transfer's from-account that points back at the transfer (V2_SPEC Part B section 5).
function checkLinks(entries: AccountEntry[]): AccountsError | null {
  const transfers = new Map(entries.filter((entry) => entry.type === 'transfer').map((entry) => [entry.id, entry]));
  for (const entry of entries) {
    if (entry.linkedTransferId === null) {
      continue;
    }
    const transfer = transfers.get(entry.linkedTransferId);
    if (entry.type !== 'expense' || !transfer || transfer.fromAccountId !== entry.accountId) {
      return new AccountsError('INVALID_ENTRY', 'A fee must be an expense in the same account the linked transfer leaves.');
    }
  }
  return null;
}

// Validates the whole ledger: every row structurally, then the running balance of every account in date order (V2_SPEC Part E).
//
// Granularity is one calendar day: the owner only picks a date, so same-day rows have no meaningful order and each account is
// checked at the end of each day, not between rows of one day. Reserved goal money never blocks (utils/accounts/reserve.ts).
export function validateEntries(entries: AccountEntry[], accounts: MoneyAccount[]): AccountsError | null {
  const byId = mapAccounts(accounts);
  for (const entry of entries) {
    const problem = checkEntry(entry, byId);
    if (problem) {
      return problem;
    }
  }
  const linkProblem = checkLinks(entries);
  if (linkProblem) {
    return linkProblem;
  }

  const ordered = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const running = new Map<string, number>();

  for (let index = 0; index < ordered.length; index += 1) {
    const entry = ordered[index];
    for (const [accountId, cents] of entryEffects(entry, byId)) {
      running.set(accountId, (running.get(accountId) ?? 0) + cents);
    }

    const isLastOfDay = index === ordered.length - 1 || ordered[index + 1].date !== entry.date;
    if (!isLastOfDay) {
      continue;
    }
    for (const [accountId, cents] of running) {
      const account = byId.get(accountId);
      if (cents < 0 && account) {
        return new AccountsError(
          'NEGATIVE_BALANCE',
          `Not enough money in ${account.name}: short by ${account.currency} ${formatAmount(-cents / 100)} on ${entry.date}.`,
        );
      }
    }
  }
  return null;
}
