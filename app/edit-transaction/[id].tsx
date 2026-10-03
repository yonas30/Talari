import { Alert, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import AppButton from '../../components/AppButton';
import AppHeader from '../../components/AppHeader';
import TransactionForm from '../../components/TransactionForm';
import { colors, spacing, typography } from '../../constants/theme';
import { useFinanceStore } from '../../store/finance';
import { TransactionInput } from '../../types';
import { alertLedgerError } from '../../utils/alerts';

export default function EditTransactionScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const transactions = useFinanceStore((state) => state.transactions);
  const updateTransaction = useFinanceStore((state) => state.updateTransaction);
  const deleteTransaction = useFinanceStore((state) => state.deleteTransaction);

  const original = transactions.find((item) => item.id === id);

  if (!original) {
    return (
      <View style={styles.screen}>
        <AppHeader title="Edit transaction" />
        <Text style={styles.title}>Transaction not found</Text>
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
    <View style={styles.screen}>
      <AppHeader title="Edit transaction" />
      <TransactionForm
        // Remount if the user navigates between two different transactions.
        key={original.id}
        initial={original}
        submitLabel="Save changes"
        onSubmit={onSubmit}
        footer={<AppButton title="Delete transaction" variant="danger" onPress={onDelete} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  title: {
    ...typography.sectionTitle,
    color: colors.navy,
    padding: spacing.xl,
  },
});
