import { StyleSheet, View } from 'react-native';

import { radius, spacing } from '../constants/theme';
import { useProfileStore } from '../store/profile';
import { useTheme } from '../theme/ThemeProvider';
import AppText from './AppText';
import Button from './Button';

// Development-only tools for walking through the Welcome flow and the one-time name sheet without deleting any
// transactions. Rendered by Settings only when __DEV__ is true. Nothing here touches the ledger.
export default function DevOnboardingRow() {
  const { colors } = useTheme();
  const profile = useProfileStore((state) => state.profile);
  const showWelcomeAgain = useProfileStore((state) => state.devShowWelcomeAgain);
  const resetToExistingUser = useProfileStore((state) => state.devResetToExistingUser);
  const ageNotNow = useProfileStore((state) => state.devAgeNotNowByDays);

  const skippedAt = profile.prompt.skippedAt ? new Date(profile.prompt.skippedAt).toLocaleString() : 'n/a';

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <AppText style={[styles.title, { color: colors.text }]}>Dev: name and onboarding</AppText>
      <AppText style={[styles.subtitle, { color: colors.textMuted }]}>
        welcome={profile.welcome} | name={profile.name ?? 'none'} | prompt={profile.prompt.status} | first Not now={skippedAt}
      </AppText>
      <Button title="Show Welcome again (clears name)" variant="secondary" onPress={showWelcomeAgain} />
      <Button title="Reset: existing-data name sheet" variant="secondary" onPress={resetToExistingUser} />
      <Button title="Move first Not now back 7 days" variant="secondary" onPress={() => ageNotNow(7)} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
    marginBottom: spacing.xs,
  },
});
