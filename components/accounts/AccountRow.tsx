import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../theme/ThemeProvider';
import { AccountSummary } from '../../utils/accounts/totals';
import { accountSubtitle } from '../../utils/accounts/groups';
import { formatMoney, formatNumber, maskAmount } from '../../utils/format';
import AppText from '../AppText';
import AccountIcon from './AccountIcon';

interface AccountRowProps {
  summary: AccountSummary;
  hidden: boolean;
  // "4,500 reserved for Car", shown instead of the type line when money is reserved in this account.
  reserved?: string | null;
  isFirst?: boolean;
  onPress: () => void;
}

// One account in a list: icon, name, a quiet line under it, and its ETB value on the right (a foreign account shows its own currency
// in the line under the name). Hidden balances mask the amount.
export default function AccountRow({ summary, hidden, reserved, isFirst = false, onPress }: AccountRowProps) {
  const { colors } = useTheme();
  const { account, valueETB } = summary;
  const subtitle = accountSubtitle(summary, formatMoney);
  const amountText = valueETB === null ? 'No rate' : maskAmount(formatNumber(valueETB), hidden);
  const spoken = `${account.name}, ${account.type}${account.currency === 'ETB' ? '' : `, ${hidden ? 'balance hidden' : formatMoney(summary.balance, account.currency)}`}, ${valueETB === null ? 'no exchange rate, not in the total' : hidden ? 'amount hidden' : `ETB ${formatNumber(valueETB)}`}`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      style={({ pressed }) => [
        styles.row,
        styles.rowRoomy,
        !isFirst && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}
    >
      <AccountIcon type={account.type} size={36} />
      <View style={styles.text}>
        <AppText style={[styles.name, { color: colors.text }]} numberOfLines={1}>
          {account.name}
        </AppText>
        {reserved ? (
          <View style={[styles.pill, { backgroundColor: colors.accentDisc }]}>
            <AppText style={[styles.pillText, { color: colors.primaryText }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
              {hidden ? 'Reserved for goals' : reserved}
            </AppText>
          </View>
        ) : (
          <AppText style={[styles.subtitle, { color: colors.textMuted }]} numberOfLines={1}>
            {hidden && account.currency !== 'ETB' ? `${account.type === 'wallet' ? 'Wallet' : account.type === 'bank' ? 'Bank' : 'Cash'} · ${account.currency}` : subtitle}
          </AppText>
        )}
      </View>
      <AppText
        variant="number"
        style={[styles.amount, { color: valueETB === null ? colors.textMuted : colors.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        maxFontSizeMultiplier={1.3}
      >
        {amountText}
      </AppText>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowRoomy: {
    paddingVertical: 10,
  },
  text: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  pill: {
    marginTop: 3,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    maxWidth: '100%',
  },
  pillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  amount: {
    flexShrink: 0,
    maxWidth: '38%',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'right',
  },
});
