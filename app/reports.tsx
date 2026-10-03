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
import { addDays, toLocalDateKey } from '../utils/dates';
import { formatETB, formatNumber } from '../utils/format';
import {
  RangePreset,
  TREND_TITLES,
  clampCustomRange,
  endOfWeek,
  getBiggestSpendingCategory,
  getCategoryBreakdown,
  getFilteredTransactionsByRange,
  getPeriodTotals,
  getRangeDates,
  getSourceBreakdown,
  getTrendSeries,
  shiftMonth,
  shiftWeek,
  startOfWeek,
} from '../utils/reports';

interface PeriodNavProps {
  label: string;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
}

// Shared ← label → control for the weekly and monthly views. Going forward past the current period
// is disabled (nothing can have happened yet), and shown as such.
function PeriodNav({ label, canGoForward, onBack, onForward }: PeriodNavProps) {
  return (
    <View style={styles.monthNav}>
      <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Previous period">
        <Ionicons name="chevron-back" size={22} color={colors.navy} />
      </Pressable>
      <Text style={styles.monthLabel}>{label}</Text>
      <Pressable
        onPress={onForward}
        disabled={!canGoForward}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Next period"
        accessibilityState={{ disabled: !canGoForward }}
      >
        <Ionicons name="chevron-forward" size={22} color={canGoForward ? colors.navy : '#C9CDD6'} />
      </Pressable>
    </View>
  );
}

export default function ReportsScreen() {
  const transactions = useFinanceStore((state) => state.transactions);
  const [range, setRange] = useState<RangePreset>('monthly');
  const [monthOffset, setMonthOffset] = useState(0);
  const [weekOffset, setWeekOffset] = useState(0);
  // Custom period defaults to the last 30 days; both ends are user-editable.
  const [customStart, setCustomStart] = useState(() => toLocalDateKey(addDays(new Date(), -29)));
  const [customEnd, setCustomEnd] = useState(() => toLocalDateKey(new Date()));

  const referenceDate = useMemo(
    () => (range === 'weekly' ? shiftWeek(new Date(), weekOffset) : shiftMonth(new Date(), monthOffset)),
    [range, monthOffset, weekOffset],
  );

  const dates = useMemo(
    () => (range === 'custom' ? { start: customStart, end: customEnd } : getRangeDates(range, referenceDate)),
    [range, referenceDate, customStart, customEnd],
  );

  // Everything below is computed from this one filtered list, so a change of period updates every
  // metric and chart together.
  const filtered = useMemo(
    () => getFilteredTransactionsByRange(transactions, dates.start, dates.end),
    [transactions, dates],
  );

  const totals = useMemo(() => getPeriodTotals(filtered), [filtered]);
  const categoryBreakdown = useMemo(() => getCategoryBreakdown(filtered), [filtered]);
  const sourceBreakdown = useMemo(() => getSourceBreakdown(filtered), [filtered]);
  const trend = useMemo(() => getTrendSeries(filtered, dates.start, dates.end), [filtered, dates]);
  const biggestCategory = useMemo(() => getBiggestSpendingCategory(filtered), [filtered]);

  const totalSpending = categoryBreakdown.reduce((sum, item) => sum + item.amount, 0);

  const weekLabel = useMemo(() => {
    const start = startOfWeek(referenceDate);
    const end = endOfWeek(referenceDate);
    return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }, [referenceDate]);

  const onCustomChange = (changed: 'start' | 'end', value: string) => {
    const next = clampCustomRange(
      changed,
      changed === 'start' ? value : customStart,
      changed === 'end' ? value : customEnd,
    );
    setCustomStart(next.start);
    setCustomEnd(next.end);
  };

  const netColor = totals.net < 0 ? colors.statusExpense : colors.statusIncome;

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
          <PeriodNav
            label={referenceDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            canGoForward={monthOffset < 0}
            onBack={() => setMonthOffset((prev) => prev - 1)}
            onForward={() => setMonthOffset((prev) => Math.min(prev + 1, 0))}
          />
        )}

        {range === 'weekly' && (
          <PeriodNav
            label={weekLabel}
            canGoForward={weekOffset < 0}
            onBack={() => setWeekOffset((prev) => prev - 1)}
            onForward={() => setWeekOffset((prev) => Math.min(prev + 1, 0))}
          />
        )}

        {range === 'custom' && (
          <View style={styles.customRow}>
            <View style={styles.customField}>
              <Text style={styles.label}>Start date</Text>
              <DateField label="Start date" value={customStart} onChange={(value) => onCustomChange('start', value)} />
            </View>
            <View style={styles.customField}>
              <Text style={styles.label}>End date</Text>
              <DateField label="End date" value={customEnd} onChange={(value) => onCustomChange('end', value)} />
            </View>
          </View>
        )}

        <Text style={styles.currencyNote}>All amounts in ETB · transfers are not counted as income or spending</Text>

        <View style={styles.summaryRow}>
          <View style={[styles.summaryCard, { backgroundColor: colors.oliveLight }]}>
            <View style={styles.summaryHeaderRow}>
              <Text style={styles.summaryLabel}>Income</Text>
              <Ionicons name="trending-up" size={14} color={colors.statusIncome} />
            </View>
            <Text
              style={[styles.summaryValue, { color: colors.statusIncome }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
              maxFontSizeMultiplier={1.3}
            >
              {formatNumber(totals.income)}
            </Text>
          </View>
          <View style={[styles.summaryCard, { backgroundColor: colors.redLight }]}>
            <View style={styles.summaryHeaderRow}>
              <Text style={styles.summaryLabel}>Expenses</Text>
              <Ionicons name="trending-down" size={14} color={colors.statusExpense} />
            </View>
            <Text
              style={[styles.summaryValue, { color: colors.statusExpense }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
              maxFontSizeMultiplier={1.3}
            >
              {formatNumber(totals.expenses)}
            </Text>
          </View>
          <View style={[styles.summaryCard, { backgroundColor: colors.surface }]}>
            <View style={styles.summaryHeaderRow}>
              <Text style={styles.summaryLabel}>Net</Text>
              <Ionicons name="swap-vertical" size={14} color={netColor} />
            </View>
            <Text
              style={[styles.summaryValue, { color: netColor }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
              maxFontSizeMultiplier={1.3}
            >
              {totals.net > 0 ? '+' : ''}
              {formatNumber(totals.net)}
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Spending by category</Text>
          {categoryBreakdown.length === 0 ? (
            <Text style={styles.emptyState}>No expense data for this period.</Text>
          ) : (
            <DonutChart
              data={categoryBreakdown}
              centerLabel="ETB total"
              centerValue={formatNumber(totalSpending, 0)}
            />
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Income by source</Text>
          {sourceBreakdown.length === 0 ? (
            <Text style={styles.emptyState}>No income sources for this period.</Text>
          ) : (
            <HorizontalBarChart data={sourceBreakdown} />
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{TREND_TITLES[range]}</Text>
          {filtered.every((item) => item.type === 'transfer') ? (
            <Text style={styles.emptyState}>No activity for this period.</Text>
          ) : (
            <TrendLineChart data={trend} />
          )}
        </View>

        <View style={[styles.card, styles.highlightCard]}>
          <Text style={styles.sectionTitle}>Biggest spending category</Text>
          {biggestCategory ? (
            <Text style={styles.highlightText}>
              {biggestCategory.label}: {formatETB(biggestCategory.amount)}
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
  currencyNote: {
    ...typography.helper,
    color: colors.textSecondary,
    textAlign: 'center',
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
