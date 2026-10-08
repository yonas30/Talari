import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, DevSettings, useColorScheme } from 'react-native';

import { getThemeMode, setThemeMode, ThemeMode, DEFAULT_THEME_MODE } from '../utils/themePreference';
import { APPEARANCE_ENABLED } from './config';
import { palettes, ThemeColors, ThemeScheme } from './tokens';

export interface ThemeContextValue {
  /** The saved preference ('system' by default). It is saved even while Appearance is hidden. */
  mode: ThemeMode;
  /** The scheme actually in use. */
  scheme: ThemeScheme;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => void;
  /** The saved preference has been read; until then `scheme` is Light. */
  ready: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const DEV_CYCLE: ThemeMode[] = ['light', 'dark', 'system'];

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(DEFAULT_THEME_MODE);
  const [ready, setReady] = useState(false);
  // Development-only override for testing the migrated parts. In memory only, so it can never reach a user.
  const [devMode, setDevMode] = useState<ThemeMode | null>(null);
  const systemScheme = useColorScheme();

  useEffect(() => {
    let cancelled = false;
    void getThemeMode().then((saved) => {
      if (!cancelled) {
        setModeState(saved);
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Dev menu entry (shake the device / Ctrl+M): cycles Light -> Dark -> System. Not present in release builds.
  useEffect(() => {
    if (!__DEV__) {
      return;
    }
    DevSettings.addMenuItem('Talari: cycle theme (Light / Dark / System)', () => {
      setDevMode((current) => DEV_CYCLE[(DEV_CYCLE.indexOf(current ?? 'light') + 1) % DEV_CYCLE.length]);
    });
  }, []);

  // Until Phase 4 the app is Light for users, whatever is saved (see theme/config.ts).
  const effectiveMode: ThemeMode = APPEARANCE_ENABLED ? mode : __DEV__ ? (devMode ?? 'light') : 'light';
  const scheme: ThemeScheme = effectiveMode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : effectiveMode;

  // Keep native pieces (system dialogs, date pickers, keyboard) in step with the choice. 'unspecified' = follow the system.
  useEffect(() => {
    Appearance.setColorScheme(effectiveMode === 'system' ? 'unspecified' : effectiveMode);
    if (__DEV__) {
      // Evidence for "does Appearance.setColorScheme work in Expo Go": compare these in the Metro log.
      console.log(`[theme] mode=${effectiveMode} scheme=${scheme} Appearance.getColorScheme()=${Appearance.getColorScheme()}`);
    }
  }, [effectiveMode, scheme]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void setThemeMode(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, scheme, colors: palettes[scheme], setMode, ready }),
    [mode, scheme, setMode, ready],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme must be used inside <ThemeProvider>.');
  }
  return value;
}

// For shared components that must also work outside a provider (tests, the splash before the tree is up): same value as
// useTheme() when there is a provider, the Light palette otherwise.
export function useThemeColors(): ThemeColors {
  return useContext(ThemeContext)?.colors ?? palettes.light;
}
