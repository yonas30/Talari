import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { useTheme } from '../../theme/ThemeProvider';
import { accountColors } from '../../theme/tokens';
import { MoneyAccount } from '../../types/accounts';
import AppText from '../AppText';

interface AccountChipsProps {
  accounts: MoneyAccount[];
  value: string | null;
  onChange: (accountId: string) => void;
}

// A row of account chips: a dot in the account type's colour and the name. The selected chip takes the orange tint and edge, the same
// selected look as the other pickers, and says "selected" to screen readers (never by colour alone).
export default function AccountChips({ accounts, value, onChange }: AccountChipsProps) {
  const { colors } = useTheme();

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} keyboardShouldPersistTaps="handled">
      {accounts.map((account) => {
        const selected = account.id === value;
        const dot = accountColors(colors, account.type).dot;
        return (
          <Pressable
            key={account.id}
            onPress={() => onChange(account.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={account.name}
            style={({ pressed }) => [
              styles.chip,
              { backgroundColor: selected ? colors.accentDisc : colors.surface, borderColor: selected ? colors.primary : colors.border },
              selected && styles.chipSelected,
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.dot, { backgroundColor: dot }]} />
            <AppText
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
              style={[styles.label, { color: selected ? colors.primaryText : colors.text, fontWeight: selected ? '700' : '600' }]}
            >
              {account.name}
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipSelected: {
    borderWidth: 1.5,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontSize: 13,
    maxWidth: 160,
  },
  pressed: {
    opacity: 0.7,
  },
});
