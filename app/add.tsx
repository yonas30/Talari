import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import AppButton from '../components/AppButton';
import CategoryPicker from '../components/CategoryPicker';
import CurrencyPicker from '../components/CurrencyPicker';
import DateField from '../components/DateField';
import { defaultCategories } from '../constants/categories';
import { colors, radius, spacing, typography } from '../constants/theme';
import { useFinanceStore } from '../store/finance';
import { CurrencyCode } from '../types';
import { alertLedgerError } from '../utils/alerts';
import { todayKey } from '../utils/dates';

// Step 2 keeps this form to Income/Expense (paid from / into Available). The Saved choice and the
// Transfer type with From/To arrive with the Step 3 transaction-form work.
type EntryType = 'income' | 'expense';

const TYPE_LABELS: Record<EntryType, string> = {
  expense: 'Expense',
  income: 'Income',
};

export default function AddTransactionScreen() {
  const router = useRouter();
  const addTransaction = useFinanceStore((state) => state.addTransaction);
  const exchangeRates = useFinanceStore((state) => state.exchangeRates);
  const categories = useFinanceStore((state) => state.categories);
  const homeCurrency = useFinanceStore((state) => state.homeCurrency);

  const [type, setType] = useState<EntryType>('expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(defaultCategories[0]?.id ?? 'food');
  const [currency, setCurrency] = useState<CurrencyCode>(homeCurrency);
  const [source, setSource] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayKey());
  const [showRateSection, setShowRateSection] = useState(false);

  const currentRate = exchangeRates.find((rate) => rate.fromCurrency === currency && rate.toCurrency === homeCurrency)?.rate;
  // Empty = use the stored default. A value here is a ONE-OFF override for this transaction only;
  // the stored rate is changed solely on the Exchange Rates settings page (V2 Part D).
  const [rateInput, setRateInput] = useState('');

  const categoryOptions = useMemo(() => {
    const items = categories.length > 0 ? categories : defaultCategories;
    return items.filter((item) => item.type === type);
  }, [categories, type]);

  const onSubmit = async () => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return;
    }

    const override = rateInput.trim() === '' ? null : Number(rateInput);

    try {
      await addTransaction({
        type,
        amount: numericAmount,
        currency,
        rateOverride: currency === homeCurrency ? null : override,
        category: categoryOptions.find((item) => item.id === category)?.name ?? category,
        source: source.trim() || 'Manual entry',
        account: 'available',
        date,
        note: note.trim() || null,
      });
    } catch (error) {
      // Blocked entries (negative balance, no exchange rate, ...) leave the form untouched.
      alertLedgerError(error);
      return;
    }

    setAmount('');
    setSource('');
    setNote('');
    setRateInput('');
    router.push('/transactions');
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Add Transaction</Text>

      <View style={styles.typeSegmented}>
        {(['expense', 'income'] as const).map((option) => (
          <Pressable
            key={option}
            style={[styles.typeSegment, type === option && styles.typeSegmentSelected]}
            onPress={() => {
              setType(option);
              const next = categoryOptions.find((item) => item.type === option) ?? categoryOptions[0];
              if (next) setCategory(next.id);
            }}
          >
            <Text style={[styles.typeSegmentText, type === option && styles.typeSegmentTextSelected]}>
              {TYPE_LABELS[option]}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Amount</Text>
        <View style={styles.amountRow}>
          <TextInput
            style={styles.amountInput}
            value={amount}
            onChangeText={setAmount}
            placeholder="0"
            keyboardType="decimal-pad"
          />
          <CurrencyPicker value={currency} onChange={setCurrency} />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Category</Text>
        <CategoryPicker value={category} options={categoryOptions} onChange={setCategory} />
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Date</Text>
        <DateField label="Date" value={date} onChange={setDate} />
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Where / Source</Text>
        <TextInput style={styles.input} value={source} onChangeText={setSource} placeholder="e.g. Burger Station" />
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Note (optional)</Text>
        <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="Add a note..." />
      </View>

      {currency !== homeCurrency && (
        <View style={styles.card}>
          <Pressable style={styles.collapsibleHeader} onPress={() => setShowRateSection((prev) => !prev)}>
            <Text style={styles.label}>Exchange rate</Text>
            <Ionicons name={showRateSection ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
          </Pressable>
          {showRateSection && (
            <View style={styles.rateSection}>
              <Text style={styles.helperText}>
                1 {currency} = ? {homeCurrency} — leave empty to use the saved rate{currentRate ? ` (${currentRate})` : ''}. A rate entered here applies to this transaction only.
              </Text>
              <TextInput
                style={styles.input}
                value={rateInput}
                onChangeText={setRateInput}
                placeholder={currentRate ? String(currentRate) : 'No saved rate - enter one'}
                keyboardType="decimal-pad"
              />
            </View>
          )}
        </View>
      )}

      <View style={styles.submitButton}>
        <AppButton title={`Save ${TYPE_LABELS[type]}`} variant="primary" onPress={() => void onSubmit()} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: spacing.xl,
    backgroundColor: colors.background,
    gap: spacing.md,
  },
  title: {
    ...typography.pageTitle,
    fontSize: 24,
    color: colors.navy,
    marginTop: 40,
    marginBottom: spacing.sm,
  },
  typeSegmented: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.button,
    padding: 4,
  },
  typeSegment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: radius.button - 2,
  },
  typeSegmentSelected: {
    backgroundColor: colors.orange,
  },
  typeSegmentText: {
    fontWeight: '700',
    color: colors.navy,
  },
  typeSegmentTextSelected: {
    color: '#FFFFFF',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  label: {
    ...typography.helper,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  amountInput: {
    flex: 1,
    fontSize: 28,
    fontWeight: '800',
    color: colors.navy,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: radius.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 15,
    color: colors.navy,
  },
  collapsibleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rateSection: {
    gap: spacing.sm,
  },
  helperText: {
    ...typography.helper,
    color: colors.textSecondary,
  },
  successText: {
    ...typography.helper,
    color: colors.statusIncome,
  },
  submitButton: {
    marginTop: spacing.sm,
  },
});
