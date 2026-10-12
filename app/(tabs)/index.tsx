import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import AppHeader from '../../components/AppHeader';
import AppText from '../../components/AppText';
import BudgetBanner from '../../components/home/BudgetBanner';
import HeroCard from '../../components/home/HeroCard';
import MonthCard from '../../components/home/MonthCard';
import RecentList from '../../components/home/RecentList';
import SpendingCard from '../../components/home/SpendingCard';
import StreakCard from '../../components/home/StreakCard';
import NameSheet from '../../components/NameSheet';
import { useFinanceStore } from '../../store/finance';
import { useProfileStore } from '../../store/profile';
import { NO_DEV_HOME_PREVIEW, useUiStore } from '../../store/ui';
import { useTheme } from '../../theme/ThemeProvider';
import { getBalances } from '../../utils/balances';
import { calculateBuilderStreak, getCurrentPeriodSummary } from '../../utils/currency';
import { formatETB } from '../../utils/format';
import { buildSpendingSlices, goalsTotal } from '../../utils/homeModel';
import { getBudgetAlerts } from '../../utils/notifications';
import { getDashboardMessage } from '../../utils/motivation';
import { formatGreeting } from '../../utils/profile';
import { getCategoryBreakdown, getFilteredTransactionsByRange, getRangeDates } from '../../utils/reports';

