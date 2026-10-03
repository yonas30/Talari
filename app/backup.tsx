import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import AppHeader from '../components/AppHeader';
import { colors, radius, spacing, typography } from '../constants/theme';
import { useUiStore } from '../store/ui';
import { isAppLockEnabled, setAppLockEnabled } from '../utils/appLock';

export default function SettingsScreen() {
  const router = useRouter();
  const notifications = useUiStore((state) => state.notifications);
  const [lockEnabled, setLockEnabled] = useState(false);

  useEffect(() => {
    void isAppLockEnabled().then(setLockEnabled);
  }, []);

  const unreadNotifications = notifications.filter((notification) => !notification.isRead).length;

  const onToggleAppLock = async () => {
    if (!lockEnabled) {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !isEnrolled) {
        Alert.alert(
          'No lock method set up',
          'Set up a fingerprint, face unlock, or device passcode in your phone settings first.',
        );
        return;
      }
    }

    const nextValue = !lockEnabled;
    await setAppLockEnabled(nextValue);
    setLockEnabled(nextValue);
  };

  const rows = [
    {
      title: 'Categories',
      subtitle: 'Add, edit, or delete categories',
      icon: 'list-outline' as const,
      onPress: () => router.push('/categories'),
      showArrow: true,
    },
    {
      title: 'Notifications',
      subtitle: unreadNotifications > 0 ? `${unreadNotifications} unread` : 'Everything is up to date',
      icon: 'notifications-outline' as const,
      onPress: () => router.push('/notifications'),
      showArrow: true,
      showDot: unreadNotifications > 0,
    },
    {
      title: 'App lock',
      subtitle: 'Secure your data with biometrics or passcode',
      icon: 'lock-closed-outline' as const,
      toggleValue: lockEnabled,
      onToggle: () => void onToggleAppLock(),
      showArrow: false,
    },
    {
      title: 'Export / Restore',
      subtitle: 'Backup and restore your data',
      icon: 'download-outline' as const,
      onPress: () => router.push('/export-data'),
      showArrow: true,
    },
    {
      title: 'About',
      subtitle: 'Learn about the app and its story',
      icon: 'information-circle-outline' as const,
      onPress: () => router.push('/about'),
      showArrow: true,
    },
  ];

  return (
    <View style={styles.screen}>
      <AppHeader title="Settings" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          {rows.map((row) => (
            <View key={row.title} style={styles.rowWrap}>
              {row.showArrow ? (
                <Pressable style={styles.menuItem} onPress={row.onPress}>
                  <View style={styles.menuItemContent}>
                    <Ionicons name={row.icon} size={20} color={colors.navy} />
                    <View style={styles.menuItemText}>
                      <Text style={styles.menuItemTitle}>{row.title}</Text>
                      <Text style={styles.menuItemDescription}>{row.subtitle}</Text>
                    </View>
                  </View>
                  <View style={styles.endColumn}>
                    {row.showDot && <View style={styles.unreadDot} />}
                    <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                  </View>
                </Pressable>
              ) : (
                <View style={styles.menuItem}>
                  <View style={styles.menuItemContent}>
                    <Ionicons name={row.icon} size={20} color={colors.navy} />
                    <View style={styles.menuItemText}>
                      <Text style={styles.menuItemTitle}>{row.title}</Text>
                      <Text style={styles.menuItemDescription}>{row.subtitle}</Text>
                    </View>
                  </View>
                  <Switch value={row.toggleValue ?? false} onValueChange={row.onToggle} />
                </View>
              )}
            </View>
          ))}
        </View>
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
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  rowWrap: {
    borderBottomWidth: 1,
    borderBottomColor: colors.background,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  menuItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  menuItemText: {
    gap: 2,
    flex: 1,
  },
  menuItemTitle: {
    fontWeight: '700',
    color: colors.navy,
    fontSize: 15,
  },
  menuItemDescription: {
    ...typography.helper,
    color: colors.textSecondary,
    fontSize: 13,
  },
  endColumn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.red,
  },
});
