import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../theme/ThemeProvider';
import { AccountEntry, MoneyAccount } from '../../types/accounts';
import { accountName, formatDateKey, formatNumber, transactionTitle } from '../../utils/format';
import { entryAmountRole, formatEntryAmount } from '../../utils/homeModel';
import { CONTROL_LABEL_MAX_SCALE } from '../../utils/layout';
import AppText from '../AppText';
import Card from '../Card';

// Money amounts stop scaling past this multiplier so extreme accessibility font sizes cannot push them out of the card.
const MONEY_MAX_FONT_SCALE = 1.3;

interface RecentListProps {
  transactions: AccountEntry[];
  accounts: MoneyAccount[];
  /** The emoji a category stores, by category name. Missing / empty -> a neutral icon. */
  categoryIcons: Record<string, string>;
  onSeeAll: () => void;
  /** Opens the edit / detail screen for a transaction (the same one the Transactions list uses). */
  onOpen: (transactionId: string) => void;
}

export default function RecentList({ transactions, accounts, categoryIcons, onSeeAll, onOpen }: RecentListProps) {
  const { colors } = useTheme();

  return (
    <Card>
      <View style={styles.header}>
        <AppText variant="title" style={styles.title} accessibilityRole="header" numberOfLines={1}>
          Recent transactions
        </AppText>
        <Pressable
          onPress={onSeeAll}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="See all transactions"
          style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
        >
          <AppText style={[styles.link, { color: colors.primaryText }]} maxFontSizeMultiplier={CONTROL_LABEL_MAX_SCALE}>
            See all →
          </AppText>
        </Pressable>
      </View>

      {transactions.length === 0 ? (
        <AppText style={[styles.empty, { color: colors.textMuted }]}>No transactions yet</AppText>
      ) : (
        <View style={styles.list}>
          {transactions.map((transaction, index) => {
            const role = entryAmountRole(transaction);
            const textColor = role === 'expense' ? colors.expense : role === 'income' ? colors.income : colors.text;
            const iconTint = role === 'expense' ? colors.expenseDisc : role === 'income' ? colors.incomeDisc : colors.transferDisc;
            const iconColor = role === 'expense' ? colors.expenseGlyph : role === 'income' ? colors.incomeGlyph : colors.transferGlyph;
            const emoji = role === 'transfer' ? '' : (categoryIcons[transaction.category] ?? '').trim();
            const isTransfer = transaction.type === 'transfer';

            return (
              // The text column takes the remaining width and truncates; the amount shrinks to fit rather than overflowing.
              <Pressable
                key={transaction.id}
                onPress={() => onOpen(transaction.linkedTransferId ?? transaction.id)}
                accessibilityRole="button"
                accessibilityLabel={`${transactionTitle(transaction, accounts)}, ${formatEntryAmount(transaction)}, ${formatDateKey(transaction.date)}. Opens the transaction.`}
                style={({ pressed }) => [
                  styles.row,
                  index > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
                  pressed && { backgroundColor: colors.surfaceMuted },
                ]}
              >
                <View style={[styles.disc, { backgroundColor: iconTint }]}>
                  {isTransfer ? (
                    <Ionicons name="swap-horizontal" size={20} color={iconColor} />
                  ) : emoji ? (
                    <AppText style={styles.emoji} maxFontSizeMultiplier={1.2}>
                      {emoji}
                    </AppText>
                  ) : (
                    <Ionicons name="receipt-outline" size={20} color={iconColor} />
                  )}
                </View>
                <View style={styles.text}>
                  <AppText style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
                    {transactionTitle(transaction, accounts)}
                  </AppText>
                  <AppText style={[styles.rowMeta, { color: colors.textMuted }]} numberOfLines={1}>
                    {isTransfer ? '' : `${accountName(transaction.accountId, accounts)}${transaction.source ? ` · ${transaction.source}` : ''} · `}
                    {formatDateKey(transaction.date)}
                  </AppText>
                </View>
                <View style={styles.amountWrap}>
                  <AppText
                    variant="number"
                    style={[styles.amount, { color: textColor }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    // 0.5: "−ETB 1,234,567.89" needs 0.77 of 15 sp in a 108 dp column at 320 dp, more at the 1.3x cap.
                    minimumFontScale={0.5}
                    maxFontSizeMultiplier={MONEY_MAX_FONT_SCALE}
                  >
                    {formatEntryAmount(transaction)}
                  </AppText>
                  {transaction.currency !== 'ETB' && !isTransfer ? (
                    <AppText
                      style={[styles.original, { color: colors.textMuted }]}
                      numberOfLines={1}
                      maxFontSizeMultiplier={MONEY_MAX_FONT_SCALE}
                    >
                      (originally {formatNumber(transaction.amount)} {transaction.currency})
                    </AppText>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    fontSize: 17,
    flex: 1,
  },
  link: {
    fontSize: 14,
    fontWeight: '600',
  },
  list: {
    marginTop: 8,
  },
  empty: {
    fontSize: 14,
    marginTop: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  disc: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 19,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  rowMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  amountWrap: {
    flexShrink: 0,
    maxWidth: '45%',
    alignItems: 'flex-end',
  },
  amount: {
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'right',
  },
  original: {
    fontSize: 11,
    marginTop: 2,
    textAlign: 'right',
  },
});
