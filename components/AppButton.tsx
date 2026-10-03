import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';

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
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: '#1d4ed8',
  },
  danger: {
    backgroundColor: '#dc2626',
  },
  selected: {
    backgroundColor: '#1d4ed8',
  },
  pressed: {
    opacity: 0.75,
  },
  disabled: {
    opacity: 0.5,
  },
  text: {
    color: '#0f172a',
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
