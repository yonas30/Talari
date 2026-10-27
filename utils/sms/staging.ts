import { UNCATEGORISED_NAME } from '../../constants/categories';
import { Category } from '../../types';
import { MoneyAccount } from '../../types/accounts';
import { RecipientRule, SmsSuggestion } from '../../types/sms';
import { Ctx } from '../accounts/context';
import { matchAccount } from './accountMatch';
import { resolveMessageDate, needsBatchDate } from './dateSource';
import { parseBatch } from './parse';
import { suggestCategory } from './recipient';
import { IgnoreReason, ParsedSms } from './types';

export interface BatchPreview {
  // Recognised messages not seen before, in the order pasted.
  fresh: ParsedSms[];
  // Recognised messages whose hash is already stored (pending, confirmed or ignored) or repeated within this paste.
  alreadyHandled: number;
  // OTPs, promotions, anything without an amount.
  ignored: number;
  // The same messages as `ignored` counts, with their text, for the paste screen only (a hidden copy can be made of each). Never stored.
  ignoredItems: { text: string; reason: IgnoreReason }[];
  // Had an amount but no template. The only group whose text is shown, and it is not stored.
  unreadable: { text: string; rawHash: string }[];
  // At least one new message has no date of its own (no printed date and no usable receipt date), so the batch needs one date.
  needsDate: boolean;
}

// Parses a pasted block and sorts every piece into exactly one bucket, so the summary always adds up to what was pasted.
// `now` is the phone's clock: a receipt date is only trusted if it is not in the future.
export function previewBatch(text: string, handledHashes: ReadonlySet<string>, senderHint?: string | null, now: Date = new Date()): BatchPreview {
  const seen = new Set<string>();
  const preview: BatchPreview = { fresh: [], alreadyHandled: 0, ignored: 0, ignoredItems: [], unreadable: [], needsDate: false };
  for (const result of parseBatch(text, senderHint)) {
    if (result.status === 'ignored') {
      preview.ignored += 1;
      if (result.text !== undefined) preview.ignoredItems.push({ text: result.text, reason: result.reason });
    } else if (result.status === 'unreadable') {
      if (!seen.has(result.rawHash)) {
        seen.add(result.rawHash);
        preview.unreadable.push({ text: result.text, rawHash: result.rawHash });
      }
    } else if (handledHashes.has(result.sms.rawHash) || seen.has(result.sms.rawHash)) {
      preview.alreadyHandled += 1;
    } else {
      seen.add(result.sms.rawHash);
      preview.fresh.push(result.sms);
    }
  }
  preview.needsDate = needsBatchDate(preview.fresh, now);
  return preview;
}

export interface StagingLookup {
  accounts: MoneyAccount[];
  rules: RecipientRule[];
  categories: Category[];
}

// The rows to save for the new messages. A message with a printed date keeps it; one with a usable CBE receipt reference takes the date
// decoded from it; any other takes the batch date. Each row records which of the three it was. The account and category are
// pre-selected where they can be told, and left empty (never guessed) where they cannot.
export function stageBatch(preview: BatchPreview, batchDate: string, ctx: Ctx, lookup: StagingLookup): SmsSuggestion[] {
  const createdAt = ctx.now().toISOString();
  return preview.fresh.map((message) => {
    const when = resolveMessageDate(message, ctx.now(), batchDate);
    return {
    ...message,
    id: ctx.newId(),
    status: 'pending',
    accountId: matchAccount(lookup.accounts, message),
    // Uncategorised unless a remembered recipient or a hint (airtime, bills, packages) names one the owner has.
    category: suggestCategory(message, lookup.rules, lookup.categories) || UNCATEGORISED_NAME,
    feeAmount: null,
    date: when.date,
    dateSource: when.source,
    createdAt,
    confirmedEntryId: null,
    };
  });
}

// Every hash the table knows, whatever its status: a message is never suggested twice.
export function handledHashes(suggestions: SmsSuggestion[]): Set<string> {
  return new Set(suggestions.map((suggestion) => suggestion.rawHash));
}
