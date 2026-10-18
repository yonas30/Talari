import { create } from 'zustand';

import { markNotificationsRead } from '../db/database';
import { AppNotification } from '../types/notifications';
import { INITIAL_BALANCES_HIDDEN, toggleBalancesHidden } from '../utils/balanceVisibility';
import {
  clearAllNotifications as clearAllItems,
  forgetReadIds as withoutReadIds,
  markAllRead,
  markRead,
  mergeNotifications,
  replaceGoalItems,
} from '../utils/notificationList';

// The shape lives in types/notifications.ts (goal notifications joined the budget alerts in Phase 5D).
export type { AppNotification };

export interface DevHomePreview {
  noSpending: boolean;
  noTransactions: boolean;
  noGoals: boolean;
  noStreak: boolean;
}

export const NO_DEV_HOME_PREVIEW: DevHomePreview = { noSpending: false, noTransactions: false, noGoals: false, noStreak: false };

interface UiState {
  isDrawerOpen: boolean;
  // The splash overlay has left. Anything that opens a native Modal (which draws above the splash) waits for this.
  isSplashDone: boolean;
  setSplashDone: () => void;
  // Development only: preview Home's empty states without touching real data (see components/DevHomeRow.tsx).
  devHomePreview: DevHomePreview;
  setDevHomePreview: (patch: Partial<DevHomePreview>) => void;
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
  // The saved goal notifications as they are now: the list gains the new ones and loses any that were deleted, expired or cleared.
  replaceGoalNotifications: (items: AppNotification[]) => void;
  // Their read records go when the notifications do.
  forgetReadIds: (ids: string[]) => void;
  // "Clear all": goal notifications leave the list, the (recomputed) budget alerts are marked read.
  clearAllNotifications: () => void;
  removeNotificationsWhere: (predicate: (item: AppNotification) => boolean) => void;
  markNotificationAsRead: (id: string) => void;
  markAllNotificationsAsRead: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  isDrawerOpen: false,
  isSplashDone: false,
  setSplashDone: () => set({ isSplashDone: true }),
  devHomePreview: NO_DEV_HOME_PREVIEW,
  setDevHomePreview: (patch) => set((state) => ({ devHomePreview: { ...state.devHomePreview, ...patch } })),
  // Balances start hidden every launch; the eye button reveals them (V2 Part I).
  isBalanceHidden: INITIAL_BALANCES_HIDDEN,
  notifications: [],
  readIds: {},
  openDrawer: () => set({ isDrawerOpen: true }),
  closeDrawer: () => set({ isDrawerOpen: false }),
  toggleBalanceVisibility: () => set((state) => ({ isBalanceHidden: toggleBalancesHidden(state.isBalanceHidden) })),
  hydrateReadIds: (ids) =>
    set((state) => ({
      readIds: { ...state.readIds, ...Object.fromEntries(ids.map((id) => [id, true as const])) },
      notifications: state.notifications.map((item) => (ids.includes(item.id) ? { ...item, isRead: true } : item)),
    })),
  // Seen once (this session or an earlier one) stays seen while the notification keeps existing (utils/notificationList.ts).
  upsertNotifications: (items) =>
    set((state) => ({ notifications: mergeNotifications(state.notifications, items, state.readIds, new Date().toISOString()) })),
  replaceGoalNotifications: (items) =>
    set((state) => ({ notifications: replaceGoalItems(state.notifications, items, state.readIds, new Date().toISOString()) })),
  forgetReadIds: (ids) => set((state) => ({ readIds: withoutReadIds(state.readIds, ids) })),
  clearAllNotifications: () => {
    const unread = get().notifications.filter((item) => item.type !== 'goal' && !item.isRead).map((item) => item.id);
    set((state) => ({
      readIds: { ...state.readIds, ...Object.fromEntries(unread.map((id) => [id, true as const])) },
      notifications: clearAllItems(state.notifications),
    }));
    if (unread.length > 0) {
      markNotificationsRead(unread);
    }
  },
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
      notifications: markRead(state.notifications, [id]),
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
      notifications: markAllRead(state.notifications),
    }));
    markNotificationsRead(unread);
  },
}));
