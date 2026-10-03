import { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import AppHeader from '../components/AppHeader';
import DonutChart from '../components/DonutChart';
import { APP_USER_NAME, colors, radius, spacing, typography } from '../constants/theme';
import { useFinanceStore } from '../store/finance';
import { useUiStore } from '../store/ui';
import { getBalances } from '../utils/balances';
import { calculateBuilderStreak, getBudgetProgress, getCurrentPeriodSummary } from '../utils/currency';
import { formatDateKey, formatETB, formatNumber, HIDDEN_AMOUNT, transactionTitle } from '../utils/format';
import { getDashboardMessage } from '../utils/motivation';
import { getCategoryBreakdown, getFilteredTransactionsByRange, getRangeDates } from '../utils/reports';

// Money amounts in transaction cards stop scaling past this multiplier so extreme accessibility
// font sizes can't push them out of the card; other text keeps scaling normally.
const MONEY_MAX_FONT_SCALE = 1.3;

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function HomeScreen() {
  const router = useRouter();
  const { transactions, exchangeRates, goals, homeCurrency, origin, isReady, budgets } = useFinanceStore();
  const notifications = useUiStore((state) => state.notifications);
  const isBalanceHidden = useUiStore((state) => state.isBalanceHidden);
  const toggleBalanceVisibility = useUiStore((state) => state.toggleBalanceVisibility);
  const upsertNotifications = useUiStore((state) => state.upsertNotifications);

  useEffect(() => {
    if (!isReady) {
      void useFinanceStore.getState().loadData();
    }
  }, [isReady]);

  const budgetAlerts = useMemo(
    () =>
      budgets
        .map((budget) => {
          const { spentAmount, limitETB, isOverBudget } = getBudgetProgress(budget, transactions, exchangeRates);
          if (!isOverBudget || limitETB === null) {
            return null;
          }

          const exceeded = spentAmount - limitETB;
          return {
            category: budget.category,
            amount: exceeded,
            currency: 'ETB',
          };
        })
        .filter((item): item is { category: string; amount: number; currency: string } => item !== null),
    [budgets, transactions, exchangeRates],
  );

  useEffect(() => {
    if (budgetAlerts.length === 0) {
      return;
    }

    const nextNotifications = budgetAlerts.map((alert) => ({
      id: `budget-${alert.category}`,
      title: 'Budget alert',
      description: `${alert.category} is over budget by ${alert.currency} ${alert.amount.toFixed(2)}.`,
      isRead: false,
      type: 'budget' as const,
    }));

    upsertNotifications(nextNotifications);
  }, [budgetAlerts, upsertNotifications]);

  // Every figure below is derived from the ledger on each render (V2 Part C) - nothing is cached.
  const balances = useMemo(() => getBalances(transactions), [transactions]);
  const periodSummary = useMemo(() => getCurrentPeriodSummary(transactions), [transactions]);
  const builderStreak = useMemo(() => calculateBuilderStreak(transactions), [transactions]);
  const motivationalMessage = getDashboardMessage(origin, balances.saved);

  const monthlyBreakdown = useMemo(() => {
    const dates = getRangeDates('monthly');
    const filtered = getFilteredTransactionsByRange(transactions, dates.start, dates.end);
    return getCategoryBreakdown(filtered);
  }, [transactions]);

  const totalSpending = monthlyBreakdown.reduce((sum, item) => sum + item.amount, 0);
  const recentTransactions = transactions.slice(0, 3);
  const monthName = new Date().toLocaleString('default', { month: 'long' });

  const mask = (value: number) => (isBalanceHidden ? HIDDEN_AMOUNT : formatETB(value));

  const onNotificationPress = () => {
    router.push('/notifications');
  };

  const unreadCount = notifications.filter((notification) => !notification.isRead).length;

  return (
    <View style={styles.screen}>
      <AppHeader title="Home" notificationCount={unreadCount} onNotificationPress={onNotificationPress} />
      <ScrollView contentContainerStyle={styles.container}>
        <View>
          <Text style={styles.greeting}>{getGreeting()}, {APP_USER_NAME} 👋</Text>
          <Text style={styles.motivation}>{motivationalMessage}</Text>
        </View>

        <View style={styles.balanceCard}>
          <View style={styles.balanceHeader}>
            <Text style={styles.balanceLabel}>Total Balance</Text>
            <Pressable
              onPress={toggleBalanceVisibility}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={isBalanceHidden ? 'Show balances' : 'Hide balances'}
            >
              <Ionicons name={isBalanceHidden ? 'eye-off-outline' : 'eye-outline'} size={20} color="#FFFFFF" />
            </Pressable>
          </View>
          <Text style={styles.balanceValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
            {mask(balances.total)}
          </Text>
        </View>

        <View style={styles.row}>
          <View style={styles.balanceTile}>
            <Text style={styles.tileLabel}>Available</Text>
            <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
              {mask(balances.available)}
            </Text>
          </View>
          <View style={styles.balanceTile}>
            <Text style={styles.tileLabel}>Saved</Text>
            <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
              {mask(balances.saved)}
            </Text>
          </View>
        </View>

        <Text style={styles.periodTitle}>This Month · {monthName}</Text>
        <View style={styles.row}>
          <View style={styles.summaryCard}>
            <View style={[styles.summaryIconCircle, { backgroundColor: colors.oliveLight }]}>
              <Ionicons name="trending-up" size={16} color={colors.statusIncome} />
            </View>
            <Text style={styles.tileLabel}>Income</Text>
            <Text
              style={[styles.summaryValue, { color: colors.statusIncome }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {formatNumber(periodSummary.income)}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <View style={[styles.summaryIconCircle, { backgroundColor: colors.redLight }]}>
              <Ionicons name="trending-down" size={16} color={colors.statusExpense} />
            </View>
            <Text style={styles.tileLabel}>Expenses</Text>
            <Text
              style={[styles.summaryValue, { color: colors.statusExpense }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {formatNumber(periodSummary.expenses)}
            </Text>
          </View>
        </View>

        {/* Net is this month's income minus expenses - a flow, not a balance, so it is never labelled "Available". */}
        <View style={styles.netCard}>
          <Text style={styles.tileLabel}>Net (Income − Expenses)</Text>
          <Text
            style={[styles.netValue, { color: periodSummary.net < 0 ? colors.statusExpense : colors.statusIncome }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {periodSummary.net > 0 ? '+' : ''}
            {formatNumber(periodSummary.net)}
          </Text>
        </View>

        <Pressable style={styles.streakCard}>
          <View style={styles.streakLeft}>
            <Text style={styles.streakEmoji}>🔥</Text>
            <View style={styles.flexShrink}>
              <Text style={styles.streakText}>{builderStreak} day streak</Text>
              <Text style={styles.streakSupport}>
                {builderStreak > 0 ? "You're doing great!" : 'Record something today to start your streak.'}
              </Text>
            </View>
          </View>
        </Pressable>

        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Spending this month</Text>
            <Pressable onPress={() => router.push('/reports')}>
              <Text style={styles.seeAll}>See details →</Text>
            </Pressable>
          </View>
          {monthlyBreakdown.length === 0 ? (
            <Text style={styles.emptyState}>No expenses logged yet this month.</Text>
          ) : (
            <DonutChart
              data={monthlyBreakdown}
              centerLabel={`${homeCurrency} total`}
              centerValue={totalSpending.toFixed(0)}
            />
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Recent transactions</Text>
            <Pressable onPress={() => router.push('/transactions')}>
              <Text style={styles.seeAll}>See all →</Text>
            </Pressable>
          </View>
          {recentTransactions.length === 0 ? (
            <Text style={styles.emptyState}>No transactions yet — add your first one.</Text>
          ) : (
            recentTransactions.map((transaction) => {
              const isExpense = transaction.type === 'expense';
              const isTransfer = transaction.type === 'transfer';
              const tint = isExpense ? colors.statusExpense : isTransfer ? colors.blue : colors.statusIncome;
              const sign = isExpense ? '-' : isTransfer ? '' : '+';

              return (
                // Left side takes the remaining width and truncates; the amount shrinks to fit rather than
                // overflowing, so ETB 1,000,000.00, long merchants and large font sizes all stay inside the card.
                <View key={transaction.id} style={styles.transactionRow}>
                  <View style={styles.transactionLeft}>
                    <View
                      style={[
                        styles.transactionIcon,
                        { backgroundColor: isExpense ? colors.redLight : isTransfer ? '#E3EAFB' : colors.oliveLight },
                      ]}
                    >
                      <Ionicons
                        name={isExpense ? 'cart' : isTransfer ? 'swap-horizontal' : 'briefcase'}
                        size={16}
                        color={tint}
                      />
                    </View>
                    <View style={styles.transactionText}>
                      <Text style={styles.transactionCategory} numberOfLines={1}>
                        {transactionTitle(transaction, goals)}
                      </Text>
                      <Text style={styles.transactionMeta} numberOfLines={1}>
                        {isTransfer ? '' : `${transaction.source} · `}
                        {formatDateKey(transaction.date)}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.transactionAmountWrap}>
                    <Text
                      style={[styles.transactionAmount, { color: isTransfer ? colors.navy : tint }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                      maxFontSizeMultiplier={MONEY_MAX_FONT_SCALE}
                    >
                      {sign}
                      {formatETB(transaction.amountETB)}
                    </Text>
                    {transaction.currency !== 'ETB' && (
                      <Text style={styles.transactionOriginal} numberOfLines={1} maxFontSizeMultiplier={MONEY_MAX_FONT_SCALE}>
                        (originally {formatNumber(transaction.amount)} {transaction.currency})
                      </Text>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  greeting: {
    ...typography.pageTitle,
    fontSize: 22,
    color: colors.navy,
  },
  motivation: {
    ...typography.helper,
    color: colors.textSecondary,
    marginTop: 4,
  },
  balanceCard: {
    backgroundColor: colors.navy,
    borderRadius: radius.card,
    padding: spacing.lg,
  },
  balanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  balanceLabel: {
    ...typography.helper,
    color: '#C6CCD8',
  },
  balanceValue: {
    ...typography.bigNumber,
    color: '#FFFFFF',
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  balanceTile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: 4,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  tileLabel: {
    ...typography.helper,
    color: colors.textSecondary,
  },
  tileValue: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.navy,
  },
  periodTitle: {
    ...typography.sectionTitle,
    color: colors.navy,
    marginBottom: -spacing.sm,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.md,
    alignItems: 'flex-start',
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  summaryIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: '800',
    alignSelf: 'stretch',
  },
  netCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: 4,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  netValue: {
    fontSize: 22,
    fontWeight: '800',
  },
  streakCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.orangeLight,
    borderRadius: radius.card,
    padding: spacing.lg,
  },
  streakLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flexShrink: 1,
  },
  flexShrink: {
    flexShrink: 1,
  },
  streakEmoji: {
    fontSize: 26,
  },
  streakText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.navy,
  },
  streakSupport: {
    ...typography.helper,
    color: colors.textSecondary,
    marginTop: 2,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionTitle: {
    ...typography.sectionTitle,
    color: colors.navy,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  seeAll: {
    ...typography.helper,
    color: colors.blue,
    fontWeight: '700',
  },
  transactionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.background,
  },
  transactionLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  transactionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transactionText: {
    flex: 1,
    minWidth: 0,
  },
  transactionCategory: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.navy,
  },
  transactionMeta: {
    ...typography.helper,
    color: colors.textSecondary,
    marginTop: 2,
  },
  transactionAmountWrap: {
    maxWidth: '48%',
    flexShrink: 0,
    alignItems: 'flex-end',
  },
  transactionAmount: {
    fontWeight: '700',
  },
  transactionOriginal: {
    ...typography.helper,
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  emptyState: {
    ...typography.helper,
    color: colors.textSecondary,
  },
});
