import { ReserveNotification } from '../../types/accounts';

// How long a saved "reserved money was used" notification is kept. It is counted from when it was CREATED, read or unread. After this the app
// removes it when it loads, and a restored backup drops the ones already older than this.
export const RESERVE_NOTIFICATION_RETENTION_DAYS = 30;

const DAY_MS = 86400000;

// Older than the retention (strictly: exactly 30 days old is still kept, 30 days and a second is gone). A time that cannot be read is kept:
// losing a notification because of a bad value is worse than keeping one.
export function isExpired(
  notification: Pick<ReserveNotification, 'createdAt'>,
  now: Date,
  days: number = RESERVE_NOTIFICATION_RETENTION_DAYS,
): boolean {
  const created = Date.parse(notification.createdAt);
  return Number.isFinite(created) && now.getTime() - created > days * DAY_MS;
}

export function expiredIds(list: ReserveNotification[], now: Date, days: number = RESERVE_NOTIFICATION_RETENTION_DAYS): string[] {
  return list.filter((item) => isExpired(item, now, days)).map((item) => item.id);
}

export function pruneExpired(list: ReserveNotification[], now: Date, days: number = RESERVE_NOTIFICATION_RETENTION_DAYS): ReserveNotification[] {
  return list.filter((item) => !isExpired(item, now, days));
}

// The saved read flag: the given ids, or every notification when no ids are given. Items already read keep their identity.
export function markReserveRead(list: ReserveNotification[], ids?: string[]): ReserveNotification[] {
  const wanted = ids ? new Set(ids) : null;
  return list.map((item) => (!item.read && (wanted === null || wanted.has(item.id)) ? { ...item, read: true } : item));
}
