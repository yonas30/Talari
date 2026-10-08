import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import AppHeader from '../components/AppHeader';
import { colors, radius, spacing, typography } from '../constants/theme';
import { useFinanceStore } from '../store/finance';
import { calculateBuilderStreak } from '../utils/currency';
import { formatDateKey, formatNumber } from '../utils/format';
import AppText from '../components/AppText';

// 'YYYY-MM' -> 'September 2026'
function formatMonthKey(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export default function JourneyScreen() {
  const { milestones, monthlySnapshots, transactions } = useFinanceStore();

  const longestStreak = useMemo(() => calculateBuilderStreak(transactions), [transactions]);

  const incomeGrowth = useMemo(() => {
    if (monthlySnapshots.length < 2) {
      return null;
    }
    const first = monthlySnapshots[0];
    const latest = monthlySnapshots[monthlySnapshots.length - 1];
    if (first.income <= 0) {
      return null;
    }
    return ((latest.income - first.income) / first.income) * 100;
  }, [monthlySnapshots]);

  return (
    <View style={styles.screen}>
      <AppHeader title="Your Journey" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={[styles.card, styles.heroCard]}>
          <View style={styles.statHeader}>
            <Ionicons name="flash" size={22} color={colors.orange} />
            <AppText style={styles.statTitle}>Your Momentum</AppText>
          </View>
          <AppText style={styles.streakNumber}>{longestStreak}</AppText>
          <AppText style={styles.streakLabel}>day streak</AppText>
          <AppText style={styles.streakSupport}>
            {longestStreak > 0 ? "You're tracking consistently!" : 'Record something today to start your streak.'}
          </AppText>
        </View>

        {incomeGrowth !== null && (
          <View style={styles.card}>
            <View style={styles.statHeader}>
            <Ionicons name="arrow-up" size={22} color={colors.olive} />
              <AppText style={styles.statTitle}>Income Growth</AppText>
            </View>
            <AppText style={styles.growthValue}>
              {incomeGrowth >= 0 ? '+' : ''}{incomeGrowth.toFixed(0)}%
            </AppText>
            <AppText style={styles.growthLabel}>
              since your first tracked month
            </AppText>
          </View>
        )}

        <View style={styles.card}>
          <View style={styles.statHeader}>
            <Ionicons name="calendar" size={22} color={colors.navy} />
            <AppText style={styles.statTitle}>Monthly History</AppText>
          </View>
          {monthlySnapshots.length === 0 ? (
            <AppText style={styles.emptyState}>
              Come back after your first full month of tracking — your growth chart will appear here.
            </AppText>
          ) : (
            <View style={styles.snapshotList}>
              {monthlySnapshots
                .slice()
                .reverse()
                .map((snapshot, index) => (
                  <View
                    key={snapshot.id}
                    style={[
                      styles.snapshotRow,
                      index === monthlySnapshots.length - 1 && styles.snapshotRowLast,
                    ]}
                  >
                    <AppText style={styles.snapshotMonth}>{formatMonthKey(snapshot.month)}</AppText>
                    <View style={styles.snapshotMetrics}>
                      <View style={styles.metricItem}>
                        <AppText style={styles.metricLabel}>In</AppText>
                        <AppText style={[styles.metricValue, { color: colors.statusIncome }]}>
                          {snapshot.currency} {formatNumber(snapshot.income, 0)}
                        </AppText>
                      </View>
                      <View style={styles.metricItem}>
                        <AppText style={styles.metricLabel}>Out</AppText>
                        <AppText style={[styles.metricValue, { color: colors.statusExpense }]}>
                          {snapshot.currency} {formatNumber(snapshot.expenses, 0)}
                        </AppText>
                      </View>
                      <View style={styles.metricItem}>
                        <AppText style={styles.metricLabel}>Set aside</AppText>
                        <AppText style={[styles.metricValue, { color: colors.olive }]}>
                          {snapshot.currency} {formatNumber(snapshot.savings, 0)}
                        </AppText>
                      </View>
                    </View>
                  </View>
                ))}
            </View>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.statHeader}>
            <Ionicons name="star" size={22} color={colors.orange} />
            <AppText style={styles.statTitle}>Milestones</AppText>
          </View>
          {milestones.length === 0 ? (
            <AppText style={styles.emptyState}>
              No milestones yet — complete a goal or build a long streak to earn your first one.
            </AppText>
          ) : (
            <View style={styles.milestoneList}>
              {milestones.map((milestone, index) => (
                <View
                  key={milestone.id}
                  style={[
                    styles.milestoneRow,
                    index === milestones.length - 1 && styles.milestoneRowLast,
                  ]}
                >
                  <View style={styles.milestoneBullet} />
                  <View style={styles.milestoneContent}>
                    <AppText style={styles.milestoneTitle}>{milestone.title}</AppText>
                    <AppText style={styles.milestoneDescription}>{milestone.description}</AppText>
                    <AppText style={styles.milestoneDate}>{formatDateKey(milestone.date)}</AppText>
                  </View>
                </View>
              ))}
            </View>
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
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  heroCard: {
    backgroundColor: colors.orangeLight,
  },
  statHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  statTitle: {
    ...typography.sectionTitle,
    color: colors.navy,
  },
  streakNumber: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.orange,
  },
  streakLabel: {
    ...typography.helper,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  streakSupport: {
    ...typography.helper,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  growthValue: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.olive,
  },
  growthLabel: {
    ...typography.helper,
    color: colors.textSecondary,
  },
  emptyState: {
    ...typography.helper,
    color: colors.textSecondary,
  },
  snapshotList: {
    gap: spacing.md,
  },
  snapshotRow: {
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.background,
    gap: spacing.sm,
  },
  snapshotRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  snapshotMonth: {
    fontWeight: '700',
    color: colors.navy,
    fontSize: 15,
  },
  snapshotMetrics: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  metricItem: {
    flex: 1,
    gap: 2,
  },
  metricLabel: {
    ...typography.helper,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  metricValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  milestoneList: {
    gap: spacing.md,
  },
  milestoneRow: {
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.background,
    flexDirection: 'row',
    gap: spacing.md,
  },
  milestoneRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  milestoneBullet: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.orange,
    marginTop: spacing.md,
  },
  milestoneContent: {
    flex: 1,
    gap: 4,
  },
  milestoneTitle: {
    fontWeight: '700',
    color: colors.navy,
    fontSize: 14,
  },
  milestoneDescription: {
    ...typography.helper,
    color: colors.textSecondary,
  },
  milestoneDate: {
    ...typography.helper,
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: spacing.xs,
  },
});
