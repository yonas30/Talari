import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { spacing } from '../constants/theme';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeMode } from '../utils/themePreference';
import AppText from './AppText';
import SegmentedControl, { SegmentOption } from './SegmentedControl';

const OPTIONS: SegmentOption<ThemeMode>[] = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

// The Appearance setting: a settings row (pale disc, title, one line of what is in effect) with the shared segmented control under it.
// The choice is saved straight away and applies without a restart.
export default function AppearanceRow({ isLast = false }: { isLast?: boolean }) {
  const { colors, mode, scheme, setMode } = useTheme();
  const inEffect = scheme === 'dark' ? 'Dark' : 'Light';
  const subtitle = mode === 'system' ? `Following your phone (${inEffect} now)` : `Always ${inEffect}`;

  return (
    <View style={[styles.row, !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
      <View style={styles.top}>
        <View style={[styles.disc, { backgroundColor: colors.accentDisc }]}>
          <Ionicons name="contrast-outline" size={18} color={colors.primaryText} />
        </View>
        <View style={styles.text}>
          <AppText style={[styles.title, { color: colors.text }]}>Appearance</AppText>
          <AppText style={[styles.subtitle, { color: colors.textMuted }]}>{subtitle}</AppText>
        </View>
      </View>
      <SegmentedControl options={OPTIONS} value={mode} onChange={setMode} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: spacing.md,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  disc: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 13,
  },
});
