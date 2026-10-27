import { BASE_CURRENCY } from '../../constants/accounts';
import { FEES_CATEGORY } from '../../constants/categories';
import { AccountEntry, AccountsState, DateSource, MoneyAccount } from '../../types/accounts';
import { mapAccounts, validateEntries } from './balances';
import { Ctx, defaultCtx } from './context';
import { AccountsError } from './errors';
import { convertToETB, round2, toCents } from './money';
import { enforceReserved, WriteResult } from './reserve';

// What the owner enters. A transfer carries its optional fee; the fee becomes its own linked expense row.
export type EntryInput =
  | {
      type: 'income' | 'expense';
      accountId: string;
      amount: number;
      currency: string;
      // Per-entry override of the stored rate (X -> ETB). Never written back to the rate table.
      rateOverride?: number | null;
      category: string;
      source?: string;
      date: string;
      note?: string | null;
      isAutomatic?: boolean;
      // An import from an SMS: where the date came from, and the time the message printed (a UTC ISO string) so same-day entries keep the
      // order they happened in. Both optional; a manual entry sets neither.
      dateSource?: DateSource | null;
      timestamp?: string | null;
    }
  | {
      type: 'transfer';
      fromAccountId: string;
      toAccountId: string;
      fromAmount: number;
      toAmount: number;
      // In ETB or the from-account's currency.
      fee?: { amount: number; currency: string } | null;
      date: string;
      note?: string | null;
      // A transfer imported from paired messages (V2_SPEC Part Z): where its date came from and the time a message printed. Optional.
      dateSource?: DateSource | null;
      timestamp?: string | null;
    }
  | {
      type: 'adjustment';
      accountId: string;
      // Signed and non-zero.
      amount: number;
      date: string;
      note?: string | null;
    };

interface Built {
  main: AccountEntry;
  fee: AccountEntry | null;
}

function usableAccount(accounts: Map<string, MoneyAccount>, id: string): MoneyAccount {
  const account = accounts.get(id);
  if (!account) {
    throw new AccountsError('UNKNOWN_ACCOUNT', 'Choose an account.');
  }
  if (account.archived) {
    throw new AccountsError('ACCOUNT_ARCHIVED', `${account.name} is archived, so nothing can be added to it.`);
  }
  return account;
}

function requirePositive(amount: number): void {
  if (!Number.isFinite(amount) || toCents(amount) <= 0) {
    throw new AccountsError('INVALID_AMOUNT', 'Amount must be greater than zero.');
  }
}

// The date source an entry ends up with. An explicit one in the input wins (null clears it). Otherwise an edit keeps the existing source,
// unless the DATE was changed: then it is the owner's own date now ('manual'), so an estimate stops being shown as one.
function dateSourceFor(input: EntryInput, existing?: AccountEntry): { dateSource?: DateSource } {
  const explicit = 'dateSource' in input ? input.dateSource : undefined;
  const source: DateSource | null | undefined =
    explicit !== undefined ? explicit : existing?.dateSource ? (input.date !== existing.date ? 'manual' : existing.dateSource) : undefined;
  return source ? { dateSource: source } : {};
}

