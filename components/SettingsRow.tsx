import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, spacing, typography } from '../constants/theme';
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
  showDot?: boolean;
  isLast?: boolean;
}

// One row of a settings list: tinted icon circle, title + quiet subtitle, then a chevron or switch.
export default function SettingsRow({
  icon,
  title,
  subtitle,
  onPress,
  toggleValue,
  onToggle,
  showDot = false,
  isLast = false,
}: SettingsRowProps) {
  const isToggle = onToggle !== undefined;

  const content = (
    <>
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={18} color={colors.navy} />
      </View>
      <View style={styles.text}>
        <AppText style={styles.title}>{title}</AppText>
        {subtitle ? <AppText style={styles.subtitle}>{subtitle}</AppText> : null}
      </View>
      {isToggle ? (
        <Switch
          value={toggleValue ?? false}
          onValueChange={onToggle}
          trackColor={{ false: '#D9DCE4', true: colors.statusIncome }}
          thumbColor="#FFFFFF"
          accessibilityLabel={title}
        />
      ) : (
        <View style={styles.end}>
          {showDot && <View style={styles.dot} />}
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </View>
      )}
    </>
  );

  const rowStyle = [styles.row, !isLast && styles.divider];

  if (isToggle) {
    return <View style={rowStyle}>{content}</View>;
  }

  return (
    <Pressable
      style={({ pressed }) => [rowStyle, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
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
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.background,
  },
  pressed: {
    opacity: 0.7,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.navy,
  },
  subtitle: {
    ...typography.helper,
    color: colors.textSecondary,
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
    backgroundColor: colors.red,
  },
});
