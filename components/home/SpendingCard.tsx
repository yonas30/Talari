import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '../../theme/ThemeProvider';
import { SpendingSlice } from '../../utils/homeModel';
import { CONTROL_LABEL_MAX_SCALE } from '../../utils/layout';
import AppText from '../AppText';
import Card from '../Card';
import SpendingDonut from '../SpendingDonut';

interface SpendingCardProps {
  slices: SpendingSlice[];
  total: number;
  /** Balances are hidden: nothing here is masked today (spending is not a balance), but the spoken summary leaves amounts out. */
  hidden: boolean;
  onSeeDetails: () => void;
}

// Home's spending card: the title row, then the shared donut at Home's size (a third of the card, 96-168 dp) with the top-3 + Others legend.
export default function SpendingCard({ slices, total, hidden, onSeeDetails }: SpendingCardProps) {
  const { colors } = useTheme();

  return (
    <Card>
      <View style={styles.header}>
        <AppText variant="title" style={styles.title} accessibilityRole="header" numberOfLines={1}>
          Spending this month
        </AppText>
        <Pressable
          onPress={onSeeDetails}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="See spending details"
          style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
        >
          <AppText style={[styles.link, { color: colors.primaryText }]} maxFontSizeMultiplier={CONTROL_LABEL_MAX_SCALE}>
            See details →
          </AppText>
        </Pressable>
      </View>

      {slices.length === 0 ? (
        // No spending: no ring, no legend - the old message under the title row.
        <AppText style={[styles.emptyMessage, { color: colors.textMuted }]}>No expenses logged yet this month.</AppText>
      ) : (
        <SpendingDonut slices={slices} total={total} hidden={hidden} style={styles.donut} />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    fontSize: 17,
    flex: 1,
  },
  link: {
    fontSize: 14,
    fontWeight: '600',
  },
  donut: {
    marginTop: 16,
  },
  emptyMessage: {
    fontSize: 14,
    marginTop: 14,
  },
});
