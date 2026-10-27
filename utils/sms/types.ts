export type SmsService = 'telebirr' | 'cbe' | 'boa' | 'awash';
export type SmsDirection = 'in' | 'out';
export type SmsKind =
  | 'person_transfer'
  | 'bank_transfer'
  | 'package_payment'
  | 'received'
  | 'credit'
  | 'debit'
  | 'merchant_payment'
  | 'airtime'
  | 'bill_payment';

// What one recognised message says. Amounts are positive ETB (the direction comes from the wording, never from a sign).
// The raw text is deliberately not kept here: only its hash, so a staged suggestion can be deduplicated without storing the message.
export type ParsedSms = {
  service: SmsService;
  direction: SmsDirection;
  kind: SmsKind;
  amount: number;
  fee: number | null;
  vat: number | null;
  otherCharge: number | null;
  totalDeducted: number | null;
  counterpartyName: string | null;
  counterpartyPhoneTail: string | null;
  counterpartyBank: string | null;
  counterpartyAccountTail: string | null;
  // The merchant code, bill number, payment number or phone number a message pays. null for transfers.
  counterpartyCode: string | null;
  accountTail: string | null;
  reference: string | null;
  // Local time, no timezone suffix ("2026-01-31T13:52:15"); null when the message carries no date (CBE, BOA).
  occurredAt: string | null;
  balanceAfter: number | null;
  rawHash: string;
  // The package or item named in the message (package payments), otherwise null.
  note: string | null;
  // Self-check results the reviewer should see, e.g. 'total_mismatch'. Empty when the message is fully consistent.
  flags: string[];
};

export type ParsedBody = Omit<ParsedSms, 'rawHash'>;

// 'airtime_received' is the notice that airtime arrived on a number: not money, no balance.
export type IgnoreReason = 'empty' | 'otp' | 'no_amount' | 'airtime_received';

// Three outcomes, so nothing is ever dropped silently: a transaction, something that is not one, or something we could not read.
export type ParseResult =
  | { status: 'parsed'; sms: ParsedSms }
  // `text` is the message as pasted, kept only while the paste screen shows it (so a hidden copy can be made of it); never stored.
  | { status: 'ignored'; reason: IgnoreReason; reference?: string | null; text?: string }
  | { status: 'unreadable'; text: string; rawHash: string };
