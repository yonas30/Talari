import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans/700Bold';
import { PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans/800ExtraBold';
import { useFonts } from 'expo-font';
import { useEffect, useState } from 'react';

// The font set, keyed by family name. The same files are also embedded natively by the expo-font config plugin in
// app.json (fonts are then available from the first frame in a real build); this runtime loader is what makes them
// work in Expo Go, which cannot use the plugin.
export const APP_FONTS = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
};

// If the fonts have not loaded after this long, stop waiting for them: text falls back to the system font rather than
// holding the splash forever.
export const FONT_WAIT_LIMIT_MS = 4000;

/** `ready` is true once the fonts loaded, failed, or the wait limit passed - never an indefinite hold. */
export function useAppFonts(): { loaded: boolean; ready: boolean } {
  const [loaded, error] = useFonts(APP_FONTS);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), FONT_WAIT_LIMIT_MS);
    return () => clearTimeout(timer);
  }, []);

  return { loaded, ready: loaded || error !== null || timedOut };
}
