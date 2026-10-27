import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// THE MIGRATIONS ARE THE TRUTH. The SQL that really creates and changes the tables is in db/migrations.ts and the db/*Migration.ts files, and
// each step only ADDS (schema 9 now). This file is a Drizzle description of the result, kept for readers and typed queries; nothing at run time
// reads it. scripts/verify-schema-mirror.ts builds a database with the real migrations and fails if a table or a column here differs from it,
// so when a migration changes a table, change it here too.

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type', { enum: ['income', 'expense', 'savings'] }).notNull(),
  icon: text('icon').notNull(),
  color: text('color').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(true),
});

export const currencies = sqliteTable('currencies', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
});

// Schema 4 (Phase 5, the accounts model). The SQL that creates these tables is db/accountsMigration.ts; this mirrors it for Drizzle.
export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type', { enum: ['cash', 'wallet', 'bank'] }).notNull(),
  currency: text('currency').notNull(),
  colour: text('colour').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  smsSender: text('sms_sender'),
  lastDigits: text('last_digits'),
  createdAt: text('created_at').notNull(),
});

// One immutable ledger row. income / expense / opening / adjustment use account_id; a transfer uses from_account_id / to_account_id and
// carries both legs (amount + to_amount); a transfer's fee is its own expense row with linked_transfer_id set.
export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  type: text('type', { enum: ['income', 'expense', 'transfer', 'opening', 'adjustment'] }).notNull(),
  accountId: text('account_id'),
  // The amount in the account's currency (or the original amount, for a foreign entry on an ETB account); amountETB is what reports use.
  amount: real('amount').notNull(),
  currency: text('currency').notNull(),
  amountETB: real('amount_etb').notNull(),
  exchangeRate: real('exchange_rate').notNull(),
  category: text('category').notNull().default(''),
  source: text('source').notNull().default(''),
  fromAccountId: text('from_account_id'),
  toAccountId: text('to_account_id'),
  toAmount: real('to_amount'),
  toAmountETB: real('to_amount_etb'),
  linkedTransferId: text('linked_transfer_id'),
  date: text('date').notNull(),
  timestamp: text('timestamp').notNull(),
  note: text('note'),
  isAutomatic: integer('is_automatic', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  // Schema 7 (Phase 6C-0): where an imported entry's date came from (message, paired, receipt, batch, manual). A label only; never a balance.
  dateSource: text('date_source'),
});

export const goals = sqliteTable('goals', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  targetAmount: real('target_amount').notNull(),
  deadline: text('deadline'),
  status: text('status', { enum: ['active', 'completed', 'abandoned'] }).notNull().default('active'),
  heldInAccountId: text('held_in_account_id').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Append-only: a goal's amount is the sum of its rows, an account's reserved money the sum of its rows.
export const goalAllocations = sqliteTable('goal_allocations', {
  id: text('id').primaryKey(),
  goalId: text('goal_id').notNull(),
  accountId: text('account_id').notNull(),
  amount: real('amount').notNull(),
  date: text('date').notNull(),
  kind: text('kind', { enum: ['manual', 'auto_reduce'] }).notNull(),
  createdAt: text('created_at').notNull(),
});

export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: ['goal_reserve_used'] }).notNull(),
  goalId: text('goal_id').notNull(),
  accountId: text('account_id').notNull(),
  amount: real('amount').notNull(),
  amountAfter: real('amount_after').notNull(),
  createdAt: text('created_at').notNull(),
  read: integer('read', { mode: 'boolean' }).notNull().default(false),
});

