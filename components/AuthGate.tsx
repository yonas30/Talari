import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';

import AppButton from './AppButton';
import { isAppLockEnabled } from '../utils/appLock';

export default function AuthGate({ children }: { children: React.ReactNode }) {
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
      promptMessage: 'Unlock My Finances',
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
    });
  }, []);

  useEffect(() => {
    if (lockRequired) {
      void attemptUnlock();
    }
  }, [lockRequired]);

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
        <Text style={styles.title}>My Finances is locked</Text>
        {error && <Text style={styles.error}>{error}</Text>}
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
    backgroundColor: '#f8fafc',
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
