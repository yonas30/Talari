import { useState } from 'react';
import { LayoutChangeEvent, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

import { OTHERS_COLOR } from '../theme/chartPalette';
import { useTheme } from '../theme/ThemeProvider';
import { formatETB, formatNumber } from '../utils/format';
import {
  DONUT_SLICE_GAP,
  DONUT_STROKE_SHARE,
  donutSizeFor,
  showAmountColumn,
  SpendingSlice,
  spendingAccessibilityLabel,
} from '../utils/homeModel';
import { CONTROL_LABEL_MAX_SCALE } from '../utils/layout';
import AppText from './AppText';

interface SpendingDonutProps {
  slices: SpendingSlice[];
  total: number;
  /** Balances are hidden: nothing here is masked (spending is not a balance), but the spoken summary leaves amounts out. */
  hidden: boolean;
  /** A fixed diameter (Insights). Without it the ring is sized from the card width by Home's rule. */
  size?: number;
  /**
   * Where a legend row's amount goes. 'column': at the right of the row, only when the legend is wide enough (Home). 'below': on a
   * second line under the name, always (Insights, whose legend is narrow beside the large ring).
   */
  amountPlacement?: 'column' | 'below';
  style?: StyleProp<ViewStyle>;
}

// THE spending donut, shared by Home and Insights: the same palette (the colour each slice carries, "Others" grey), stroke ratio,
// 2 px slice gaps, centre total and "Name · 39%" legend rows. Only the size and where the amounts go differ.
export default function SpendingDonut({ slices, total, hidden, size, amountPlacement = 'column', style }: SpendingDonutProps) {
  const { colors } = useTheme();
  const [innerWidth, setInnerWidth] = useState(0);
  const [legendWidth, setLegendWidth] = useState(0);

  const donutSize = size ?? donutSizeFor(innerWidth);
  const showAmounts = showAmountColumn(legendWidth);
  const colored = slices.map((slice) => ({ ...slice, color: slice.isOthers ? OTHERS_COLOR : (slice.color ?? OTHERS_COLOR) }));

  return (
    <View style={[styles.body, style]} onLayout={(event: LayoutChangeEvent) => setInnerWidth(event.nativeEvent.layout.width)}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={spendingAccessibilityLabel(slices, total, hidden)}
        style={{ width: donutSize, height: donutSize }}
      >
        <Ring size={donutSize} slices={colored} />
        <View style={styles.center} pointerEvents="none">
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
            ETB total
          </AppText>
        </View>
      </View>

      <View style={styles.legend} onLayout={(event) => setLegendWidth(event.nativeEvent.layout.width)}>
        {colored.map((slice) => (
          <View
            key={slice.key}
            style={styles.legendRow}
            accessible
            accessibilityLabel={`${slice.label}, ${slice.percent} percent, ${formatETB(slice.amount)}`}
          >
            <View style={[styles.dot, { backgroundColor: slice.color }, amountPlacement === 'below' && styles.dotTop]} />
            {amountPlacement === 'below' ? (
              <View style={styles.legendStack}>
                <AppText
                  style={[styles.legendName, styles.legendNameStacked, { color: colors.text }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  maxFontSizeMultiplier={CONTROL_LABEL_MAX_SCALE}
                >
                  {slice.label} · {slice.percent}%
                </AppText>
                <AppText variant="number" style={[styles.legendAmountBelow, { color: colors.textMuted }]} numberOfLines={1}>
                  {formatETB(slice.amount)}
                </AppText>
              </View>
            ) : (
              <>
                <AppText
                  style={[styles.legendName, { color: colors.text }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  maxFontSizeMultiplier={CONTROL_LABEL_MAX_SCALE}
                >
                  {slice.label} · {slice.percent}%
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
              </>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

function Ring({ size, slices }: { size: number; slices: (SpendingSlice & { color: string })[] }) {
  const strokeWidth = Math.round(size * DONUT_STROKE_SHARE);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const total = slices.reduce((sum, slice) => sum + slice.amount, 0);
  // A gap in the card's surface colour separates neighbouring slices (the gaps are simply not painted). One slice is a full ring.
  const gap = slices.length > 1 ? DONUT_SLICE_GAP : 0;
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
  body: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
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
  dotTop: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  legendStack: {
    flex: 1,
    minWidth: 0,
  },
  legendName: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '500',
  },
  legendNameStacked: {
    flex: 0,
  },
  legendAmountBelow: {
    fontSize: 12,
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
