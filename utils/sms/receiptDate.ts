import { toLocalDateKey } from '../dates';

// Five years. Long enough to import real history, short enough to throw away a garbled reference; a "FT99..." style value is rejected as
// a future date anyway.
export const RECEIPT_MAX_AGE_DAYS = 1827;

const DAY_MS = 86_400_000;
const pad = (n: number): string => String(n).padStart(2, '0');
const isLeapYear = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

// A CBE receipt reference is "FT" + a 2-digit year + a 3-digit day of the year + more characters ("FT26..."). This decodes the date it
// stands for, as "YYYY-MM-DD", or returns null when it cannot be trusted: not that shape, a day that does not exist in that year (366 only
// in a leap year), after today, or more than RECEIPT_MAX_AGE_DAYS ago. It gives a DATE ONLY: the reference carries no time.
// The day is worked out in UTC so a daylight-saving shift can never move it; "today" is the phone's local day.
export function decodeReceiptDate(reference: string | null | undefined, today: Date): string | null {
  if (!reference) {
    return null;
  }
  const match = /^FT(\d{2})(\d{3})/i.exec(reference.trim());
  if (!match) {
    return null;
  }
  const year = 2000 + Number(match[1]);
  const dayOfYear = Number(match[2]);
  if (dayOfYear < 1 || dayOfYear > (isLeapYear(year) ? 366 : 365)) {
    return null;
  }
  const utc = Date.UTC(year, 0, dayOfYear);
  const date = new Date(utc);
  if (date.getUTCFullYear() !== year) {
    return null;
  }
  const key = `${year}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const todayKey = toLocalDateKey(today);
  if (key > todayKey) {
    return null;
  }
  const [ty, tm, td] = todayKey.split('-').map(Number);
  const ageDays = Math.round((Date.UTC(ty, tm - 1, td) - utc) / DAY_MS);
  return ageDays > RECEIPT_MAX_AGE_DAYS ? null : key;
}
