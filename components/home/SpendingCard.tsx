import { useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

import { assignSliceColors, OTHERS_COLOR } from '../../theme/chartPalette';
import { useTheme } from '../../theme/ThemeProvider';
import { formatETB, formatNumber } from '../../utils/format';
import { SpendingSlice, spendingAccessibilityLabel } from '../../utils/homeModel';
import { CONTROL_LABEL_MAX_SCALE } from '../../utils/layout';
import AppText from '../AppText';
import Card from '../Card';

interface SpendingCardProps {
  slices: SpendingSlice[];
  total: number;
  /** Category id by category name, so a category keeps the same colour on every screen. Unknown names fall back to the name itself. */
  categoryIds: Record<string, string>;
  /** Balances are hidden: nothing here is masked today (spending is not a balance), but the spoken summary leaves amounts out. */
  hidden: boolean;
  onSeeDetails: () => void;
}

// The ring takes about a third of the card and never less than MIN_DONUT, so the legend keeps room for names.
const DONUT_SHARE = 0.33;
const MIN_DONUT = 96;
const MAX_DONUT = 168;
// Dot 10 + name 70 + percent 34 + amount 56 + three 8 dp gaps: below this legend width the amount column is dropped, so names
// are never truncated to make room for it.
const AMOUNT_COLUMN_MIN_LEGEND_WIDTH = 194;

export default function SpendingCard({ slices, total, categoryIds, hidden, onSeeDetails }: SpendingCardProps) {
  const { colors, scheme } = useTheme();
  const [innerWidth, setInnerWidth] = useState(0);
  const [legendWidth, setLegendWidth] = useState(0);

  const donutSize = innerWidth > 0 ? Math.max(MIN_DONUT, Math.min(MAX_DONUT, Math.round(innerWidth * DONUT_SHARE))) : MIN_DONUT;
  const showAmounts = legendWidth === 0 || legendWidth >= AMOUNT_COLUMN_MIN_LEGEND_WIDTH;
  // Real categories get their colours together (so neighbours differ); "Others" is always the neutral grey.
  const categorySlices = slices.filter((slice) => !slice.isOthers);
  const sliceColors = assignSliceColors(categorySlices.map((slice) => categoryIds[slice.label] ?? slice.label), scheme);
  const colored = slices.map((slice) => ({
    ...slice,
    color: slice.isOthers ? OTHERS_COLOR : (sliceColors[categorySlices.indexOf(slice)] ?? OTHERS_COLOR),
  }));

  if (slices.length === 0) {
    // No spending: no ring, no legend, no placeholder circle - just the title row and a centred message.
    return (
      <Card>
        <View style={styles.header}>
          <AppText variant="title" style={styles.title} accessibilityRole="header" numberOfLines={1}>
            Spending this month
          </AppText>
        </View>
        <View
          style={styles.empty}
          accessible
          accessibilityLabel={`${spendingAccessibilityLabel([], 0, hidden)} Your spending will appear here.`}
        >
          <AppText style={[styles.emptyTitle, { color: colors.text }]}>No spending yet this month</AppText>
          <AppText style={[styles.emptyHint, { color: colors.textMuted }]}>Your spending will appear here.</AppText>
        </View>
      </Card>
    );
  }

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

      <View
        style={styles.body}
        onLayout={(event: LayoutChangeEvent) => setInnerWidth(event.nativeEvent.layout.width)}
      >
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={spendingAccessibilityLabel(slices, total, hidden)}
          style={{ width: donutSize, height: donutSize }}
        >
          <Ring size={donutSize} slices={colored} />
          <View style={styles.center} pointerEvents="none">
            <>
                <AppText
                  variant="number"
                  style={[styles.centerValue, { color: colors.text }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                >
                  {formatNumber(total, 0)}
                </AppText>
                <AppText style={[styles.centerLabel, { color: colors.textMuted }]} maxFontSizeMultiplier={CONTROL_LABEL_MAX_SCALE}>
                  Total
                </AppText>
            </>
          </View>
        </View>

        <View style={styles.legend} onLayout={(event) => setLegendWidth(event.nativeEvent.layout.width)}>
            {colored.map((slice) => (
              <View key={slice.key} style={styles.legendRow} accessible accessibilityLabel={`${slice.label}, ${slice.percent} percent, ${formatETB(slice.amount)}`}>
                <View style={[styles.dot, { backgroundColor: slice.color }]} />
                <AppText style={[styles.legendName, { color: colors.text }]} numberOfLines={1}>
                  {slice.label}
                </AppText>
                <AppText variant="number" style={[styles.legendPercent, { color: colors.textMuted }]} numberOfLines={1}>
                  {slice.percent}%
                </AppText>
                {showAmounts ? (
                  <AppText
                    variant="number"
                    style={[styles.legendAmount, { color: colors.text }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.75}
                  >
                    {formatNumber(slice.amount)}
                  </AppText>
                ) : null}
              </View>
            ))}
        </View>
      </View>
    </Card>
  );
}

// A 2 px gap in the card's surface colour separates neighbouring slices (the gaps are simply not painted). One slice is a full ring.
const SLICE_GAP = 2;

function Ring({ size, slices }: { size: number; slices: (SpendingSlice & { color: string })[] }) {
  const strokeWidth = Math.round(size * 0.14);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const total = slices.reduce((sum, slice) => sum + slice.amount, 0);
  const gap = slices.length > 1 ? SLICE_GAP : 0;
  // Where each arc starts along the circle (cumulative length of the slices before it).
  const starts: number[] = [];
  let running = 0;
  for (const slice of slices) {
    starts.push(running);
    running += (slice.amount / total) * circumference;
  }

  return (
    <Svg width={size} height={size}>
      <G rotation={-90} origin={`${center}, ${center}`}>
        {slices.map((slice, index) => {
          const length = (slice.amount / total) * circumference;
          const drawn = Math.max(length - gap, 0.5);
          return (
            <Circle
              key={slice.key}
              cx={center}
              cy={center}
              r={radius}
              stroke={slice.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${drawn} ${circumference - drawn}`}
              strokeDashoffset={-(starts[index] + gap / 2)}
              fill="none"
            />
          );
        })}
      </G>
    </Svg>
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
  body: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 16,
  },
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  centerValue: {
    fontSize: 18,
    fontWeight: '700',
    alignSelf: 'stretch',
    textAlign: 'center',
  },
  centerLabel: {
    fontSize: 12,
    marginTop: 1,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 14,
    paddingBottom: 6,
    gap: 2,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: 13,
    textAlign: 'center',
  },
  legend: {
    flex: 1,
    minWidth: 0,
    gap: 10,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendName: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '500',
  },
  legendPercent: {
    fontSize: 13,
    flexShrink: 0,
  },
  legendAmount: {
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
    minWidth: 56,
    textAlign: 'right',
    maxWidth: 96,
  },
});
