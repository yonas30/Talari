import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing } from '../constants/theme';
import { useThemeColors } from '../theme/ThemeProvider';
import AppText from './AppText';
import OverlayModal from './OverlayModal';
import { usePickerStyles } from './pickerStyles';

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
  const colors = useThemeColors();
  const styles = usePickerStyles();
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find((item) => item.id === value || item.name === value);

  return (
    <>
      <Pressable style={styles.trigger} onPress={() => setIsOpen(true)} accessibilityRole="button">
        <AppText style={styles.triggerText} numberOfLines={1}>
          {selected ? `${selected.icon} ${selected.name}` : 'Choose a category'}
        </AppText>
        <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
      </Pressable>

      <OverlayModal visible={isOpen} animationType="fade" onRequestClose={() => setIsOpen(false)}>
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
                  <AppText style={[styles.optionText, selected?.id === item.id && styles.optionTextSelected]}>
                    {item.icon} {item.name}
                  </AppText>
                  {selected?.id === item.id && <Ionicons name="checkmark" size={18} color={colors.primaryText} />}
                </Pressable>
              ))}
              {options.length === 0 && <AppText style={styles.empty}>No categories of this type yet.</AppText>}
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
                  <AppText style={styles.addText}>+ Add category</AppText>
                  <Ionicons name="chevron-forward" size={18} color={colors.primaryText} />
                </Pressable>
              )}
            </ScrollView>
          </View>
        </Pressable>
      </OverlayModal>
    </>
  );
}
