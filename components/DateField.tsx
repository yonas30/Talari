import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';

import { radius, spacing } from '../constants/theme';
import { useThemeColors } from '../theme/ThemeProvider';
import { parseDateKey, toLocalDateKey } from '../utils/dates';
import AppText from './AppText';
import Button from './Button';

interface DateField {
  label: string;
  value: string | null;
  onChange: (value: string) => void;
}

export default function DateField({ label, value, onChange }: DateField) {
  const colors = useThemeColors();
  const [showPicker, setShowPicker] = useState(false);

  const dateValue = value ? parseDateKey(value) : new Date();

  // datetimepicker 9.x replaced the single onChange (which encoded set/dismissed in event.type)
  // with onValueChange / onDismiss. The Android dialog closes itself, so we unmount it in both
  // cases or it would reopen on the next render; iOS stays open (inline) until Done.
  const onPickerValueChange = (_event: unknown, selectedDate: Date) => {
    if (Platform.OS === 'android') {
      setShowPicker(false);
    }
    // Local day, not UTC: toISOString() shifted picked dates back a day in UTC+3.
    onChange(toLocalDateKey(selectedDate));
  };

  const onPickerDismiss = () => setShowPicker(false);

  return (
    <View style={styles.container}>
      <Pressable
        style={[styles.row, { backgroundColor: colors.bg, borderColor: colors.inputBorder }]}
        onPress={() => setShowPicker(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${value ?? 'not set'}`}
      >
        <Ionicons name="calendar-outline" size={18} color={colors.text} />
        <AppText style={[styles.rowText, { color: colors.text }]}>{value ?? `Pick ${label.toLowerCase()}`}</AppText>
        <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
      </Pressable>
      {showPicker && (
        <DateTimePicker
          value={dateValue}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onValueChange={onPickerValueChange}
          onDismiss={onPickerDismiss}
        />
      )}
      {Platform.OS === 'ios' && showPicker && (
        <Button title="Done" variant="primary" onPress={() => setShowPicker(false)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rowText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  container: {
    gap: 8,
  },
});
