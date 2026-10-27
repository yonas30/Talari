import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import AppHeader from '../../components/AppHeader';
import AppText from '../../components/AppText';
import TransactionForm from '../../components/TransactionForm';
import { useFinanceStore } from '../../store/finance';
import { useTheme } from '../../theme/ThemeProvider';
import { EntryInput } from '../../utils/accounts/entries';

export default function AddTransactionScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const addTransaction = useFinanceStore((state) => state.addTransaction);

  const onSubmit = async (input: EntryInput) => {
    // Throws an AccountsError if the entry would overdraw an account or has no exchange rate;
    // the form shows the warning and nothing is saved.
    await addTransaction(input);
    router.navigate('/transactions');
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader title="Add transaction" />
      <Pressable
        onPress={() => router.push('/import-sms')}
        accessibilityRole="button"
        accessibilityLabel="Import from SMS"
        hitSlop={8}
        style={({ pressed }) => [styles.importRow, pressed && { opacity: 0.6 }]}
      >
        <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.primaryText} />
        <AppText style={[styles.importText, { color: colors.primaryText }]}>Import from SMS</AppText>
      </Pressable>
      <TransactionForm submitLabel="Save" onSubmit={onSubmit} resetOnSuccess />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  importRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 20,
  },
  importText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
