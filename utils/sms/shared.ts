import { ParsedBody, SmsDirection, SmsKind, SmsService } from './types';

export function blank(service: SmsService, direction: SmsDirection, kind: SmsKind, amount: number): ParsedBody {
  return {
    service,
    direction,
    kind,
    amount,
    fee: null,
    vat: null,
    otherCharge: null,
    totalDeducted: null,
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
  };
}

// The last digits that are actually printed, at most four. Masked numbers ("2519****4410", "1***4827", "4xxxxxxxxxxxxx3") end in whatever
// the bank chose to show, so we take the trailing digit run and never pad or guess the hidden part.
export function tailOf(masked: string | undefined): string | null {
  if (masked === undefined) return null;
  const m = /(\d+)\s*$/.exec(masked);
  return m ? m[1].slice(-4) : null;
}

// A name or text that came through a link can carry percent-encoding ("A%26B" for "A&B", "%20" for a space, "%C3%A9" for an accented letter).
// Each run of %XX is decoded on its own, once: a run that is not valid UTF-8 ("%E0%A4", "%ZZ", a lone "%") is left exactly as it was, so
// decoding can never fail or lose text. Used for every name read from a message.
export function decodePercent(text: string): string {
  return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

export function cleanName(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  // Decoded first; a decoded control character (%0A, %00) must not put a line break or a NUL into a name, so it becomes a space.
  const s = decodePercent(raw)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s === '' ? null : s;
}
