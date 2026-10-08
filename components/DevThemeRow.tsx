import { StyleSheet, View } from 'react-native';

import { radius, spacing } from '../constants/theme';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeMode } from '../utils/themePreference';
import AppText from './AppText';
import SegmentedControl from './SegmentedControl';

const OPTIONS: { key: ThemeMode; label: string }[] = [
  { key: 'light', label: 'Light' },
  { key: 'system', label: 'System' },
  { key: 'dark', label: 'Dark' },
];

// Development-only switch for testing the migrated parts in Dark. Rendered by Settings only when __DEV__ is true. It is a
// plain row (not a SettingsRow) because it needs three choices, and it uses the shared SegmentedControl on purpose so the
// Dark segmented style gets exercised too.
export default function DevThemeRow() {
  const { activeMode, setMode, scheme, colors } = useTheme();

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <AppText style={[styles.title, { color: colors.text }]}>Dev: theme mode</AppText>
      <AppText style={[styles.subtitle, { color: colors.textMuted }]}>
        Showing {scheme}. Development builds only; users stay on Light.
      </AppText>
      <SegmentedControl options={OPTIONS} value={activeMode} onChange={setMode} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
    marginBottom: spacing.xs,
  },
});
