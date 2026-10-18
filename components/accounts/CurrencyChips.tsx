import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { useFinanceStore } from '../../store/finance';
import { useTheme } from '../../theme/ThemeProvider';
import AppText from '../AppText';

interface CurrencyChipsProps {
  value: string;
  onChange: (code: string) => void;
}

// The currencies on the Currencies & Exchange Rates screen as an inline row of chips. Used in the New account form instead of the
// dropdown picker: the form lives in a bottom sheet next to an amount field, and a second pop-up opened from inside a sheet is exactly what
// we avoid there (the amount field must keep working).
export default function CurrencyChips({ value, onChange }: CurrencyChipsProps) {
  const { colors } = useTheme();
  const currencies = useFinanceStore((state) => state.currencies);
  const codes = currencies.length > 0 ? currencies.map((item) => item.code) : ['ETB', 'USD', 'EUR', 'GBP'];

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} keyboardShouldPersistTaps="handled">
      {codes.map((code) => {
        const selected = code === value;
        return (
          <Pressable
            key={code}
            onPress={() => onChange(code)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`Currency ${code}`}
            style={({ pressed }) => [
              styles.chip,
              { backgroundColor: selected ? colors.accentDisc : colors.surface, borderColor: selected ? colors.primary : colors.border },
              selected && styles.chipSelected,
              pressed && styles.pressed,
            ]}
          >
            <AppText style={[styles.label, { color: selected ? colors.primaryText : colors.text, fontWeight: selected ? '700' : '600' }]} maxFontSizeMultiplier={1.3}>
              {code}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 8,
    paddingVertical: 2,
  },
  chip: {
    minHeight: 38,
    paddingHorizontal: 14,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
  },
  chipSelected: {
    borderWidth: 1.5,
  },
  label: {
    fontSize: 13,
  },
  pressed: {
    opacity: 0.7,
  },
});
