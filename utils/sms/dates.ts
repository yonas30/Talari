// Both layouts appear, even within one service: "dd/MM/yyyy HH:mm:ss" and "yyyy-MM-dd HH:mm:ss". Always Gregorian.
export const DATE_SRC = '(\\d{2}/\\d{2}/\\d{4} \\d{2}:\\d{2}:\\d{2}|\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2})';

const pad = (n: number): string => String(n).padStart(2, '0');

// Returns a local-time ISO string without a timezone ("2026-01-31T13:52:15"), or null for anything that is not a real date and time
// (month 13, 31 February, 25:00). Built from parts on purpose: going through Date would shift it by the device's timezone.
export function parseSmsDate(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const m = /^(?:(\d{2})\/(\d{2})\/(\d{4})|(\d{4})-(\d{2})-(\d{2})) (\d{2}):(\d{2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const [day, month, year] = m[1] !== undefined ? [Number(m[1]), Number(m[2]), Number(m[3])] : [Number(m[6]), Number(m[5]), Number(m[4])];
  const hour = Number(m[7]);
  const minute = Number(m[8]);
  const second = Number(m[9]);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
}
