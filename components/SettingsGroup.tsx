import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useThemeColors } from '../theme/ThemeProvider';
import AppText from './AppText';

interface SettingsGroupProps {
  /** Section title above the card, in the muted text colour. */
  title?: string;
  children: ReactNode;
}

// A titled, flat card of settings rows (1 px border, radius 20, no shadow). The rows draw their own hairline dividers.
export default function SettingsGroup({ title, children }: SettingsGroupProps) {
  const colors = useThemeColors();
  return (
    <View style={styles.wrap}>
      {title ? (
        <AppText style={[styles.title, { color: colors.textMuted }]} accessibilityRole="header">
          {title}
        </AppText>
      ) : null}
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 4,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
});
