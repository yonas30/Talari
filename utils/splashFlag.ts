import * as SecureStore from 'expo-secure-store';

// "Has the full first-launch splash been shown?" Stored next to the app-lock setting (SecureStore), which is where
// this app already keeps device-level settings that are not ledger data. It deliberately is not in SQLite: no schema
// change, and it is not part of a backup (a restored backup on a new install should still get the full intro once).
const SPLASH_SEEN_KEY = 'intro-splash-seen';

export async function hasSeenIntroSplash(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(SPLASH_SEEN_KEY)) === 'true';
  } catch {
    // If the keystore cannot be read, play the short version rather than block launch.
    return true;
  }
}

export async function markIntroSplashSeen(): Promise<void> {
  try {
    await SecureStore.setItemAsync(SPLASH_SEEN_KEY, 'true');
  } catch {
    // Worst case the intro plays again next launch.
  }
}
