export const colors = {
  background: '#F7F7F3',
  surface: '#FFFFFF',
  navy: '#172033',
  textSecondary: '#66708B',
  olive: '#6B7D3A',
  oliveLight: '#E8EDDC',
  orange: '#E87532',
  orangeLight: '#FCE8DA',
  blue: '#4169E1',
  red: '#D95C5C',
  redLight: '#FBE4E4',
  // Status colors from the design system reference — distinct from the olive/orange accents.
  statusIncome: '#16A34A',
  statusExpense: '#D95C5C',
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