// Turns what the owner entered into ledger rows. Converts to ETB once, at entry time (V2_SPEC Part D). When editing, id / createdAt /
// timestamp stay put: the timestamp is the stable same-day ordering key and must not move on edit.
function buildEntries(input: EntryInput, state: AccountsState, ctx: Ctx, existing?: AccountEntry, existingFee?: AccountEntry): Built {
  const accounts = mapAccounts(state.accounts);
  const nowIso = ctx.now().toISOString();
  const id = existing?.id ?? ctx.newId();
  const base = {
    id,
    source: '',
    category: '',
    fromAccountId: null,
    toAccountId: null,
    toAmount: null,
    toAmountETB: null,
    linkedTransferId: null,
    note: null,
    isAutomatic: existing?.isAutomatic ?? false,
    timestamp: existing?.timestamp ?? nowIso,
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  } as const;

  // Written as two "not" checks so TypeScript narrows the union (its first member has a two-value `type`).
  if (input.type !== 'transfer' && input.type !== 'adjustment') {
    const account = usableAccount(accounts, input.accountId);
    requirePositive(input.amount);
    if (account.currency !== BASE_CURRENCY && input.currency !== account.currency) {
      throw new AccountsError('WRONG_CURRENCY', `${account.name} holds ${account.currency}, so enter this in ${account.currency}.`);
    }
    // An edit keeps the rate the entry was made at unless the currency changes or a new override is given: re-pricing with today's
    // rate would silently rewrite history.
    const keptRate =
      input.rateOverride ??
      (existing && existing.type !== 'transfer' && existing.currency === input.currency && input.currency !== BASE_CURRENCY ? existing.exchangeRate : null);
    const { amountETB, rate } = convertToETB(input.amount, input.currency, state.rates, keptRate);
    return {
      main: {
        ...base,
        type: input.type,
        accountId: account.id,
        amount: input.amount,
        currency: input.currency,
        amountETB,
        exchangeRate: rate,
        category: input.category.trim(),
        source: (input.source ?? '').trim(),
        date: input.date,
        note: input.note?.trim() ? input.note.trim() : null,
        isAutomatic: existing?.isAutomatic ?? input.isAutomatic ?? false,
        // A time printed in an imported message orders it within its day; an edit never moves an existing timestamp.
        timestamp: existing?.timestamp ?? input.timestamp ?? nowIso,
        ...dateSourceFor(input, existing),
      },
      fee: null,
    };
  }

  if (input.type === 'adjustment') {
    const account = usableAccount(accounts, input.accountId);
    if (!Number.isFinite(input.amount) || toCents(input.amount) === 0) {
      throw new AccountsError('INVALID_AMOUNT', 'An adjustment cannot be zero.');
    }
    const { amountETB, rate } = convertToETB(input.amount, account.currency, state.rates);
    return {
      main: {
        ...base,
        type: 'adjustment',
        accountId: account.id,
        amount: input.amount,
        currency: account.currency,
        amountETB,
        exchangeRate: rate,
        date: input.date,
        note: input.note?.trim() ? input.note.trim() : null,
        ...dateSourceFor(input, existing),
      },
      fee: null,
    };
  }

  // transfer
  const from = usableAccount(accounts, input.fromAccountId);
  const to = usableAccount(accounts, input.toAccountId);
  if (from.id === to.id) {
    throw new AccountsError('SAME_ACCOUNT', 'From and To cannot be the same account.');
  }
  requirePositive(input.fromAmount);
  requirePositive(input.toAmount);
  if (from.currency === to.currency && toCents(input.fromAmount) !== toCents(input.toAmount)) {
    throw new AccountsError('TRANSFER_AMOUNT_MISMATCH', 'Between accounts in the same currency the two amounts must be equal.');
  }

  // Each leg is converted at the rate on the transfer date. When the currencies differ the ETB total can move; that gap is the
  // exchange cost, not income or expense (V2_SPEC Part B section 5).
  const fromLeg = convertToETB(input.fromAmount, from.currency, state.rates);
  const toLeg = convertToETB(input.toAmount, to.currency, state.rates);
  const main: AccountEntry = {
    ...base,
    type: 'transfer',
    accountId: null,
    amount: input.fromAmount,
    currency: from.currency,
    amountETB: fromLeg.amountETB,
    exchangeRate: fromLeg.rate,
    fromAccountId: from.id,
    toAccountId: to.id,
    toAmount: input.toAmount,
    toAmountETB: toLeg.amountETB,
    date: input.date,
    note: input.note?.trim() ? input.note.trim() : null,
    timestamp: existing?.timestamp ?? input.timestamp ?? nowIso,
    ...dateSourceFor(input, existing),
  };

  const fee = input.fee && Number.isFinite(input.fee.amount) && input.fee.amount !== 0 ? input.fee : null;
  if (!fee) {
    return { main, fee: null };
  }
  requirePositive(fee.amount);

  let feeNative = fee.amount;
  let feeETB: number;
  let feeRate: number;
  if (fee.currency === from.currency) {
    ({ amountETB: feeETB, rate: feeRate } = convertToETB(fee.amount, from.currency, state.rates));
  } else if (fee.currency === BASE_CURRENCY) {
    // A fee typed in ETB for a foreign account is converted back to the account's currency at the stored rate for that date.
    const { rate } = convertToETB(1, from.currency, state.rates);
    feeNative = round2(fee.amount / rate);
    feeETB = round2(fee.amount);
    feeRate = rate;
    requirePositive(feeNative);
  } else {
    throw new AccountsError('WRONG_CURRENCY', `A fee is entered in ETB or in ${from.currency}.`);
  }

  return {
    main,
    fee: {
      ...base,
      id: existingFee?.id ?? ctx.newId(),
      timestamp: existingFee?.timestamp ?? main.timestamp,
      createdAt: existingFee?.createdAt ?? nowIso,
      type: 'expense',
      accountId: from.id,
      amount: feeNative,
      currency: from.currency,
      amountETB: feeETB,
      exchangeRate: feeRate,
      category: FEES_CATEGORY.name,
      linkedTransferId: main.id,
      date: input.date,
      note: null,
      // The fee happened with its transfer, so it shares its date source.
      ...(main.dateSource ? { dateSource: main.dateSource } : {}),
    },
  };
}

