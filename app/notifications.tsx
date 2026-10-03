import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import AppHeader from '../components/AppHeader';
import { colors, radius, spacing, typography } from '../constants/theme';
import { useUiStore } from '../store/ui';

export default function NotificationsScreen() {
  const notifications = useUiStore((state) => state.notifications);
  const markAllNotificationsAsRead = useUiStore((state) => state.markAllNotificationsAsRead);

  useEffect(() => {
    markAllNotificationsAsRead();
  }, [markAllNotificationsAsRead]);

  return (
    <View style={styles.screen}>
      <AppHeader title="Notifications" />
      <ScrollView contentContainerStyle={styles.container}>
        {notifications.length === 0 ? (
          <View style={styles.emptyStateCard}>
            <Ionicons name="notifications-off-outline" size={28} color={colors.textSecondary} />
            <Text style={styles.emptyTitle}>No notifications yet</Text>
            <Text style={styles.emptyText}>You’re all caught up for now.</Text>
          </View>
        ) : (
          notifications.map((notification) => (
            <Pressable key={notification.id} style={styles.notificationCard}>
              <View style={styles.iconWrap}>
                <Ionicons
                  name={notification.type === 'budget' ? 'wallet-outline' : 'information-circle-outline'}
                  size={18}
                  color={notification.type === 'budget' ? colors.orange : colors.blue}
                />
              </View>
              <View style={styles.body}>
                <View style={styles.titleRow}>
                  <Text style={styles.title}>{notification.title}</Text>
                  {!notification.isRead && <View style={styles.unreadDot} />}
                </View>
                <Text style={styles.description}>{notification.description}</Text>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  emptyStateCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  emptyTitle: {
    ...typography.sectionTitle,
    color: colors.navy,
  },
  emptyText: {
    ...typography.helper,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  notificationCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.oliveLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    ...typography.sectionTitle,
    color: colors.navy,
    flex: 1,
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.red,
  },
  description: {
    ...typography.helper,
    color: colors.textSecondary,
    lineHeight: 20,
  },
});
