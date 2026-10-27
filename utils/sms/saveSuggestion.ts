import { FEES_CATEGORY, UNCATEGORISED_NAME } from '../../constants/categories';
import { AccountEntry, AccountsState, MoneyAccount } from '../../types/accounts';
import { RecipientRule, SmsSuggestion } from '../../types/sms';
import { Ctx, defaultCtx } from '../accounts/context';
import { EntryInput, planAddEntries } from '../accounts/entries';
import { AccountsError } from '../accounts/errors';
import { formatAmount, fromCents, toCents } from '../accounts/money';
import { WriteResult } from '../accounts/reserve';
import { SERVICE_LABEL } from './accountMatch';
import { timestampFromOccurredAt } from './dateSource';
import { recipientKey } from './recipient';

// The charges the message printed (service charge + VAT + any other charge), as one amount.
export function printedCharges(s: Pick<SmsSuggestion, 'fee' | 'vat' | 'otherCharge'>): number {
  return fromCents(toCents(s.fee ?? 0) + toCents(s.vat ?? 0) + toCents(s.otherCharge ?? 0));
}

// The fee line as the card shows it: what the owner typed, otherwise the printed charges. Only money going out has one.
export function effectiveFee(s: SmsSuggestion): number {
  if (s.direction !== 'out') {
    return 0;
  }
  const fee = s.feeAmount ?? printedCharges(s);
  return Number.isFinite(fee) && fee > 0 ? fee : 0;
}

function usableAccount(accounts: MoneyAccount[], id: string | null): MoneyAccount | null {
  const account = id === null ? undefined : accounts.find((item) => item.id === id);
  return account && !account.archived && account.currency === 'ETB' ? account : null;
}

const who = (s: SmsSuggestion): string | null => s.counterpartyName ?? s.counterpartyBank ?? null;

// A card the owner has not categorised is saved as Uncategorised (built in), to be fixed later from Transactions.
export const categoryOf = (s: Pick<SmsSuggestion, 'category'>): string => s.category.trim() || UNCATEGORISED_NAME;

// What the entry's "merchant" field says: the counterparty, or for airtime and bills (which name only a number) what the payment was.
const sourceOf = (s: SmsSuggestion): string => who(s) ?? (s.kind === 'airtime' || s.kind === 'bill_payment' ? (s.note ?? '') : '');

// The rows a suggestion becomes. Money out is an expense (sent to a person too) and money in is income; a transfer between the owner's
// own accounts is never made here. The fee is its OWN expense in the Fees category, not linked to the main entry (a link is only for
// transfer fees), in the same account on the same date.
export function suggestionInputs(s: SmsSuggestion, accountId: string, category: string, chainTime: string | null = null): EntryInput[] {
  const type = s.direction === 'out' ? 'expense' : 'income';
  // The printed time orders the entry within its day, but only while the date is still the message's own: an edited date has no matching time.
  // A message that printed none gets a time from its place in the balance chain (Phase 6C-2), so same-day entries keep the bank's order.
  const timestamp = s.dateSource === 'message' ? (timestampFromOccurredAt(s.occurredAt) ?? chainTime) : chainTime;
  const inputs: EntryInput[] = [
    { type, accountId, amount: s.amount, currency: 'ETB', category, source: sourceOf(s), date: s.date, note: s.note, dateSource: s.dateSource, timestamp },
  ];
  const fee = effectiveFee(s);
  if (fee > 0) {
    const name = who(s);
    inputs.push({
      type: 'expense',
      accountId,
      amount: fee,
      currency: 'ETB',
      category: FEES_CATEGORY.name,
      date: s.date,
      note: name ? `Fee for ${name}` : `Fee (${SERVICE_LABEL[s.service]})`,
      dateSource: s.dateSource,
      timestamp,
    });
  }
  return inputs;
}

// The day of the account's opening balance, or null when it has none. The typed opening balance already includes everything that
// happened before it, so a message dated earlier would be counted twice.
export function openingDateOf(state: AccountsState, accountId: string): string | null {
  const dates = state.entries.filter((entry) => entry.type === 'opening' && entry.accountId === accountId).map((entry) => entry.date);
  return dates.sort()[0] ?? null;
}

// For SMS saves only (manual entries are left as they are): a message of EITHER direction dated before the account's opening day is
// refused, with the same specific wording. An expense would also fail the balance check; an income would silently double-count.
export function beforeOpeningProblem(state: AccountsState, accountId: string, date: string): AccountsError | null {
  const opening = openingDateOf(state, accountId);
  return opening !== null && date < opening ? new AccountsError('BEFORE_OPENING', `This is dated before the account's opening balance on ${opening}.`) : null;
}

export interface CardWarning {
  kind: 'duplicate' | 'reserved' | 'mismatch';
  message: string;
}

export interface CardCheck {
  // What the card still needs from the owner before it can be saved.
  missing: Array<'account'>;
  warnings: CardWarning[];
  // Why saving is refused (nothing would be written). null when it can be saved.
  blocked: string | null;
  // True when the block is "dated before the account's opening balance": the card then offers to move the opening back.
  beforeOpening: boolean;
  // Ready for "Save all that are clean": it has an account, nothing to warn about, and is not blocked. A category is not required.
  clean: boolean;
}

