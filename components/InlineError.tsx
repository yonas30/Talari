import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useThemeColors } from '../theme/ThemeProvider';
import AppText from './AppText';

// A validation or ledger message shown in place, in the expense (danger) text tone with an icon - never colour alone. Announced to
// screen readers when it appears.
export default function InlineError({ message }: { message: string }) {
  const colors = useThemeColors();
  return (
    <View style={styles.row} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle" size={18} color={colors.expense} />
      <AppText style={[styles.text, { color: colors.expense }]}>{message}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  text: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
});
