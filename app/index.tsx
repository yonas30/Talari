import { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import AppHeader from '../components/AppHeader';
import DonutChart from '../components/DonutChart';
import { APP_USER_NAME, colors, radius, spacing, typography } from '../constants/theme';
import { useFinanceStore } from '../store/finance';
import { useUiStore } from '../store/ui';
import { calculateBuilderStreak, getBudgetProgress, getCurrentPeriodSummary } from '../utils/currency';
import { getDashboardMessage } from '../utils/motivation';
import { getCategoryBreakdown, getFilteredTransactionsByRange, getRangeDates } from '../utils/reports';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function HomeScreen() {
  const router = useRouter();
  const { transactions, exchangeRates, homeCurrency, origin, monthlySnapshots, isReady, budgets } = useFinanceStore();
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
          const { spentAmount, isOverBudget } = getBudgetProgress(budget, transactions, exchangeRates);
          if (!isOverBudget) {
            return null;
          }

          const exceeded = spentAmount - budget.monthlyLimit;
          return {
            category: budget.category,
            amount: exceeded,
            currency: budget.currency,
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

  const periodSummary = getCurrentPeriodSummary(transactions, homeCurrency, exchangeRates);
  const totalSavings = transactions
    .filter((transaction) => transaction.type === 'savings')
    .reduce((sum, item) => sum + item.amount, 0);

  const builderStreak = calculateBuilderStreak(transactions);
  const motivationalMessage = getDashboardMessage(origin, totalSavings);

  const monthlyBreakdown = useMemo(() => {
    const dates = getRangeDates('monthly');
    const filtered = getFilteredTransactionsByRange(transactions, dates.start, dates.end);
    return getCategoryBreakdown(filtered, homeCurrency, exchangeRates);
  }, [transactions, homeCurrency, exchangeRates]);

  const totalSpending = monthlyBreakdown.reduce((sum, item) => sum + item.amount, 0);

  const previousSnapshot = monthlySnapshots[monthlySnapshots.length - 1];
  const previousBalance = previousSnapshot ? previousSnapshot.income - previousSnapshot.expenses : null;
  const trendPercent =
    previousBalance !== null && Math.abs(previousBalance) > 0
      ? ((periodSummary.net - previousBalance) / Math.abs(previousBalance)) * 100
      : null;

  const recentTransactions = transactions.slice(0, 3);

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
            <Pressable onPress={toggleBalanceVisibility} hitSlop={8}>
              <Ionicons name={isBalanceHidden ? 'eye-off-outline' : 'eye-outline'} size={20} color="#FFFFFF" />
            </Pressable>
          </View>
          <Text style={styles.balanceValue}>
            {homeCurrency} {isBalanceHidden ? '••••••' : Math.max(periodSummary.net, 0).toFixed(2)}
          </Text>
          {trendPercent !== null && (
            <View style={styles.trendRow}>
              <Ionicons
                name={trendPercent >= 0 ? 'trending-up' : 'trending-down'}
                size={14}
                color={trendPercent >= 0 ? colors.oliveLight : colors.redLight}
              />
              <Text style={[styles.trendText, trendPercent < 0 && styles.trendTextNegative]}>
                {trendPercent >= 0 ? '+' : ''}
                {trendPercent.toFixed(0)}% from last month
              </Text>
            </View>
          )}
        </View>

        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <View style={[styles.summaryIconCircle, { backgroundColor: colors.oliveLight }]}>
              <Ionicons name="trending-up" size={16} color={colors.statusIncome} />
            </View>
            <Text style={styles.summaryLabel}>Income</Text>
            <Text style={[styles.summaryValue, { color: colors.statusIncome }]}>
              {periodSummary.income.toFixed(0)}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <View style={[styles.summaryIconCircle, { backgroundColor: colors.redLight }]}>
              <Ionicons name="trending-down" size={16} color={colors.statusExpense} />
            </View>
            <Text style={styles.summaryLabel}>Expenses</Text>
            <Text style={[styles.summaryValue, { color: colors.statusExpense }]}>
              {periodSummary.expenses.toFixed(0)}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <View style={[styles.summaryIconCircle, { backgroundColor: colors.oliveLight }]}>
              <Ionicons name="wallet" size={16} color={colors.olive} />
            </View>
            <Text style={styles.summaryLabel}>Saved</Text>
            <Text style={[styles.summaryValue, { color: colors.olive }]}>{periodSummary.savings.toFixed(0)}</Text>
          </View>
        </View>

        <Pressable style={styles.streakCard}>
          <View style={styles.streakLeft}>
            <Text style={styles.streakEmoji}>🔥</Text>
            <View>
              <Text style={styles.streakText}>{builderStreak} day streak</Text>
              <Text style={styles.streakSupport}>
                {builderStreak > 0 ? "You're doing great!" : 'Log something today to start your streak.'}
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.orange} />
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
            recentTransactions.map((transaction) => (
              <View key={transaction.id} style={styles.transactionRow}>
                <View style={styles.transactionLeft}>
                  <View
                    style={[
                      styles.transactionIcon,
                      { backgroundColor: transaction.type === 'expense' ? colors.redLight : colors.oliveLight },
                    ]}
                  >
                    <Ionicons
                      name={transaction.type === 'expense' ? 'cart' : transaction.type === 'income' ? 'briefcase' : 'wallet'}
                      size={16}
                      color={transaction.type === 'expense' ? colors.statusExpense : colors.statusIncome}
                    />
                  </View>
                  <View>
                    <Text style={styles.transactionCategory}>{transaction.category}</Text>
                    <Text style={styles.transactionMeta}>
                      {transaction.source} · {new Date(transaction.date).toLocaleDateString()}
                    </Text>
                  </View>
                </View>
                <Text
                  style={[
                    styles.transactionAmount,
                    { color: transaction.type === 'expense' ? colors.statusExpense : colors.statusIncome },
                  ]}
                >
                  {transaction.type === 'expense' ? '-' : '+'}
                  {transaction.amount.toFixed(2)} {transaction.currency}
                </Text>
              </View>
            ))
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
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  trendText: {
    ...typography.helper,
    color: colors.oliveLight,
  },
  trendTextNegative: {
    color: colors.redLight,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
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
  summaryLabel: {
    ...typography.helper,
    color: colors.textSecondary,
  },
  summaryValue: {
    fontSize: 16,
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
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.background,
  },
  transactionLeft: {
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
  transactionAmount: {
    fontWeight: '700',
  },
  emptyState: {
    ...typography.helper,
    color: colors.textSecondary,
  },
});
