import { Goal, Transaction, TransferEndpoint } from '../types';
import { parseDateKey } from './dates';

export const HIDDEN_AMOUNT = '••••••••••';

export function formatNumber(value: number, fractionDigits = 2): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
}

export function formatETB(value: number): string {
  return `ETB ${formatNumber(value)}`;
}

// Transaction dates are local day keys; parse them as local, not UTC, before formatting.
export function formatDateKey(key: string): string {
  return parseDateKey(key).toLocaleDateString();
}

function endpointLabel(endpoint: TransferEndpoint | null, goalId: string | null, goals: Goal[]): string {
  if (endpoint === 'goal') {
    return goals.find((goal) => goal.id === goalId)?.name ?? 'Deleted goal';
  }
  return endpoint === 'saved' ? 'Saved' : 'Available';
}

// Row title: the category for income/expense, "From → To" for a transfer.
export function transactionTitle(transaction: Transaction, goals: Goal[]): string {
  if (transaction.type === 'transfer') {
    return `${endpointLabel(transaction.fromAccount, transaction.fromGoalId, goals)} → ${endpointLabel(transaction.toAccount, transaction.toGoalId, goals)}`;
  }
  return transaction.category;
}
