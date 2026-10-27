import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import AppHeader from '../../components/AppHeader';
import AppText from '../../components/AppText';
import Button from '../../components/Button';
import Card from '../../components/Card';
import TransactionForm from '../../components/TransactionForm';
import { getAccountsState, useFinanceStore } from '../../store/finance';
import { useTheme } from '../../theme/ThemeProvider';
import { alertLedgerError } from '../../utils/alerts';
import { defaultCtx } from '../../utils/accounts/context';
import { EntryInput, planDeleteEntry } from '../../utils/accounts/entries';
import { AccountsError } from '../../utils/accounts/errors';
import { accountName, formatDateKey, formatETB, formatMoney, formatNumber } from '../../utils/format';
import { isEstimatedDate } from '../../utils/sms/dateSource';

export default function EditTransactionScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const transactions = useFinanceStore((state) => state.transactions);
  const accounts = useFinanceStore((state) => state.accounts);
  const updateTransaction = useFinanceStore((state) => state.updateTransaction);
  const deleteTransaction = useFinanceStore((state) => state.deleteTransaction);
  const confirmEntryDate = useFinanceStore((state) => state.confirmEntryDate);

  const found = transactions.find((item) => item.id === id);
  // A transfer fee is edited through its transfer: open that instead.
  const original = found?.linkedTransferId ? (transactions.find((item) => item.id === found.linkedTransferId) ?? found) : found;

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

  const onSubmit = async (input: EntryInput) => {
    // Editing just replaces this one ledger row (and a transfer's fee row); the whole resulting ledger is re-validated first.
    await updateTransaction(original.id, input);
    router.back();
  };

  // Deleting income, or a transfer into an account, can leave less in the account than is reserved for goals. Same warning as the Add form
  // gives before saving: the delete is allowed, and the goals shrink to match (with a notification each).
  const reserveNote = (): string => {
    try {
      const used = planDeleteEntry(getAccountsState(), original.id, defaultCtx).reserveUsed[0];
      return used ? ` Deleting it uses ${formatETB(used.shortfall)} of the ${formatETB(used.reservedBefore)} reserved for goals, so the goals shrink to match.` : '';
    } catch (error) {
      if (error instanceof AccountsError) {
        return ''; // the delete itself will be refused with its own message
      }
      throw error;
    }
  };

  const onDelete = () => {
    Alert.alert('Delete transaction', `This cannot be undone.${reserveNote()}`, [
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

  // The opening balance and adjustments are system rows: they count in an account's balance but are never income or spending, and an
  // opening balance is changed with an adjustment. They can be looked at and deleted here, not edited.
  if (original.type === 'opening' || original.type === 'adjustment') {
    const name = accountName(original.accountId, accounts);
    const currency = accounts.find((account) => account.id === original.accountId)?.currency ?? original.currency;
    return (
      <View style={[styles.screen, { backgroundColor: colors.bg }]}>
        <AppHeader title={original.type === 'opening' ? 'Opening balance' : 'Adjustment'} />
        <ScrollView contentContainerStyle={styles.container}>
          <Card style={styles.card}>
            <AppText variant="title" style={styles.cardTitle}>
              {original.type === 'opening' ? 'Opening balance' : 'Adjustment'} · {name}
            </AppText>
            <AppText variant="number" style={[styles.amount, { color: colors.text }]}>
              {original.amount < 0 ? '−' : '+'}
              {formatMoney(Math.abs(original.amount), currency)}
            </AppText>
            <AppText style={[styles.note, { color: colors.textMuted }]}>
              {formatDateKey(original.date)}
              {original.note ? ` · ${original.note}` : ''}
            </AppText>
            <AppText style={[styles.note, { color: colors.textMuted }]}>
              This counts in {name}&apos;s balance but is not income or spending, so it is in no report.{' '}
              {original.type === 'opening' ? 'To change the starting amount, use Opening balance on the account screen (it shows before and after first), or add an adjustment.' : 'To change it, delete it and add a new one.'}
              {currency !== 'ETB' ? ` (About ETB ${formatNumber(original.amountETB)} when it was recorded.)` : ''}
            </AppText>
          </Card>
          <Button title="Delete" variant="danger" onPress={onDelete} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader title="Edit transaction" />
      {isEstimatedDate(original.dateSource) ? (
        <View style={[styles.estimated, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]} accessibilityLiveRegion="polite">
          <AppText style={[styles.estimatedText, { color: colors.text }]}>
            This date is an estimate: it is the day the messages were imported. Check it, then change it or confirm it.
          </AppText>
          <Button title="Date is right" variant="secondary" onPress={() => void confirmEntryDate(original.id)} />
        </View>
      ) : null}
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
  estimated: {
    marginHorizontal: 20,
    marginBottom: 8,
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  estimatedText: {
    fontSize: 13,
    lineHeight: 18,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 14,
  },
  card: {
    padding: 16,
    gap: 6,
  },
  cardTitle: {
    fontSize: 16,
  },
  amount: {
    fontSize: 26,
    fontWeight: '700',
  },
  note: {
    fontSize: 13,
    lineHeight: 19,
  },
  notFound: {
    padding: 20,
  },
});
