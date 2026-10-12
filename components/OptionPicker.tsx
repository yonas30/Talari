import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing } from '../constants/theme';
import { useThemeColors } from '../theme/ThemeProvider';
import AppText from './AppText';
import OverlayModal from './OverlayModal';
import { usePickerStyles } from './pickerStyles';

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
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const styles = usePickerStyles();
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find((item) => item.value === value);

  return (
    <>
      <Pressable style={styles.trigger} onPress={() => setIsOpen(true)} accessibilityRole="button">
        <View style={styles.triggerBody}>
          <AppText style={styles.triggerText} numberOfLines={1}>
            {selected ? selected.label : placeholder}
          </AppText>
          {selected?.hint ? (
            <AppText style={styles.hint} numberOfLines={1}>
              {selected.hint}
            </AppText>
          ) : null}
        </View>
        <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
      </Pressable>

      <OverlayModal visible={isOpen} animationType="fade" onRequestClose={() => setIsOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setIsOpen(false)}>
          <View style={[styles.sheet, { paddingBottom: spacing.md + insets.bottom }]}>
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
                    <AppText style={[styles.optionText, item.value === value && styles.optionTextSelected]} numberOfLines={1}>
                      {item.label}
                    </AppText>
                    {item.hint ? <AppText style={styles.hint}>{item.hint}</AppText> : null}
                  </View>
                  {item.value === value && <Ionicons name="checkmark" size={18} color={colors.primaryText} />}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </OverlayModal>
    </>
  );
}
