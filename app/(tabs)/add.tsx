import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import AppHeader from '../../components/AppHeader';
import TransactionForm from '../../components/TransactionForm';
import { useFinanceStore } from '../../store/finance';
import { useTheme } from '../../theme/ThemeProvider';
import { TransactionInput } from '../../types';

export default function AddTransactionScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const addTransaction = useFinanceStore((state) => state.addTransaction);

  const onSubmit = async (input: TransactionInput) => {
    // Throws a LedgerError if the entry would overdraw a balance or has no exchange rate;
    // the form shows the warning and nothing is saved.
    await addTransaction(input);
    router.navigate('/transactions');
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader title="Add transaction" />
      <TransactionForm submitLabel="Save" onSubmit={onSubmit} resetOnSuccess />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
});
