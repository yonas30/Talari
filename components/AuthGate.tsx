import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

import AppButton from './AppButton';
import { colors } from '../constants/theme';
import { isAppLockEnabled } from '../utils/appLock';
import AppText from './AppText';

type Props = {
  children: React.ReactNode;
  /** Called once, as soon as it is known whether the lock screen or the app comes first. */
  onLockResolved?: () => void;
  /**
   * False holds back the automatic biometric prompt (the Unlock button still works). The splash uses this so that no
   * system dialog appears over its animation.
   */
  promptAllowed?: boolean;
};

export default function AuthGate({ children, onLockResolved, promptAllowed = true }: Props) {
  const [lockRequired, setLockRequired] = useState<boolean | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attemptUnlock = async () => {
    setError(null);
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();

    if (!hasHardware || !isEnrolled) {
      // No biometrics/PIN enrolled on this device — do not block access.
      setIsUnlocked(true);
      return;
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Talari',
      fallbackLabel: 'Use passcode',
    });

    if (result.success) {
      setIsUnlocked(true);
    } else {
      setError('Authentication failed. Try again.');
    }
  };

  useEffect(() => {
    void isAppLockEnabled().then((enabled) => {
      setLockRequired(enabled);
      if (!enabled) {
        setIsUnlocked(true);
      }
      onLockResolved?.();
    });
    // onLockResolved must be a stable callback (it is only ever called once the lock state is known).
  }, [onLockResolved]);

  useEffect(() => {
    if (lockRequired && promptAllowed) {
      void attemptUnlock();
    }
  }, [lockRequired, promptAllowed]);

  if (lockRequired === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1d4ed8" />
      </View>
    );
  }

  if (lockRequired && !isUnlocked) {
    return (
      <View style={styles.center}>
        <AppText style={styles.title}>Talari is locked</AppText>
        {error && <AppText style={styles.error}>{error}</AppText>}
        <AppButton title="Unlock" variant="primary" onPress={() => void attemptUnlock()} />
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    gap: 16,
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  error: {
    color: '#dc2626',
    fontSize: 13,
  },
});
