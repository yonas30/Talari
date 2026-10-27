import { DATE_SOURCES, DateSource } from '../../types/accounts';
import { SmsSuggestion } from '../../types/sms';
import { SmsDirection, SmsKind, SmsService } from './types';

// The handled messages in a backup (V2_SPEC Part Z, Phase 6D-1). Pure.
//
// A record is the message's HASH, what became of it, and only the few figures the app needs later (the "Fee counted twice" repair finds its
// entries from them, and the Skipped list shows them). Never the message text, names, tails, references, notes, the balance, a category or a
// recipient rule. A hash is not strictly anonymous (a short, predictable message could be guessed and checked against it), so a backup file is
// private either way.

export interface HandledRecord {
  hash: string;
  status: 'confirmed' | 'ignored';
  // The entry a confirmed message became (the main entry, or the transfer). null for a skipped message.
  confirmedEntryId: string | null;
  date: string;
  dateSource: DateSource;
  service: SmsService;
  direction: SmsDirection;
  kind: SmsKind;
  amount: number;
  fee: number | null;
  vat: number | null;
  otherCharge: number | null;
  totalDeducted: number | null;
  // The fee the owner typed on the card, when they did.
  feeAmount: number | null;
}

const SERVICES: readonly string[] = ['telebirr', 'cbe', 'boa', 'awash'];
const DIRECTIONS: readonly string[] = ['in', 'out'];
const KINDS: readonly string[] = ['person_transfer', 'bank_transfer', 'package_payment', 'received', 'credit', 'debit', 'merchant_payment', 'airtime', 'bill_payment'];

// What a backup keeps of the messages the owner has dealt with: confirmed and skipped ones. Waiting ones are not kept.
export function toHandledRecords(suggestions: SmsSuggestion[]): HandledRecord[] {
  return suggestions
    .filter((s) => s.status === 'confirmed' || s.status === 'ignored')
    .map((s) => ({
      hash: s.rawHash,
      status: s.status === 'confirmed' ? ('confirmed' as const) : ('ignored' as const),
      confirmedEntryId: s.status === 'confirmed' ? s.confirmedEntryId : null,
      date: s.date,
      dateSource: s.dateSource,
      service: s.service,
      direction: s.direction,
      kind: s.kind,
      amount: s.amount,
      fee: s.fee,
      vat: s.vat,
      otherCharge: s.otherCharge,
      totalDeducted: s.totalDeducted,
      feeAmount: s.feeAmount,
    }));
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// A figure that may be missing: absent or null is null; anything else must be a finite number of zero or more.
function optionalFigure(value: unknown): number | null | 'bad' {
  if (value === undefined || value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 'bad';
}

// Reads the handled list of a backup. Returns the records, or the reason the file is refused. Every record is rebuilt field by field, so
// nothing else that a file carries (message text, names, anything) is ever kept.
export function readHandledRecords(raw: unknown): HandledRecord[] | string {
  if (!Array.isArray(raw)) {
    return 'The list of handled messages in this backup is missing or damaged.';
  }
  const seen = new Set<string>();
  const records: HandledRecord[] = [];
  for (const item of raw) {
    if (!isObject(item)) return 'A handled message in this backup is damaged.';
    const { hash, status, date, dateSource, service, direction, kind, amount, confirmedEntryId } = item;
    if (typeof hash !== 'string' || hash === '' || hash.length > 200) return 'A handled message in this backup has no valid hash.';
    if (seen.has(hash)) return 'A handled message appears twice in this backup.';
    if (status !== 'confirmed' && status !== 'ignored') return 'A handled message in this backup has a status this app does not know.';
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return 'A handled message in this backup has a bad date.';
    if (typeof dateSource !== 'string' || !(DATE_SOURCES as readonly string[]).includes(dateSource)) return 'A handled message in this backup has a bad date source.';
    if (typeof service !== 'string' || !SERVICES.includes(service)) return 'A handled message in this backup comes from a service this app does not know.';
    if (typeof direction !== 'string' || !DIRECTIONS.includes(direction)) return 'A handled message in this backup has a bad direction.';
    if (typeof kind !== 'string' || !KINDS.includes(kind)) return 'A handled message in this backup has a kind this app does not know.';
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return 'A handled message in this backup has a bad amount.';
    if (confirmedEntryId !== undefined && confirmedEntryId !== null && typeof confirmedEntryId !== 'string') return 'A handled message in this backup has a bad entry id.';
    const figures = [optionalFigure(item.fee), optionalFigure(item.vat), optionalFigure(item.otherCharge), optionalFigure(item.totalDeducted), optionalFigure(item.feeAmount)];
    if (figures.includes('bad')) return 'A handled message in this backup has a figure that is not a number.';
    const [fee, vat, otherCharge, totalDeducted, feeAmount] = figures as Array<number | null>;
    seen.add(hash);
    records.push({
      hash,
      status,
      confirmedEntryId: status === 'confirmed' && typeof confirmedEntryId === 'string' && confirmedEntryId !== '' ? confirmedEntryId : null,
      date,
      dateSource: dateSource as DateSource,
      service: service as SmsService,
      direction: direction as SmsDirection,
      kind: kind as SmsKind,
      amount,
      fee,
      vat,
      otherCharge,
      totalDeducted,
      feeAmount,
    });
  }
  return records;
}

export interface RestoredHandled {
  rows: SmsSuggestion[];
  confirmed: number;
  skipped: number;
  // Confirmed in the file, but the entry it points at is not in the restored ledger: kept as skipped, so it can never hide a message that has
  // no entry.
  demoted: number;
}

// The message rows a restore writes. A restored message has no account and none of the names, so it takes no part in the balance chain or the
// banner; it exists to stop the same message being offered again and to let the repairs find their entries.
export function restoredSuggestions(records: HandledRecord[], entryIds: ReadonlySet<string>, nowIso: string): RestoredHandled {
  let confirmed = 0;
  let skipped = 0;
  let demoted = 0;
  const rows = records.map((record): SmsSuggestion => {
    const keeps = record.status === 'confirmed' && record.confirmedEntryId !== null && entryIds.has(record.confirmedEntryId);
    if (keeps) confirmed += 1;
    else skipped += 1;
    if (record.status === 'confirmed' && !keeps) demoted += 1;
    return {
      id: `restored-${record.hash}`,
      rawHash: record.hash,
      status: keeps ? 'confirmed' : 'ignored',
      service: record.service,
      direction: record.direction,
      kind: record.kind,
      amount: record.amount,
      fee: record.fee,
      vat: record.vat,
      otherCharge: record.otherCharge,
      totalDeducted: record.totalDeducted,
      counterpartyName: null,
      counterpartyPhoneTail: null,
      counterpartyBank: null,
      counterpartyAccountTail: null,
      counterpartyCode: null,
      accountTail: null,
      reference: null,
      occurredAt: null,
      balanceAfter: null,
      note: null,
      flags: [],
      accountId: null,
      category: '',
      feeAmount: record.feeAmount,
      date: record.date,
      dateSource: record.dateSource,
      createdAt: nowIso,
      confirmedEntryId: keeps ? record.confirmedEntryId : null,
    };
  });
  return { rows, confirmed, skipped, demoted };
}