function possibleDuplicates(state: AccountsState, s: SmsSuggestion, accountId: string): AccountEntry[] {
  const type = s.direction === 'out' ? 'expense' : 'income';
  return state.entries.filter(
    (entry) =>
      entry.accountId === accountId &&
      entry.type === type &&
      entry.linkedTransferId === null &&
      entry.date === s.date &&
      toCents(entry.amount) === toCents(s.amount),
  );
}

// Everything the review card says about a suggestion, by PLANNING the save without writing it (the same planner the save uses), so the
// warnings and the block can never disagree with what saving would do.
export function checkSuggestion(state: AccountsState, s: SmsSuggestion, ctx: Ctx = defaultCtx): CardCheck {
  const account = usableAccount(state.accounts, s.accountId);
  const missing: CardCheck['missing'] = [];
  if (!account) missing.push('account');
  const warnings: CardWarning[] = [];
  let blocked: string | null = null;
  let beforeOpening = false;

  // The message's own figures do not add up (amount + charges is not its printed total): never guessed, never "clean".
  if (s.flags.includes('total_mismatch')) {
    warnings.push({
      kind: 'mismatch',
      message: `The amount, the charges and the total in this message do not add up${s.totalDeducted !== null ? ` (total ETB ${formatAmount(s.totalDeducted)})` : ''}. Check the amounts before saving.`,
    });
  }

  if (account) {
    if (possibleDuplicates(state, s, account.id).length > 0) {
      warnings.push({
        kind: 'duplicate',
        message: `Possible duplicate: ${account.name} already has ETB ${formatAmount(s.amount)} on ${s.date}.`,
      });
    }
    const early = beforeOpeningProblem(state, account.id, s.date);
    try {
      if (early) {
        beforeOpening = true;
        throw early;
      }
      const planned = planAddEntries(state, suggestionInputs(s, account.id, categoryOf(s)), ctx);
      const used = planned.reserveUsed.filter((row) => row.accountId === account.id && row.shortfall > 0);
      if (used.length > 0) {
        const shortfall = used.reduce((sum, row) => sum + row.shortfall, 0);
        const reserved = used[0].reservedBefore;
        warnings.push({
          kind: 'reserved',
          message: `This uses ETB ${formatAmount(shortfall)} of the ETB ${formatAmount(reserved)} reserved for goals in ${account.name}.`,
        });
      }
    } catch (error) {
      if (!(error instanceof AccountsError)) {
        throw error;
      }
      blocked = error.message;
    }
  }

  return { missing, warnings, blocked, beforeOpening, clean: missing.length === 0 && warnings.length === 0 && blocked === null };
}

export interface SuggestionSavePlan {
  // The whole resulting ledger: main entry, fee entry, and any goal shrink with its notification.
  result: WriteResult & { added: AccountEntry[] };
  mainEntryId: string;
  feeEntryId: string | null;
  // What the database transaction also writes. rule is null when "remember" is off or the message names nobody.
  confirmation: { suggestionId: string; entryId: string; rule: RecipientRule | null };
}

// Plans the save as one set. Throws an AccountsError (with the opening-balance wording where it applies) and changes nothing if the
// entries, validated TOGETHER, would not work; the caller then writes the plan in one database transaction (db/smsRepo.ts).
export function planSuggestionSave(state: AccountsState, s: SmsSuggestion, options: { remember: boolean; timestamp?: string | null }, ctx: Ctx = defaultCtx): SuggestionSavePlan {
  if (s.status !== 'pending') {
    throw new AccountsError('INVALID_ENTRY', 'This message has already been handled.');
  }
  const account = usableAccount(state.accounts, s.accountId);
  if (!account) {
    throw new AccountsError('UNKNOWN_ACCOUNT', 'Choose an account for this message.');
  }
  const category = categoryOf(s);
  const early = beforeOpeningProblem(state, account.id, s.date);
  if (early) {
    throw early;
  }

  const result = planAddEntries(state, suggestionInputs(s, account.id, category, options.timestamp ?? null), ctx);

  // Nothing is remembered for Uncategorised: it would only teach the next message "no category" and hide a better suggestion.
  const key = options.remember && category !== UNCATEGORISED_NAME ? recipientKey(s) : null;
  return {
    result,
    mainEntryId: result.added[0].id,
    feeEntryId: result.added[1]?.id ?? null,
    confirmation: {
      suggestionId: s.id,
      entryId: result.added[0].id,
      rule: key === null ? null : { key, category, lastUsed: ctx.now().toISOString() },
    },
  };
}

// "Save all that are clean" works oldest first so each entry sees the balance the ones before it left.
export function cleanOrder(suggestions: SmsSuggestion[]): SmsSuggestion[] {
  return suggestions.filter((s) => s.status === 'pending').sort((a, b) => (a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date)));
}
