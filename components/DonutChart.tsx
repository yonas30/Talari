import { StyleSheet, Text, View } from 'react-native';

import { CONTROL_LABEL_MAX_SCALE } from '../utils/layout';
import Svg, { Circle, G } from 'react-native-svg';

export interface DonutSlice {
  label: string;
  amount: number;
  color: string;
}

interface DonutChartProps {
  data: DonutSlice[];
  size?: number;
  strokeWidth?: number;
  centerLabel?: string;
  centerValue?: string;
}

export default function DonutChart({ data, size = 160, strokeWidth = 24, centerLabel, centerValue }: DonutChartProps) {
  const total = data.reduce((sum, slice) => sum + slice.amount, 0);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  let cumulativeOffset = 0;

  return (
    <View style={styles.row}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <G rotation={-90} origin={`${center}, ${center}`}>
            {total === 0 ? (
              <Circle
                cx={center}
                cy={center}
                r={radius}
                stroke="#e2e8f0"
                strokeWidth={strokeWidth}
                fill="none"
              />
            ) : (
              data.map((slice) => {
                const fraction = slice.amount / total;
                const dashLength = fraction * circumference;
                const dashArray = `${dashLength} ${circumference - dashLength}`;
                const strokeDashoffset = -cumulativeOffset;
                cumulativeOffset += dashLength;

                return (
                  <Circle
                    key={slice.label}
                    cx={center}
                    cy={center}
                    r={radius}
                    stroke={slice.color}
                    strokeWidth={strokeWidth}
                    strokeDasharray={dashArray}
                    strokeDashoffset={strokeDashoffset}
                    fill="none"
                  />
                );
              })
            )}
          </G>
        </Svg>
        {(centerLabel || centerValue) && (
          <View style={[styles.centerOverlay, { paddingHorizontal: strokeWidth + 6 }]} pointerEvents="none">
            {centerValue && (
              <Text
                style={styles.centerValue}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
                maxFontSizeMultiplier={CONTROL_LABEL_MAX_SCALE}
              >
                {centerValue}
              </Text>
            )}
            {centerLabel && (
              <Text style={styles.centerLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} maxFontSizeMultiplier={CONTROL_LABEL_MAX_SCALE}>
                {centerLabel}
              </Text>
            )}
          </View>
        )}
      </View>

      <View style={styles.legend}>
        {data.slice(0, 6).map((slice) => (
          <View key={slice.label} style={styles.legendRow}>
            <View style={[styles.dot, { backgroundColor: slice.color }]} />
            <Text style={styles.legendLabel} numberOfLines={1}>
              {slice.label}
              {total > 0 ? ` · ${Math.round((slice.amount / total) * 100)}%` : ''}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  centerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerValue: {
    fontWeight: '800',
    fontSize: 15,
    color: '#172033',
  },
  centerLabel: {
    fontSize: 10,
    color: '#667085',
    marginTop: 2,
  },
  legend: {
    flex: 1,
    gap: 8,
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
  legendLabel: {
    color: '#334155',
    fontSize: 12,
    flexShrink: 1,
  },
});
