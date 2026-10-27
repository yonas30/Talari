import { BASE_CURRENCY, accountColour } from '../../constants/accounts';
import { FEES_CATEGORY, UNCATEGORISED_EXPENSE, UNCATEGORISED_INCOME } from '../../constants/categories';
import { Budget, Category, ExchangeRate, GoalStatus } from '../../types';
import {
  AccountEntry,
  AccountGoal,
  AccountsState,
  GoalAllocation,
  MoneyAccount,
  ReserveNotification,
} from '../../types/accounts';
import { DATE_SOURCES } from '../../types/accounts';
import { SmsSuggestion } from '../../types/sms';
import { HandledRecord, readHandledRecords, restoredSuggestions, toHandledRecords } from '../sms/handledBackup';
import { MAX_OWN_NAME_LENGTH, MAX_OWN_NAMES, cleanOwnNameInput, normaliseOwnName } from '../sms/ownNames';
import { getAccountBalances, validateEntries } from './balances';
import { pruneExpired } from './notificationRetention';
import { Ctx, defaultCtx } from './context';
import { AccountsError } from './errors';
import { formatAmount, toCents } from './money';
import { getGoalAmounts, getReservedByAccount } from './reserve';

// Backup version 3 (V2_SPEC Part W tests 24 and 25). Version 2 backed up categories, transactions, exchange rates, goals and budgets;
// version 3 adds only what the accounts design needs: the accounts, the goal allocations and the stored notifications.
export interface BackupV3 {
  version: 3;
  exportedAt: string;
  categories: Category[];
  accounts: MoneyAccount[];
  transactions: AccountEntry[];
  exchangeRates: ExchangeRate[];
  goals: AccountGoal[];
  goalAllocations: GoalAllocation[];
  budgets: Budget[];
  notifications: ReserveNotification[];
}

// Version 4 (Phase 6D-1): version 3 plus the handled messages (hashes and a few figures, never message text; see utils/sms/handledBackup.ts).
export interface BackupV4 extends Omit<BackupV3, 'version'> {
  version: 4;
  handledMessages: HandledRecord[];
  // The owner's own names as banks write them (Phase 6D-3): personal data, so the file is private. Optional: a backup without it leaves the
  // device's names as they are, and no version change was needed.
  ownNames?: string[];
}

