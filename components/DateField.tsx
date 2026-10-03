import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';

import AppButton from './AppButton';
import { colors, radius, spacing } from '../constants/theme';
import { parseDateKey, toLocalDateKey } from '../utils/dates';

interface DateField {
  label: string;
  value: string | null;
  onChange: (value: string) => void;
}

export default function DateField({ label, value, onChange }: DateField) {
  const [showPicker, setShowPicker] = useState(false);

  const dateValue = value ? parseDateKey(value) : new Date();

  const onPickerChange = (event: { type: string }, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowPicker(false);
    }
    if (event.type === 'set' && selectedDate) {
      // Local day, not UTC: toISOString() shifted picked dates back a day in UTC+3.
      onChange(toLocalDateKey(selectedDate));
    }
  };

  return (
    <View style={styles.container}>
      <Pressable style={styles.row} onPress={() => setShowPicker(true)}>
        <Ionicons name="calendar-outline" size={18} color={colors.navy} />
        <Text style={styles.rowText}>{value ?? `Pick ${label.toLowerCase()}`}</Text>
        <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
      </Pressable>
      {showPicker && (
        <DateTimePicker value={dateValue} mode="date" display={Platform.OS === 'ios' ? 'inline' : 'default'} onChange={onPickerChange} />
      )}
      {Platform.OS === 'ios' && showPicker && (
        <AppButton title="Done" variant="primary" onPress={() => setShowPicker(false)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rowText: {
    flex: 1,
    fontSize: 15,
    color: colors.navy,
    fontWeight: '600',
  },
  container: {
    gap: 8,
  },
});
