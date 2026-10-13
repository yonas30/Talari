import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import AppHeader from '../../components/AppHeader';
import AppText from '../../components/AppText';
import Card from '../../components/Card';
import DateField from '../../components/DateField';
import HorizontalBarChart from '../../components/HorizontalBarChart';
import MonthCard from '../../components/home/MonthCard';
import SegmentedControl, { SegmentOption } from '../../components/SegmentedControl';
import SpendingDonut from '../../components/SpendingDonut';
import TrendLineChart from '../../components/TrendLineChart';
import { useFinanceStore } from '../../store/finance';
import { useTheme } from '../../theme/ThemeProvider';
import { addDays, toLocalDateKey } from '../../utils/dates';
import { formatETB } from '../../utils/format';
import { buildSpendingSlices } from '../../utils/homeModel';
import { CONTROL_LABEL_MAX_SCALE } from '../../utils/layout';
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
} from '../../utils/reports';

const RANGE_OPTIONS: SegmentOption<RangePreset>[] = [
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'custom', label: 'Custom' },
];

// The Insights donut keeps its large size (160 dp); Home's is a third of its card.
const INSIGHTS_DONUT_SIZE = 160;

interface PeriodNavProps {
  label: string;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
}

// Shared ← label → control for the weekly and monthly views. Going forward past the current period
// is disabled (nothing can have happened yet), and shown as such.
function PeriodNav({ label, canGoForward, onBack, onForward }: PeriodNavProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.monthNav}>
      <Pressable
        onPress={onBack}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Previous period"
        style={({ pressed }) => (pressed ? styles.pressed : null)}
      >
        <Ionicons name="chevron-back" size={22} color={colors.text} />
      </Pressable>
      <AppText style={[styles.monthLabel, { color: colors.text }]} numberOfLines={2} maxFontSizeMultiplier={CONTROL_LABEL_MAX_SCALE}>
        {label}
      </AppText>
      <Pressable
        onPress={onForward}
        disabled={!canGoForward}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Next period"
        accessibilityState={{ disabled: !canGoForward }}
        style={({ pressed }) => (pressed && canGoForward ? styles.pressed : null)}
      >
        <Ionicons name="chevron-forward" size={22} color={canGoForward ? colors.text : colors.inputBorder} />
      </Pressable>
    </View>
  );
}

export default function ReportsScreen() {
  const { colors } = useTheme();
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
  // Every category (no "Others" here), with the percentages worked out the same way as on Home.
  const spending = useMemo(() => buildSpendingSlices(categoryBreakdown, Number.POSITIVE_INFINITY), [categoryBreakdown]);

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

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader title="Insights" />
      <ScrollView contentContainerStyle={styles.container}>
        <SegmentedControl options={RANGE_OPTIONS} value={range} onChange={setRange} />

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
              <AppText style={[styles.label, { color: colors.textMuted }]}>Start date</AppText>
              <DateField label="Start date" value={customStart} onChange={(value) => onCustomChange('start', value)} />
            </View>
            <View style={styles.customField}>
              <AppText style={[styles.label, { color: colors.textMuted }]}>End date</AppText>
              <DateField label="End date" value={customEnd} onChange={(value) => onCustomChange('end', value)} />
            </View>
          </View>
        )}

        <AppText style={[styles.currencyNote, { color: colors.textMuted }]}>
          All amounts in ETB · transfers are not counted as income or spending
        </AppText>

        {/* The same card as Home's This Month: Income | Expenses, then Net with its sign. */}
        <MonthCard income={totals.income} expenses={totals.expenses} net={totals.net} />

        <Card>
          <AppText variant="title" style={styles.sectionTitle} accessibilityRole="header">
            Spending by category
          </AppText>
          {spending.slices.length === 0 ? (
            <AppText style={[styles.emptyState, { color: colors.textMuted }]}>No expense data for this period.</AppText>
          ) : (
            <SpendingDonut
              slices={spending.slices}
              total={spending.total}
              hidden={false}
              size={INSIGHTS_DONUT_SIZE}
              amountPlacement="below"
              style={styles.donut}
            />
          )}
        </Card>

        <Card>
          <AppText variant="title" style={styles.sectionTitle} accessibilityRole="header">
            Income by source
          </AppText>
          {sourceBreakdown.length === 0 ? (
            <AppText style={[styles.emptyState, { color: colors.textMuted }]}>No income sources for this period.</AppText>
          ) : (
            <HorizontalBarChart data={sourceBreakdown} />
          )}
        </Card>

        <Card>
          <AppText variant="title" style={styles.sectionTitle} accessibilityRole="header">
            {TREND_TITLES[range]}
          </AppText>
          {filtered.every((item) => item.type === 'transfer') ? (
            <AppText style={[styles.emptyState, { color: colors.textMuted }]}>No activity for this period.</AppText>
          ) : (
            <TrendLineChart data={trend} />
          )}
        </Card>

        {/* The warm accent of the screen, like the streak card on Home. */}
        <View style={[styles.highlight, { backgroundColor: colors.streakFill, borderColor: colors.streakBorder }]}>
          <AppText variant="title" style={styles.sectionTitle} accessibilityRole="header">
            Biggest spending category
          </AppText>
          {biggestCategory ? (
            <AppText style={[styles.highlightText, { color: colors.text }]}>
              {biggestCategory.label}: {formatETB(biggestCategory.amount)}
            </AppText>
          ) : (
            <AppText style={[styles.emptyState, { color: colors.streakMuted }]}>No spending categories yet.</AppText>
          )}
        </View>
      </ScrollView>
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
    paddingBottom: 28,
    gap: 16,
  },
  pressed: {
    opacity: 0.6,
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  // Shrinks and wraps so the two arrows always stay on screen (a long week range is wider than the row at large fonts).
  monthLabel: {
    flexShrink: 1,
    textAlign: 'center',
    fontWeight: '700',
    fontSize: 15,
  },
  customRow: {
    flexDirection: 'row',
    gap: 12,
  },
  customField: {
    flex: 1,
    gap: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
  currencyNote: {
    fontSize: 12,
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: 17,
    marginBottom: 12,
  },
  donut: {
    marginTop: 4,
  },
  highlight: {
    borderRadius: 20,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  highlightText: {
    fontSize: 16,
    fontWeight: '700',
  },
  emptyState: {
    fontSize: 14,
  },
});