// The old payload, as the Available / Saved build wrote it. These shapes exist only to read such a file; the app no longer has the
// Available / Saved model.
export interface LegacyTransaction {
  id: string;
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  currency: string;
  amountETB: number;
  exchangeRate: number;
  category: string;
  source: string;
  account: 'available' | 'saved' | null;
  fromAccount: 'available' | 'saved' | 'goal' | null;
  fromGoalId: string | null;
  toAccount: 'available' | 'saved' | 'goal' | null;
  toGoalId: string | null;
  date: string;
  timestamp: string;
  note: string | null;
  isAutomatic?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LegacyGoal {
  id: string;
  name: string;
  targetAmount: number;
  deadline: string | null;
  status?: GoalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface LegacyBackupV2 {
  version: 2;
  exportedAt: string;
  categories: Category[];
  transactions: LegacyTransaction[];
  exchangeRates: ExchangeRate[];
  goals: LegacyGoal[];
  budgets: Budget[];
}

export interface RestoreResult {
  backup: BackupV3;
  // Shown to the owner after a restore. For an old backup it says exactly how the data was mapped.
  message: string;
  // The message rows a restore writes in the same transaction, replacing the device's confirmed and skipped ones. null for an older backup
  // (version 3 or 2): those carry none, so the device's handled messages are left exactly as they are.
  handled: SmsSuggestion[] | null;
  // The owner's names a restore writes, replacing the device's. null: the backup carries none (an older one), so the device's stay.
  ownNames: string[] | null;
}

export function createBackupV3(source: { categories: Category[]; budgets: Budget[]; state: AccountsState }, now: Date = new Date()): BackupV3 {
  const { state } = source;
  return {
    version: 3,
    exportedAt: now.toISOString(),
    categories: source.categories,
    accounts: state.accounts,
    transactions: state.entries,
    exchangeRates: state.rates,
    goals: state.goals,
    goalAllocations: state.allocations,
    budgets: source.budgets,
    notifications: state.notifications,
  };
}

// What an export writes: the ledger as version 3 does, and the messages the owner has handled (confirmed or skipped) as hashes with a few figures.
export function createBackupV4(source: { categories: Category[]; budgets: Budget[]; state: AccountsState; suggestions: SmsSuggestion[]; ownNames?: string[] }, now: Date = new Date()): BackupV4 {
  const { version: _version, ...ledger } = createBackupV3(source, now);
  void _version;
  return { version: 4, ...ledger, handledMessages: toHandledRecords(source.suggestions), ownNames: source.ownNames ?? [] };
}

function fail(message: string): never {
  throw new AccountsError('RESTORE_FAILED', message);
}

function withFees(categories: Category[]): Category[] {
  // The legacy 'savings' classification has no meaning any more, so it is not restored.
  const kept = categories.filter((item) => item.type !== 'savings');
  // The built-in categories always exist after a restore, whatever the file holds: Fees (transfer fees) and the two Uncategorised ones
  // (the default for an imported message). An older backup was made before the latter existed.
  const has = (category: Category) => kept.some((item) => item.type === category.type && item.name === category.name);
  return [...kept, ...[FEES_CATEGORY, UNCATEGORISED_INCOME, UNCATEGORISED_EXPENSE].filter((category) => !has(category))];
}

// An entry's date source is optional: a backup without it restores with none, and a value this app does not know is dropped.
function cleanDateSources(entries: AccountEntry[]): AccountEntry[] {
  return entries.map((entry) => {
    const source = (entry as { dateSource?: unknown }).dateSource;
    if (source === undefined || (typeof source === 'string' && (DATE_SOURCES as readonly string[]).includes(source))) {
      return entry;
    }
    const { dateSource: _dropped, ...rest } = entry as AccountEntry & { dateSource?: unknown };
    void _dropped;
    return rest as AccountEntry;
  });
}

// Never restores a ledger that breaks an invariant: valid rows, no account below zero, every allocation pointing at a real goal in
// its own ETB account, no goal below zero, and nothing reserved beyond what the account holds.
function checkInvariants(state: AccountsState): string | null {
  const problem = validateEntries(state.entries, state.accounts);
  if (problem) {
    return problem.message;
  }
  const accounts = new Map(state.accounts.map((account) => [account.id, account]));
  const goals = new Map(state.goals.map((goal) => [goal.id, goal]));

  for (const goal of state.goals) {
    const account = accounts.get(goal.heldInAccountId);
    if (!account || account.currency !== BASE_CURRENCY) {
      return `The goal "${goal.name}" is not held in an ETB account.`;
    }
  }
  for (const row of state.allocations) {
    const goal = goals.get(row.goalId);
    if (!goal || goal.heldInAccountId !== row.accountId) {
      return 'A goal allocation points at a goal or account that is not in this backup.';
    }
  }
  for (const [goalId, amount] of Object.entries(getGoalAmounts(state.allocations))) {
    if (toCents(amount) < 0) {
      return `The goal "${goals.get(goalId)?.name ?? ''}" would hold less than zero.`;
    }
  }
  const balances = getAccountBalances(state.entries, state.accounts);
  for (const [accountId, reserved] of Object.entries(getReservedByAccount(state.allocations))) {
    if (toCents(reserved) > toCents(balances[accountId] ?? 0)) {
      return `Your goals hold ETB ${formatAmount(reserved)} in ${accounts.get(accountId)?.name ?? 'an account'}, but it only has ETB ${formatAmount(balances[accountId] ?? 0)}.`;
    }
  }
  return null;
}

function restoreV3(payload: BackupV3, now: Date): RestoreResult {
  const lists = [payload.categories, payload.accounts, payload.transactions, payload.exchangeRates, payload.goals, payload.goalAllocations, payload.budgets, payload.notifications];
  if (!lists.every(Array.isArray)) {
    fail('This file does not look like a valid backup.');
  }
  const problem = checkInvariants({
    accounts: payload.accounts,
    entries: payload.transactions,
    goals: payload.goals,
    allocations: payload.goalAllocations,
    notifications: payload.notifications,
    rates: payload.exchangeRates,
    currencies: [],
  });
  if (problem) {
    fail(`This backup cannot be restored. ${problem} Nothing was changed.`);
  }
  // Notifications older than the retention are dropped, as they would be on the next app load anyway.
  return {
    backup: { ...payload, transactions: cleanDateSources(payload.transactions), categories: withFees(payload.categories), notifications: pruneExpired(payload.notifications, now) },
    message: 'Your data has been restored from the backup.',
    handled: null,
    ownNames: null,
  };
}

// An old backup has no accounts, so everything lands in ONE ETB account called "Cash" (V2_SPEC Part W test 25):
//  - income and expenses keep their rows (a foreign amount keeps its original amount, currency and rate; Cash is an ETB account, so it
//    moves by the ETB value);
//  - transfers between Available and Saved are left out: both sides are now the same account, and they never changed the total;
//  - a transfer into or out of a goal becomes a goal allocation held in Cash, so each goal is restored as reserved money.
// If the goals would hold more than Cash does, the restore fails and changes nothing.
function mapLegacyV2(payload: LegacyBackupV2, ctx: Ctx): RestoreResult {
  if (![payload.transactions, payload.goals, payload.categories, payload.exchangeRates, payload.budgets].every(Array.isArray)) {
    fail('This file does not look like a valid backup.');
  }

  const nowIso = ctx.now().toISOString();
  const cash: MoneyAccount = {
    id: 'account-cash',
    name: 'Cash',
    type: 'cash',
    currency: BASE_CURRENCY,
    colour: accountColour('cash'),
    sortOrder: 0,
    archived: false,
    smsSender: null,
    lastDigits: null,
    createdAt: nowIso,
  };

  const goalIds = new Set(payload.goals.map((goal) => goal.id));
  const ordered = [...payload.transactions].sort((a, b) => a.date.localeCompare(b.date) || a.timestamp.localeCompare(b.timestamp));
  const entries: AccountEntry[] = [];
  const allocations: GoalAllocation[] = [];
  let skippedTransfers = 0;

  for (const row of ordered) {
    if (row.type === 'income' || row.type === 'expense') {
      entries.push({
        id: row.id,
        type: row.type,
        accountId: cash.id,
        amount: row.amount,
        currency: row.currency,
        amountETB: row.amountETB,
        exchangeRate: row.exchangeRate,
        category: row.category,
        source: row.source,
        fromAccountId: null,
        toAccountId: null,
        toAmount: null,
        toAmountETB: null,
        linkedTransferId: null,
        date: row.date,
        timestamp: row.timestamp,
        note: row.note,
        isAutomatic: row.isAutomatic ?? false,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
      continue;
    }

    const legs: Array<[string, number]> = [];
    if (row.fromAccount === 'goal' && row.fromGoalId) {
      legs.push([row.fromGoalId, -row.amountETB]);
    }
    if (row.toAccount === 'goal' && row.toGoalId) {
      legs.push([row.toGoalId, row.amountETB]);
    }
    if (legs.length === 0) {
      skippedTransfers += 1; // Available <-> Saved
      continue;
    }
    for (const [goalId, amount] of legs) {
      if (!goalIds.has(goalId)) {
        fail('This backup cannot be restored. A transfer refers to a goal that is not in the backup. Nothing was changed.');
      }
      allocations.push({
        id: `${row.id}:${amount < 0 ? 'out' : 'in'}`,
        goalId,
        accountId: cash.id,
        amount,
        date: row.date,
        kind: 'manual',
        createdAt: row.timestamp || row.createdAt,
      });
    }
  }

  const goals: AccountGoal[] = payload.goals.map((goal) => ({
    id: goal.id,
    name: goal.name,
    targetAmount: goal.targetAmount,
    deadline: goal.deadline ?? null,
    status: goal.status ?? 'active',
    heldInAccountId: cash.id,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
  }));

  const state: AccountsState = {
    accounts: [cash],
    entries,
    goals,
    allocations,
    notifications: [],
    rates: payload.exchangeRates,
    currencies: [],
  };

  // The explicit goals-versus-total check, with the figures, before the general invariants.
  const balance = getAccountBalances(entries, [cash])[cash.id] ?? 0;
  const reserved = getReservedByAccount(allocations)[cash.id] ?? 0;
  if (toCents(reserved) > toCents(balance)) {
    fail(`This backup cannot be restored. Your goals hold ETB ${formatAmount(reserved)}, but the backup's total balance is only ETB ${formatAmount(balance)}. Nothing was changed.`);
  }
  const problem = checkInvariants(state);
  if (problem) {
    fail(`This backup cannot be restored. ${problem} Nothing was changed.`);
  }

  const goalCount = goals.length;
  const message = [
    'Restored from an older backup.',
    `Accounts did not exist then, so everything was put into one account called "Cash" (ETB): ${entries.length} income and expense ${entries.length === 1 ? 'entry' : 'entries'}, with a balance of ETB ${formatAmount(balance)}.`,
    goalCount > 0
      ? `Each of your ${goalCount} ${goalCount === 1 ? 'goal' : 'goals'} is now money reserved inside Cash (ETB ${formatAmount(reserved)} in total).`
      : 'You had no goals.',
    skippedTransfers > 0
      ? `${skippedTransfers} ${skippedTransfers === 1 ? 'transfer' : 'transfers'} between Available and Saved ${skippedTransfers === 1 ? 'was' : 'were'} left out, because both sides are now the same account and the total did not change.`
      : '',
    'You can now add your real accounts and move money between them.',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    backup: {
      version: 3,
      exportedAt: nowIso,
      categories: withFees(payload.categories),
      accounts: state.accounts,
      transactions: entries,
      exchangeRates: payload.exchangeRates,
      goals,
      goalAllocations: allocations,
      budgets: payload.budgets,
      notifications: [],
    },
    message,
    handled: null,
    ownNames: null,
  };
}

// The optional list of the owner's names in a version 4 backup. A list that is not a list of texts, or too long, is refused; texts are tidied the
// way a typed name is, and a name that is the same as an earlier one (ignoring case and spacing) is dropped.
function readOwnNamesList(raw: unknown): string[] | string {
  if (!Array.isArray(raw) || raw.length > MAX_OWN_NAMES * 5) {
    return 'The list of your names in this backup is damaged.';
  }
  const names: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string' || item.length > MAX_OWN_NAME_LENGTH * 4) {
      return 'A name in this backup is damaged.';
    }
    const text = cleanOwnNameInput(item);
    const key = text === null ? '' : normaliseOwnName(text);
    if (text === null || key === '') {
      return 'A name in this backup is empty.';
    }
    if (!seen.has(key)) {
      seen.add(key);
      names.push(text);
    }
  }
  return names.length > MAX_OWN_NAMES ? `This backup has more than ${MAX_OWN_NAMES} names.` : names;
}

// Version 4: the ledger is checked exactly as version 3 is, and the handled list is read strictly (a damaged file is refused, nothing written).
// A confirmed message whose entry is not in the restored ledger is kept as skipped, so it can never hide a message that has no entry.
function restoreV4(payload: BackupV4, ctx: Ctx): RestoreResult {
  const { handledMessages, ownNames: rawNames, version: _version, ...ledger } = payload;
  void _version;
  const records = readHandledRecords(handledMessages);
  if (typeof records === 'string') {
    fail(`This backup cannot be restored. ${records} Nothing was changed.`);
  }
  const names = rawNames === undefined ? null : readOwnNamesList(rawNames);
  if (typeof names === 'string') {
    fail(`This backup cannot be restored. ${names} Nothing was changed.`);
  }
  const restored = restoreV3({ version: 3, ...ledger }, ctx.now());
  const result = restoredSuggestions(records, new Set(restored.backup.transactions.map((entry) => entry.id)), ctx.now().toISOString());
  const count = result.rows.length;
  const note = count === 0 ? 'The backup had no handled messages.' : `${count} handled ${count === 1 ? 'message' : 'messages'} restored (${result.confirmed} saved, ${result.skipped} skipped), so they are not offered again.`;
  const demoted = result.demoted > 0 ? ` ${result.demoted} saved ${result.demoted === 1 ? 'message points' : 'messages point'} at an entry that is not in the backup, so ${result.demoted === 1 ? 'it was' : 'they were'} kept as skipped.` : '';
  const namesNote = names === null ? '' : names.length === 0 ? ' Your list of names as banks write them was cleared, as the backup has none.' : ` ${names.length} ${names.length === 1 ? 'name' : 'names'} as banks write them restored.`;
  return { backup: restored.backup, message: `${restored.message} ${note}${demoted}${namesNote}`, handled: result.rows, ownNames: names };
}

// Reads any backup this app has ever written. Version 4 and 3 are restored as is (after the invariant checks); version 2 is mapped into one
// Cash account; anything else is refused with a clear message. Throws AccountsError('RESTORE_FAILED'); nothing is written here.
export function restoreBackup(payload: unknown, ctx: Ctx = defaultCtx): RestoreResult {
  if (typeof payload !== 'object' || payload === null || !('version' in payload)) {
    fail('This file does not look like a valid backup.');
  }
  const version = (payload as { version: unknown }).version;
  if (version === 4) {
    return restoreV4(payload as BackupV4, ctx);
  }
  if (version === 3) {
    return restoreV3(payload as BackupV3, ctx.now());
  }
  if (version === 2) {
    return mapLegacyV2(payload as LegacyBackupV2, ctx);
  }
  return fail('This backup was made by a version of the app that cannot be restored.');
}
