import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import { useThemeColors } from '../theme/ThemeProvider';
import { brandFills } from '../theme/tokens';
import AppText from './AppText';

export interface TrendLinePoint {
  label: string;
  income: number;
  expense: number;
}

interface TrendLineChartProps {
  data: TrendLinePoint[];
  width?: number;
  height?: number;
}

function buildPath(values: number[], width: number, height: number, max: number): string {
  if (values.length === 0) {
    return '';
  }

  const stepX = values.length > 1 ? width / (values.length - 1) : 0;

  return values
    .map((value, index) => {
      const x = index * stepX;
      const y = max > 0 ? height - (value / max) * height : height;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

// Income and expense over the period. The lines and points are the vivid brand fills (income green, expense red); the baseline,
// axis labels and legend come from the theme tokens, so the chart is readable in Light and Dark.
export default function TrendLineChart({ data, width: widthProp, height = 140 }: TrendLineChartProps) {
  const colors = useThemeColors();
  // Fit the card it is placed in; 300 is only the first-paint fallback.
  const [measuredWidth, setMeasuredWidth] = useState(300);
  const width = widthProp ?? measuredWidth;
  const paddingBottom = 20;
  const chartHeight = height - paddingBottom;
  const maxValue = Math.max(1, ...data.map((point) => Math.max(point.income, point.expense)));

  const incomePath = buildPath(
    data.map((point) => point.income),
    width,
    chartHeight,
    maxValue,
  );
  const expensePath = buildPath(
    data.map((point) => point.expense),
    width,
    chartHeight,
    maxValue,
  );

  const stepX = data.length > 1 ? width / (data.length - 1) : 0;
  // A single point (e.g. a one-day custom period) is centred rather than pinned to the left edge.
  const xAt = (index: number) => (data.length > 1 ? index * stepX : width / 2);

  return (
    <View onLayout={(event) => setMeasuredWidth(Math.max(120, Math.floor(event.nativeEvent.layout.width)))}>
      <Svg width={width} height={height}>
        <Line x1={0} y1={chartHeight} x2={width} y2={chartHeight} stroke={colors.border} strokeWidth={1} />
        {incomePath !== '' && <Path d={incomePath} stroke={brandFills.income} strokeWidth={2} fill="none" />}
        {expensePath !== '' && <Path d={expensePath} stroke={brandFills.expense} strokeWidth={2} fill="none" />}
        {data.map((point, index) => (
          <Circle
            key={`${point.label}-income`}
            cx={xAt(index)}
            cy={chartHeight - (point.income / maxValue) * chartHeight}
            r={3}
            fill={brandFills.income}
          />
        ))}
        {data.map((point, index) => (
          <Circle
            key={`${point.label}-expense`}
            cx={xAt(index)}
            cy={chartHeight - (point.expense / maxValue) * chartHeight}
            r={3}
            fill={brandFills.expense}
          />
        ))}
        {data.map((point, index) => {
          if (data.length > 8 && index % Math.ceil(data.length / 6) !== 0) {
            return null;
          }
          return (
            <SvgText key={`${point.label}-label`} x={xAt(index)} y={height - 4} fontSize={10} fill={colors.textMuted} textAnchor="middle">
              {point.label}
            </SvgText>
          );
        })}
      </Svg>

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: brandFills.income }]} />
          <AppText style={[styles.legendText, { color: colors.textMuted }]}>Income</AppText>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: brandFills.expense }]} />
          <AppText style={[styles.legendText, { color: colors.textMuted }]}>Expense</AppText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 12,
  },
});
