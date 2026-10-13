import { ScrollView, StyleSheet, View } from 'react-native';

import AppHeader from '../components/AppHeader';
import AppText from '../components/AppText';
import Card from '../components/Card';
import TalariSymbol from '../components/TalariSymbol';
import TalariWordmark from '../components/TalariWordmark';
import { useTheme } from '../theme/ThemeProvider';

export default function AboutScreen() {
  const { colors } = useTheme();

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader title="About" />
      <ScrollView contentContainerStyle={styles.container}>
        <Card style={styles.card}>
          {/* The approved symbol and wordmark (Latin letters only). */}
          <View style={styles.logo} accessible accessibilityRole="image" accessibilityLabel="Talari">
            <TalariSymbol width={56} />
            <TalariWordmark width={132} />
          </View>
          <AppText style={[styles.version, { color: colors.textMuted }]}>Version 1.0.0</AppText>
          <AppText style={[styles.body, { color: colors.text }]}>
            This is not a generic budgeting app. It's a personal tool built as part of a "LIFE 2.0" journey —
            helping its one user make better financial decisions while staying connected to why they're building
            their life.
          </AppText>
          <AppText style={[styles.body, { color: colors.text }]}>
            Built with React Native, Expo, SQLite, and Zustand. All your data stays on your device.
          </AppText>
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  card: {
    padding: 16,
    gap: 12,
  },
  logo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  version: {
    fontSize: 13,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
  },
});
