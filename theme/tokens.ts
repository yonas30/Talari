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
  /** The dim behind sheets, pickers and the drawer. */
  scrim: string;
  /** Destructive actions (Delete, Remove): the expense tone as a fill, and the text on it. */
  danger: string;
  onDanger: string;
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
  /**
   * Icon discs: a pale 16% tint of the brand fill with the text-safe glyph colour on it (both themes). The glyph colours
   * below are what to draw ON the matching disc.
   */
  incomeDisc: string;
  expenseDisc: string;
  netDisc: string;
  transferDisc: string;
  incomeGlyph: string;
  expenseGlyph: string;
  netGlyph: string;
  transferGlyph: string;
  /** Goals: the pale disc behind a goal's icon, the glyph on it, and the progress-bar fill (the goals colour; its track is surfaceMuted). */
  goalsDisc: string;
  goalsGlyph: string;
  goalsBar: string;
  /** A light wash of the expense colour: the over-budget banner. */
  expenseWash: string;
  /** Net at 18.66 px bold or more counts as large text (3:1), so Light may use the vivid brand blue for it. */
  netLarge: string;
  /** The thin line between the balance and the Available / Saved columns on the hero card. */
  heroDivider: string;
  /** Streak card: a rich peach with an orange edge in Light, the plain surface in Dark. */
  streakFill: string;
  streakBorder: string;
  /** The flame glyph: navy on its solid orange disc in Light, the brand orange in Dark. */
  streakAccent: string;
  /** Disc behind the flame (solid orange in Light, none in Dark) and the colour of the subtitle on the streak card. */
  streakDisc: string;
  streakMuted: string;
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
// Icon discs on Home (and the recent list): pale, so they do not compete with the numbers.
export const DISC_ALPHA = 0.16;

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
  scrim: 'rgba(23,35,60,0.4)',
  danger: '#C23A33',
  onDanger: '#FFFFFF',
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
  incomeDisc: withAlpha(brandFills.income, DISC_ALPHA),
  expenseDisc: withAlpha(brandFills.expense, DISC_ALPHA),
  netDisc: withAlpha(brandFills.net, DISC_ALPHA),
  transferDisc: withAlpha(brandFills.transfer, DISC_ALPHA),
  incomeGlyph: '#1F7A4A',
  expenseGlyph: '#C23A33',
  netGlyph: '#3A6AA8',
  transferGlyph: '#6B5B9E',
  goalsDisc: withAlpha(brandFills.goals, DISC_ALPHA),
  goalsGlyph: '#5F6D49',
  goalsBar: brandFills.goals,
  expenseWash: withAlpha(brandFills.expense, 0.12),
  netLarge: brandFills.net,
  heroDivider: 'rgba(255,255,255,0.14)',
  streakFill: '#FFD9B8',
  streakBorder: '#F47C20',
  streakAccent: '#17233C',
  streakDisc: '#F47C20',
  streakMuted: '#17233C',
};

export const darkColors: ThemeColors = {
  bg: '#101522',
  surface: '#182033',
  surfaceMuted: '#222C44',
  border: 'rgba(255,255,255,0.08)',
  scrim: 'rgba(0,0,0,0.6)',
  danger: '#E8736F',
  onDanger: '#17233C',
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
  incomeDisc: withAlpha(brandFills.income, DISC_ALPHA),
  expenseDisc: withAlpha(brandFills.expense, DISC_ALPHA),
  netDisc: withAlpha(brandFills.net, DISC_ALPHA),
  transferDisc: withAlpha(brandFills.transfer, DISC_ALPHA),
  incomeGlyph: '#2E9B62',
  expenseGlyph: '#E8736F',
  netGlyph: '#5B8FD0',
  transferGlyph: '#9A8CCB',
  goalsDisc: withAlpha(brandFills.goals, DISC_ALPHA),
  goalsGlyph: '#8FA070',
  goalsBar: '#8FA070',
  expenseWash: withAlpha(brandFills.expense, 0.12),
  netLarge: '#5B8FD0',
  heroDivider: 'rgba(255,255,255,0.14)',
  streakFill: '#182033',
  streakBorder: 'rgba(255,255,255,0.08)',
  streakAccent: '#F47C20',
  streakDisc: 'transparent',
  streakMuted: '#AEB5C2',
};

export const palettes: Record<ThemeScheme, ThemeColors> = { light: lightColors, dark: darkColors };
