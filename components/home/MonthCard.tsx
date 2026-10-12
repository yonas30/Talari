import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../theme/ThemeProvider';
import { formatNumber } from '../../utils/format';
import { formatNet } from '../../utils/homeModel';
import AppText from '../AppText';
import Card from '../Card';

interface MonthCardProps {
  monthName: string;
  income: number;
  expenses: number;
  net: number;
}

// "This Month": Income | Expenses side by side, then Net centred underneath. Net is always the blue Net colour - the explicit
// sign (+ / −) is what says whether it is good or bad, never the colour.
export default function MonthCard({ monthName, income, expenses, net }: MonthCardProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.wrap}>
      <AppText variant="title" style={styles.heading} accessibilityRole="header">
        This Month · {monthName}
      </AppText>
      <Card style={styles.card}>
        <View style={styles.topRow}>
          <Metric icon="trending-up" label="Income" value={formatNumber(income)} color={colors.income} tint={colors.incomeTint} />
          <View style={[styles.verticalDivider, { backgroundColor: colors.border }]} />
          <Metric icon="trending-down" label="Expenses" value={formatNumber(expenses)} color={colors.expense} tint={colors.expenseTint} />
        </View>

        <View style={[styles.horizontalDivider, { backgroundColor: colors.border }]} />

        <View style={styles.netBlock}>
          <View style={[styles.disc, { backgroundColor: colors.netTint }]}>
            <Ionicons name="bar-chart" size={18} color={colors.net} />
          </View>
          <AppText style={[styles.label, { color: colors.textMuted }]}>Net (Income − Expenses)</AppText>
          <AppText
            variant="number"
            style={[styles.netValue, { color: colors.net }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {formatNet(net)}
          </AppText>
        </View>
      </Card>
    </View>
  );
}

function Metric({
  icon,
  label,
  value,
  color,
  tint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  color: string;
  tint: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.metric}>
      <View style={[styles.disc, { backgroundColor: tint }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <AppText style={[styles.label, { color: colors.textMuted }]}>{label}</AppText>
      <AppText
        variant="number"
        style={[styles.value, { color }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 10,
  },
  heading: {
    fontSize: 18,
  },
  card: {
    padding: 0,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  metric: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    gap: 4,
  },
  verticalDivider: {
    width: 1,
    marginVertical: 14,
  },
  horizontalDivider: {
    height: 1,
  },
  netBlock: {
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    gap: 4,
  },
  disc: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  value: {
    fontSize: 20,
    fontWeight: '700',
    alignSelf: 'stretch',
    textAlign: 'center',
  },
  netValue: {
    fontSize: 24,
    fontWeight: '700',
    alignSelf: 'stretch',
    textAlign: 'center',
  },
});
