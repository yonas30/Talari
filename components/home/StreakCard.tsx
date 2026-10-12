import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../theme/ThemeProvider';
import AppText from '../AppText';

interface StreakCardProps {
  days: number;
  /** Where tapping goes. Today it goes nowhere, so with no handler the chevron (which promises a destination) is left out. */
  onPress?: () => void;
}

// Compact streak card. Light: a soft orange wash. Dark: the plain surface with its border and an orange flame.
export default function StreakCard({ days, onPress }: StreakCardProps) {
  const { colors } = useTheme();
  const subtitle = days > 0 ? "You're doing great!" : 'Record something today to start your streak.';
  const content = (
    <>
      <Ionicons name="flame" size={28} color={colors.streakAccent} />
      <View style={styles.text}>
        <AppText style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {days} day streak
        </AppText>
        <AppText style={[styles.subtitle, { color: colors.textMuted }]} numberOfLines={2}>
          {subtitle}
        </AppText>
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={20} color={colors.textMuted} /> : null}
    </>
  );
  const frame = [styles.card, { backgroundColor: colors.streakFill, borderColor: colors.streakBorder }];

  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${days} day streak`} style={frame}>
      {content}
    </Pressable>
  ) : (
    <View style={frame} accessible accessibilityLabel={`${days} day streak. ${subtitle}`}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 68,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
  },
});
