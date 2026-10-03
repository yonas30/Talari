import { StyleSheet, Text, View } from 'react-native';

export interface BarDatum {
  label: string;
  amount: number;
  color: string;
}

interface HorizontalBarChartProps {
  data: BarDatum[];
}

export default function HorizontalBarChart({ data }: HorizontalBarChartProps) {
  const total = data.reduce((sum, item) => sum + item.amount, 0);
  const maxAmount = Math.max(...data.map((item) => item.amount), 1);

  return (
    <View style={styles.container}>
      {data.map((item) => {
        const percent = total > 0 ? Math.round((item.amount / total) * 100) : 0;
        return (
          <View key={item.label} style={styles.row}>
            <Text style={styles.label} numberOfLines={1}>
              {item.label}
            </Text>
            <View style={styles.trackWrap}>
              <View style={styles.track}>
                <View
                  style={[
                    styles.fill,
                    { width: `${(item.amount / maxAmount) * 100}%`, backgroundColor: item.color },
                  ]}
                />
              </View>
            </View>
            <Text style={styles.percent}>{percent}%</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  label: {
    width: 90,
    fontSize: 12,
    color: '#172033',
    fontWeight: '600',
  },
  trackWrap: {
    flex: 1,
  },
  track: {
    height: 10,
    borderRadius: 999,
    backgroundColor: '#F0F0EA',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
  },
  percent: {
    width: 36,
    fontSize: 12,
    color: '#66708B',
    textAlign: 'right',
    fontWeight: '700',
  },
});
