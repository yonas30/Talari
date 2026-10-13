import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../theme/ThemeProvider';
import { formatNumber } from '../../utils/format';
import { formatNet } from '../../utils/homeModel';
import AppText from '../AppText';
import Card from '../Card';

interface MonthCardProps {
  /** Heading text. Insights passes none: its period control above says what the numbers cover. */
  heading?: string;
  monthName?: string;
  income: number;
  expenses: number;
  net: number;
}

// "This Month": Income | Expenses side by side, then Net centred underneath. Compact on purpose (about 120 dp, clearly shorter
// than the hero card): a 32 dp icon disc beside the label and amount. Net is always the blue Net colour - the explicit sign
// (+ / −) says whether it is good or bad, never the colour. Income and expenses are small text, so they use the text-safe
// tones; Net is 20 sp bold (large text), so Light may use the vivid brand blue.
export default function MonthCard({ heading, monthName, income, expenses, net }: MonthCardProps) {
  const title = heading ?? (monthName !== undefined ? `This Month · ${monthName}` : undefined);
  const { colors } = useTheme();

  return (
    <View style={styles.wrap}>
      {title !== undefined && (
        <AppText variant="title" style={styles.heading} accessibilityRole="header">
          {title}
        </AppText>
      )}
      <Card style={styles.card}>
        <View style={styles.topRow}>
          <Metric icon="trending-up" label="Income" value={formatNumber(income)} color={colors.income} disc={colors.incomeDisc} glyph={colors.incomeGlyph} />
          <View style={[styles.verticalDivider, { backgroundColor: colors.border }]} />
          <Metric icon="trending-down" label="Expenses" value={formatNumber(expenses)} color={colors.expense} disc={colors.expenseDisc} glyph={colors.expenseGlyph} />
        </View>

        <View style={[styles.horizontalDivider, { backgroundColor: colors.border }]} />

        <View style={styles.netBlock}>
          <View style={[styles.disc, { backgroundColor: colors.netDisc }]}>
            <Ionicons name="bar-chart" size={17} color={colors.netGlyph} />
          </View>
          <View style={styles.netText}>
            <AppText style={[styles.label, { color: colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              Net (Income − Expenses)
            </AppText>
            <AppText
              variant="number"
              style={[styles.netValue, { color: colors.netLarge }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.5}
            >
              {formatNet(net)}
            </AppText>
          </View>
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
  disc,
  glyph,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  color: string;
  disc: string;
  glyph: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.metric}>
      <View style={[styles.disc, { backgroundColor: disc }]}>
        <Ionicons name={icon} size={17} color={glyph} />
      </View>
      <View style={styles.metricText}>
        <AppText style={[styles.label, { color: colors.textMuted }]} numberOfLines={1}>
          {label}
        </AppText>
        <AppText
          variant="number"
          style={[styles.value, { color }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.5}
        >
          {value}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  heading: {
    fontSize: 17,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  metricText: {
    flex: 1,
    minWidth: 0,
  },
  verticalDivider: {
    width: 1,
    marginVertical: 10,
  },
  horizontalDivider: {
    height: 1,
  },
  netBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  netText: {
    flexShrink: 1,
    minWidth: 0,
  },
  disc: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
  },
  value: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
  },
  netValue: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
  },
});
