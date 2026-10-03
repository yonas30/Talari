import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import AppButton from '../components/AppButton';
import AppHeader from '../components/AppHeader';
import { colors, radius, spacing, typography } from '../constants/theme';
import { useFinanceStore } from '../store/finance';

export default function ExchangeRatesScreen() {
  const exchangeRates = useFinanceStore((state) => state.exchangeRates);
  const upsertExchangeRate = useFinanceStore((state) => state.upsertExchangeRate);
  const homeCurrency = useFinanceStore((state) => state.homeCurrency);
  const currencies = useFinanceStore((state) => state.currencies);
  const addCurrency = useFinanceStore((state) => state.addCurrency);
  const deleteCurrency = useFinanceStore((state) => state.deleteCurrency);

  const [rateInputs, setRateInputs] = useState<Record<string, string>>({});
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [ratesSaved, setRatesSaved] = useState(false);

  const findRate = (from: string) => exchangeRates.find((rate) => rate.fromCurrency === from && rate.toCurrency === homeCurrency)?.rate;

  const otherCurrencies = currencies.filter((currency) => currency.code !== homeCurrency);

  const onSaveRate = async (code: string) => {
    const value = Number(rateInputs[code] ?? findRate(code) ?? 0);
    if (Number.isFinite(value) && value > 0) {
      await upsertExchangeRate(code, homeCurrency, value);
    }
  };

  const onSaveRates = async () => {
    await Promise.all(otherCurrencies.map((currency) => onSaveRate(currency.code)));
    setRatesSaved(true);
  };

  const onAddCurrency = async () => {
    if (!newCode.trim()) {
      Alert.alert('Enter a currency code, e.g. CAD.');
      return;
    }
    await addCurrency(newCode.trim(), newName.trim() || newCode.trim());
    setNewCode('');
    setNewName('');
  };

  const onDeleteCurrency = (code: string) => {
    Alert.alert('Remove currency', `Remove ${code} from your currency list?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void deleteCurrency(code) },
    ]);
  };

  return (
    <View style={styles.screen}>
      <AppHeader title="Currencies & Exchange Rates" />
      {/* The soft keyboard doesn't resize an edge-to-edge window; lift the form so inputs stay visible. */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" removeClippedSubviews={false}>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Manual rates (to {homeCurrency})</Text>
            <Text style={styles.helper}>These rates are used to convert every transaction into your home currency.</Text>

            {otherCurrencies.length === 0 ? (
              <Text style={styles.helper}>Add another currency below to set its exchange rate.</Text>
            ) : (
              otherCurrencies.map((currency) => (
                <View key={currency.code} style={styles.rateRow}>
                  <Text style={styles.label}>
                    {currency.code} → {homeCurrency}
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={rateInputs[currency.code] ?? String(findRate(currency.code) ?? '')}
                    onChangeText={(value) => {
                      setRatesSaved(false);
                      setRateInputs((prev) => ({ ...prev, [currency.code]: value }));
                    }}
                    keyboardType="decimal-pad"
                  />
                </View>
              ))
            )}
            {otherCurrencies.length > 0 && (
              <View style={styles.saveRatesBlock}>
                <AppButton
                  title={ratesSaved ? 'Saved' : 'Save rates'}
                  variant="primary"
                  selected={ratesSaved}
                  onPress={() => void onSaveRates()}
                />
                {ratesSaved && <Text style={styles.successText}>Manual exchange rates updated.</Text>}
              </View>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Your currencies</Text>
            {currencies.map((currency) => (
              <View key={currency.code} style={styles.currencyRow}>
                <View style={styles.currencyInfo}>
                  <Text style={styles.currencyCode}>{currency.code}</Text>
                  <Text style={styles.helper}>{currency.name}</Text>
                </View>
                {!currency.isDefault && (
                  <Pressable onPress={() => onDeleteCurrency(currency.code)}>
                    <Ionicons name="trash-outline" size={20} color={colors.red} />
                  </Pressable>
                )}
              </View>
            ))}

            <Text style={styles.label}>Add a currency</Text>
            <TextInput
              style={styles.input}
              value={newCode}
              onChangeText={setNewCode}
              placeholder="Code, e.g. CAD"
              autoCapitalize="characters"
              maxLength={6}
            />
            <TextInput style={styles.input} value={newName} onChangeText={setNewName} placeholder="Name, e.g. Canadian Dollar" />
            <AppButton title="Add currency" variant="primary" onPress={() => void onAddCurrency()} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flexGrow: 1,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionTitle: {
    ...typography.sectionTitle,
    color: colors.navy,
  },
  helper: {
    ...typography.helper,
    color: colors.textSecondary,
  },
  label: {
    ...typography.helper,
    color: colors.navy,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  rateRow: {
    gap: 6,
  },
  saveRatesBlock: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  successText: {
    ...typography.helper,
    color: colors.statusIncome,
  },
  input: {
    backgroundColor: colors.background,
    borderColor: '#E2E5DE',
    borderWidth: 1,
    borderRadius: radius.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
  },
  currencyInfo: {
    flex: 1,
    minWidth: 0,
  },
  currencyRow: {
    gap: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.background,
  },
  currencyCode: {
    fontWeight: '700',
    color: colors.navy,
    fontSize: 15,
  },
});
