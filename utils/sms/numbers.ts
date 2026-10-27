// The amount pattern, for building the service regexes. It tolerates a sign, thousands commas and no decimals; the sign is thrown away
// by parseAmount because the wording (Debited / Credited / transferred / received) is what decides the direction.
export const AMT = '-?\\s*\\d[\\d,]*(?:\\.\\d+)?';

// "630.00", "1,000.00", "2012", "1000.0", "5712.34", "2486130.45", "-40000.00" -> a positive number rounded to cents.
// Anything that is not a plain money amount (stray commas, more than two decimals) is null: a wrong amount is worse than an unread message.
export function parseAmount(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const s = raw.replace(/\s+/g, '').replace(/^-/, '');
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s.replace(/,/g, '')) * 100) / 100;
}

export const toCents = (value: number): number => Math.round(value * 100);
