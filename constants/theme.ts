import { lightColors } from '../theme/tokens';

// Legacy static palette used by the existing screens (Light only). The new tokens in theme/tokens.ts are the single
// source of truth: a key here is built from a token ONLY where the new value is imperceptibly different from the old one
// (CIEDE2000 < 3, checked by scripts/verify-contrast.ts). Every other key keeps its old value on purpose - those colours
// move screen by screen in Phases 3 and 4 when the screen is migrated to useTheme().
export const colors = {
  background: lightColors.bg, // was #F7F7F3 (dE 1.0)
  surface: lightColors.surface, // unchanged #FFFFFF
  navy: lightColors.text, // was #172033 (dE 2.6)
  textSecondary: '#66708B', // kept: new textMuted #5B6679 is visibly darker (dE 5.4)
  olive: '#6B7D3A', // kept: new goals tokens are a different, desaturated olive (dE 7.2)
  oliveLight: '#E8EDDC',
  orange: '#E87532', // kept: primary #F47C20 is visibly brighter (dE 4.5)
  orangeLight: '#FCE8DA',
  blue: '#4169E1', // kept: moves to the net/saved tokens in Phase 3
  red: '#D95C5C', // kept: expense tokens differ visibly (dE 11)
  redLight: '#FBE4E4',
  // Status colors from the design system reference — distinct from the olive/orange accents.
  statusIncome: '#16A34A', // kept (income token differs, dE 15)
  statusExpense: '#D95C5C', // kept
  statusWarning: '#F59E0B',
  statusInfo: '#3B82F6',
};

export const typography = {
  pageTitle: { fontSize: 28, fontWeight: '800' as const },
  sectionTitle: { fontSize: 18, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  helper: { fontSize: 13, fontWeight: '400' as const },
  bigNumber: { fontSize: 32, fontWeight: '800' as const },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
};

export const radius = {
  card: 16,
  button: 12,
  pill: 999,
};

// Single-user app — this is a personal, non-generic finance tool.
export const APP_USER_NAME = 'Yonas';
