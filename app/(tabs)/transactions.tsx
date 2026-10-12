import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import AppHeader from '../../components/AppHeader';
import AppText from '../../components/AppText';
import AppTextInput from '../../components/AppTextInput';
import SegmentedControl, { SegmentOption } from '../../components/SegmentedControl';
import { useFinanceStore } from '../../store/finance';
import { useTheme } from '../../theme/ThemeProvider';
import { formatDateKey, formatNumber, transactionTitle } from '../../utils/format';
import { formatTransactionAmount, transactionAmountRole } from '../../utils/homeModel';
import { filterByType, filterTransactions, TypeFilter } from '../../utils/search';

const TYPE_TABS: SegmentOption<TypeFilter>[] = [
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
  const { colors } = useTheme();
  const { transactions, goals, categories, isReady } = useFinanceStore();
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [searchFocused, setSearchFocused] = useState(false);

  // The tab narrows by type first; the search then looks only inside that tab ("food" on Expense searches expenses).
  // Filters live as you type: merchant/source, category, note, a transfer's From -> To, and amounts.
  const inTab = useMemo(() => filterByType(transactions, typeFilter), [transactions, typeFilter]);
  const visible = useMemo(() => filterTransactions(inTab, query, goals), [inTab, query, goals]);
  const isSearching = query.trim().length > 0;
  const noun = TAB_NOUNS[typeFilter];
  // The emoji a category stores, by category name (what transactions store).
  const categoryIcons = useMemo(() => Object.fromEntries(categories.map((category) => [category.name, category.icon])), [categories]);

  useEffect(() => {
    if (!isReady) {
      void useFinanceStore.getState().loadData();
    }
  }, [isReady]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader title="Transactions" />
      {transactions.length === 0 ? (
        <View style={styles.emptyContainer}>
          <AppText style={[styles.emptyState, { color: colors.textMuted }]}>No transactions yet — add your first one.</AppText>
        </View>
      ) : (
        <>
          <View style={styles.tabsWrap}>
            <SegmentedControl options={TYPE_TABS} value={typeFilter} onChange={setTypeFilter} />
          </View>
          <View
            style={[
              styles.searchBox,
              { backgroundColor: colors.surface, borderColor: searchFocused ? colors.text : colors.inputBorder },
            ]}
          >
            <Ionicons name="search" size={18} color={colors.textMuted} />
            <AppTextInput
              style={[styles.searchInput, { color: colors.text }]}
              value={query}
              onChangeText={setQuery}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder="Search merchant, category, note or amount"
              placeholderTextColor={colors.textMuted}
              cursorColor={colors.primary}
              selectionColor={colors.primary}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="never"
              accessibilityLabel="Search transactions"
            />
            {isSearching && (
              <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
              </Pressable>
            )}
          </View>
          <AppText style={[styles.hint, { color: colors.textMuted }]}>
            {isSearching
              ? `${visible.length} of ${inTab.length} ${noun.plural}`
              : 'Tap any entry to edit or delete it.'}
          </AppText>
          <FlatList
            data={visible}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ListEmptyComponent={
              <View style={styles.noMatch}>
                <AppText style={[styles.emptyState, { color: colors.textMuted }]}>
                  {isSearching ? `No ${noun.plural} match “${query.trim()}”.` : `No ${noun.plural} yet.`}
                </AppText>
                {isSearching ? (
                  <Pressable onPress={() => setQuery('')} accessibilityRole="button" hitSlop={10}>
                    <AppText style={[styles.clearLink, { color: colors.primaryText }]}>Clear search</AppText>
                  </Pressable>
                ) : (
                  <Pressable onPress={() => setTypeFilter('all')} accessibilityRole="button" hitSlop={10}>
                    <AppText style={[styles.clearLink, { color: colors.primaryText }]}>Show all</AppText>
                  </Pressable>
                )}
              </View>
            }
            renderItem={({ item, index }) => {
              const role = transactionAmountRole(item.type);
              const isTransfer = item.type === 'transfer';
              const isForeign = item.currency !== 'ETB';
              const title = transactionTitle(item, goals);
              const discColor = role === 'expense' ? colors.expenseDisc : role === 'income' ? colors.incomeDisc : colors.transferDisc;
              const glyphColor = role === 'expense' ? colors.expenseGlyph : role === 'income' ? colors.incomeGlyph : colors.transferGlyph;
              const amountColor = role === 'expense' ? colors.expense : role === 'income' ? colors.income : colors.text;
              const emoji = isTransfer ? '' : (categoryIcons[item.category] ?? '').trim();
              const signed = formatTransactionAmount(item.type, item.amountETB);
              const sub = `${formatDateKey(item.date)}${item.account ? ` · ${item.type === 'income' ? 'into' : 'from'} ${item.account === 'saved' ? 'Saved' : 'Available'}` : ''}`;
              const detail = detailLine(item.source, item.note);
              // One flat card made of rows: the first row rounds the top corners, the last the bottom ones, hairlines between.
              const first = index === 0;
              const last = index === visible.length - 1;

              return (
                <Pressable
                  onPress={() => router.push(`/edit-transaction/${item.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`${title}, ${signed}, ${sub}. Opens the transaction.`}
                  style={({ pressed }) => [
                    styles.item,
                    { backgroundColor: pressed ? colors.bg : colors.surface, borderColor: colors.border },
                    first && styles.itemFirst,
                    last && styles.itemLast,
                    !first && { borderTopWidth: 0 },
                  ]}
                >
                  {!first && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
                  <View style={[styles.disc, { backgroundColor: discColor }]}>
                    {isTransfer ? (
                      <Ionicons name="swap-horizontal" size={20} color={glyphColor} />
                    ) : emoji ? (
                      <AppText style={styles.emoji} maxFontSizeMultiplier={1.2}>
                        {emoji}
                      </AppText>
                    ) : (
                      <Ionicons name="receipt-outline" size={20} color={glyphColor} />
                    )}
                  </View>
                  {/* The text side takes whatever width the amount leaves and truncates, instead of pushing the amount out of the
                      card (same approach as the Home recent list and the Recurring rows). */}
                  <View style={styles.itemContent}>
                    <AppText style={[styles.title, { color: colors.text }]} numberOfLines={2}>
                      {title}
                    </AppText>
                    <AppText style={[styles.meta, { color: colors.textMuted }]} numberOfLines={2}>
                      {sub}
                    </AppText>
                    {detail !== '' && (
                      <AppText style={[styles.meta, { color: colors.textMuted }]} numberOfLines={1}>
                        {detail}
                      </AppText>
                    )}
                  </View>
                  {/* Bounded width so the amount's shrink-to-fit has something to fit into at large system font sizes. */}
                  <View style={styles.amountWrap}>
                    <AppText
                      variant="number"
                      style={[styles.amount, { color: amountColor }]}
                      maxFontSizeMultiplier={1.3}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.5}
                    >
                      {signed}
                    </AppText>
                    {isForeign && (
                      <AppText style={[styles.converted, { color: colors.textMuted }]} maxFontSizeMultiplier={1.3} numberOfLines={1}>
                        (originally {formatNumber(item.amount)} {item.currency})
                      </AppText>
                    )}
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
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  emptyState: {
    fontSize: 15,
    textAlign: 'center',
  },
  tabsWrap: {
    marginHorizontal: 20,
    marginTop: 8,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    marginHorizontal: 20,
    marginTop: 12,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 11,
    fontSize: 15,
  },
  noMatch: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 24,
  },
  clearLink: {
    fontSize: 14,
    fontWeight: '700',
  },
  hint: {
    fontSize: 13,
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 10,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderTopWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  itemFirst: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  itemLast: {
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    borderBottomWidth: 1,
  },
  divider: {
    position: 'absolute',
    top: 0,
    left: 14,
    right: 14,
    height: StyleSheet.hairlineWidth,
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
  itemContent: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
  },
  meta: {
    fontSize: 12,
  },
  amountWrap: {
    maxWidth: '45%',
    flexShrink: 0,
    alignItems: 'flex-end',
    gap: 2,
  },
  amount: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'right',
  },
  converted: {
    fontSize: 11,
    textAlign: 'right',
  },
});
