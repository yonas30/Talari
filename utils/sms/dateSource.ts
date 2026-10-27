import { DateSource } from '../../types/accounts';
import { decodeReceiptDate } from './receiptDate';

// Where a message's date comes from, in priority order (V2_SPEC Part Z):
//   1. message  a date and time printed in the message
//   2. paired   the other side of an own-account transfer (applied when a pair is accepted, Phase 6C-1)
//   3. receipt  decoded from a CBE receipt reference (a date only)
//   4. batch    the one date chosen on the paste screen
// 'manual' is a date the owner set. Only the batch date is an estimate.
export function resolveMessageDate(
  message: { occurredAt: string | null; reference: string | null },
  now: Date,
  batchDate: string,
): { date: string; source: DateSource } {
  if (message.occurredAt !== null) {
    return { date: message.occurredAt.slice(0, 10), source: 'message' };
  }
  const receipt = decodeReceiptDate(message.reference, now);
  return receipt !== null ? { date: receipt, source: 'receipt' } : { date: batchDate, source: 'batch' };
}

// The paste screen asks for a batch date only when some message could not get its date any other way.
export function needsBatchDate(messages: Array<{ occurredAt: string | null; reference: string | null }>, now: Date): boolean {
  return messages.some((message) => message.occurredAt === null && decodeReceiptDate(message.reference, now) === null);
}

export const isEstimatedDate = (source: DateSource | null | undefined): boolean => source === 'batch';

// The quiet line under a card's date.
export function dateSourceNote(source: DateSource): string {
  switch (source) {
    case 'message':
      return 'Date from the message';
    case 'paired':
      return 'Date from the other side of the transfer';
    case 'receipt':
      return 'Date from the receipt';
    case 'batch':
      return 'Estimated: the day you imported';
    case 'manual':
      return 'Date set by you';
  }
}

// The time a message printed ("2026-11-14T13:52:15", local time) as the entry's timestamp, so same-day entries sit in the order they happened.
// Entry timestamps are UTC ISO strings, so it is converted: built from the local parts, never parsed as UTC. null when there is no time or
// it is not a real one.
export function timestampFromOccurredAt(occurredAt: string | null): string | null {
  const m = occurredAt === null ? null : /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(occurredAt);
  if (!m) {
    return null;
  }
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const date = new Date(y, mo - 1, d, h, mi, s);
  const real = date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d && date.getHours() === h && date.getMinutes() === mi && date.getSeconds() === s;
  return real ? date.toISOString() : null;
}
