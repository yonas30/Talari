import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
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
  // The pale disc behind each category icon and the colour of the fallback glyph (the form passes its type's tokens).
  discColor?: string;
  glyphColor?: string;
}

export default function CategoryPicker({ value, options, onChange, onAddCategory, discColor, glyphColor }: CategoryPickerProps) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const styles = usePickerStyles();
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find((item) => item.id === value || item.name === value);
  const disc = discColor ?? colors.surfaceMuted;
  const glyph = glyphColor ?? colors.textMuted;

  return (
    <>
      <Pressable style={styles.trigger} onPress={() => setIsOpen(true)} accessibilityRole="button">
        {selected ? <CategoryDisc icon={selected.icon} disc={disc} glyph={glyph} /> : null}
        <AppText style={styles.triggerText} numberOfLines={1}>
          {selected ? selected.name : 'Choose a category'}
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
                  <View style={styles.optionLead}>
                    <CategoryDisc icon={item.icon} disc={disc} glyph={glyph} />
                    <AppText style={[styles.optionText, selected?.id === item.id && styles.optionTextSelected]} numberOfLines={1}>
                      {item.name}
                    </AppText>
                  </View>
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

// A pale disc with the emoji the category stores, or a neutral tag icon when it has none.
function CategoryDisc({ icon, disc, glyph }: { icon: string; disc: string; glyph: string }) {
  const emoji = icon.trim();
  return (
    <View style={[discStyles.disc, { backgroundColor: disc }]}>
      {emoji ? (
        <AppText style={discStyles.emoji} maxFontSizeMultiplier={1.2}>
          {emoji}
        </AppText>
      ) : (
        <Ionicons name="pricetag-outline" size={16} color={glyph} />
      )}
    </View>
  );
}

const discStyles = StyleSheet.create({
  disc: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 16,
  },
});
