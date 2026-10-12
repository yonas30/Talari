import { Pressable, PressableProps, StyleProp, StyleSheet, ViewStyle } from 'react-native';

import { radius } from '../constants/theme';
import { useTheme } from '../theme/ThemeProvider';
import AppText from './AppText';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'link';

interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  title: string;
  variant?: ButtonVariant;
  /** A toggled-on option (secondary only): the same navy / off-white pill as a selected segment. */
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
}

// primary: orange fill with navy text. secondary: quiet fill with a border (selected: the segment pill). danger: the expense tone
// with its own text colour (white in Light, navy in Dark). link: text only, in the orange text colour (darker in Light so it
// stays readable). The label never wraps; it shrinks a little before it would be cut off.
export default function Button({ title, variant = 'primary', selected = false, disabled, style, ...rest }: ButtonProps) {
  const { colors } = useTheme();
  const isSelected = selected && variant === 'secondary';

  const container =
    variant === 'primary'
      ? { backgroundColor: colors.primary }
      : variant === 'danger'
        ? { backgroundColor: colors.danger }
        : variant === 'secondary'
          ? isSelected
            ? { backgroundColor: colors.segmentSelectedBg, borderColor: colors.segmentSelectedBg, borderWidth: 1 }
            : { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderWidth: 1 }
          : null;
  const labelColor =
    variant === 'primary'
      ? colors.onPrimary
      : variant === 'danger'
        ? colors.onDanger
        : variant === 'secondary'
          ? isSelected
            ? colors.segmentSelectedText
            : colors.text
          : colors.primaryText;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled), selected: variant === 'secondary' ? isSelected : undefined }}
      disabled={disabled}
      {...rest}
      style={({ pressed }) => [
        styles.base,
        variant === 'link' && styles.link,
        container,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <AppText
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        maxFontSizeMultiplier={1.3}
        style={[styles.label, { color: labelColor }]}
      >
        {title}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  link: {
    minHeight: 44,
    paddingHorizontal: 8,
  },
  pressed: {
    opacity: 0.75,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
});
