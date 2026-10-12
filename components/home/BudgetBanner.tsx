import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../theme/ThemeProvider';
import AppText from '../AppText';

interface BudgetBannerProps {
  title: string;
  detail: string;
  onPress: () => void;
}

// The over-budget warning that already sits under the greeting. Same behaviour, now from tokens: the expense colour on its tint.
export default function BudgetBanner({ title, detail, onPress }: BudgetBannerProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Over budget, open budgets"
      style={[styles.banner, { backgroundColor: colors.expenseTint, borderColor: colors.expense }]}
    >
      <Ionicons name="warning" size={20} color={colors.expense} />
      <View style={styles.text}>
        <AppText style={[styles.title, { color: colors.text }]}>{title}</AppText>
        <AppText style={[styles.detail, { color: colors.text }]} numberOfLines={2}>
          {detail}
        </AppText>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.expense} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
  },
  detail: {
    fontSize: 12,
    marginTop: 2,
  },
});
