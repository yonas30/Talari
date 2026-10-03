import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '../constants/theme';

interface CategoryOption {
  id: string;
  name: string;
  icon: string;
}

interface CategoryPickerProps {
  value: string;
  options: CategoryOption[];
  onChange: (value: string) => void;
}

export default function CategoryPicker({ value, options, onChange }: CategoryPickerProps) {
  const insets = useSafeAreaInsets();
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find((item) => item.id === value || item.name === value);

  return (
    <>
      <Pressable style={styles.trigger} onPress={() => setIsOpen(true)}>
        <Text style={styles.triggerText} numberOfLines={1}>
          {selected ? `${selected.icon} ${selected.name}` : 'Choose a category'}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
      </Pressable>

      <Modal visible={isOpen} transparent animationType="fade" onRequestClose={() => setIsOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setIsOpen(false)}>
          <View style={[styles.sheet, { paddingBottom: spacing.md + insets.bottom }]}>
            {options.map((item) => (
              <Pressable
                key={item.id}
                style={styles.option}
                onPress={() => {
                  onChange(item.id);
                  setIsOpen(false);
                }}
              >
                <Text style={[styles.optionText, selected?.id === item.id && styles.optionTextSelected]}>
                  {item.icon} {item.name}
                </Text>
                {selected?.id === item.id && <Ionicons name="checkmark" size={18} color={colors.orange} />}
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
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  triggerText: {
    flex: 1,
    color: colors.navy,
    fontSize: 15,
    fontWeight: '600',
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(23, 32, 51, 0.4)',
  },
  sheet: {
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
  optionText: {
    color: colors.navy,
    fontSize: 16,
    fontWeight: '600',
  },
  optionTextSelected: {
    color: colors.orange,
  },
});
