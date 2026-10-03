import { RecurringFrequency, RecurringTransaction } from '../types';
import { parseDateKey, toLocalDateKey } from './dates';

// First day of the month `months` away, then the anchor day clamped to that month's length. Plain
// setMonth() overflows (31 Jan + 1 month = 3 Mar), which posted monthly entries on the wrong date.
function addMonthsClamped(date: Date, months: number, anchorDay: number): Date {
  const firstOfTarget = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth() + 1, 0).getDate();
  return new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth(), Math.min(anchorDay, lastDay));
}

// `anchorDay` is the day-of-month the rule started on, so a rule that began on the 31st returns to the
// 31st after a short month instead of drifting to the 28th forever.
export function advanceDate(date: Date, frequency: RecurringFrequency, anchorDay: number): Date {
  if (frequency === 'monthly') {
    return addMonthsClamped(date, 1, anchorDay);
  }
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + (frequency === 'daily' ? 1 : 7));
  return next;
}

// The date the rule fires next. Shared by the generator (db) and the Recurring screen so what the list
// shows is exactly what will be posted.
export function getNextDueDate(rule: Pick<RecurringTransaction, 'startDate' | 'lastGeneratedDate' | 'frequency'>): Date {
  const start = parseDateKey(rule.startDate);
  if (!rule.lastGeneratedDate) {
    return start;
  }
  return advanceDate(parseDateKey(rule.lastGeneratedDate), rule.frequency, start.getDate());
}

// What happens to a rule's schedule when it is edited. Editing must never cause back-posting of old
// occurrences, so:
//  - a rule that has never fired can take any new start date;
//  - a rule with history keeps its schedule, unless the frequency changes - then it restarts at the date
//    it was due next, so the old cadence's already-posted occurrences are not repeated at the new one.
export function planRecurringEdit(
  existing: Pick<RecurringTransaction, 'startDate' | 'lastGeneratedDate' | 'frequency'>,
  input: { startDate: string; frequency: RecurringFrequency },
): { startDate: string; lastGeneratedDate: string | null } {
  if (!existing.lastGeneratedDate) {
    return { startDate: input.startDate, lastGeneratedDate: null };
  }
  if (existing.frequency !== input.frequency) {
    return { startDate: toLocalDateKey(getNextDueDate(existing)), lastGeneratedDate: null };
  }
  return { startDate: existing.startDate, lastGeneratedDate: existing.lastGeneratedDate };
}
