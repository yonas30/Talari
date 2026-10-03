import * as SecureStore from 'expo-secure-store';

const APP_LOCK_KEY = 'app-lock-enabled';

export async function isAppLockEnabled(): Promise<boolean> {
  const value = await SecureStore.getItemAsync(APP_LOCK_KEY);
  return value === 'true';
}

export async function setAppLockEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(APP_LOCK_KEY, enabled ? 'true' : 'false');
}
