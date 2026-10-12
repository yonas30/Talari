// Talari V3 design tokens: the single source of truth for colour. Two palettes with identical keys.
//
// Text rules (checked by scripts/verify-contrast.ts): body text needs 4.5:1 against the surface it sits on, large bold
// text (>= 24 px) needs 3:1. "Brand fills" (icon circles, chart slices, dots) are NOT text, so they keep the brand colour
// and are listed separately below; only the text-safe variants are in the palettes.

export type ThemeScheme = 'light' | 'dark';

export interface ThemeColors {
  /** Screen background. */
  bg: string;
  /** Cards and sheets. */
  surface: string;
  /** Wells, chips and the unselected segment track. */
  surfaceMuted: string;
  border: string;
  /** Resting edge of text fields: a UI component edge, so 3:1 against both the field fill and the screen (WCAG 1.4.11). */
  inputBorder: string;
  text: string;
  textMuted: string;
  /** Fill of primary actions (orange). Never used for text. */
  primary: string;
  /** Text and icons placed ON the primary fill. */
  onPrimary: string;
  /** Orange text and links: darker than the fill in Light so it stays readable. */
  primaryText: string;
  /** The Total Balance hero card (navy in both schemes). */
  heroBg: string;
  /** Border of the hero card: none in Light, a hairline in Dark. */
  heroBorder: string;
  heroText: string;
  heroTextMuted: string;
  /** Text-safe financial colours. */
  income: string;
  expense: string;
  net: string;
  saved: string;
  transfer: string;
  goals: string;
  /** Accent word of the Welcome headline ("Talari"). Large bold text, so 3:1 is enough. */
  welcomeAccent: string;
  /** The one shared SegmentedControl. */
  segmentTrack: string;
  segmentSelectedBg: string;
  segmentSelectedText: string;
  segmentText: string;
  /** Tinted fills behind icons (about 14% of the brand fill), so the icon in the text-safe colour sits on a soft disc. */
  incomeTint: string;
  expenseTint: string;
  netTint: string;
  transferTint: string;
  /** The thin line between the balance and the Available / Saved columns on the hero card. */
  heroDivider: string;
  /** Streak card: soft orange wash in Light, the plain surface in Dark. */
  streakFill: string;
  streakBorder: string;
  /** The flame: the text-safe orange in Light, the brand orange in Dark. */
  streakAccent: string;
}

// Brand fills: icon circles, chart slices, dots. Same in both schemes (they are never text).
export const brandFills = {
  income: '#2E9B62',
  expense: '#D9534F',
  net: '#4D7FBF',
  saved: '#4D7FBF',
  transfer: '#7A6AA8',
  goals: '#71805A',
} as const;

// Icon circles use the brand colour at about 14% alpha.
export const FILL_TINT_ALPHA = 0.14;

export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const channel = (offset: number) => parseInt(value.slice(offset, offset + 2), 16);
  return `rgba(${channel(0)},${channel(2)},${channel(4)},${alpha})`;
}

export const lightColors: ThemeColors = {
  bg: '#F8F6F1',
  surface: '#FFFFFF',
  surfaceMuted: '#F1EEE7',
  border: '#E7E2D8',
  // 3.68:1 on the white field, 3.41:1 on the cream screen.
  inputBorder: '#8A8578',
  text: '#17233C',
  textMuted: '#5B6679',
  primary: '#F47C20',
  onPrimary: '#17233C',
  primaryText: '#BF3F12',
  heroBg: '#17233C',
  heroBorder: 'transparent',
  heroText: '#FFFFFF',
  heroTextMuted: 'rgba(255,255,255,0.72)',
  income: '#1F7A4A',
  expense: '#C23A33',
  net: '#3A6AA8',
  saved: '#3A6AA8',
  // Brief value #7A6AA8 is only 4.36:1 on the cream background and 4.07:1 on surfaceMuted, so the text-safe transfer
  // colour is a slightly deeper tint of the same hue (5.38:1 / 5.01:1). The brand FILL below keeps #7A6AA8.
  transfer: '#6B5B9E',
  // #71805A is 3.94:1 on cream; this is the same olive, darkened until it clears 4.5:1 on white, cream and surfaceMuted.
  goals: '#5F6D49',
  welcomeAccent: '#D9631A',
  segmentTrack: '#F1EEE7',
  segmentSelectedBg: '#17233C',
  segmentSelectedText: '#FFFFFF',
  segmentText: '#5B6679',
  incomeTint: withAlpha(brandFills.income, FILL_TINT_ALPHA),
  expenseTint: withAlpha(brandFills.expense, FILL_TINT_ALPHA),
  netTint: withAlpha(brandFills.net, FILL_TINT_ALPHA),
  transferTint: withAlpha(brandFills.transfer, FILL_TINT_ALPHA),
  heroDivider: 'rgba(255,255,255,0.14)',
  streakFill: withAlpha('#F47C20', FILL_TINT_ALPHA),
  streakBorder: '#E7E2D8',
  streakAccent: '#BF3F12',
};

export const darkColors: ThemeColors = {
  bg: '#101522',
  surface: '#182033',
  surfaceMuted: '#222C44',
  border: 'rgba(255,255,255,0.08)',
  // 3.67:1 on the dark surface field, 4.12:1 on the dark screen.
  inputBorder: '#6C7894',
  text: '#F5F5F2',
  textMuted: '#AEB5C2',
  primary: '#F47C20',
  onPrimary: '#17233C',
  primaryText: '#F47C20',
  heroBg: '#17233C',
  heroBorder: 'rgba(255,255,255,0.18)',
  heroText: '#FFFFFF',
  heroTextMuted: 'rgba(255,255,255,0.72)',
  income: '#2E9B62',
  expense: '#E8736F',
  net: '#5B8FD0',
  saved: '#5B8FD0',
  // Lighter tints of #7A6AA8 / #71805A (the raw values are 3.44:1 / 3.82:1 on the dark surface).
  transfer: '#9A8CCB',
  goals: '#8FA070',
  welcomeAccent: '#F47C20',
  // Selected segment: an off-white pill with navy text, clearly visible on the dark surface; unselected text is muted
  // on the #222C44 track.
  segmentTrack: '#222C44',
  segmentSelectedBg: '#F5F5F2',
  segmentSelectedText: '#17233C',
  segmentText: '#AEB5C2',
  incomeTint: withAlpha(brandFills.income, FILL_TINT_ALPHA),
  expenseTint: withAlpha(brandFills.expense, FILL_TINT_ALPHA),
  netTint: withAlpha(brandFills.net, FILL_TINT_ALPHA),
  transferTint: withAlpha(brandFills.transfer, FILL_TINT_ALPHA),
  heroDivider: 'rgba(255,255,255,0.14)',
  streakFill: '#182033',
  streakBorder: 'rgba(255,255,255,0.08)',
  streakAccent: '#F47C20',
};

export const palettes: Record<ThemeScheme, ThemeColors> = { light: lightColors, dark: darkColors };
