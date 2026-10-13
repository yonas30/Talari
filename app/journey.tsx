import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import AppHeader from '../components/AppHeader';
import AppText from '../components/AppText';
import Card from '../components/Card';
import { useFinanceStore } from '../store/finance';
import { useTheme } from '../theme/ThemeProvider';
import { calculateBuilderStreak } from '../utils/currency';
import { formatDateKey, formatNumber } from '../utils/format';

// 'YYYY-MM' -> 'September 2026'
function formatMonthKey(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export default function JourneyScreen() {
  const { colors } = useTheme();
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

  const header = (icon: keyof typeof Ionicons.glyphMap, title: string, disc: string, glyph: string) => (
    <View style={styles.statHeader}>
      <View style={[styles.disc, { backgroundColor: disc }]}>
        <Ionicons name={icon} size={18} color={glyph} />
      </View>
      <AppText variant="title" style={styles.statTitle} accessibilityRole="header">
        {title}
      </AppText>
    </View>
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader title="Your Journey" />
      <ScrollView contentContainerStyle={styles.container}>
        {/* The streak, in the same warm style as the streak card on Home. */}
        <View
          style={[styles.hero, { backgroundColor: colors.streakFill, borderColor: colors.streakBorder }]}
          accessible
          accessibilityLabel={`Your momentum: ${longestStreak} day streak`}
        >
          <View style={styles.statHeader}>
            <View style={[styles.disc, { backgroundColor: colors.streakDisc }]}>
              <Ionicons name="flame" size={20} color={colors.streakAccent} />
            </View>
            <AppText variant="title" style={styles.statTitle}>
              Your Momentum
            </AppText>
          </View>
          <AppText variant="number" style={[styles.streakNumber, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
            {longestStreak}
          </AppText>
          <AppText style={[styles.streakLabel, { color: colors.streakMuted }]}>day streak</AppText>
          <AppText style={[styles.streakSupport, { color: colors.streakMuted }]}>
            {longestStreak > 0 ? "You're tracking consistently!" : 'Record something today to start your streak.'}
          </AppText>
        </View>

        {incomeGrowth !== null && (
          <Card style={styles.card}>
            {header('arrow-up', 'Income Growth', colors.incomeDisc, colors.incomeGlyph)}
            <AppText
              variant="number"
              style={[styles.growthValue, { color: incomeGrowth >= 0 ? colors.income : colors.expense }]}
              maxFontSizeMultiplier={1.3}
            >
              {incomeGrowth >= 0 ? '+' : ''}
              {incomeGrowth.toFixed(0)}%
            </AppText>
            <AppText style={[styles.small, { color: colors.textMuted }]}>since your first tracked month</AppText>
          </Card>
        )}

        <Card style={styles.card}>
          {header('calendar', 'Monthly History', colors.accentDisc, colors.primaryText)}
          {monthlySnapshots.length === 0 ? (
            <AppText style={[styles.small, { color: colors.textMuted }]}>
              Come back after your first full month of tracking — your growth chart will appear here.
            </AppText>
          ) : (
            <View style={styles.list}>
              {monthlySnapshots
                .slice()
                .reverse()
                .map((snapshot, index) => (
                  <View
                    key={snapshot.id}
                    style={[
                      styles.snapshotRow,
                      { borderBottomColor: colors.border },
                      index === monthlySnapshots.length - 1 && styles.rowLast,
                    ]}
                  >
                    <AppText style={[styles.snapshotMonth, { color: colors.text }]}>{formatMonthKey(snapshot.month)}</AppText>
                    <View style={styles.snapshotMetrics}>
                      <View style={styles.metricItem}>
                        <AppText style={[styles.metricLabel, { color: colors.textMuted }]}>In</AppText>
                        <AppText
                          variant="number"
                          style={[styles.metricValue, { color: colors.income }]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.6}
                        >
                          {snapshot.currency} {formatNumber(snapshot.income, 0)}
                        </AppText>
                      </View>
                      <View style={styles.metricItem}>
                        <AppText style={[styles.metricLabel, { color: colors.textMuted }]}>Out</AppText>
                        <AppText
                          variant="number"
                          style={[styles.metricValue, { color: colors.expense }]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.6}
                        >
                          {snapshot.currency} {formatNumber(snapshot.expenses, 0)}
                        </AppText>
                      </View>
                      <View style={styles.metricItem}>
                        <AppText style={[styles.metricLabel, { color: colors.textMuted }]}>Set aside</AppText>
                        <AppText
                          variant="number"
                          style={[styles.metricValue, { color: colors.goals }]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                          minimumFontScale={0.6}
                        >
                          {snapshot.currency} {formatNumber(snapshot.savings, 0)}
                        </AppText>
                      </View>
                    </View>
                  </View>
                ))}
            </View>
          )}
        </Card>

        <Card style={styles.card}>
          {header('star', 'Milestones', colors.accentDisc, colors.primaryText)}
          {milestones.length === 0 ? (
            <AppText style={[styles.small, { color: colors.textMuted }]}>
              No milestones yet — complete a goal or build a long streak to earn your first one.
            </AppText>
          ) : (
            <View style={styles.list}>
              {milestones.map((milestone, index) => (
                <View
                  key={milestone.id}
                  style={[
                    styles.milestoneRow,
                    { borderBottomColor: colors.border },
                    index === milestones.length - 1 && styles.rowLast,
                  ]}
                >
                  <View style={[styles.bullet, { backgroundColor: colors.primary }]} />
                  <View style={styles.milestoneContent}>
                    <AppText style={[styles.milestoneTitle, { color: colors.text }]}>{milestone.title}</AppText>
                    <AppText style={[styles.small, { color: colors.textMuted }]}>{milestone.description}</AppText>
                    <AppText style={[styles.date, { color: colors.textMuted }]}>{formatDateKey(milestone.date)}</AppText>
                  </View>
                </View>
              ))}
            </View>
          )}
        </Card>
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
  card: {
    padding: 14,
    gap: 10,
  },
  hero: {
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 14,
    gap: 4,
  },
  statHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  disc: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statTitle: {
    fontSize: 17,
    flex: 1,
  },
  streakNumber: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '800',
    marginTop: 6,
  },
  streakLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  streakSupport: {
    fontSize: 13,
    marginTop: 2,
  },
  growthValue: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
  },
  small: {
    fontSize: 13,
    lineHeight: 18,
  },
  list: {
    gap: 12,
  },
  snapshotRow: {
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  rowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  snapshotMonth: {
    fontWeight: '700',
    fontSize: 15,
  },
  snapshotMetrics: {
    flexDirection: 'row',
    gap: 12,
  },
  metricItem: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  metricValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  milestoneRow: {
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
  },
  bullet: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 7,
  },
  milestoneContent: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  milestoneTitle: {
    fontWeight: '700',
    fontSize: 14,
  },
  date: {
    fontSize: 12,
    marginTop: 2,
  },
});
