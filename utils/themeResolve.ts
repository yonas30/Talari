// Pure rules for the Appearance setting: what is saved, and which scheme is shown. No native imports, so scripts/verify-appearance.ts
// can run it under Node.
export type ThemeMode = 'system' | 'light' | 'dark';
export type ThemeScheme = 'light' | 'dark';

export const DEFAULT_THEME_MODE: ThemeMode = 'system';

// A saved value is only trusted if it is exactly one of the three modes; anything else (missing, empty, another case, a future value,
// a corrupt entry) is the default.
export function parseThemeMode(value: unknown): ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark' ? value : DEFAULT_THEME_MODE;
}

// The scheme to draw. 'system' follows the phone; React Native reports the phone's scheme as 'light', 'dark', 'unspecified' or nothing,
// and anything that is not exactly 'dark' is drawn as Light.
export function resolveScheme(mode: ThemeMode, systemScheme: string | null | undefined): ThemeScheme {
  if (mode === 'system') {
    return systemScheme === 'dark' ? 'dark' : 'light';
  }
  return mode;
}

// What to tell the native side (Appearance.setColorScheme) so system dialogs, the date picker and the keyboard match: 'unspecified'
// hands control back to the phone.
export function nativeSchemeRequest(mode: ThemeMode): 'unspecified' | ThemeScheme {
  return mode === 'system' ? 'unspecified' : mode;
}
