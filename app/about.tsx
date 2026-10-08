import { ScrollView, StyleSheet, View } from 'react-native';

import AppHeader from '../components/AppHeader';
import { colors, radius, spacing, typography } from '../constants/theme';
import AppText from '../components/AppText';

export default function AboutScreen() {
  return (
    <View style={styles.screen}>
      <AppHeader title="About" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <AppText style={styles.title}>Talari</AppText>
          <AppText style={styles.version}>Version 1.0.0</AppText>
          <AppText style={styles.body}>
            This is not a generic budgeting app. It's a personal tool built as part of a "LIFE 2.0" journey —
            helping its one user make better financial decisions while staying connected to why they're building
            their life.
          </AppText>
          <AppText style={styles.body}>
            Built with React Native, Expo, SQLite, and Zustand. All your data stays on your device.
          </AppText>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flexGrow: 1,
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  title: {
    ...typography.pageTitle,
    fontSize: 24,
    color: colors.navy,
  },
  version: {
    ...typography.helper,
    color: colors.textSecondary,
  },
  body: {
    ...typography.body,
    color: colors.navy,
    lineHeight: 22,
  },
});
