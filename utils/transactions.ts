import { ExchangeRate, Transaction, TransactionInput } from '../types';
import { assertValidLedger } from './balances';
import { toETB } from './currency';

function newId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Turns form input into a ledger row: converts to ETB once (Part D) and normalises the fields so a
// row only carries what its type uses (income/expense -> `account`; transfer -> from/to).
// Pass `existing` when editing so id / createdAt / timestamp stay put - the timestamp is the
// stable same-day ordering key and must not move on edit.
export function buildTransaction(
  input: TransactionInput,
  rates: ExchangeRate[],
  existing?: Transaction,
): Transaction {
  const amount = Number(input.amount);
  const { amountETB, rate } = toETB(amount, input.currency, rates, input.rateOverride);
  const now = new Date().toISOString();
  const isTransfer = input.type === 'transfer';

  return {
    id: existing?.id ?? newId(),
    type: input.type,
    amount,
    currency: input.currency,
    amountETB,
    exchangeRate: rate,
    // Transfers are not categorised and have no source/merchant.
    category: isTransfer ? '' : (input.category ?? '').trim(),
    source: isTransfer ? '' : (input.source ?? '').trim(),
    account: isTransfer ? null : (input.account ?? null),
    fromAccount: isTransfer ? (input.fromAccount ?? null) : null,
    fromGoalId: isTransfer && input.fromAccount === 'goal' ? (input.fromGoalId ?? null) : null,
    toAccount: isTransfer ? (input.toAccount ?? null) : null,
    toGoalId: isTransfer && input.toAccount === 'goal' ? (input.toGoalId ?? null) : null,
    date: input.date,
    timestamp: existing?.timestamp ?? now,
    note: input.note?.trim() ? input.note.trim() : null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

// The three ledger mutations as pure functions over the current ledger. The store calls these
// before touching SQLite, so the exact same code path is what the accounting tests exercise.
// Each throws a LedgerError (and the caller writes nothing) if the resulting ledger is invalid.

export function planAdd(
  ledger: Transaction[],
  input: TransactionInput,
  rates: ExchangeRate[],
  goalNames: Record<string, string> = {},
): Transaction {
  const transaction = buildTransaction(input, rates);
  assertValidLedger([...ledger, transaction], goalNames);
  return transaction;
}

export function planEdit(
  ledger: Transaction[],
  id: string,
  input: TransactionInput,
  rates: ExchangeRate[],
  goalNames: Record<string, string> = {},
): Transaction {
  const existing = ledger.find((item) => item.id === id);
  if (!existing) {
    throw new Error('Transaction not found');
  }

  // Keep the rate the transaction was originally entered at unless the user changes the currency
  // or supplies a new override - re-pricing with today's rate would silently rewrite history.
  const rateOverride = input.rateOverride ?? (existing.currency === input.currency ? existing.exchangeRate : null);
  const transaction = buildTransaction({ ...input, rateOverride }, rates, existing);
  assertValidLedger(
    ledger.map((item) => (item.id === id ? transaction : item)),
    goalNames,
  );
  return transaction;
}

export function planDelete(ledger: Transaction[], id: string, goalNames: Record<string, string> = {}): void {
  assertValidLedger(
    ledger.filter((item) => item.id !== id),
    goalNames,
  );
}
