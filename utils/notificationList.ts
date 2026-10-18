import { AppNotification } from '../types/notifications';
import { AccountGoal, ReserveNotification } from '../types/accounts';
import { describeReserveNotification } from './accounts/notificationText';

// The rules of the Notifications page and the bell badge, kept free of React Native so scripts/verify-accounting.ts can check them.

export const GOAL_MISSING_MESSAGE = 'That goal no longer exists.';

// The saved "reserved money was used" events as list items. The text comes from describeReserveNotification (name and target as the goal
// is now; "what it held afterwards" as it was at the time). A notification is read when its own saved flag says so OR the app's seen-state
// (notification_reads, the same one budget alerts use) does.
export function goalNotificationItems(
  reserve: ReserveNotification[],
  goals: AccountGoal[],
  readIds: Record<string, true>,
): AppNotification[] {
  return reserve.map((item) => {
    const text = describeReserveNotification(
      item,
      goals.find((goal) => goal.id === item.goalId),
    );
    return {
      id: item.id,
      title: text.title,
      description: text.description,
      isRead: item.read || Boolean(readIds[item.id]),
      type: 'goal' as const,
      goalId: item.goalId,
      createdAt: item.createdAt,
    };
  });
}

// Adds or refreshes items by id, never losing what the list already knows: once seen (this session or an earlier one) a notification
// stays seen while it keeps existing, and an item without a time is stamped with the moment it was first seen.
export function mergeNotifications(
  existing: AppNotification[],
  incoming: AppNotification[],
  readIds: Record<string, true>,
  nowIso: string,
): AppNotification[] {
  const merged = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) {
    const previous = merged.get(item.id);
    merged.set(item.id, {
      ...previous,
      ...item,
      isRead: Boolean(readIds[item.id]) || (previous?.isRead ?? item.isRead),
      createdAt: item.createdAt ?? previous?.createdAt ?? nowIso,
    });
  }
  return Array.from(merged.values());
}

// Newest first. Items that happened at the same moment keep the order they were made in, with the later one first.
export function sortNewestFirst(list: AppNotification[]): AppNotification[] {
  return list
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const at = a.item.createdAt ?? '';
      const bt = b.item.createdAt ?? '';
      return at === bt ? b.index - a.index : at < bt ? 1 : -1;
    })
    .map(({ item }) => item);
}

// What the bell badge shows.
export function unreadCount(list: AppNotification[]): number {
  return list.filter((item) => !item.isRead).length;
}

export function markRead(list: AppNotification[], ids: string[]): AppNotification[] {
  const wanted = new Set(ids);
  return list.map((item) => (wanted.has(item.id) && !item.isRead ? { ...item, isRead: true } : item));
}

export function markAllRead(list: AppNotification[]): AppNotification[] {
  return list.map((item) => (item.isRead ? item : { ...item, isRead: true }));
}

export interface NotificationTarget {
  pathname: string;
  params?: Record<string, string>;
}

// Where a tap goes. A goal notification opens the Goals tab with the goal's id as a route param (the tab scrolls to it and highlights it, or
// says it no longer exists); budget and system notifications go where they always did. Null: nothing to open.
export function notificationTarget(item: Pick<AppNotification, 'type' | 'route' | 'goalId'>): NotificationTarget | null {
  if (item.type === 'goal') {
    return item.goalId ? { pathname: '/goals', params: { goal: item.goalId } } : { pathname: '/goals' };
  }
  return item.route ? { pathname: item.route } : null;
}

// The link line under a notification. Null when tapping opens nothing.
export function notificationActionLabel(item: Pick<AppNotification, 'type' | 'route' | 'goalId'>): string | null {
  if (item.type === 'goal') {
    return 'View goal →';
  }
  return item.route === '/budgets' ? 'Review budgets →' : null;
}

// What a screen reader adds after the text.
export function notificationOpensLabel(item: Pick<AppNotification, 'type' | 'route' | 'goalId'>): string {
  if (item.type === 'goal') {
    return 'Opens the goal.';
  }
  return item.route === '/budgets' ? 'Opens budgets.' : '';
}

export type GoalFocus =
  | { kind: 'none' }
  | { kind: 'goal'; goalId: string; tab: 'active' | 'completed' }
  | { kind: 'missing' };

// What the Goals tab does with the `goal` route param: nothing, scroll to and highlight that goal (on the tab it lives on), or say it is gone.
export function resolveGoalFocus(param: string | string[] | undefined, goals: Pick<AccountGoal, 'id' | 'status'>[]): GoalFocus {
  const id = Array.isArray(param) ? param[0] : param;
  if (!id) {
    return { kind: 'none' };
  }
  const goal = goals.find((item) => item.id === id);
  if (!goal) {
    return { kind: 'missing' };
  }
  return { kind: 'goal', goalId: goal.id, tab: goal.status === 'completed' ? 'completed' : 'active' };
}

// How a row of the Notifications page looks. Unread means a dot, a slightly stronger background and "Unread." at the start of what a screen
// reader says - for budget alerts and goal notifications alike; never colour alone.
export function notificationVisualState(item: Pick<AppNotification, 'isRead'>): { dot: boolean; tinted: boolean; accessibilityPrefix: '' | 'Unread. ' } {
  return item.isRead ? { dot: false, tinted: false, accessibilityPrefix: '' } : { dot: true, tinted: true, accessibilityPrefix: 'Unread. ' };
}

// The seen-state without the given ids (their notifications no longer exist).
export function forgetReadIds(readIds: Record<string, true>, ids: string[]): Record<string, true> {
  const gone = new Set(ids);
  return Object.fromEntries(Object.entries(readIds).filter(([id]) => !gone.has(id))) as Record<string, true>;
}

// "Clear all": the saved goal notifications are removed from the list; budget alerts are worked out from the data every launch, so they cannot
// be removed and are marked read instead.
export function clearAllNotifications(list: AppNotification[]): AppNotification[] {
  return markAllRead(list.filter((item) => item.type !== 'goal'));
}

// Replaces the goal items with the saved ones: any goal item that is no longer saved (its goal was deleted, it expired, it was cleared) leaves
// the list; the rest are added or refreshed. Budget and system items are untouched.
export function replaceGoalItems(existing: AppNotification[], saved: AppNotification[], readIds: Record<string, true>, nowIso: string): AppNotification[] {
  const live = new Set(saved.map((item) => item.id));
  return mergeNotifications(
    existing.filter((item) => item.type !== 'goal' || live.has(item.id)),
    saved,
    readIds,
    nowIso,
  );
}
