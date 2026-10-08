import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { useRouter } from 'expo-router';

import AppHeader from '../components/AppHeader';
import DevThemeRow from '../components/DevThemeRow';
import SettingsRow from '../components/SettingsRow';
import { colors, radius, spacing } from '../constants/theme';
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

  return (
    <View style={styles.screen}>
      <AppHeader title="Settings" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <SettingsRow
            icon="cash-outline"
            title="Currency & Exchange Rates"
            subtitle="Rates used to convert foreign amounts to ETB"
            onPress={() => router.push('/exchange-rates')}
          />
          <SettingsRow
            icon="grid-outline"
            title="Categories"
            subtitle="Add, edit, or delete categories"
            onPress={() => router.push('/categories')}
          />
          <SettingsRow
            icon="notifications-outline"
            title="Notifications"
            subtitle={unreadNotifications > 0 ? `${unreadNotifications} unread` : 'Everything is up to date'}
            showDot={unreadNotifications > 0}
            onPress={() => router.push('/notifications')}
            isLast
          />
        </View>

        <View style={styles.card}>
          <SettingsRow
            icon="lock-closed-outline"
            title="App lock"
            subtitle="Secure your data with biometrics or passcode"
            toggleValue={lockEnabled}
            onToggle={() => void onToggleAppLock()}
          />
          <SettingsRow
            icon="download-outline"
            title="Export / Restore"
            subtitle="Back up and restore your data"
            onPress={() => router.push('/export-data')}
          />
          <SettingsRow
            icon="information-circle-outline"
            title="About"
            subtitle="Learn about the app and its story"
            onPress={() => router.push('/about')}
            isLast
          />
        </View>

        {/* Development builds only (Expo Go / dev client): never present in preview or production builds. */}
        {__DEV__ ? <DevThemeRow /> : null}
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
    gap: spacing.lg,
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
});
