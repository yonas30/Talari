import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { spacing } from '../constants/theme';
import { useThemeColors } from '../theme/ThemeProvider';
import AppText from './AppText';

interface SettingsRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  // Navigation row: shows a chevron and calls onPress.
  onPress?: () => void;
  // Toggle row: shows a switch instead of a chevron.
  toggleValue?: boolean;
  onToggle?: (value: boolean) => void;
  /** A small "something needs attention" dot next to the chevron. The row's spoken label must say so too (see accessibilityLabel). */
  showDot?: boolean;
  /** Overrides the spoken label (default: the title); used when the dot means "unread". */
  accessibilityLabel?: string;
  isLast?: boolean;
}

// One row of a settings list: pale icon disc, title + quiet subtitle, then a chevron or a switch. Hairline divider between rows;
// pressed rows get a background.
export default function SettingsRow({
  icon,
  title,
  subtitle,
  onPress,
  toggleValue,
  onToggle,
  showDot = false,
  accessibilityLabel,
  isLast = false,
}: SettingsRowProps) {
  const colors = useThemeColors();
  const isToggle = onToggle !== undefined;

  const content = (
    <>
      <View style={[styles.iconCircle, { backgroundColor: colors.accentDisc }]}>
        <Ionicons name={icon} size={18} color={colors.primaryText} />
      </View>
      <View style={styles.text}>
        <AppText style={[styles.title, { color: colors.text }]}>{title}</AppText>
        {subtitle ? <AppText style={[styles.subtitle, { color: colors.textMuted }]}>{subtitle}</AppText> : null}
      </View>
      {isToggle ? (
        <Switch
          value={toggleValue ?? false}
          onValueChange={onToggle}
          // Off: a visible grey track with a light thumb; on: the orange track with a navy thumb. Both clear 3:1 in Light and Dark.
          trackColor={{ false: colors.inputBorder, true: colors.primary }}
          thumbColor={toggleValue ? colors.onPrimary : colors.surface}
          accessibilityLabel={title}
        />
      ) : (
        <View style={styles.end}>
          {showDot && <View style={[styles.dot, { backgroundColor: colors.danger }]} />}
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </View>
      )}
    </>
  );

  const rowStyle = [styles.row, !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }];

  if (isToggle) {
    return <View style={rowStyle}>{content}</View>;
  }

  return (
    <Pressable
      style={({ pressed }) => [rowStyle, pressed && { backgroundColor: colors.surfaceMuted }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  iconCircle: {
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
  end: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
});
