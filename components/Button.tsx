import { Pressable, PressableProps, StyleSheet } from 'react-native';

import { radius } from '../constants/theme';
import { useTheme } from '../theme/ThemeProvider';
import AppText from './AppText';

type ButtonVariant = 'primary' | 'secondary' | 'link';

interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  title: string;
  variant?: ButtonVariant;
}

// primary: orange fill with navy text. secondary: quiet fill with a border. link: text only, in the orange text colour
// (darker in Light so it stays readable). The label never wraps; it shrinks a little before it would be cut off.
export default function Button({ title, variant = 'primary', disabled, ...rest }: ButtonProps) {
  const { colors } = useTheme();

  const container =
    variant === 'primary'
      ? { backgroundColor: colors.primary }
      : variant === 'secondary'
        ? { backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderWidth: 1 }
        : null;
  const labelColor = variant === 'primary' ? colors.onPrimary : variant === 'secondary' ? colors.text : colors.primaryText;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      {...rest}
      style={({ pressed }) => [
        styles.base,
        variant === 'link' && styles.link,
        container,
        pressed && styles.pressed,
        disabled && styles.disabled,
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
