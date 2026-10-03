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
  markNotificationAsRead: (id: string) => void;
  markAllNotificationsAsRead: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  isDrawerOpen: false,
  isBalanceHidden: false,
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
