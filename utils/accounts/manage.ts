import { accountColour, ACCOUNT_TYPES, BASE_CURRENCY } from '../../constants/accounts';
import { AccountEntry, AccountsState, AccountType, MoneyAccount } from '../../types/accounts';
import { getAccountBalances } from './balances';
import { Ctx, defaultCtx, todayOf } from './context';
import { AccountsError } from './errors';
import { convertToETB, toCents } from './money';
import { getReservedByAccount } from './reserve';

export interface AccountInput {
  name: string;
  type: AccountType;
  currency: string;
  // What is in it right now. Above zero it is saved as an `opening` entry.
  openingAmount: number;
  // Defaults to today.
  date?: string;
  smsSender?: string | null;
  lastDigits?: string | null;
}

// A foreign account is valued at today's stored rate, so one with no rate could not be valued and cannot be created or
// changed to (V2_SPEC Part B section 1).
function requireCurrency(state: AccountsState, currency: string): void {
  if (currency === BASE_CURRENCY) {
    return;
  }
  if (!state.currencies.includes(currency)) {
    throw new AccountsError('UNKNOWN_CURRENCY', `${currency} is not on your currency list. Add it under Currencies & Exchange Rates first.`);
  }
  convertToETB(1, currency, state.rates); // throws MISSING_RATE
}

