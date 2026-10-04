import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import AppHeader from '../../components/AppHeader';
import SegmentedTabs, { TabOption } from '../../components/SegmentedTabs';
import { colors, radius, spacing, typography } from '../../constants/theme';
import { useFinanceStore } from '../../store/finance';
import { formatDateKey, formatETB, formatNumber, transactionTitle } from '../../utils/format';
import { filterByType, filterTransactions, TypeFilter } from '../../utils/search';

const TYPE_TABS: TabOption<TypeFilter>[] = [
  { key: 'all', label: 'All' },
  { key: 'income', label: 'Income' },
  { key: 'expense', label: 'Expense' },
  { key: 'transfer', label: 'Transfer' },
];

// What to call the entries of each tab in the count line and the empty states.
const TAB_NOUNS: Record<TypeFilter, { plural: string }> = {
  all: { plural: 'transactions' },
  income: { plural: 'income entries' },
  expense: { plural: 'expenses' },
  transfer: { plural: 'transfers' },
};

// The merchant/source and note, so an entry that matched a search shows why. The default source label adds nothing.
function detailLine(source: string, note: string | null): string {
  const parts = [source && source !== 'Manual entry' ? source : '', note ?? ''].filter(Boolean);
  return parts.join(' · ');
}

export default function TransactionsScreen() {
  const router = useRouter();
  const { transactions, goals, isReady } = useFinanceStore();
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  // The tab narrows by type first; the search then looks only inside that tab ("food" on Expense searches expenses).
  // Filters live as you type: merchant/source, category, note, a transfer's From -> To, and amounts.
  const inTab = useMemo(() => filterByType(transactions, typeFilter), [transactions, typeFilter]);
  const visible = useMemo(() => filterTransactions(inTab, query, goals), [inTab, query, goals]);
  const isSearching = query.trim().length > 0;
  const noun = TAB_NOUNS[typeFilter];

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
          <View style={styles.tabsWrap}>
            <SegmentedTabs tabs={TYPE_TABS} value={typeFilter} onChange={setTypeFilter} />
          </View>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={colors.textSecondary} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search merchant, category, note or amount"
              placeholderTextColor={colors.textSecondary}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="never"
              accessibilityLabel="Search transactions"
            />
            {isSearching && (
              <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
              </Pressable>
            )}
          </View>
          <Text style={styles.hint}>
            {isSearching
              ? `${visible.length} of ${inTab.length} ${noun.plural}`
              : 'Tap any entry to edit or delete it.'}
          </Text>
          <FlatList
            data={visible}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ListEmptyComponent={
              <View style={styles.noMatch}>
                <Text style={styles.emptyState}>
                  {isSearching ? `No ${noun.plural} match “${query.trim()}”.` : `No ${noun.plural} yet.`}
                </Text>
                {isSearching ? (
                  <Pressable onPress={() => setQuery('')} accessibilityRole="button">
                    <Text style={styles.clearLink}>Clear search</Text>
                  </Pressable>
                ) : (
                  <Pressable onPress={() => setTypeFilter('all')} accessibilityRole="button">
                    <Text style={styles.clearLink}>Show all</Text>
                  </Pressable>
                )}
              </View>
            }
            renderItem={({ item }) => {
              const isForeign = item.currency !== 'ETB';
              const title = transactionTitle(item, goals);

              return (
                <Pressable
                  style={styles.item}
                  onPress={() => router.push(`/edit-transaction/${item.id}`)}
                >
                  <View style={styles.itemContent}>
                    <Text style={styles.category} numberOfLines={2}>
                      {title}
                    </Text>
                    <Text style={styles.meta} numberOfLines={2}>
                      {formatDateKey(item.date)}
                      {item.account ? ` · ${item.type === 'income' ? 'into' : 'from'} ${item.account === 'saved' ? 'Saved' : 'Available'}` : ''}
                    </Text>
                    {detailLine(item.source, item.note) !== '' && (
                      <Text style={styles.detail} numberOfLines={1}>
                        {detailLine(item.source, item.note)}
                      </Text>
                    )}
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
  tabsWrap: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.button,
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: spacing.md,
    fontSize: 15,
    color: colors.navy,
  },
  noMatch: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  clearLink: {
    ...typography.helper,
    color: colors.blue,
    fontWeight: '700',
  },
  detail: {
    ...typography.helper,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  hint: {
    ...typography.helper,
    color: colors.textSecondary,
    marginHorizontal: spacing.xl,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
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
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  // The text side takes whatever width the amount leaves and truncates, instead of pushing the amount out of
  // the card (same approach as the Home recent-transactions and Recurring rows).
  itemContent: {
    flex: 1,
    minWidth: 0,
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
  // Bounded width so the amount's shrink-to-fit has something to fit into at large system font sizes.
  amountWrap: {
    maxWidth: '48%',
    flexShrink: 0,
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
