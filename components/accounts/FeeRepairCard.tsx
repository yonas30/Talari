import { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAccountsState, useFinanceStore } from '../../store/finance';
import { useSmsStore } from '../../store/sms';
import { useUiStore } from '../../store/ui';
import { useTheme } from '../../theme/ThemeProvider';
import { formatDateKey, formatNumber, maskAmount } from '../../utils/format';
import { findFeeCountedTwice, repairEffect, repairLine } from '../../utils/sms/feeRepair';
import AppText from '../AppText';
import Button from '../Button';
import InlineError from '../InlineError';

interface FeeRepairCardProps {
  // On an account's own screen: only that account's entries.
  accountId?: string;
}

// A quiet, one-time card (V2_SPEC Part Z, "Repairing a fee counted twice"). It appears only while some entry was saved with the total debited as
// its amount AND the charges again as a separate fee. Nothing changes until the owner confirms; Fix changes only that entry's amount.
export default function FeeRepairCard({ accountId }: FeeRepairCardProps) {
  const { colors } = useTheme();
  const state = useAccountsState();
  const suggestions = useSmsStore((store) => store.suggestions);
  const isBalanceHidden = useUiStore((store) => store.isBalanceHidden);
  const repair = useFinanceStore((store) => store.repairFeesCountedTwice);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = useMemo(() => findFeeCountedTwice(state, suggestions).filter((item) => !accountId || item.accountId === accountId), [state, suggestions, accountId]);
  if (items.length === 0) {
    return null;
  }

  const mask = (text: string) => maskAmount(text, isBalanceHidden);
  const nameOf = (id: string) => state.accounts.find((account) => account.id === id)?.name ?? 'Account';

  const run = async (entryIds: string[]) => {
    setBusy(true);
    setError(null);
    try {
      await repair(suggestions, entryIds);
    } catch (reason) {
      // Nothing was changed. The list is shown again, rebuilt from what is there now.
      setError(reason instanceof Error ? reason.message : 'Could not fix this. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  const confirmOne = (index: number) => {
    const item = items[index];
    Alert.alert(
      'Fix this entry?',
      `${formatDateKey(item.date)} · ${nameOf(item.accountId)}\n${repairLine(item, nameOf(item.accountId), mask)}.\n\nOnly the amount of this entry changes. The fee entry stays.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Fix', onPress: () => void run([item.entryId]) },
      ],
    );
  };

  const confirmAll = () => {
    const effect = repairEffect(state, items);
    const lines = effect.byAccount.map((row) => `${row.name} goes up by ${mask(`ETB ${formatNumber(row.change)}`)}`).join('\n');
    Alert.alert(
      `Fix ${items.length} ${items.length === 1 ? 'entry' : 'entries'}?`,
      `In total your balances go up by ${mask(`ETB ${formatNumber(effect.total)}`)}:\n${lines}\n\nOnly the amount of each entry changes; the fee entries stay. All of them are fixed, or none.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Fix all', onPress: () => void run(items.map((item) => item.entryId)) },
      ],
    );
  };

  return (
    // On the account's own screen the page already has its side padding; on Transactions the card brings its own.
    <View style={[styles.card, accountId ? styles.insideScreen : null, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]} accessibilityLabel={`Fee counted twice, ${items.length}`}>
      <View style={styles.head}>
        <Ionicons name="build-outline" size={18} color={colors.textMuted} />
        <AppText style={[styles.title, { color: colors.text }]}>Fee counted twice ({items.length})</AppText>
      </View>
      <AppText style={[styles.text, { color: colors.textMuted }]}>
        {items.length === 1 ? 'This entry was' : 'These entries were'} saved with the total debited as the amount, and the charges again as a fee, so the account is lower than your bank by the fee. Fixing changes only the amount.
      </AppText>
      {items.map((item, index) => (
        <View key={item.entryId} style={styles.row}>
          <View style={styles.rowText}>
            <AppText style={[styles.rowTitle, { color: colors.text }]}>
              {formatDateKey(item.date)} · {nameOf(item.accountId)}
            </AppText>
            <AppText style={[styles.rowLine, { color: colors.text }]}>{repairLine(item, nameOf(item.accountId), mask)}</AppText>
          </View>
          <Button title="Fix" variant="secondary" disabled={busy} onPress={() => confirmOne(index)} accessibilityLabel={`Fix the entry of ${formatDateKey(item.date)} in ${nameOf(item.accountId)}`} />
        </View>
      ))}
      {error !== null ? <InlineError message={error} /> : null}
      {items.length > 1 ? <Button title={busy ? 'Fixing…' : `Fix all (${items.length})`} variant="secondary" disabled={busy} onPress={confirmAll} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 8, marginHorizontal: 20, marginTop: 8 },
  insideScreen: { marginHorizontal: 0, marginTop: 0 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 14, fontWeight: '700' },
  text: { fontSize: 12, lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontSize: 13, fontWeight: '600' },
  rowLine: { fontSize: 12, lineHeight: 17 },
});
