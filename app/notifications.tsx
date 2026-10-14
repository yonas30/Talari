import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import AppHeader from '../components/AppHeader';
import AppText from '../components/AppText';
import { useUiStore } from '../store/ui';
import { useTheme } from '../theme/ThemeProvider';

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const notifications = useUiStore((state) => state.notifications);
  const markAllNotificationsAsRead = useUiStore((state) => state.markAllNotificationsAsRead);
  const markNotificationAsRead = useUiStore((state) => state.markNotificationAsRead);
  const router = useRouter();

  useEffect(() => {
    markAllNotificationsAsRead();
  }, [markAllNotificationsAsRead]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader title="Notifications" hideBell />
      <ScrollView contentContainerStyle={styles.container}>
        {notifications.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={28} color={colors.textMuted} />
            <AppText style={[styles.emptyTitle, { color: colors.text }]}>No notifications yet</AppText>
            <AppText style={[styles.emptyText, { color: colors.textMuted }]}>You’re all caught up for now.</AppText>
          </View>
        ) : (
          notifications.map((notification) => {
            const isBudget = notification.type === 'budget';
            const isWarning = notification.level === 'warning';
            const spoken = notification.accessibilityLabel ?? `${notification.title}. ${notification.description}`;
            const summary = notification.route ? `${spoken} Opens budgets.` : spoken;
            return (
              <Pressable
                key={notification.id}
                style={({ pressed }) => [
                  styles.card,
                  { backgroundColor: pressed ? colors.bg : colors.surface, borderColor: colors.border },
                ]}
                onPress={() => {
                  markNotificationAsRead(notification.id);
                  if (notification.route) {
                    router.push(notification.route as never);
                  }
                }}
                accessibilityRole="button"
                // Unread is said out loud as well as shown (a dot and a bolder title), so it never depends on colour.
                accessibilityLabel={notification.isRead ? summary : `Unread. ${summary}`}
              >
                <View style={[styles.disc, { backgroundColor: isWarning ? colors.accentDisc : isBudget ? colors.expenseWash : colors.netDisc }]}>
                  <Ionicons
                    name={isWarning ? 'alert-circle-outline' : isBudget ? 'wallet-outline' : 'information-circle-outline'}
                    size={18}
                    color={isWarning ? colors.primaryText : isBudget ? colors.expense : colors.netGlyph}
                  />
                </View>
                <View style={styles.body}>
                  <View style={styles.titleRow}>
                    <AppText style={[styles.title, { color: colors.text, fontWeight: notification.isRead ? '600' : '800' }]}>
                      {notification.title}
                    </AppText>
                    {!notification.isRead && <View style={[styles.unreadDot, { backgroundColor: colors.danger }]} />}
                  </View>
                  <AppText style={[styles.description, { color: colors.textMuted }]}>{notification.description}</AppText>
                  {notification.route && (
                    <AppText style={[styles.action, { color: colors.primaryText }]}>Review budgets →</AppText>
                  )}
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
