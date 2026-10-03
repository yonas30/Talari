import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import TransactionForm from '../components/TransactionForm';
import { colors, spacing, typography } from '../constants/theme';
import { useFinanceStore } from '../store/finance';
import { TransactionInput } from '../types';

export default function AddTransactionScreen() {
  const router = useRouter();
  const addTransaction = useFinanceStore((state) => state.addTransaction);

  const onSubmit = async (input: TransactionInput) => {
    // Throws a LedgerError if the entry would overdraw a balance or has no exchange rate;
    // the form shows the warning and nothing is saved.
    await addTransaction(input);
    router.push('/transactions');
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Add Transaction</Text>
      <TransactionForm submitLabel="Save" onSubmit={onSubmit} resetOnSuccess />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  title: {
    ...typography.pageTitle,
    fontSize: 24,
    color: colors.navy,
    marginTop: 40,
    paddingHorizontal: spacing.xl,
  },
});
