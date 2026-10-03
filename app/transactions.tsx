import { useEffect } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import AppHeader from '../components/AppHeader';
import { colors, radius, spacing, typography } from '../constants/theme';
import { useFinanceStore } from '../store/finance';
import { convertCurrency } from '../utils/currency';

export default function TransactionsScreen() {
  const router = useRouter();
  const { transactions, exchangeRates, homeCurrency, isReady } = useFinanceStore();

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
              const converted = convertCurrency(item.amount, item.currency, homeCurrency, exchangeRates);

              return (
                <Pressable
                  style={styles.item}
                  onPress={() => router.push(`/edit-transaction/${item.id}`)}
                >
                  <View style={styles.itemContent}>
                    <Text style={styles.category}>{item.category}</Text>
                    <Text style={styles.meta}>{new Date(item.date).toLocaleDateString()}</Text>
                  </View>
                  <View style={styles.amountWrap}>
                    <Text style={styles.amount}>{item.amount.toFixed(2)} {item.currency}</Text>
                    <Text style={styles.converted}>{homeCurrency} {converted.toFixed(2)}</Text>
                    <Text style={[styles.type, { color: item.type === 'income' ? colors.statusIncome : item.type === 'savings' ? colors.olive : colors.statusExpense }]}>
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
