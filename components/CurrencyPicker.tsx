import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '../constants/theme';
import { useFinanceStore } from '../store/finance';
import { CurrencyCode } from '../types';

interface CurrencyPickerProps {
  value: CurrencyCode;
  onChange: (value: CurrencyCode) => void;
}

export default function CurrencyPicker({ value, onChange }: CurrencyPickerProps) {
  const insets = useSafeAreaInsets();
  const [isOpen, setIsOpen] = useState(false);
  const currencies = useFinanceStore((state) => state.currencies);
  const options = currencies.length > 0 ? currencies.map((item) => item.code) : ['ETB', 'USD', 'EUR', 'GBP'];

  return (
    <>
      <Pressable style={styles.trigger} onPress={() => setIsOpen(true)}>
        <Text style={styles.triggerText}>{value}</Text>
        <Ionicons name="chevron-down" size={16} color={colors.navy} />
      </Pressable>

      <Modal visible={isOpen} transparent animationType="fade" onRequestClose={() => setIsOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setIsOpen(false)}>
          <View style={[styles.sheet, { paddingBottom: spacing.md + insets.bottom }]}>
            {options.map((currency) => (
              <Pressable
                key={currency}
                style={styles.option}
                onPress={() => {
                  onChange(currency);
                  setIsOpen(false);
                }}
              >
                <Text style={[styles.optionText, currency === value && styles.optionTextSelected]}>{currency}</Text>
                {currency === value && <Ionicons name="checkmark" size={18} color={colors.orange} />}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.background,
    borderRadius: radius.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  triggerText: {
    fontWeight: '700',
    color: colors.navy,
    fontSize: 14,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(23, 32, 51, 0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  option: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.background,
  },
  optionText: {
    fontSize: 16,
    color: colors.navy,
    fontWeight: '600',
  },
  optionTextSelected: {
    color: colors.orange,
  },
});
