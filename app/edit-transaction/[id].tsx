import { Alert, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import AppHeader from '../../components/AppHeader';
import AppText from '../../components/AppText';
import Button from '../../components/Button';
import TransactionForm from '../../components/TransactionForm';
import { useFinanceStore } from '../../store/finance';
import { useTheme } from '../../theme/ThemeProvider';
import { TransactionInput } from '../../types';
import { alertLedgerError } from '../../utils/alerts';

export default function EditTransactionScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const transactions = useFinanceStore((state) => state.transactions);
  const updateTransaction = useFinanceStore((state) => state.updateTransaction);
  const deleteTransaction = useFinanceStore((state) => state.deleteTransaction);

  const original = transactions.find((item) => item.id === id);

  if (!original) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.bg }]}>
        <AppHeader title="Edit transaction" />
        <AppText variant="title" style={styles.notFound}>
          Transaction not found
        </AppText>
      </View>
    );
  }

  const onSubmit = async (input: TransactionInput) => {
    // Editing just replaces this one ledger row; the whole resulting ledger is re-validated first.
    await updateTransaction(original.id, input);
    router.back();
  };

  const onDelete = () => {
    Alert.alert('Delete transaction', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteTransaction(original.id);
          } catch (error) {
            // e.g. deleting income that later spending depends on.
            alertLedgerError(error);
            return;
          }
          router.back();
        },
      },
    ]);
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader title="Edit transaction" />
      <TransactionForm
        // Remount if the user navigates between two different transactions.
        key={original.id}
        initial={original}
        submitLabel="Save changes"
        onSubmit={onSubmit}
        footer={<Button title="Delete transaction" variant="danger" onPress={onDelete} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  notFound: {
    padding: 20,
  },
});
