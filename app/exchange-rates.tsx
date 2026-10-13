import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import AppHeader from '../components/AppHeader';
import AppText from '../components/AppText';
import Button from '../components/Button';
import Card from '../components/Card';
import FormInput from '../components/FormInput';
import InlineError from '../components/InlineError';
import { spacing } from '../constants/theme';
import { useFinanceStore } from '../store/finance';
import { useTheme } from '../theme/ThemeProvider';

export default function ExchangeRatesScreen() {
  const { colors } = useTheme();
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
  // A validation message shown under the "Add a currency" fields (it used to be a native alert).
  const [currencyError, setCurrencyError] = useState<string | null>(null);

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
      setCurrencyError('Enter a currency code, e.g. CAD.');
      return;
    }
    setCurrencyError(null);
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

  const label = [styles.label, { color: colors.text }];
  const helper = [styles.helper, { color: colors.textMuted }];

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader title="Currencies & Exchange Rates" />
      {/* The soft keyboard doesn't resize an edge-to-edge window; lift the form so inputs stay visible. */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled" removeClippedSubviews={false}>
          <Card style={styles.card}>
            <AppText variant="title" style={styles.sectionTitle} accessibilityRole="header">
              Manual rates (to {homeCurrency})
            </AppText>
            <AppText style={helper}>These rates are used to convert every transaction into your home currency.</AppText>

            {otherCurrencies.length === 0 ? (
              <AppText style={helper}>Add another currency below to set its exchange rate.</AppText>
            ) : (
              otherCurrencies.map((currency) => (
                <View key={currency.code} style={styles.rateRow}>
                  <AppText style={label}>
                    {currency.code} → {homeCurrency}
                    {findRate(currency.code) === undefined ? '  ·  not set (required before logging this currency)' : ''}
                  </AppText>
                  <FormInput
                    value={rateInputs[currency.code] ?? String(findRate(currency.code) ?? '')}
                    onChangeText={(value) => {
                      setRatesSaved(false);
                      setRateInputs((prev) => ({ ...prev, [currency.code]: value }));
                    }}
                    keyboardType="decimal-pad"
                    accessibilityLabel={`${currency.code} to ${homeCurrency} rate`}
                  />
                </View>
              ))
            )}
            {otherCurrencies.length > 0 && (
              <View style={styles.saveRatesBlock}>
                <Button
                  title={ratesSaved ? 'Saved' : 'Save rates'}
                  variant={ratesSaved ? 'secondary' : 'primary'}
                  selected={ratesSaved}
                  onPress={() => void onSaveRates()}
                />
                {ratesSaved && (
                  <View style={styles.successRow} accessibilityLiveRegion="polite">
                    <Ionicons name="checkmark-circle" size={18} color={colors.income} />
                    <AppText style={[styles.successText, { color: colors.income }]}>Manual exchange rates updated.</AppText>
                  </View>
                )}
              </View>
            )}
          </Card>

          <Card style={styles.card}>
            <AppText variant="title" style={styles.sectionTitle} accessibilityRole="header">
              Your currencies
            </AppText>
            {currencies.map((currency, index) => (
              <View
                key={currency.code}
                style={[styles.currencyRow, index < currencies.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
              >
                <View style={styles.currencyInfo}>
                  <AppText style={[styles.currencyCode, { color: colors.text }]}>{currency.code}</AppText>
                  <AppText style={helper}>{currency.name}</AppText>
                </View>
                {!currency.isDefault && (
                  <Pressable
                    onPress={() => onDeleteCurrency(currency.code)}
                    style={({ pressed }) => [styles.deleteButton, pressed && { backgroundColor: colors.surfaceMuted }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${currency.code}`}
                  >
                    <Ionicons name="trash-outline" size={20} color={colors.expense} />
                  </Pressable>
                )}
              </View>
            ))}

            <AppText style={label}>Add a currency</AppText>
            <FormInput
              value={newCode}
              onChangeText={(value) => {
                setNewCode(value);
                setCurrencyError(null);
              }}
              placeholder="Code, e.g. CAD"
              autoCapitalize="characters"
              maxLength={6}
              accessibilityLabel="Currency code"
              invalid={currencyError !== null}
            />
            <FormInput value={newName} onChangeText={setNewName} placeholder="Name, e.g. Canadian Dollar" accessibilityLabel="Currency name" />
            {currencyError ? <InlineError message={currencyError} /> : null}
            <Button title="Add currency" variant="primary" onPress={() => void onAddCurrency()} />
          </Card>
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
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 16,
  },
  card: {
    padding: 14,
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: 17,
  },
  helper: {
    fontSize: 13,
    lineHeight: 18,
  },
  label: {
    fontSize: 13,
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
  successRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  successText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
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
  },
  currencyCode: {
    fontWeight: '700',
    fontSize: 15,
  },
  deleteButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
