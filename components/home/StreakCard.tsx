import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../theme/ThemeProvider';
import AppText from '../AppText';

interface StreakCardProps {
  days: number;
  /** Where tapping goes. With no handler the card is plain and the chevron (which promises a destination) is left out. */
  onPress?: () => void;
}

// Compact streak card, the warm accent of the screen. Light: a rich peach with an orange edge, navy text and a solid orange disc
// behind a navy flame. Dark: the plain surface with its border and an orange flame.
export default function StreakCard({ days, onPress }: StreakCardProps) {
  const { colors } = useTheme();
  const subtitle = days > 0 ? "You're doing great!" : 'Record something today to start your streak.';
  const content = (
    <>
      <View style={[styles.flameDisc, { backgroundColor: colors.streakDisc }]}>
        <Ionicons name="flame" size={24} color={colors.streakAccent} />
      </View>
      <View style={styles.text}>
        <AppText style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {days} day streak
        </AppText>
        <AppText style={[styles.subtitle, { color: colors.streakMuted }]} numberOfLines={2}>
          {subtitle}
        </AppText>
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={20} color={colors.streakMuted} /> : null}
    </>
  );
  const frame = { backgroundColor: colors.streakFill, borderColor: colors.streakBorder };

  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${days} day streak. ${subtitle} Opens your journey.`}
      style={({ pressed }) => [styles.card, frame, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={[styles.card, frame]} accessible accessibilityLabel={`${days} day streak. ${subtitle}`}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 68,
    borderRadius: 20,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pressed: {
    opacity: 0.8,
  },
  flameDisc: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
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