export function planCreateAccount(
  state: AccountsState,
  input: AccountInput,
  ctx: Ctx = defaultCtx,
): { state: AccountsState; account: MoneyAccount; opening: AccountEntry | null } {
  const name = cleanAccountName(input.name);
  if (!name) {
    throw new AccountsError('INVALID_ACCOUNT', 'Give the account a name.');
  }
  const taken = accountNameProblem(state.accounts, name);
  if (taken) {
    throw new AccountsError('DUPLICATE_ACCOUNT_NAME', taken);
  }
  if (!ACCOUNT_TYPES.includes(input.type)) {
    throw new AccountsError('INVALID_ACCOUNT', 'Choose Cash, Wallet or Bank.');
  }
  if (!Number.isFinite(input.openingAmount) || toCents(input.openingAmount) < 0) {
    throw new AccountsError('INVALID_AMOUNT', 'What is in the account cannot be negative.');
  }
  requireCurrency(state, input.currency);

  const nowIso = ctx.now().toISOString();
  const account: MoneyAccount = {
    id: ctx.newId(),
    name,
    type: input.type,
    currency: input.currency,
    colour: accountColour(input.type),
    sortOrder: state.accounts.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1,
    archived: false,
    smsSender: cleanSmsSender(input.smsSender),
    lastDigits: cleanLastDigits(input.lastDigits),
    createdAt: nowIso,
  };

  let opening: AccountEntry | null = null;
  if (toCents(input.openingAmount) > 0) {
    const { amountETB, rate } = convertToETB(input.openingAmount, input.currency, state.rates);
    opening = {
      id: ctx.newId(),
      type: 'opening',
      accountId: account.id,
      amount: input.openingAmount,
      currency: input.currency,
      amountETB,
      exchangeRate: rate,
      category: '',
      source: '',
      fromAccountId: null,
      toAccountId: null,
      toAmount: null,
      toAmountETB: null,
      linkedTransferId: null,
      date: input.date ?? todayOf(ctx),
      timestamp: nowIso,
      note: null,
      isAutomatic: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }

  return {
    state: { ...state, accounts: [...state.accounts, account], entries: opening ? [...state.entries, opening] : state.entries },
    account,
    opening,
  };
}

function findAccount(state: AccountsState, accountId: string): MoneyAccount {
  const account = state.accounts.find((item) => item.id === accountId);
  if (!account) {
    throw new AccountsError('UNKNOWN_ACCOUNT', 'That account no longer exists.');
  }
  return account;
}

function touches(entry: AccountEntry, accountId: string): boolean {
  return entry.accountId === accountId || entry.fromAccountId === accountId || entry.toAccountId === accountId;
}

// Archiving hides an account and keeps its history. It is only allowed at exactly zero with nothing reserved in it, because
// a hidden account that still held money would make Total silently smaller.
export function planArchiveAccount(state: AccountsState, accountId: string): AccountsState {
  const account = findAccount(state, accountId);
  const balance = getAccountBalances(state.entries, state.accounts)[accountId] ?? 0;
  const reserved = getReservedByAccount(state.allocations)[accountId] ?? 0;
  if (toCents(balance) !== 0 || toCents(reserved) !== 0 || state.goals.some((goal) => goal.heldInAccountId === accountId)) {
    throw new AccountsError(
      'ACCOUNT_NOT_EMPTY',
      `${account.name} still holds money or goals. Move it out first; an account can only be archived when it is empty.`,
    );
  }
  return { ...state, accounts: state.accounts.map((item) => (item.id === accountId ? { ...item, archived: true } : item)) };
}

// An account with any entry cannot be deleted (archive it instead).
export function planDeleteAccount(state: AccountsState, accountId: string): AccountsState {
  const account = findAccount(state, accountId);
  if (state.entries.some((entry) => touches(entry, accountId))) {
    throw new AccountsError('ACCOUNT_HAS_ENTRIES', `${account.name} has transactions, so it cannot be deleted. Archive it to hide it.`);
  }
  if (state.goals.some((goal) => goal.heldInAccountId === accountId)) {
    throw new AccountsError('ACCOUNT_HAS_GOALS', `A goal is held in ${account.name}.`);
  }
  return { ...state, accounts: state.accounts.filter((item) => item.id !== accountId) };
}

// The currency is fixed once the account has any entry: its balance is a sum in that currency.
export function planChangeAccountCurrency(state: AccountsState, accountId: string, currency: string): AccountsState {
  const account = findAccount(state, accountId);
  if (state.entries.some((entry) => touches(entry, accountId))) {
    throw new AccountsError('ACCOUNT_HAS_ENTRIES', `${account.name} has transactions, so its currency can no longer change.`);
  }
  if (state.goals.some((goal) => goal.heldInAccountId === accountId) && currency !== BASE_CURRENCY) {
    throw new AccountsError('GOAL_NOT_ETB', 'A goal is held in this account, and goals can only be held in ETB.');
  }
  requireCurrency(state, currency);
  return { ...state, accounts: state.accounts.map((item) => (item.id === accountId ? { ...item, currency } : item)) };
}

// A currency can leave the Currencies & Exchange Rates list only when no account in use is held in it: that account's balance would be in
// a currency the app no longer knows and its ETB value would have no rate to follow. The message names the account(s).
//
// An ARCHIVED account does not block it. It is empty (an account can only be archived at exactly zero), hidden, and kept only for its
// history; its entries keep their own currency and amounts, and the stored rate is left in place, so nothing about it breaks. Blocking
// on it would force the owner to keep a currency they no longer use for as long as the history exists, and there is no way to unarchive.
export function checkCurrencyRemovable(accounts: MoneyAccount[], code: string): AccountsError | null {
  const using = accounts.filter((account) => !account.archived && account.currency === code);
  if (using.length === 0) {
    return null;
  }
  return new AccountsError(
    'CURRENCY_IN_USE',
    `${code} is used by ${using.map((account) => account.name).join(', ')}. Archive or delete ${using.length === 1 ? 'that account' : 'those accounts'} first.`,
  );
}

// ---- account names are unique ------------------------------------------------------------------------------------------------------
// Two accounts with the same name are indistinguishable in every chip, picker and list, so a name can only be used once. "The same" ignores
// case and leading, trailing and repeated spaces; archived accounts count (they still show up in history and backups).

// What is stored and compared: trimmed, with runs of spaces collapsed to one.
export function cleanAccountName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

const nameKey = (name: string): string => cleanAccountName(name).toLowerCase();

// "CBE 2" -> "CBE" and the number to start from, so a name that already ends in a small number is offered the NEXT one.
function splitTrailingNumber(name: string): string {
  const match = /^(.*\S)\s+(\d{1,2})$/.exec(name);
  return match ? match[1] : name;
}

// The first "<name> 2", "<name> 3", ... that no OTHER account has.
export function suggestAccountName(accounts: MoneyAccount[], name: string, renamingId?: string): string {
  const base = splitTrailingNumber(cleanAccountName(name));
  const used = new Set(accounts.filter((account) => account.id !== renamingId).map((account) => nameKey(account.name)));
  let number = 2;
  while (used.has(nameKey(`${base} ${number}`))) {
    number += 1;
  }
  return `${base} ${number}`;
}

// The message to show when `name` cannot be used, or null when it can. Used by the pure planners AND by the forms (live, under the name field).
//  - `renamingId`: the account being renamed. It never clashes with itself, and a rename that keeps its name (apart from case and spaces)
//    is never refused, even if an older duplicate of that name already exists: a rename must not CREATE a new collision, but accounts
//    that were already duplicates (from earlier testing) keep loading and working, and can be renamed to any free name.
//  - an empty name is not a duplicate of anything; the "give it a name" check is separate.
export function accountNameProblem(accounts: MoneyAccount[], name: string, renamingId?: string): string | null {
  const key = nameKey(name);
  if (key === '') {
    return null;
  }
  const self = renamingId ? accounts.find((account) => account.id === renamingId) : undefined;
  if (self && nameKey(self.name) === key) {
    return null;
  }
  const clash = accounts.find((account) => account.id !== renamingId && nameKey(account.name) === key);
  if (!clash) {
    return null;
  }
  return `You already have an account called ${clash.name}. Try ${suggestAccountName(accounts, name, renamingId)}.`;
}

// Renaming changes only the name: the account keeps its id, so every entry, goal and rule that points at it is untouched.
export function planRenameAccount(state: AccountsState, accountId: string, name: string): AccountsState {
  const account = findAccount(state, accountId);
  const cleaned = cleanAccountName(name);
  if (!cleaned) {
    throw new AccountsError('INVALID_ACCOUNT', 'Give the account a name.');
  }
  const taken = accountNameProblem(state.accounts, cleaned, accountId);
  if (taken) {
    throw new AccountsError('DUPLICATE_ACCOUNT_NAME', taken);
  }
  return { ...state, accounts: state.accounts.map((item) => (item.id === account.id ? { ...item, name: cleaned } : item)) };
}

// The optional SMS link of an account (V2_SPEC Part Z): who the messages come from ("127", "CBE") and the last digits of the account.
// Digits only and at most four, because that is all a message ever prints; empty means none.
export const MAX_SMS_SENDER_LENGTH = 40;

export function cleanSmsSender(value: string | null | undefined): string | null {
  const cleaned = (value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_SMS_SENDER_LENGTH);
  return cleaned === '' ? null : cleaned;
}

export function cleanLastDigits(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '').slice(0, 4);
  return digits === '' ? null : digits;
}

// Changes only the two SMS fields: the account keeps its id, name, balance and history.
export function planUpdateAccountSms(state: AccountsState, accountId: string, input: { smsSender: string | null; lastDigits: string | null }): AccountsState {
  const account = findAccount(state, accountId);
  const next = { ...account, smsSender: cleanSmsSender(input.smsSender), lastDigits: cleanLastDigits(input.lastDigits) };
  return { ...state, accounts: state.accounts.map((item) => (item.id === account.id ? next : item)) };
}
