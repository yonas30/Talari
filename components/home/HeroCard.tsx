import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../theme/ThemeProvider';
import { formatETB, HIDDEN_AMOUNT } from '../../utils/format';
import { goalsLineText, shouldShowGoalsLine } from '../../utils/homeModel';
import AppText from '../AppText';
import Card from '../Card';

interface HeroCardProps {
  total: number;
  available: number;
  saved: number;
  /** Money held in goals (already part of the total). */
  goalsAmount: number;
  hidden: boolean;
  onToggleHidden: () => void;
}

// The navy Total Balance card: the total, then Available and Saved side by side. Goals are not a column here; when they hold money a
// small line says how much of the total they account for. Hidden balances mask every amount, that line included.
export default function HeroCard({ total, available, saved, goalsAmount, hidden, onToggleHidden }: HeroCardProps) {
  const { colors } = useTheme();
  const mask = (value: number) => (hidden ? HIDDEN_AMOUNT : formatETB(value));

  return (
    <Card variant="hero" style={styles.card}>
      <View style={styles.header}>
        <AppText style={[styles.label, { color: colors.heroTextMuted }]}>Total balance</AppText>
        <Pressable
          onPress={onToggleHidden}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={hidden ? 'Show balances' : 'Hide balances'}
        >
          <Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={22} color={colors.heroText} />
        </Pressable>
      </View>

      <AppText
        variant="number"
        style={[styles.total, { color: colors.heroText }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {mask(total)}
      </AppText>

      <View style={[styles.divider, { backgroundColor: colors.heroDivider }]} />

      <View style={styles.columns}>
        <View style={styles.column}>
          <AppText style={[styles.columnLabel, { color: colors.heroTextMuted }]}>Available</AppText>
          <AppText
            variant="number"
            style={[styles.columnValue, { color: colors.heroText }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {mask(available)}
          </AppText>
        </View>
        <View style={styles.column}>
          <AppText style={[styles.columnLabel, { color: colors.heroTextMuted }]}>Saved</AppText>
          <AppText
            variant="number"
            style={[styles.columnValue, { color: colors.heroText }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {mask(saved)}
          </AppText>
        </View>
      </View>

      {shouldShowGoalsLine(goalsAmount, hidden) ? (
        <AppText style={[styles.goalsLine, { color: colors.heroTextMuted }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
          {goalsLineText(goalsAmount)}
        </AppText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 15,
    fontWeight: '500',
    flexShrink: 1,
  },
  total: {
    fontSize: 40,
    lineHeight: 50,
    fontWeight: '700',
    marginTop: 6,
  },
  divider: {
    height: 1,
    marginTop: 14,
    marginBottom: 16,
  },
  columns: {
    flexDirection: 'row',
    gap: 12,
  },
  column: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  columnLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  columnValue: {
    fontSize: 20,
    fontWeight: '600',
    marginTop: 4,
    alignSelf: 'stretch',
    textAlign: 'center',
  },
  goalsLine: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 14,
  },
});
