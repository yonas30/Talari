import { useEffect } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AccountForm from '../components/accounts/AccountForm';
import AppText from '../components/AppText';
import Button from '../components/Button';
import Card from '../components/Card';
import { useFinanceStore } from '../store/finance';
import { useTheme } from '../theme/ThemeProvider';

// "Add your first account". The app opens here whenever there is no account to record money in, so nobody is stranded on an empty
// Home: transactions, goals and recurring rules all need an account, and nothing else can be done until one exists. From here the owner
// can also restore a backup instead (which brings its accounts with it).
export default function FirstAccountScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const hasAccounts = useFinanceStore((state) => state.accounts.some((account) => !account.archived));

  // Once an account exists (just created here, or restored from a backup) the app takes over.
  useEffect(() => {
    if (hasAccounts) {
      router.replace('/');
    }
  }, [hasAccounts, router]);

  return (
    <KeyboardAvoidingView style={[styles.screen, { backgroundColor: colors.bg }]} behavior="padding">
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 28 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.disc, { backgroundColor: colors.accentDisc }]}>
          <Ionicons name="wallet-outline" size={26} color={colors.primaryText} />
        </View>
        <AppText variant="heading" style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          Add your first account
        </AppText>
        <AppText style={[styles.body, { color: colors.textMuted }]}>
          Talari tracks where your money actually is: cash in hand, a wallet like Telebirr, a bank. Start with one; you can add the others any
          time.
        </AppText>

        <Card style={styles.card}>
          <AccountForm submitLabel="Add account" onCreated={() => router.replace('/')} onSetRate={() => router.push('/exchange-rates')} />
        </Card>

        <Button title="Restore from a backup instead" variant="link" onPress={() => router.push('/export-data')} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 20,
    gap: 14,
  },
  disc: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 26,
    lineHeight: 33,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
  },
  card: {
    padding: 16,
  },
});
