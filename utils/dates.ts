// Transaction dates are calendar days in the user's own timezone ('YYYY-MM-DD').
// Never derive them with toISOString(): that is UTC, so in UTC+3 anything logged between
// 00:00 and 03:00 local lands on the previous day (this broke streaks).

export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayKey(): string {
  return toLocalDateKey(new Date());
}

// Parses a day key as local midnight (new Date('YYYY-MM-DD') would be UTC midnight).
export function parseDateKey(key: string): Date {
  return new Date(`${key}T00:00:00`);
}
