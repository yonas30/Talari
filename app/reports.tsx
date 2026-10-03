import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import AppHeader from '../components/AppHeader';
import DateField from '../components/DateField';
import DonutChart from '../components/DonutChart';
import HorizontalBarChart from '../components/HorizontalBarChart';
import TrendLineChart from '../components/TrendLineChart';
import { colors, radius, spacing, typography } from '../constants/theme';
import { useFinanceStore } from '../store/finance';
import { RangePreset, endOfWeek, getBiggestSpendingCategory, getCategoryBreakdown, getFilteredTransactionsByRange, getRangeDates, getSourceBreakdown, getTrendSeries, startOfWeek, toISODate } from '../utils/reports';

const TREND_TITLES: Record<RangePreset, string> = {
  weekly: 'Weekly Trend',
  monthly: 'Monthly Trend',
  custom: 'Custom Trend',
};

export default function ReportsScreen() {
  const { transactions, homeCurrency } = useFinanceStore();
  const [range, setRange] = useState<RangePreset>('monthly');
  const [monthOffset, setMonthOffset] = useState(0);
  const [weekOffset, setWeekOffset] = useState(0);
  const [customStart, setCustomStart] = useState(toISODate(new Date(Date.now() - 29 * 86400000)));
  const [customEnd, setCustomEnd] = useState(toISODate(new Date()));

  const referenceDate = useMemo(() => {
    const date = new Date();
    if (range === 'monthly') {
      date.setMonth(date.getMonth() + monthOffset);
    } else if (range === 'weekly') {
      date.setDate(date.getDate() + weekOffset * 7);
    }
    return date;
  }, [range, monthOffset, weekOffset]);

  const dates = useMemo(() => {
    if (range === 'custom') {
      return { start: customStart, end: customEnd };
    }
    return getRangeDates(range, referenceDate);
  }, [range, referenceDate, customStart, customEnd]);

  const filtered = useMemo(
    () => getFilteredTransactionsByRange(transactions, dates.start, dates.end),
    [transactions, dates],
  );

  const periodIncome = useMemo(
    () =>
      filtered
        .filter((transaction) => transaction.type === 'income')
        .reduce((sum, transaction) => sum + transaction.amountETB, 0),
    [filtered],
  );
  const periodExpenses = useMemo(
    () =>
      filtered
        .filter((transaction) => transaction.type === 'expense')
        .reduce((sum, transaction) => sum + transaction.amountETB, 0),
    [filtered],
  );

  const categoryBreakdown = useMemo(
    () => getCategoryBreakdown(filtered),
    [filtered],
  );
  const sourceBreakdown = useMemo(
    () => getSourceBreakdown(filtered),
    [filtered],
  );
  const trend = useMemo(
    () => getTrendSeries(filtered, dates.start, dates.end),
    [filtered, dates],
  );
  const biggestCategory = useMemo(
    () => getBiggestSpendingCategory(filtered),
    [filtered],
  );

  const totalSpending = categoryBreakdown.reduce((sum, item) => sum + item.amount, 0);

  const weekLabel = useMemo(() => {
    const start = startOfWeek(referenceDate);
    const end = endOfWeek(referenceDate);
    return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }, [referenceDate]);

  return (
    <View style={styles.screen}>
      <AppHeader title="Insights" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.segmented}>
          {(['weekly', 'monthly', 'custom'] as const).map((option) => (
            <Pressable
              key={option}
              style={[styles.pill, range === option && styles.pillSelected]}
              onPress={() => setRange(option)}
            >
              <Text style={[styles.pillText, range === option && styles.pillTextSelected]}>{option}</Text>
            </Pressable>
          ))}
        </View>

        {range === 'monthly' && (
          <View style={styles.monthNav}>
            <Pressable onPress={() => setMonthOffset((prev) => prev - 1)}>
              <Ionicons name="chevron-back" size={20} color={colors.navy} />
            </Pressable>
            <Text style={styles.monthLabel}>
              {referenceDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </Text>
            <Pressable onPress={() => setMonthOffset((prev) => Math.min(prev + 1, 0))}>
              <Ionicons name="chevron-forward" size={20} color={colors.navy} />
            </Pressable>
          </View>
        )}

        {range === 'weekly' && (
          <View style={styles.monthNav}>
            <Pressable onPress={() => setWeekOffset((prev) => prev - 1)}>
              <Ionicons name="chevron-back" size={20} color={colors.navy} />
            </Pressable>
            <Text style={styles.monthLabel}>{weekLabel}</Text>
            <Pressable onPress={() => setWeekOffset((prev) => Math.min(prev + 1, 0))}>
              <Ionicons name="chevron-forward" size={20} color={colors.navy} />
            </Pressable>
          </View>
        )}

        {range === 'custom' && (
          <View style={styles.customRow}>
            <View style={styles.customField}>
              <Text style={styles.label}>Start date</Text>
              <DateField label="Start date" value={customStart} onChange={setCustomStart} />
            </View>
            <View style={styles.customField}>
              <Text style={styles.label}>End date</Text>
              <DateField label="End date" value={customEnd} onChange={setCustomEnd} />
            </View>
          </View>
        )}

        <View style={styles.summaryRow}>
          <View style={[styles.summaryCard, { backgroundColor: colors.oliveLight }]}>
            <View style={styles.summaryHeaderRow}>
              <Text style={styles.summaryLabel}>Income</Text>
              <Ionicons name="trending-up" size={14} color={colors.statusIncome} />
            </View>
            <Text style={[styles.summaryValue, { color: colors.statusIncome }]}>
              {homeCurrency} {periodIncome.toFixed(0)}
            </Text>
          </View>
          <View style={[styles.summaryCard, { backgroundColor: colors.redLight }]}>
            <View style={styles.summaryHeaderRow}>
              <Text style={styles.summaryLabel}>Expenses</Text>
              <Ionicons name="trending-up" size={14} color={colors.statusExpense} />
            </View>
            <Text style={[styles.summaryValue, { color: colors.statusExpense }]}>
              {homeCurrency} {periodExpenses.toFixed(0)}
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Spending by category</Text>
          {categoryBreakdown.length === 0 ? (
            <Text style={styles.emptyState}>No expense data for this range.</Text>
          ) : (
            <DonutChart
              data={categoryBreakdown}
              centerLabel={`${homeCurrency} total`}
              centerValue={totalSpending.toFixed(0)}
            />
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Income by source</Text>
          {sourceBreakdown.length === 0 ? (
            <Text style={styles.emptyState}>No income sources for this range.</Text>
          ) : (
            <HorizontalBarChart data={sourceBreakdown} />
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{TREND_TITLES[range]}</Text>
          {trend.length === 0 ? (
            <Text style={styles.emptyState}>No activity for this range.</Text>
          ) : (
            <TrendLineChart data={trend} />
          )}
        </View>

        <View style={[styles.card, styles.highlightCard]}>
          <Text style={styles.sectionTitle}>Biggest spending category</Text>
          {biggestCategory ? (
            <Text style={styles.highlightText}>
              {biggestCategory.label}: {homeCurrency} {biggestCategory.amount.toFixed(2)}
            </Text>
          ) : (
            <Text style={styles.emptyState}>No spending categories yet.</Text>
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
  segmented: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.button,
    padding: 4,
  },
  pill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: radius.button - 2,
  },
  pillSelected: {
    backgroundColor: colors.navy,
  },
  pillText: {
    color: colors.navy,
    textTransform: 'capitalize',
    fontWeight: '600',
  },
  pillTextSelected: {
    color: '#FFFFFF',
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  monthLabel: {
    fontWeight: '700',
    color: colors.navy,
    fontSize: 15,
  },
  customRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  customField: {
    flex: 1,
    gap: spacing.xs,
  },
  label: {
    ...typography.helper,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  summaryCard: {
    flex: 1,
    borderRadius: radius.card,
    padding: spacing.md,
  },
  summaryHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    ...typography.helper,
    color: colors.textSecondary,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '800',
    marginTop: 4,
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
    marginBottom: spacing.md,
  },
  highlightCard: {
    backgroundColor: colors.orangeLight,
  },
  highlightText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.navy,
  },
  emptyState: {
    ...typography.helper,
    color: colors.textSecondary,
  },
});