// Validates the whole resulting ledger, then settles reserved goal money. Nothing is written by the caller unless this returns.
function commit(next: AccountsState, ctx: Ctx): WriteResult {
  const problem = validateEntries(next.entries, next.accounts);
  if (problem) {
    throw problem;
  }
  return enforceReserved(next, ctx);
}

function guardAnyAccount(state: AccountsState): void {
  if (state.accounts.filter((account) => !account.archived).length === 0) {
    throw new AccountsError('NO_ACCOUNTS', 'Add an account before recording transactions.');
  }
}

// The three ledger mutations as pure functions over the current state (same shape as planAdd / planEdit / planDelete in the old
// model). Each throws an AccountsError, and the caller writes nothing, if the resulting ledger is invalid. They are also the
// preview: plan without persisting to show the "uses reserved money" warning.

export function planAddEntry(state: AccountsState, input: EntryInput, ctx: Ctx = defaultCtx): WriteResult {
  guardAnyAccount(state);
  const { main, fee } = buildEntries(input, state, ctx);
  return commit({ ...state, entries: [...state.entries, main, ...(fee ? [fee] : [])] }, ctx);
}

// Several entries as ONE write: every row is built, then the whole resulting ledger is validated and settled once. An import that saves a
// payment and its fee uses this, so the two stand or fall together (a fee that overdraws the account blocks the payment too) and the
// caller writes both in a single database transaction. `added` lists the new rows in input order (a transfer's own fee row follows it).
export function planAddEntries(state: AccountsState, inputs: EntryInput[], ctx: Ctx = defaultCtx): WriteResult & { added: AccountEntry[] } {
  guardAnyAccount(state);
  if (inputs.length === 0) {
    throw new AccountsError('INVALID_ENTRY', 'Nothing to add.');
  }
  const added: AccountEntry[] = [];
  for (const input of inputs) {
    const { main, fee } = buildEntries(input, state, ctx);
    added.push(main);
    if (fee) {
      added.push(fee);
    }
  }
  return { ...commit({ ...state, entries: [...state.entries, ...added] }, ctx), added };
}

export function planEditEntry(state: AccountsState, id: string, input: EntryInput, ctx: Ctx = defaultCtx): WriteResult {
  const existing = state.entries.find((entry) => entry.id === id);
  if (!existing) {
    throw new AccountsError('INVALID_ENTRY', 'Transaction not found.');
  }
  if (existing.linkedTransferId !== null) {
    throw new AccountsError('FEE_LINKED', 'A transfer fee is changed by editing its transfer.');
  }
  if (existing.type === 'opening') {
    throw new AccountsError('INVALID_ENTRY', 'An opening balance is changed with an adjustment.');
  }
  if ((existing.type === 'adjustment') !== (input.type === 'adjustment')) {
    throw new AccountsError('INVALID_ENTRY', 'An adjustment stays an adjustment.');
  }

  const existingFee = state.entries.find((entry) => entry.linkedTransferId === id);
  const { main, fee } = buildEntries(input, state, ctx, existing, existingFee);

  // The edited row keeps its place; its fee row (changed, created or removed) follows it.
  const entries: AccountEntry[] = [];
  for (const entry of state.entries) {
    if (entry.linkedTransferId === id) {
      continue;
    }
    if (entry.id === id) {
      entries.push(main);
      if (fee) {
        entries.push(fee);
      }
    } else {
      entries.push(entry);
    }
  }
  return commit({ ...state, entries }, ctx);
}

export function planDeleteEntry(state: AccountsState, id: string, ctx: Ctx = defaultCtx): WriteResult {
  const existing = state.entries.find((entry) => entry.id === id);
  if (!existing) {
    throw new AccountsError('INVALID_ENTRY', 'Transaction not found.');
  }
  if (existing.linkedTransferId !== null) {
    throw new AccountsError('FEE_LINKED', 'A transfer fee is removed by editing or deleting its transfer.');
  }
  return commit({ ...state, entries: state.entries.filter((entry) => entry.id !== id && entry.linkedTransferId !== id) }, ctx);
}

// "Date is right": the owner has looked at an imported entry's date and agrees with it, so it stops being shown as an estimate. Only the
// label changes; no amount, date or balance does, so there is nothing to re-validate.
export function planConfirmEntryDate(state: AccountsState, id: string): AccountsState {
  const existing = state.entries.find((entry) => entry.id === id);
  if (!existing) {
    throw new AccountsError('INVALID_ENTRY', 'Transaction not found.');
  }
  return { ...state, entries: state.entries.map((entry) => (entry.id === id ? { ...entry, dateSource: 'manual' as const } : entry)) };
}
