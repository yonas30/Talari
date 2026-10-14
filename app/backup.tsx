import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { useRouter } from 'expo-router';

import AppearanceRow from '../components/AppearanceRow';
import AppHeader from '../components/AppHeader';
import DevHomeRow from '../components/DevHomeRow';
import DevOnboardingRow from '../components/DevOnboardingRow';
import NameSheet from '../components/NameSheet';
import SettingsGroup from '../components/SettingsGroup';
import SettingsRow from '../components/SettingsRow';
import { useProfileStore } from '../store/profile';
import { useUiStore } from '../store/ui';
import { useTheme } from '../theme/ThemeProvider';
import { isAppLockEnabled, setAppLockEnabled } from '../utils/appLock';

export default function SettingsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const notifications = useUiStore((state) => state.notifications);
  const [lockEnabled, setLockEnabled] = useState(false);
  const name = useProfileStore((state) => state.profile.name);
  const saveName = useProfileStore((state) => state.saveName);
  const clearName = useProfileStore((state) => state.clearName);
  const [nameSheetOpen, setNameSheetOpen] = useState(false);

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
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader title="Settings" />
      <ScrollView contentContainerStyle={styles.container}>
        <SettingsGroup title="Preferences">
          <AppearanceRow />
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
            accessibilityLabel={unreadNotifications > 0 ? `Notifications, ${unreadNotifications} unread` : 'Notifications'}
            onPress={() => router.push('/notifications')}
            isLast
          />
        </SettingsGroup>

        <SettingsGroup title="Profile">
          <SettingsRow
            icon="person-outline"
            title="Your name"
            subtitle={name ?? 'Not set'}
            onPress={() => setNameSheetOpen(true)}
            isLast
          />
        </SettingsGroup>

        <SettingsGroup title="Security and data">
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
        </SettingsGroup>

        {/* Development builds only (Expo Go / dev client): never present in preview or production builds. */}
        {__DEV__ ? <DevOnboardingRow /> : null}
        {__DEV__ ? <DevHomeRow /> : null}
      </ScrollView>

      <NameSheet
        visible={nameSheetOpen}
        title="Your name"
        body="Shown in your greeting on Home. Stays on this phone."
        initialName={name ?? ''}
        emptyMessage={name ? 'Add a name, or tap Remove name.' : 'Add a name to save it.'}
        secondaryLabel={name ? 'Remove name' : undefined}
        onSave={(value) => {
          saveName(value);
          setNameSheetOpen(false);
        }}
        onSecondary={() => {
          clearName();
          setNameSheetOpen(false);
        }}
        onClose={() => setNameSheetOpen(false)}
      />
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
    gap: 16,
  },
});
