import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';

import AppButton from '../components/AppButton';
import AppHeader from '../components/AppHeader';
import { colors, radius, spacing, typography } from '../constants/theme';
import { exportAllData, importAllData, BackupPayload } from '../db/database';
import { useFinanceStore } from '../store/finance';

export default function ExportDataScreen() {
  const loadData = useFinanceStore((state) => state.loadData);
  const transactions = useFinanceStore((state) => state.transactions);
  const [isBusy, setIsBusy] = useState(false);

  const onExport = async () => {
    setIsBusy(true);
    try {
      const payload = await exportAllData();
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
      // amount/currency are what was entered; amount_etb is the value every balance and report uses.
      const header = 'date,type,category,amount,currency,amount_etb,exchange_rate,account,from,to,source,note';
      const rows = transactions.map((item) => {
        const note = (item.note ?? '').replace(/"/g, '""');
        const source = item.source.replace(/"/g, '""');
        const category = item.category.replace(/"/g, '""');
        const endpoint = (account: string | null, goalId: string | null) =>
          account === 'goal' ? `goal:${goalId ?? ''}` : (account ?? '');
        return `${item.date},${item.type},"${category}",${item.amount},${item.currency},${item.amountETB},${item.exchangeRate},${item.account ?? ''},${endpoint(item.fromAccount, item.fromGoalId)},${endpoint(item.toAccount, item.toGoalId)},"${source}","${note}"`;
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
      const payload = JSON.parse(contents) as BackupPayload;

      if (!payload || !Array.isArray(payload.transactions)) {
        throw new Error('This file does not look like a valid backup.');
      }

      await importAllData(payload);
      await loadData();
      Alert.alert('Import complete', 'Your data has been restored from the backup.');
    } catch (error) {
      Alert.alert('Import failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <AppHeader title="Export / Restore" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Export your data</Text>
          <Text style={styles.description}>
            Save a copy of all your transactions, categories, goals, and budgets as a JSON file you can keep safe or move to another device.
          </Text>
          <AppButton title="Export backup (JSON)" variant="primary" onPress={() => void onExport()} disabled={isBusy} />
          <AppButton title="Export transactions (CSV)" onPress={() => void onExportCsv()} disabled={isBusy} />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Restore from backup</Text>
          <Text style={styles.description}>
            Importing a backup replaces all current data on this device with the contents of the selected file.
          </Text>
          <AppButton title="Import backup" onPress={() => void onImport()} disabled={isBusy} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionTitle: {
    ...typography.sectionTitle,
    color: colors.navy,
  },
  description: {
    ...typography.helper,
    color: colors.textSecondary,
    lineHeight: 20,
  },
});
