import * as SecureStore from 'expo-secure-store';

// The user's Appearance choice. Stored next to the app-lock setting (SecureStore) because that is where this app keeps
// device-level preferences that are not ledger data: no schema change, and it is not part of a backup.
export type ThemeMode = 'system' | 'light' | 'dark';

const THEME_MODE_KEY = 'theme-mode';

export const DEFAULT_THEME_MODE: ThemeMode = 'system';

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

export async function getThemeMode(): Promise<ThemeMode> {
  try {
    const value = await SecureStore.getItemAsync(THEME_MODE_KEY);
    return isThemeMode(value) ? value : DEFAULT_THEME_MODE;
  } catch {
    // An unreadable keystore must never block launch.
    return DEFAULT_THEME_MODE;
  }
}

export async function setThemeMode(mode: ThemeMode): Promise<void> {
  try {
    await SecureStore.setItemAsync(THEME_MODE_KEY, mode);
  } catch {
    // The choice still applies for this session.
  }
}