export default function HomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { transactions, exchangeRates, goals, categories, origin, isReady, budgets } = useFinanceStore();
  const isBalanceHidden = useUiStore((state) => state.isBalanceHidden);
  const isSplashDone = useUiStore((state) => state.isSplashDone);
  const isDrawerOpen = useUiStore((state) => state.isDrawerOpen);
  // Development builds only: Settings can force the empty states below. Release builds always use the real data.
  const devPreviewState = useUiStore((state) => state.devHomePreview);
  const devPreview = __DEV__ ? devPreviewState : NO_DEV_HOME_PREVIEW;
  const name = useProfileStore((state) => state.profile.name);
  const promptOffered = useProfileStore((state) => state.promptOfferedThisSession);
  const isPromptDueNow = useProfileStore((state) => state.isPromptDueNow);
  const markPromptOffered = useProfileStore((state) => state.markPromptOffered);
  const saveName = useProfileStore((state) => state.saveName);
  const notNow = useProfileStore((state) => state.notNow);
  const [nameSheetOpen, setNameSheetOpen] = useState(false);

  // The greeting is by local time, so it is recomputed whenever the app comes back to the foreground.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setNow(new Date());
      }
    });
    return () => subscription.remove();
  }, []);

  // One-time "What should we call you?" sheet for people who already had data. A native Modal draws above everything, so it
  // waits for the splash to leave and for the side drawer to be closed, and it is offered at most once per app session
  // (and only on a Home visit). The lock screen never sees it: Home is not rendered until the app is unlocked.
  useFocusEffect(
    useCallback(() => {
      if (isSplashDone && !isDrawerOpen && !promptOffered && isPromptDueNow()) {
        markPromptOffered();
        setNameSheetOpen(true);
      }
    }, [isSplashDone, isDrawerOpen, promptOffered, isPromptDueNow, markPromptOffered]),
  );
  const toggleBalanceVisibility = useUiStore((state) => state.toggleBalanceVisibility);
  const upsertNotifications = useUiStore((state) => state.upsertNotifications);
  const removeNotificationsWhere = useUiStore((state) => state.removeNotificationsWhere);

  useEffect(() => {
    if (!isReady) {
      void useFinanceStore.getState().loadData();
    }
  }, [isReady]);

  const budgetAlerts = useMemo(() => getBudgetAlerts(budgets, transactions, exchangeRates), [budgets, transactions, exchangeRates]);

  useEffect(() => {
    // Drop budget notifications for budgets that are back within their limit (or were deleted).
    const activeIds = new Set(budgetAlerts.map((alert) => alert.id));
    removeNotificationsWhere((item) => item.type === 'budget' && !activeIds.has(item.id));

    if (budgetAlerts.length === 0) {
      return;
    }

    const nextNotifications = budgetAlerts.map((alert) => ({
      id: alert.id,
      title: alert.title,
      description: alert.description,
      isRead: false,
      type: 'budget' as const,
      route: alert.route,
    }));

    upsertNotifications(nextNotifications);
  }, [budgetAlerts, upsertNotifications, removeNotificationsWhere]);

  // Every figure below is derived from the ledger on each render (V2 Part C) - nothing is cached. The redesign changes how the
  // numbers are drawn, not where they come from.
  const balances = useMemo(() => getBalances(transactions), [transactions]);
  const periodSummary = useMemo(() => getCurrentPeriodSummary(transactions), [transactions]);
  const realStreak = useMemo(() => calculateBuilderStreak(transactions), [transactions]);
  const builderStreak = devPreview.noStreak ? 0 : realStreak;
  const motivationalMessage = getDashboardMessage(origin, balances.saved);
  const goalsAmount = devPreview.noGoals ? 0 : goalsTotal(balances.goals);

  const spending = useMemo(() => {
    const dates = getRangeDates('monthly');
    const filtered = getFilteredTransactionsByRange(transactions, dates.start, dates.end);
    return buildSpendingSlices(getCategoryBreakdown(filtered));
  }, [transactions]);

  // By category NAME (what transactions store): the icon is the emoji the category stores.
  const categoryIcons = useMemo(() => Object.fromEntries(categories.map((category) => [category.name, category.icon])), [categories]);

  const recentTransactions = devPreview.noTransactions ? [] : transactions.slice(0, 3);
  const shownSpending = devPreview.noSpending ? { slices: [], total: 0 } : spending;
  const monthName = new Date().toLocaleString('default', { month: 'long' });

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader title="Home" hideTitle />
      <ScrollView contentContainerStyle={styles.container}>
        <View>
          <AppText variant="heading" style={[styles.greeting, { color: colors.text }]} accessibilityRole="header">
            {formatGreeting(now, name)}
          </AppText>
          <AppText variant="caption" style={styles.motivation} maxFontSizeMultiplier={1.3}>
            {motivationalMessage}
          </AppText>
        </View>

        {budgetAlerts.length > 0 && (
          <BudgetBanner
            title={budgetAlerts.length === 1 ? `${budgetAlerts[0].category} is over budget` : `${budgetAlerts.length} budgets are over their limit`}
            detail={budgetAlerts.map((alert) => `${alert.category} by ${formatETB(alert.amountOver)}`).join(' · ')}
            onPress={() => router.push('/budgets')}
          />
        )}

        <HeroCard
          total={balances.total}
          available={balances.available}
          saved={balances.saved}
          goalsAmount={goalsAmount}
          hidden={isBalanceHidden}
          onToggleHidden={toggleBalanceVisibility}
        />

        <MonthCard monthName={monthName} income={periodSummary.income} expenses={periodSummary.expenses} net={periodSummary.net} />

        {/* Before the redesign this card did nothing when tapped; it now opens the Journey screen (streak and milestones). */}
        <StreakCard days={builderStreak} onPress={() => router.push('/journey')} />

        <SpendingCard
          slices={shownSpending.slices}
          total={shownSpending.total}
          hidden={isBalanceHidden}
          onSeeDetails={() => router.navigate('/reports')}
        />

        <RecentList
          transactions={recentTransactions}
          goals={goals}
          categoryIcons={categoryIcons}
          onSeeAll={() => router.navigate('/transactions')}
          // Before the redesign these rows did nothing; they now open the same edit screen the Transactions list opens.
          onOpen={(id) => router.push(`/edit-transaction/${id}`)}
        />
      </ScrollView>

      <NameSheet
        visible={nameSheetOpen}
        title="What should we call you?"
        body="Add your name for a personal greeting on Home. You can change it any time in Settings."
        emptyMessage="Add a name, or tap Not now."
        secondaryLabel="Not now"
        onSave={(value) => {
          saveName(value);
          setNameSheetOpen(false);
        }}
        onSecondary={() => {
          notNow();
          setNameSheetOpen(false);
        }}
        // Android Back or a tap outside counts as "Not now".
        onClose={() => {
          notNow();
          setNameSheetOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 4,
    // The raised + button sticks about 24 dp up into the screen; this keeps the last card clear of it.
    paddingBottom: 48,
    gap: 16,
  },
  greeting: {
    fontSize: 25,
    lineHeight: 32,
  },
  motivation: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
});
