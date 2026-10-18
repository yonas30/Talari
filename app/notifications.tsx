import { useCallback, useMemo } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';

import AppHeader from '../components/AppHeader';
import AppText from '../components/AppText';
import { useFinanceStore } from '../store/finance';
import { useUiStore } from '../store/ui';
import { useTheme } from '../theme/ThemeProvider';
import {
  notificationActionLabel,
  notificationOpensLabel,
  notificationTarget,
  notificationVisualState,
  sortNewestFirst,
} from '../utils/notificationList';

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const notifications = useUiStore((state) => state.notifications);
  const markNotificationAsRead = useUiStore((state) => state.markNotificationAsRead);
  const markReserveNotificationsRead = useFinanceStore((state) => state.markReserveNotificationsRead);
  const clearReserveNotifications = useFinanceStore((state) => state.clearReserveNotifications);
  const router = useRouter();
  // Budget alerts and goal notifications in one list, the newest first.
  const ordered = useMemo(() => sortNewestFirst(notifications), [notifications]);

  // Opening the page marks nothing: unread items are shown as unread so they can be seen. An item is marked read when it is tapped, and
  // whatever is left is marked read when the user LEAVES the page (the cleanup of a focus effect runs when the screen loses focus or closes),
  // so the bell badge drops when they leave, not on arrival. Goal notifications also have their own saved read flag (it travels with a
  // backup), so that is saved too.
  useFocusEffect(
    useCallback(
      () => () => {
        useUiStore.getState().markAllNotificationsAsRead();
        void useFinanceStore.getState().markReserveNotificationsRead();
      },
      [],
    ),
  );

  const confirmClearAll = () => {
    Alert.alert(
      'Clear all notifications?',
      'This removes your goal notifications for good. Budget alerts are worked out from your spending, so they cannot be removed: they are marked as read instead.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear all', style: 'destructive', onPress: () => void clearReserveNotifications() },
      ],
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader title="Notifications" hideBell />
      <ScrollView contentContainerStyle={styles.container}>
        {notifications.length > 0 ? (
          <Pressable
            onPress={confirmClearAll}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear all notifications"
            style={({ pressed }) => [styles.clearRow, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="trash-outline" size={16} color={colors.primaryText} />
            <AppText style={[styles.clearText, { color: colors.primaryText }]}>Clear all</AppText>
          </Pressable>
        ) : null}

        {notifications.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={28} color={colors.textMuted} />
            <AppText style={[styles.emptyTitle, { color: colors.text }]}>No notifications yet</AppText>
            <AppText style={[styles.emptyText, { color: colors.textMuted }]}>You’re all caught up for now.</AppText>
          </View>
        ) : (
          ordered.map((notification) => {
            const isBudget = notification.type === 'budget';
            const isGoal = notification.type === 'goal';
            const isWarning = notification.level === 'warning';
            const spoken = notification.accessibilityLabel ?? `${notification.title}. ${notification.description}`;
            const opens = notificationOpensLabel(notification);
            const summary = opens ? `${spoken} ${opens}` : spoken;
            const target = notificationTarget(notification);
            const action = notificationActionLabel(notification);
            const visual = notificationVisualState(notification);
            return (
              <Pressable
                key={notification.id}
                style={({ pressed }) => [
                  styles.card,
                  // Unread: a slightly stronger background (and the dot and bolder title below); read: the plain card.
                  { backgroundColor: pressed ? colors.bg : visual.tinted ? colors.surfaceMuted : colors.surface, borderColor: colors.border },
                ]}
                onPress={() => {
                  // Tapping marks this one read (the rest are marked when the page is left).
                  markNotificationAsRead(notification.id);
                  if (isGoal) {
                    void markReserveNotificationsRead([notification.id]);
                  }
                  if (target) {
                    router.push(target as never);
                  }
                }}
                accessibilityRole="button"
                // Unread is said out loud as well as shown (a dot and a bolder title), so it never depends on colour.
                accessibilityLabel={`${visual.accessibilityPrefix}${summary}`}
              >
                <View style={[styles.disc, { backgroundColor: isWarning ? colors.accentDisc : isGoal ? colors.goalsDisc : isBudget ? colors.expenseWash : colors.netDisc }]}>
                  <Ionicons
                    name={isWarning ? 'alert-circle-outline' : isGoal ? 'flag-outline' : isBudget ? 'wallet-outline' : 'information-circle-outline'}
                    size={18}
                    color={isWarning ? colors.primaryText : isGoal ? colors.goalsGlyph : isBudget ? colors.expense : colors.netGlyph}
                  />
                </View>
                <View style={styles.body}>
                  <View style={styles.titleRow}>
                    <AppText style={[styles.title, { color: colors.text, fontWeight: notification.isRead ? '600' : '800' }]}>
                      {notification.title}
                    </AppText>
                    {visual.dot && <View style={[styles.unreadDot, { backgroundColor: colors.danger }]} />}
                  </View>
                  <AppText style={[styles.description, { color: colors.textMuted }]}>{notification.description}</AppText>
                  {action !== null && <AppText style={[styles.action, { color: colors.primaryText }]}>{action}</AppText>}
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 12,
  },
  clearRow: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 32,
  },
  clearText: {
    fontSize: 14,
    fontWeight: '600',
  },
  empty: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 40,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderWidth: 1,
    borderRadius: 20,
    padding: 14,
  },
  disc: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 15,
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  description: {
    fontSize: 13,
    lineHeight: 19,
  },
  action: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
  },
});
