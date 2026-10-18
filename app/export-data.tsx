import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';

import AppHeader from '../components/AppHeader';
import AppText from '../components/AppText';
import Button from '../components/Button';
import Card from '../components/Card';
import { exportBackup, restoreBackupPayload } from '../db/database';
import { useFinanceStore } from '../store/finance';
import { useTheme } from '../theme/ThemeProvider';

export default function ExportDataScreen() {
  const { colors } = useTheme();
  const loadData = useFinanceStore((state) => state.loadData);
  const transactions = useFinanceStore((state) => state.transactions);
  const accounts = useFinanceStore((state) => state.accounts);
  const [isBusy, setIsBusy] = useState(false);

  const onExport = async () => {
    setIsBusy(true);
    try {
      const payload = await exportBackup();
      const file = new File(Paths.cache, `talari-backup-${Date.now()}.json`);
      if (file.exists) {
        file.delete();
      }
      file.create();
      file.write(JSON.stringify(payload, null, 2));

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Export backup' });
      } else {
        Alert.alert('Backup saved', `Saved to ${file.uri}`);
      }
    } catch (error) {
      Alert.alert('Export failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsBusy(false);
    }
  };

  const onExportCsv = async () => {
    setIsBusy(true);
    try {
      // amount/currency are the amount in the account's currency (or what was entered, for a foreign amount on an ETB account); amount_etb is
      // the value reports use. A transfer has two legs: account / amount is the one it leaves, to_account / to_amount / to_currency the one
      // it arrives in. fee_of_transfer is set on a transfer's fee row and holds the id of that transfer. Opening balances and adjustments are
      // included (type opening / adjustment): they count in an account's balance.
      const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
      const nameOf = (id: string | null) => accounts.find((account) => account.id === id)?.name ?? '';
      const currencyOf = (id: string | null) => accounts.find((account) => account.id === id)?.currency ?? '';
      const header = 'date,type,category,account,amount,currency,amount_etb,exchange_rate,to_account,to_amount,to_currency,fee_of_transfer,source,note';
      const rows = transactions.map((item) => {
        const account = item.type === 'transfer' ? nameOf(item.fromAccountId) : nameOf(item.accountId);
        const toAccount = item.type === 'transfer' ? nameOf(item.toAccountId) : '';
        const toAmount = item.type === 'transfer' && item.toAmount !== null ? item.toAmount : '';
        const toCurrency = item.type === 'transfer' ? currencyOf(item.toAccountId) : '';
        return [
          item.date,
          item.type,
          quote(item.category),
          quote(account),
          item.amount,
          item.currency,
          item.amountETB,
          item.exchangeRate,
          quote(toAccount),
          toAmount,
          toCurrency,
          item.linkedTransferId ?? '',
          quote(item.source),
          quote(item.note ?? ''),
        ].join(',');
      });
      const csv = [header, ...rows].join('\n');

      const file = new File(Paths.cache, `talari-transactions-${Date.now()}.csv`);
      if (file.exists) {
        file.delete();
      }
      file.create();
      file.write(csv);

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'Export CSV' });
      } else {
        Alert.alert('CSV saved', `Saved to ${file.uri}`);
      }
    } catch (error) {
      Alert.alert('Export failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsBusy(false);
    }
  };

  const onImport = async () => {
    setIsBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets[0]) {
        return;
      }

      const file = new File(result.assets[0].uri);
      const contents = await file.text();
      const payload: unknown = JSON.parse(contents);

      // Reads a version 3 backup, or an older one (which lands in one "Cash" account); refuses anything that would break the ledger, with
      // nothing changed. The message says exactly what was done.
      const message = await restoreBackupPayload(payload);
      await loadData();
      Alert.alert('Import complete', message);
    } catch (error) {
      Alert.alert('Import failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader title="Export / Restore" />
      <ScrollView contentContainerStyle={styles.container}>
        <Card style={styles.card}>
          <View style={styles.titleRow}>
            <View style={[styles.disc, { backgroundColor: colors.accentDisc }]}>
              <Ionicons name="share-outline" size={18} color={colors.primaryText} />
            </View>
            <AppText variant="title" style={styles.sectionTitle} accessibilityRole="header">
              Export your data
            </AppText>
          </View>
          <AppText style={[styles.description, { color: colors.textMuted }]}>
            Save a copy of all your accounts, transactions, categories, goals, and budgets as a JSON file you can keep safe or move to another device.
          </AppText>
          <Button title="Export backup (JSON)" variant="primary" onPress={() => void onExport()} disabled={isBusy} />
          <Button title="Export transactions (CSV)" variant="secondary" onPress={() => void onExportCsv()} disabled={isBusy} />
        </Card>

        <Card style={styles.card}>
          <View style={styles.titleRow}>
            <View style={[styles.disc, { backgroundColor: colors.expenseDisc }]}>
              <Ionicons name="warning-outline" size={18} color={colors.expenseGlyph} />
            </View>
            <AppText variant="title" style={styles.sectionTitle} accessibilityRole="header">
              Restore from backup
            </AppText>
          </View>
          <AppText style={[styles.description, { color: colors.textMuted }]}>
            Importing a backup replaces all current data on this device with the contents of the selected file.
          </AppText>
          {/* Destructive, so the danger tone: the button is the expense fill, and the warning above says what it does. */}
          <Button title="Import backup" variant="danger" onPress={() => void onImport()} disabled={isBusy} />
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
    gap: 16,
  },
  card: {
    padding: 14,
    gap: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  disc: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 17,
  },
  description: {
    fontSize: 13,
    lineHeight: 20,
  },
});
