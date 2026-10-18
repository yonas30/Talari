import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../theme/ThemeProvider';
import { MoneyAccount } from '../../types/accounts';
import { formatNumber } from '../../utils/format';
import AccountIcon from '../accounts/AccountIcon';
import AppText from '../AppText';

interface HeldInRowsProps {
  accounts: MoneyAccount[];
  value: string | null;
  onChange: (accountId: string) => void;
  // What is free to set aside in an account right now (its balance minus what other goals already reserve there).
  freeToSpend: (accountId: string) => number;
}

// The accounts a goal can be held in, one per row, each with its FREE TO SPEND amount: that is the most that can be set aside for the goal in
// it, so it is shown at the moment the account is chosen.
export default function HeldInRows({ accounts, value, onChange, freeToSpend }: HeldInRowsProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.list}>
      {accounts.map((account) => {
        const selected = account.id === value;
        const free = freeToSpend(account.id);
        return (
          <Pressable
            key={account.id}
            onPress={() => onChange(account.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${account.name}, ETB ${formatNumber(free)} free to spend`}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: selected ? colors.accentDisc : colors.surface, borderColor: selected ? colors.primary : colors.border },
              selected && styles.selected,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? colors.primaryText : colors.textMuted} />
            <AccountIcon type={account.type} size={30} />
            <View style={styles.text}>
              <AppText style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                {account.name}
              </AppText>
              <AppText style={[styles.free, { color: colors.textMuted }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                Free to spend: ETB {formatNumber(free)}
              </AppText>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  selected: {
    borderWidth: 1.5,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
  },
  free: {
    fontSize: 12,
    marginTop: 1,
  },
  pressed: {
    opacity: 0.7,
  },
});
