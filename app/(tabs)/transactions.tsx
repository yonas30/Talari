import { useEffect } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import AppHeader from '../../components/AppHeader';
import { colors, radius, spacing, typography } from '../../constants/theme';
import { useFinanceStore } from '../../store/finance';
import { formatDateKey, formatETB, formatNumber, transactionTitle } from '../../utils/format';

export default function TransactionsScreen() {
  const router = useRouter();
  const { transactions, goals, isReady } = useFinanceStore();

  useEffect(() => {
    if (!isReady) {
      void useFinanceStore.getState().loadData();
    }
  }, [isReady]);

  return (
    <View style={styles.screen}>
      <AppHeader title="Transactions" />
      {transactions.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyState}>No transactions yet — add your first one.</Text>
        </View>
      ) : (
        <>
          <Text style={styles.hint}>Tap any entry to edit or delete it.</Text>
          <FlatList
            data={transactions}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const isForeign = item.currency !== 'ETB';
              const title = transactionTitle(item, goals);

              return (
                <Pressable
                  style={styles.item}
                  onPress={() => router.push(`/edit-transaction/${item.id}`)}
                >
                  <View style={styles.itemContent}>
                    <Text style={styles.category}>{title}</Text>
                    <Text style={styles.meta}>
                      {formatDateKey(item.date)}
                      {item.account ? ` · ${item.type === 'income' ? 'into' : 'from'} ${item.account === 'saved' ? 'Saved' : 'Available'}` : ''}
                    </Text>
                  </View>
                  <View style={styles.amountWrap}>
                    <Text style={styles.amount} maxFontSizeMultiplier={1.3} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                      {formatETB(item.amountETB)}
                    </Text>
                    {isForeign && <Text style={styles.converted} maxFontSizeMultiplier={1.3} numberOfLines={1}>(originally {formatNumber(item.amount)} {item.currency})</Text>}
                    <Text style={[styles.type, { color: item.type === 'income' ? colors.statusIncome : item.type === 'transfer' ? colors.olive : colors.statusExpense }]}>
                      {item.type}
                    </Text>
                  </View>
                </Pressable>
              );
            }}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyState: {
    ...typography.helper,
    color: colors.textSecondary,
    fontSize: 16,
    textAlign: 'center',
  },
  hint: {
    ...typography.helper,
    color: colors.textSecondary,
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  listContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  itemContent: {
    gap: spacing.sm,
  },
  category: {
    ...typography.body,
    color: colors.navy,
    fontWeight: '700',
  },
  meta: {
    ...typography.helper,
    color: colors.textSecondary,
  },
  amountWrap: {
    alignItems: 'flex-end',
    gap: 2,
  },
  amount: {
    ...typography.helper,
    color: colors.navy,
    fontWeight: '700',
  },
  converted: {
    ...typography.helper,
    color: colors.blue,
    fontSize: 12,
  },
  type: {
    ...typography.helper,
    fontSize: 12,
    textTransform: 'capitalize',
  },
});
