import { create } from 'zustand';

export interface AppNotification {
  id: string;
  title: string;
  description: string;
  isRead: boolean;
  type: 'budget' | 'system';
}

interface UiState {
  isDrawerOpen: boolean;
  isBalanceHidden: boolean;
  notifications: AppNotification[];
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleBalanceVisibility: () => void;
  upsertNotifications: (items: AppNotification[]) => void;
  removeNotificationsWhere: (predicate: (item: AppNotification) => boolean) => void;
  markNotificationAsRead: (id: string) => void;
  markAllNotificationsAsRead: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  isDrawerOpen: false,
  // Balances start hidden every launch; the eye button reveals them (V2 Part I).
  isBalanceHidden: true,
  notifications: [],
  openDrawer: () => set({ isDrawerOpen: true }),
  closeDrawer: () => set({ isDrawerOpen: false }),
  toggleBalanceVisibility: () => set((state) => ({ isBalanceHidden: !state.isBalanceHidden })),
  upsertNotifications: (items) =>
    set((state) => {
      const existing = new Map(state.notifications.map((item) => [item.id, item]));
      for (const item of items) {
        existing.set(item.id, { ...existing.get(item.id), ...item, isRead: existing.get(item.id)?.isRead ?? item.isRead });
      }
      return { notifications: Array.from(existing.values()) };
    }),
  removeNotificationsWhere: (predicate) =>
    set((state) => {
      const kept = state.notifications.filter((item) => !predicate(item));
      // Keep the same array when nothing was removed so subscribers don't re-render needlessly.
      return kept.length === state.notifications.length ? state : { notifications: kept };
    }),
  markNotificationAsRead: (id) =>
    set((state) => ({
      notifications: state.notifications.map((notification) =>
        notification.id === id ? { ...notification, isRead: true } : notification,
      ),
    })),
  markAllNotificationsAsRead: () =>
    set((state) => ({
      notifications: state.notifications.map((notification) => ({ ...notification, isRead: true })),
    })),
}));
