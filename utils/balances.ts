import { Transaction, TransferEndpoint } from '../types';

// V2 Part C: Total / Available / Saved / each Goal are NEVER stored. They are derived here by
// summing the ledger (amountETB only - Part D). Edit = change one row, delete = drop one row;
// nothing is ever "reversed", so balances cannot drift.
//
// All arithmetic is done in integer cents so repeated sums never accumulate float error.

export type LedgerErrorCode =
  | 'INVALID_AMOUNT'
  | 'INVALID_ACCOUNT'
  | 'GOAL_EXPENSE'
  | 'SAME_ACCOUNT'
  | 'MISSING_GOAL'
  | 'NEGATIVE_BALANCE'
  | 'GOAL_HAS_FUNDS'
  | 'MISSING_RATE'
  | 'INVALID_RATE';

export class LedgerError extends Error {
  readonly code: LedgerErrorCode;

  constructor(code: LedgerErrorCode, message: string) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
  }
}

export type LedgerRow = Pick<
  Transaction,
  'id' | 'type' | 'amountETB' | 'account' | 'fromAccount' | 'fromGoalId' | 'toAccount' | 'toGoalId' | 'date' | 'createdAt'
>;

export interface Balances {
  total: number;
  available: number;
  saved: number;
  // Current amount per goal id (ETB). Includes goals that only appear in the ledger.
  goals: Record<string, number>;
}

type Bucket = string; // 'available' | 'saved' | `goal:<id>`

export const roundETB = (value: number): number => Math.round(value * 100) / 100;
const toCents = (value: number): number => Math.round(value * 100);

function endpointBucket(endpoint: TransferEndpoint | null, goalId: string | null): Bucket | null {
  if (endpoint === 'available' || endpoint === 'saved') {
    return endpoint;
  }
  if (endpoint === 'goal' && goalId) {
    return `goal:${goalId}`;
  }
  return null;
}

// The signed effect (in cents) a row has on each bucket. Assumes the row passed checkRow().
function effects(row: LedgerRow): Array<[Bucket, number]> {
  const cents = toCents(row.amountETB);

  if (row.type === 'income' && row.account) {
    return [[row.account, cents]];
  }
  if (row.type === 'expense' && row.account) {
    return [[row.account, -cents]];
  }
  if (row.type === 'transfer') {
    const from = endpointBucket(row.fromAccount, row.fromGoalId);
    const to = endpointBucket(row.toAccount, row.toGoalId);
    if (from && to) {
      return [
        [from, -cents],
        [to, cents],
      ];
    }
  }
  return [];
}

function sumBuckets(rows: LedgerRow[]): Map<Bucket, number> {
  const totals = new Map<Bucket, number>();
  for (const row of rows) {
    for (const [bucket, cents] of effects(row)) {
      totals.set(bucket, (totals.get(bucket) ?? 0) + cents);
    }
  }
  return totals;
}

export function getBalances(rows: LedgerRow[]): Balances {
  const totals = sumBuckets(rows);
  const goals: Record<string, number> = {};
  let goalCents = 0;

  for (const [bucket, cents] of totals) {
    if (bucket.startsWith('goal:')) {
      goals[bucket.slice(5)] = cents / 100;
      goalCents += cents;
    }
  }

  const availableCents = totals.get('available') ?? 0;
  const savedCents = totals.get('saved') ?? 0;

  return {
    available: availableCents / 100,
    saved: savedCents / 100,
    goals,
    total: (availableCents + savedCents + goalCents) / 100,
  };
}

// Net change (ETB) in Saved + Goals across the given rows - used for the monthly "savings" figure.
export function getNetSavingsChange(rows: LedgerRow[]): number {
  const totals = sumBuckets(rows);
  let cents = 0;
  for (const [bucket, value] of totals) {
    if (bucket !== 'available') {
      cents += value;
    }
  }
  return cents / 100;
}

// Structural rules that do not depend on the rest of the ledger (Part F).
function checkRow(row: LedgerRow): LedgerError | null {
  if (!Number.isFinite(row.amountETB) || toCents(row.amountETB) <= 0) {
    return new LedgerError('INVALID_AMOUNT', 'Amount must be greater than zero.');
  }

  if (row.type === 'income' || row.type === 'expense') {
    // Goal is not a legal value of the type, but guard against it at runtime (imports, bad callers).
    if ((row.account as string | null) === 'goal') {
      return new LedgerError(
        'GOAL_EXPENSE',
        'A goal cannot pay for an expense. Transfer the money out of the goal first.',
      );
    }
    if (row.account !== 'available' && row.account !== 'saved') {
      return new LedgerError('INVALID_ACCOUNT', 'Choose Available or Saved.');
    }
    return null;
  }

  if (!row.fromAccount || !row.toAccount) {
    return new LedgerError('INVALID_ACCOUNT', 'A transfer needs a From and a To.');
  }
  if (
    (row.fromAccount === 'goal' && !row.fromGoalId) ||
    (row.toAccount === 'goal' && !row.toGoalId)
  ) {
    return new LedgerError('MISSING_GOAL', 'Choose which goal this transfer involves.');
  }
  if (
    row.fromAccount === row.toAccount &&
    (row.fromAccount !== 'goal' || row.fromGoalId === row.toGoalId)
  ) {
    return new LedgerError('SAME_ACCOUNT', 'From and To cannot be the same.');
  }
  return null;
}

function bucketLabel(bucket: Bucket, goalNames: Record<string, string>): string {
  if (bucket === 'available') return 'Available';
  if (bucket === 'saved') return 'Saved';
  const id = bucket.slice(5);
  return goalNames[id] ? `the "${goalNames[id]}" goal` : 'a goal';
}

// Validates a whole ledger: every row structurally, then the running balance of every bucket in
// date order (V2 Part E, extended to edits / deletes / back-dated entries).
//
// Granularity is one calendar day: the user only picks a date, so same-day entries have no
// meaningful order and we check balances at the end of each day, not between rows of one day.
export function validateLedger(rows: LedgerRow[], goalNames: Record<string, string> = {}): LedgerError | null {
  for (const row of rows) {
    const problem = checkRow(row);
    if (problem) {
      return problem;
    }
  }

  const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const running = new Map<Bucket, number>();

  for (let index = 0; index < ordered.length; index += 1) {
    const row = ordered[index];
    for (const [bucket, cents] of effects(row)) {
      running.set(bucket, (running.get(bucket) ?? 0) + cents);
    }

    const isLastOfDay = index === ordered.length - 1 || ordered[index + 1].date !== row.date;
    if (!isLastOfDay) {
      continue;
    }

    for (const [bucket, cents] of running) {
      if (cents < 0) {
        const short = (-cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return new LedgerError(
          'NEGATIVE_BALANCE',
          `Not enough money: ${bucketLabel(bucket, goalNames)} would be short by ETB ${short} on ${row.date}.`,
        );
      }
    }
  }

  return null;
}

// Throws the first LedgerError, if any. Convenience for store/db write paths.
export function assertValidLedger(rows: LedgerRow[], goalNames: Record<string, string> = {}): void {
  const problem = validateLedger(rows, goalNames);
  if (problem) {
    throw problem;
  }
}
