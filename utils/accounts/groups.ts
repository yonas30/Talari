import { AccountEntry, AccountGoal, AccountType, MoneyAccount } from '../../types/accounts';
import { entryEffects } from './balances';
import { fromCents, toCents } from './money';
import { AccountSummary, TotalsSummary } from './totals';

export const TYPE_ORDER: AccountType[] = ['cash', 'wallet', 'bank'];

export const TYPE_LABELS: Record<AccountType, string> = { cash: 'Cash', wallet: 'Wallet', bank: 'Bank' };

export interface AccountGroup {
  type: AccountType;
  label: string;
  accounts: AccountSummary[];
  // ETB value of the accounts in the group that can be valued.
  subtotalETB: number;
}

// Accounts grouped Cash / Wallet / Bank for Home and the Accounts screen (V2_SPEC Part H). A type with no accounts is left out.
export function groupAccounts(summaries: AccountSummary[]): AccountGroup[] {
  return TYPE_ORDER.flatMap((type) => {
    const accounts = summaries.filter((summary) => summary.account.type === type);
    if (accounts.length === 0) {
      return [];
    }
    const cents = accounts.reduce((sum, summary) => sum + (summary.valueETB === null ? 0 : toCents(summary.valueETB)), 0);
    return [{ type, label: TYPE_LABELS[type], accounts, subtotalETB: fromCents(cents) }];
  });
}

// The three subtotals on the Total Balance card; a type with no accounts is 0.
export function typeSubtotals(summaries: AccountSummary[]): Record<AccountType, number> {
  const groups = groupAccounts(summaries);
  return {
    cash: groups.find((group) => group.type === 'cash')?.subtotalETB ?? 0,
    wallet: groups.find((group) => group.type === 'wallet')?.subtotalETB ?? 0,
    bank: groups.find((group) => group.type === 'bank')?.subtotalETB ?? 0,
  };
}

// "Rate last updated X days ago", shown near the total when a foreign rate is more than 7 days old (V2_SPEC Part D). Null when none is.
export function staleRateNote(totals: Pick<TotalsSummary, 'staleRates'>): string | null {
  if (totals.staleRates.length === 0) {
    return null;
  }
  const oldest = Math.max(...totals.staleRates.map((rate) => rate.ageDays));
  return totals.staleRates.length === 1
    ? `Rate last updated ${oldest} days ago`
    : `Exchange rates last updated up to ${oldest} days ago`;
}

// A foreign account with no stored rate cannot be valued and is left out of the total; the screen says so instead of staying silent.
export function unvaluedNote(totals: TotalsSummary): string | null {
  if (totals.unvaluedAccountIds.length === 0) {
    return null;
  }
  const names = totals.accounts
    .filter((summary) => totals.unvaluedAccountIds.includes(summary.account.id))
    .map((summary) => summary.account.name);
  return `Not in the total (no exchange rate): ${names.join(', ')}`;
}

// What to show under an account's name: its type, or "Wallet · USD 45.00" for a foreign account.
export function accountSubtitle(summary: AccountSummary, formatNative: (value: number, currency: string) => string): string {
  const typeLabel = TYPE_LABELS[summary.account.type];
  return summary.account.currency === 'ETB' ? typeLabel : `${typeLabel} · ${formatNative(summary.balance, summary.account.currency)}`;
}

// "4,500 reserved for Car" on an account row: the reserved amount and, when one goal holds it, that goal's name. Null when nothing is
// reserved there.
export function reservedLabel(
  accountId: string,
  reserved: number,
  goals: AccountGoal[],
  goalAmounts: Record<string, number>,
  formatAmount: (value: number) => string,
): string | null {
  if (!(reserved > 0)) {
    return null;
  }
  const holding = goals.filter((goal) => goal.heldInAccountId === accountId && (goalAmounts[goal.id] ?? 0) > 0);
  return `${formatAmount(reserved)} reserved for ${holding.length === 1 ? holding[0].name : 'goals'}`;
}

// How much one ledger row moved ONE account, in that account's own currency (signed): + for money in, - for money out. Null when the
// row does not touch the account. Used by the account detail screen.
export function signedAmountFor(entry: AccountEntry, account: MoneyAccount): number | null {
  const effect = entryEffects(entry, new Map([[account.id, account]])).find(([id]) => id === account.id);
  return effect ? fromCents(effect[1]) : null;
}

// Whether a row touches an account at all (as income, expense, system row, or either side of a transfer).
export function touchesAccount(entry: AccountEntry, accountId: string): boolean {
  return entry.accountId === accountId || entry.fromAccountId === accountId || entry.toAccountId === accountId;
}

// The Accounts screen can be opened on one account type (a tap on a Cash / Wallet / Bank tile on Home passes it as a route param).
// Anything that is not exactly one of the three types means "no filter": a stale or hand-typed link shows every account.
export function parseTypeFilter(value: string | string[] | undefined): AccountType | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first === 'cash' || first === 'wallet' || first === 'bank' ? first : null;
}

// Where a Home tile leads: the Accounts screen on that type.
export function accountsRouteFor(type: AccountType) {
  return { pathname: '/accounts' as const, params: { type } };
}

// What a screen reader says for a Home tile: its name and subtotal (not read out while balances are hidden) and where it leads.
export function tileAccessibilityLabel(group: Pick<AccountGroup, 'label' | 'subtotalETB'>, hidden: boolean, formatAmount: (value: number) => string): string {
  return `${group.label}, ${hidden ? 'amount hidden' : formatAmount(group.subtotalETB)}. Opens your ${group.label.toLowerCase()} accounts.`;
}
