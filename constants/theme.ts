// Layout constants shared by the screens. All colour lives in theme/tokens.ts (read it with useTheme()).
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

