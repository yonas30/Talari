// Font families and the fontWeight -> family mapping. Pure (no React Native import) so scripts/verify-fonts.ts can test it.
//
// Why a mapping: on Android a custom font family is ONE weight, and combining it with `fontWeight` makes the system pick
// or synthesise another face. Existing styles say `fontWeight: '800'`, so the Text helper turns that into the matching
// per-weight family name and drops the fontWeight.

export type FontFamilyKind = 'body' | 'heading';

export const INTER = {
  400: 'Inter_400Regular',
  500: 'Inter_500Medium',
  600: 'Inter_600SemiBold',
  700: 'Inter_700Bold',
} as const;

export const JAKARTA = {
  700: 'PlusJakartaSans_700Bold',
  800: 'PlusJakartaSans_800ExtraBold',
} as const;

// React Native allows 'normal' | 'bold' | '100'..'900' (and numbers).
export function normaliseWeight(weight: string | number | undefined): number {
  if (weight === undefined || weight === 'normal') {
    return 400;
  }
  if (weight === 'bold') {
    return 700;
  }
  const parsed = typeof weight === 'number' ? weight : parseInt(weight, 10);
  return Number.isFinite(parsed) ? parsed : 400;
}

export function fontFamilyFor(kind: FontFamilyKind, weight: string | number | undefined): string {
  const value = normaliseWeight(weight);
  if (kind === 'heading') {
    // Only 700 and 800 are loaded for headings: anything lighter than 800 uses 700.
    return value >= 800 ? JAKARTA[800] : JAKARTA[700];
  }
  // Inter 400/500/600/700 are loaded: 100-300 -> 400, 800-900 -> 700.
  if (value >= 700) return INTER[700];
  if (value >= 600) return INTER[600];
  if (value >= 500) return INTER[500];
  return INTER[400];
}
