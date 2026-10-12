import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, spacing } from '../constants/theme';
import { useFinanceStore } from '../store/finance';
import { useThemeColors } from '../theme/ThemeProvider';
import { CurrencyCode } from '../types';
import AppText from './AppText';
import OverlayModal from './OverlayModal';
import { usePickerStyles } from './pickerStyles';

interface CurrencyPickerProps {
  value: CurrencyCode;
  onChange: (value: CurrencyCode) => void;
}

export default function CurrencyPicker({ value, onChange }: CurrencyPickerProps) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const picker = usePickerStyles();
  const [isOpen, setIsOpen] = useState(false);
  const currencies = useFinanceStore((state) => state.currencies);
  const options = currencies.length > 0 ? currencies.map((item) => item.code) : ['ETB', 'USD', 'EUR', 'GBP'];

  return (
    <>
      <Pressable
        style={[styles.trigger, { backgroundColor: colors.bg, borderColor: colors.inputBorder }]}
        onPress={() => setIsOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Currency, ${value}`}
      >
        <AppText style={[styles.triggerText, { color: colors.text }]}>{value}</AppText>
        <Ionicons name="chevron-down" size={16} color={colors.text} />
      </Pressable>

      <OverlayModal visible={isOpen} animationType="fade" onRequestClose={() => setIsOpen(false)}>
        <Pressable style={picker.backdrop} onPress={() => setIsOpen(false)}>
          <View style={[picker.sheet, { paddingBottom: spacing.md + insets.bottom }]}>
            {options.map((currency) => (
              <Pressable
                key={currency}
                style={picker.option}
                onPress={() => {
                  onChange(currency);
                  setIsOpen(false);
                }}
              >
                <AppText style={[picker.optionText, currency === value && picker.optionTextSelected]}>{currency}</AppText>
                {currency === value && <Ionicons name="checkmark" size={18} color={colors.primaryText} />}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </OverlayModal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: radius.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  triggerText: {
    fontWeight: '700',
    fontSize: 14,
  },
});