export const budgets = sqliteTable('budgets', {
  id: text('id').primaryKey(),
  category: text('category').notNull(),
  monthlyLimit: real('monthly_limit').notNull(),
  currency: text('currency').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const exchangeRates = sqliteTable('exchange_rates', {
  id: text('id').primaryKey(),
  fromCurrency: text('from_currency').notNull(),
  toCurrency: text('to_currency').notNull(),
  rate: real('rate').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const recurringTransactions = sqliteTable('recurring_transactions', {
  id: text('id').primaryKey(),
  type: text('type', { enum: ['income', 'expense'] }).notNull(),
  accountId: text('account_id').notNull(),
  amount: real('amount').notNull(),
  currency: text('currency').notNull(),
  category: text('category').notNull(),
  source: text('source').notNull().default(''),
  note: text('note'),
  frequency: text('frequency', { enum: ['daily', 'weekly', 'monthly'] }).notNull(),
  startDate: text('start_date').notNull(),
  lastGeneratedDate: text('last_generated_date'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const userOrigin = sqliteTable('user_origin', {
  id: text('id').primaryKey(),
  storyText: text('story_text').notNull().default(''),
  startingPoint: text('starting_point').notNull().default(''),
  whyBuilding: text('why_building').notNull().default(''),
  updatedAt: text('updated_at').notNull(),
});

export const milestones = sqliteTable('milestones', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  date: text('date').notNull(),
  type: text('type', { enum: ['goal_completed', 'streak', 'income_growth', 'manual'] }).notNull(),
  goalId: text('goal_id'),
  createdAt: text('created_at').notNull(),
});

export const monthlySnapshots = sqliteTable('monthly_snapshots', {
  id: text('id').primaryKey(),
  month: text('month').notNull(),
  income: real('income').notNull(),
  expenses: real('expenses').notNull(),
  savings: real('savings').notNull(),
  currency: text('currency', { enum: ['ETB', 'USD', 'EUR', 'GBP'] }).notNull(),
  createdAt: text('created_at').notNull(),
});


// ---- Phase 6 (SMS import from pasted messages) ---------------------------------------------------------------------------------------------

// Schema 5, plus counterparty_code (6), date_source and paired_with_id (7). A message is kept as its HASH and what was read from it, never its
// text. The same table holds the messages a version 4 backup brings back: a restored message has an id of "restored-<hash>", no account, no
// names and only the handled-message figures (service, direction, kind, amount, charges, total, typed fee, date, date source).
export const smsSuggestions = sqliteTable('sms_suggestions', {
  id: text('id').primaryKey(),
  // FNV-1a 64 of the normalised text; unique, so a message is never staged twice.
  rawHash: text('raw_hash').notNull(),
  status: text('status', { enum: ['pending', 'confirmed', 'ignored'] }).notNull(),
  service: text('service', { enum: ['telebirr', 'cbe', 'boa', 'awash'] }).notNull(),
  direction: text('direction', { enum: ['in', 'out'] }).notNull(),
  kind: text('kind').notNull(),
  amount: real('amount').notNull(),
  fee: real('fee'),
  vat: real('vat'),
  otherCharge: real('other_charge'),
  totalDeducted: real('total_deducted'),
  counterpartyName: text('counterparty_name'),
  counterpartyPhoneTail: text('counterparty_phone_tail'),
  counterpartyBank: text('counterparty_bank'),
  counterpartyAccountTail: text('counterparty_account_tail'),
  accountTail: text('account_tail'),
  reference: text('reference'),
  occurredAt: text('occurred_at'),
  balanceAfter: real('balance_after'),
  note: text('note'),
  // A JSON list of the self-check results the reviewer sees (for example total_mismatch).
  flags: text('flags').notNull().default('[]'),
  accountId: text('account_id'),
  category: text('category').notNull().default(''),
  // The fee the owner typed on the card, replacing the printed charges.
  feeOverride: real('fee_override'),
  date: text('date').notNull(),
  createdAt: text('created_at').notNull(),
  // The entry a confirmed message became (the main entry, or the transfer).
  confirmedEntryId: text('confirmed_entry_id'),
  counterpartyCode: text('counterparty_code'),
  dateSource: text('date_source'),
  pairedWithId: text('paired_with_id'),
});

// The category last used for a recipient (key from utils/sms/recipient.ts).
export const recipientRules = sqliteTable('recipient_rules', {
  key: text('key').primaryKey(),
  category: text('category').notNull(),
  lastUsed: text('last_used').notNull(),
});

// Schema 8: pairs the owner said are not transfers ("not a pair", "keep separate"); never offered again.
export const pairRejections = sqliteTable('pair_rejections', {
  pairKey: text('pair_key').primaryKey(),
  reason: text('reason', { enum: ['not_pair', 'keep_separate'] }).notNull(),
  createdAt: text('created_at').notNull(),
});

// Schema 7: the message whose "balance doesn't match your bank" banner was dismissed, per account.
export const reconcileDismissals = sqliteTable('reconcile_dismissals', {
  accountId: text('account_id').primaryKey(),
  dismissedHash: text('dismissed_hash').notNull(),
  dismissedAt: text('dismissed_at').notNull(),
});

// Schema 9: the owner's own names as banks write them (pairing rule 3). Personal data; they are in a backup.
export const ownNames = sqliteTable('own_names', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
});

// Which notifications have been read (created in db/migrations.ts, used by db/notificationReads.ts).
export const notificationReads = sqliteTable('notification_reads', {
  id: text('id').primaryKey(),
  readAt: text('read_at').notNull(),
});
