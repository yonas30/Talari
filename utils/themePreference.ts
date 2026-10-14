import * as SecureStore from 'expo-secure-store';

import { DEFAULT_THEME_MODE, parseThemeMode, ThemeMode } from './themeResolve';

// The user's Appearance choice. Stored next to the app-lock setting (SecureStore) because that is where this app keeps
// device-level preferences that are not ledger data: no schema change, and it is not part of a backup.
export { DEFAULT_THEME_MODE } from './themeResolve';
export type { ThemeMode } from './themeResolve';

const THEME_MODE_KEY = 'theme-mode';

export async function getThemeMode(): Promise<ThemeMode> {
  try {
    const value = await SecureStore.getItemAsync(THEME_MODE_KEY);
    return parseThemeMode(value);
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
