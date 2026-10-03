import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import AppHeader from '../components/AppHeader';
import { colors, radius, spacing, typography } from '../constants/theme';
import { useFinanceStore } from '../store/finance';
import { calculateBuilderStreak } from '../utils/currency';

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
        <View style={styles.card}>
          <View style={styles.statHeader}>
            <Ionicons name="flash" size={22} color={colors.orange} />
            <Text style={styles.statTitle}>Your Momentum</Text>
          </View>
          <Text style={styles.streakNumber}>{longestStreak}</Text>
          <Text style={styles.streakLabel}>day streak</Text>
          <Text style={styles.streakSupport}>
            {longestStreak > 0 ? "You're tracking consistently!" : 'Log something today to start your streak.'}
          </Text>
        </View>

        {incomeGrowth !== null && (
          <View style={styles.card}>
            <View style={styles.statHeader}>
            <Ionicons name="arrow-up" size={22} color={colors.olive} />
              <Text style={styles.statTitle}>Income Growth</Text>
            </View>
            <Text style={styles.growthValue}>
              {incomeGrowth >= 0 ? '+' : ''}{incomeGrowth.toFixed(0)}%
            </Text>
            <Text style={styles.growthLabel}>
              since your first tracked month
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <View style={styles.statHeader}>
            <Ionicons name="calendar" size={22} color={colors.navy} />
            <Text style={styles.statTitle}>Monthly History</Text>
          </View>
          {monthlySnapshots.length === 0 ? (
            <Text style={styles.emptyState}>
              Come back after your first full month of tracking — your growth chart will appear here.
            </Text>
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
                    <Text style={styles.snapshotMonth}>{snapshot.month}</Text>
                    <View style={styles.snapshotMetrics}>
                      <View style={styles.metricItem}>
                        <Text style={styles.metricLabel}>In</Text>
                        <Text style={[styles.metricValue, { color: colors.statusIncome }]}>
                          {snapshot.currency} {snapshot.income.toFixed(0)}
                        </Text>
                      </View>
                      <View style={styles.metricItem}>
                        <Text style={styles.metricLabel}>Out</Text>
                        <Text style={[styles.metricValue, { color: colors.statusExpense }]}>
                          {snapshot.currency} {snapshot.expenses.toFixed(0)}
                        </Text>
                      </View>
                      <View style={styles.metricItem}>
                        <Text style={styles.metricLabel}>Saved</Text>
                        <Text style={[styles.metricValue, { color: colors.olive }]}>
                          {snapshot.currency} {snapshot.savings.toFixed(0)}
                        </Text>
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
            <Text style={styles.statTitle}>Milestones</Text>
          </View>
          {milestones.length === 0 ? (
            <Text style={styles.emptyState}>
              No milestones yet — complete a goal or build a long streak to earn your first one.
            </Text>
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
                    <Text style={styles.milestoneTitle}>{milestone.title}</Text>
                    <Text style={styles.milestoneDescription}>{milestone.description}</Text>
                    <Text style={styles.milestoneDate}>{milestone.date}</Text>
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
