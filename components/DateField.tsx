import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';

import AppButton from './AppButton';
import { colors, radius, spacing } from '../constants/theme';
import { parseDateKey, toLocalDateKey } from '../utils/dates';
import AppText from './AppText';

interface DateField {
  label: string;
  value: string | null;
  onChange: (value: string) => void;
}

export default function DateField({ label, value, onChange }: DateField) {
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
      <Pressable style={styles.row} onPress={() => setShowPicker(true)}>
        <Ionicons name="calendar-outline" size={18} color={colors.navy} />
        <AppText style={styles.rowText}>{value ?? `Pick ${label.toLowerCase()}`}</AppText>
        <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
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
