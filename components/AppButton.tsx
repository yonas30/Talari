import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';

import { colors } from '../constants/theme';

type ButtonVariant = 'primary' | 'secondary' | 'danger';

interface AppButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  selected?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

export default function AppButton({ title, onPress, variant = 'secondary', selected = false, disabled = false, style }: AppButtonProps) {
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        isPrimary && styles.primary,
        isDanger && styles.danger,
        selected && styles.selected,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text
        style={[
          styles.text,
          isPrimary && styles.textOnDark,
          isDanger && styles.textOnDark,
          selected && !isPrimary && !isDanger && styles.textSelected,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#ECEEF3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Design system (V2 Part U): orange is the single accent for primary actions, navy marks a selected
  // option, red only for destructive actions. No saturated blue.
  primary: {
    backgroundColor: colors.orange,
  },
  danger: {
    backgroundColor: colors.red,
  },
  selected: {
    backgroundColor: colors.navy,
  },
  pressed: {
    opacity: 0.75,
  },
  disabled: {
    opacity: 0.5,
  },
  text: {
    color: colors.navy,
    fontWeight: '700',
    fontSize: 14,
  },
  textOnDark: {
    color: '#ffffff',
  },
  textSelected: {
    color: '#ffffff',
  },
});
