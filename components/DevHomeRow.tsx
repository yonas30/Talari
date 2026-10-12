import { StyleSheet, Switch, View } from 'react-native';

import { radius, spacing } from '../constants/theme';
import { DevHomePreview, useUiStore } from '../store/ui';
import { useTheme } from '../theme/ThemeProvider';
import AppText from './AppText';

const ROWS: { key: keyof DevHomePreview; label: string }[] = [
  { key: 'noSpending', label: 'No spending this month' },
  { key: 'noTransactions', label: 'No transactions' },
  { key: 'noGoals', label: 'No money in goals' },
  { key: 'noStreak', label: 'Zero-day streak' },
];

// Development-only switches that make Home show its empty states without touching any real data. Rendered by Settings only
// when __DEV__ is true; the Home screen ignores them in release builds. "Hidden balances" is the real eye button on Home.
export default function DevHomeRow() {
  const { colors } = useTheme();
  const preview = useUiStore((state) => state.devHomePreview);
  const setPreview = useUiStore((state) => state.setDevHomePreview);
  const isBalanceHidden = useUiStore((state) => state.isBalanceHidden);
  const toggleBalanceVisibility = useUiStore((state) => state.toggleBalanceVisibility);

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <AppText style={[styles.title, { color: colors.text }]}>Dev: Home empty states</AppText>
      <AppText style={[styles.subtitle, { color: colors.textMuted }]}>Preview only. Your data is not changed.</AppText>
      {ROWS.map((row) => (
        <View key={row.key} style={styles.line}>
          <AppText style={[styles.label, { color: colors.text }]}>{row.label}</AppText>
          <Switch
            value={preview[row.key]}
            onValueChange={(value) => setPreview({ [row.key]: value })}
            accessibilityLabel={row.label}
            trackColor={{ false: colors.surfaceMuted, true: colors.primary }}
          />
        </View>
      ))}
      <View style={styles.line}>
        <AppText style={[styles.label, { color: colors.text }]}>Hide balances</AppText>
        <Switch
          value={isBalanceHidden}
          onValueChange={toggleBalanceVisibility}
          accessibilityLabel="Hide balances"
          trackColor={{ false: colors.surfaceMuted, true: colors.primary }}
        />
      </View>
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
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  label: {
    flex: 1,
    fontSize: 14,
  },
});
