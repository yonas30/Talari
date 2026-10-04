import { create } from 'zustand';

import { markNotificationsRead } from '../db/database';

export interface AppNotification {
  id: string;
  title: string;
  description: string;
  isRead: boolean;
  type: 'budget' | 'system';
  // Where tapping the notification goes (e.g. '/budgets'); none for purely informational ones.
  route?: string;
}

interface UiState {
  isDrawerOpen: boolean;
  isBalanceHidden: boolean;
  notifications: AppNotification[];
  // Ids the user has already seen, loaded from storage at start-up and kept in step with it. A notification whose id
  // is here is never shown as unread again - that is what stops the bell badge returning on every launch.
  readIds: Record<string, true>;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleBalanceVisibility: () => void;
  hydrateReadIds: (ids: string[]) => void;
  upsertNotifications: (items: AppNotification[]) => void;
  removeNotificationsWhere: (predicate: (item: AppNotification) => boolean) => void;
  markNotificationAsRead: (id: string) => void;
  markAllNotificationsAsRead: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  isDrawerOpen: false,
  // Balances start hidden every launch; the eye button reveals them (V2 Part I).
  isBalanceHidden: true,
  notifications: [],
  readIds: {},
  openDrawer: () => set({ isDrawerOpen: true }),
  closeDrawer: () => set({ isDrawerOpen: false }),
  toggleBalanceVisibility: () => set((state) => ({ isBalanceHidden: !state.isBalanceHidden })),
  hydrateReadIds: (ids) =>
    set((state) => ({
      readIds: { ...state.readIds, ...Object.fromEntries(ids.map((id) => [id, true as const])) },
      notifications: state.notifications.map((item) => (ids.includes(item.id) ? { ...item, isRead: true } : item)),
    })),
  upsertNotifications: (items) =>
    set((state) => {
      const existing = new Map(state.notifications.map((item) => [item.id, item]));
      for (const item of items) {
        const previous = existing.get(item.id);
        existing.set(item.id, {
          ...previous,
          ...item,
          // Seen once (this session or an earlier one) stays seen while the notification keeps existing.
          isRead: Boolean(state.readIds[item.id]) || (previous?.isRead ?? item.isRead),
        });
      }
      return { notifications: Array.from(existing.values()) };
    }),
  removeNotificationsWhere: (predicate) =>
    set((state) => {
      const kept = state.notifications.filter((item) => !predicate(item));
      // Keep the same array when nothing was removed so subscribers don't re-render needlessly.
      return kept.length === state.notifications.length ? state : { notifications: kept };
    }),
  markNotificationAsRead: (id) => {
    if (get().readIds[id]) {
      return;
    }
    set((state) => ({
      readIds: { ...state.readIds, [id]: true },
      notifications: state.notifications.map((notification) => (notification.id === id ? { ...notification, isRead: true } : notification)),
    }));
    markNotificationsRead([id]);
  },
  markAllNotificationsAsRead: () => {
    const unread = get().notifications.filter((notification) => !notification.isRead).map((notification) => notification.id);
    if (unread.length === 0) {
      return;
    }
    set((state) => ({
      readIds: { ...state.readIds, ...Object.fromEntries(unread.map((id) => [id, true as const])) },
      notifications: state.notifications.map((notification) => ({ ...notification, isRead: true })),
    }));
    markNotificationsRead(unread);
  },
}));
