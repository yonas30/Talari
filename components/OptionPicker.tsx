import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, radius, spacing } from '../constants/theme';

export interface PickerOption {
  value: string;
  label: string;
  // Secondary line, e.g. the current balance of that account.
  hint?: string;
}

interface OptionPickerProps {
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  placeholder?: string;
}

// Generic dropdown in the same style as CategoryPicker / CurrencyPicker.
export default function OptionPicker({ value, options, onChange, placeholder = 'Choose' }: OptionPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find((item) => item.value === value);

  return (
    <>
      <Pressable style={styles.trigger} onPress={() => setIsOpen(true)}>
        <View style={styles.triggerBody}>
          <Text style={styles.triggerText} numberOfLines={1}>
            {selected ? selected.label : placeholder}
          </Text>
          {selected?.hint ? (
            <Text style={styles.hint} numberOfLines={1}>
              {selected.hint}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
      </Pressable>

      <Modal visible={isOpen} transparent animationType="fade" onRequestClose={() => setIsOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setIsOpen(false)}>
          <View style={styles.sheet}>
            <ScrollView>
              {options.map((item) => (
                <Pressable
                  key={item.value}
                  style={styles.option}
                  onPress={() => {
                    onChange(item.value);
                    setIsOpen(false);
                  }}
                >
                  <View style={styles.optionBody}>
                    <Text style={[styles.optionText, item.value === value && styles.optionTextSelected]} numberOfLines={1}>
                      {item.label}
                    </Text>
                    {item.hint ? <Text style={styles.hint}>{item.hint}</Text> : null}
                  </View>
                  {item.value === value && <Ionicons name="checkmark" size={18} color={colors.orange} />}
                </Pressable>
              ))}
            </ScrollView>
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
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  triggerBody: {
    flex: 1,
  },
  triggerText: {
    color: colors.navy,
    fontSize: 15,
    fontWeight: '600',
  },
  hint: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(23, 32, 51, 0.4)',
  },
  sheet: {
    maxHeight: '70%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.background,
  },
  optionBody: {
    flex: 1,
  },
  optionText: {
    color: colors.navy,
    fontSize: 16,
    fontWeight: '600',
  },
  optionTextSelected: {
    color: colors.orange,
  },
});
