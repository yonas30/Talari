import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
  // When given, the list ends with an "Add category" row that calls this (the picker closes first). Forms use it to
  // jump to Categories without losing what has been typed.
  onAddCategory?: () => void;
}

export default function CategoryPicker({ value, options, onChange, onAddCategory }: CategoryPickerProps) {
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
            <ScrollView>
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
              {options.length === 0 && <Text style={styles.empty}>No categories of this type yet.</Text>}
              {onAddCategory && (
                <Pressable
                  style={styles.option}
                  onPress={() => {
                    setIsOpen(false);
                    onAddCategory();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Add category"
                >
                  <Text style={styles.addText}>+ Add category</Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.orange} />
                </Pressable>
              )}
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
  optionText: {
    color: colors.navy,
    fontSize: 16,
    fontWeight: '600',
  },
  empty: {
    color: colors.textSecondary,
    fontSize: 14,
    paddingVertical: spacing.md,
  },
  addText: {
    color: colors.orange,
    fontSize: 16,
    fontWeight: '700',
  },
  optionTextSelected: {
    color: colors.orange,
  },
});
