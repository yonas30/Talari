import { ReactNode, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import AppButton from './AppButton';
import CategoryPicker from './CategoryPicker';
import CurrencyPicker from './CurrencyPicker';
import DateField from './DateField';
import OptionPicker, { PickerOption } from './OptionPicker';
import { defaultCategories } from '../constants/categories';
import { colors, radius, spacing, typography } from '../constants/theme';
import { useFinanceStore } from '../store/finance';
import { Account, CurrencyCode, Transaction, TransactionInput, TransactionType, TransferEndpoint } from '../types';
import { alertLedgerError } from '../utils/alerts';
import { getBalances, LedgerError } from '../utils/balances';
import { getRateToETB } from '../utils/currency';
import { todayKey } from '../utils/dates';
import { formatETB } from '../utils/format';

const TYPE_LABELS: Record<TransactionType, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
};

const ACCOUNT_LABELS: Record<Account, string> = {
  available: 'Available',
  saved: 'Saved',
};

// A transfer endpoint is one picker value: 'available', 'saved' or 'goal:<id>'.
function toEndpointValue(account: TransferEndpoint | null, goalId: string | null, fallback: string): string {
  if (account === 'goal' && goalId) {
    return `goal:${goalId}`;
  }
  return account === 'available' || account === 'saved' ? account : fallback;
}

function fromEndpointValue(value: string): { account: TransferEndpoint; goalId: string | null } {
  if (value.startsWith('goal:')) {
    return { account: 'goal', goalId: value.slice(5) };
  }
  return { account: value === 'saved' ? 'saved' : 'available', goalId: null };
}

interface TransactionFormProps {
  // Present when editing: the row is replaced in place (V2 Part G), nothing is "reversed".
  initial?: Transaction;
  submitLabel: string;
  // Should throw (LedgerError) when the ledger rejects the entry; the form shows the warning and stays put.
  onSubmit: (input: TransactionInput) => Promise<void>;
  resetOnSuccess?: boolean;
  footer?: ReactNode;
}

export default function TransactionForm({ initial, submitLabel, onSubmit, resetOnSuccess = false, footer }: TransactionFormProps) {
  const categories = useFinanceStore((state) => state.categories);
  const goals = useFinanceStore((state) => state.goals);
  const transactions = useFinanceStore((state) => state.transactions);
  const exchangeRates = useFinanceStore((state) => state.exchangeRates);

  const [type, setType] = useState<TransactionType>(initial?.type ?? 'expense');
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [currency, setCurrency] = useState<CurrencyCode>(initial?.currency ?? 'ETB');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [source, setSource] = useState(initial?.source ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [date, setDate] = useState(initial?.date ?? todayKey());
  const [account, setAccount] = useState<Account>(initial?.account ?? 'available');
  const [from, setFrom] = useState(toEndpointValue(initial?.fromAccount ?? null, initial?.fromGoalId ?? null, 'available'));
  const [to, setTo] = useState(toEndpointValue(initial?.toAccount ?? null, initial?.toGoalId ?? null, 'saved'));
  const [showRateSection, setShowRateSection] = useState(false);
  // Empty = use the stored default (or, when editing, the rate the entry was made at). A value is a
  // ONE-OFF override for this transaction only - the stored rate changes only on the Exchange Rates page.
  const [rateInput, setRateInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const categoryOptions = useMemo(() => {
    if (type === 'transfer') {
      return [];
    }
    const items = categories.length > 0 ? categories : defaultCategories;
    return items.filter((item) => item.type === type);
  }, [categories, type]);

  const selectedCategory =
    categoryOptions.find((item) => item.id === category || item.name === category) ?? categoryOptions[0];

  // Balances as they'd be without the row being edited, so the hints show what is actually spendable.
  const balances = useMemo(
    () => getBalances(transactions.filter((item) => item.id !== initial?.id)),
    [transactions, initial?.id],
  );

  const endpointOptions = useMemo<PickerOption[]>(() => {
    const options: PickerOption[] = [
      { value: 'available', label: 'Available', hint: formatETB(balances.available) },
      { value: 'saved', label: 'Saved', hint: formatETB(balances.saved) },
      ...goals.map((goal) => ({
        value: `goal:${goal.id}`,
        label: `Goal: ${goal.name}`,
        hint: formatETB(balances.goals[goal.id] ?? 0),
      })),
    ];

    // Keep a goal that was deleted after this entry was made selectable so the form can still load it.
    for (const value of [from, to]) {
      if (value.startsWith('goal:') && !options.some((option) => option.value === value)) {
        options.push({ value, label: 'Goal: (deleted)', hint: formatETB(balances.goals[value.slice(5)] ?? 0) });
      }
    }
    return options;
  }, [balances, goals, from, to]);

  const storedRate = getRateToETB(currency, exchangeRates);
  const defaultRate = initial && initial.currency === currency ? initial.exchangeRate : storedRate;

  const reset = () => {
    setAmount('');
    setSource('');
    setNote('');
    setRateInput('');
    setShowRateSection(false);
  };

  const submit = async () => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      alertLedgerError(new LedgerError('INVALID_AMOUNT', 'Enter an amount greater than zero.'));
      return;
    }

    const override = currency !== 'ETB' && rateInput.trim() !== '' ? Number(rateInput) : null;
    let input: TransactionInput;

    if (type === 'transfer') {
      const fromEndpoint = fromEndpointValue(from);
      const toEndpoint = fromEndpointValue(to);
      input = {
        type,
        amount: numericAmount,
        currency,
        rateOverride: override,
        fromAccount: fromEndpoint.account,
        fromGoalId: fromEndpoint.goalId,
        toAccount: toEndpoint.account,
        toGoalId: toEndpoint.goalId,
        date,
        note: note.trim() || null,
      };
    } else {
      input = {
        type,
        amount: numericAmount,
        currency,
        rateOverride: override,
        category: selectedCategory?.name ?? category,
        source: source.trim() || 'Manual entry',
        account,
        date,
        note: note.trim() || null,
      };
    }

    setIsSaving(true);
    try {
      await onSubmit(input);
      if (resetOnSuccess) {
        reset();
      }
    } catch (error) {
      // Blocked entries (negative balance, no exchange rate, same From/To, ...) leave the form untouched.
      alertLedgerError(error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    // Same technique as the Goals sheets: the soft keyboard does not resize the window (the app draws
    // edge-to-edge), so shrink the form by the keyboard's height; the ScrollView then keeps the focused
    // field visible instead of the keyboard covering it.
    <KeyboardAvoidingView style={styles.flex} behavior="padding">
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.typeSegmented}>
          {(['expense', 'income', 'transfer'] as const).map((option) => (
            <Pressable
              key={option}
              style={[styles.typeSegment, type === option && styles.typeSegmentSelected]}
              onPress={() => setType(option)}
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

        {type === 'transfer' ? (
          <View style={styles.card}>
            <Text style={styles.label}>From</Text>
            <OptionPicker value={from} options={endpointOptions} onChange={setFrom} />
            <View style={styles.arrowRow}>
              <Ionicons name="arrow-down" size={18} color={colors.textSecondary} />
            </View>
            <Text style={styles.label}>To</Text>
            <OptionPicker value={to} options={endpointOptions} onChange={setTo} />
            <Text style={styles.helperText}>
              A transfer moves money you already have. Total Balance does not change.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.label}>{type === 'income' ? 'Into' : 'Pay from'}</Text>
              {/* Goal is deliberately not offered here: a goal can never pay for an expense (V2 Part B.6). */}
              <View style={styles.segmented}>
                {(['available', 'saved'] as const).map((option) => (
                  <AppButton
                    key={option}
                    title={ACCOUNT_LABELS[option]}
                    selected={account === option}
                    onPress={() => setAccount(option)}
                    style={styles.segmentButton}
                  />
                ))}
              </View>
              <Text style={styles.helperText}>
                {ACCOUNT_LABELS[account]} balance: {formatETB(balances[account])}
              </Text>
              {type === 'expense' && (
                <Text style={styles.helperText}>To spend goal money, transfer it out of the goal first.</Text>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>Category</Text>
              <CategoryPicker
                value={selectedCategory?.id ?? category}
                options={categoryOptions}
                onChange={setCategory}
              />
            </View>
          </>
        )}

        <View style={styles.card}>
          <Text style={styles.label}>Date</Text>
          <DateField label="Date" value={date} onChange={setDate} />
        </View>

        {type !== 'transfer' && (
          <View style={styles.card}>
            <Text style={styles.label}>{type === 'income' ? 'Source' : 'Where / Merchant'}</Text>
            <TextInput
              style={styles.input}
              value={source}
              onChangeText={setSource}
              placeholder={type === 'income' ? 'e.g. Employer' : 'e.g. Burger Station'}
            />
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.label}>Note (optional)</Text>
          <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="Add a note..." />
        </View>

        {currency !== 'ETB' && (
          <View style={styles.card}>
            <Pressable style={styles.collapsibleHeader} onPress={() => setShowRateSection((prev) => !prev)}>
              <Text style={styles.label}>Exchange rate</Text>
              <Ionicons name={showRateSection ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
            </Pressable>
            {showRateSection && (
              <View style={styles.rateSection}>
                <Text style={styles.helperText}>
                  1 {currency} = ? ETB — leave empty to use {defaultRate ? `the rate ${defaultRate}` : 'the saved rate'}. A rate entered
                  here applies to this transaction only.
                </Text>
                <TextInput
                  style={styles.input}
                  value={rateInput}
                  onChangeText={setRateInput}
                  placeholder={defaultRate ? String(defaultRate) : 'No saved rate - enter one'}
                  keyboardType="decimal-pad"
                />
              </View>
            )}
          </View>
        )}

        <View style={styles.submitButton}>
          <AppButton title={submitLabel} variant="primary" disabled={isSaving} onPress={() => void submit()} />
        </View>
        {footer}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    padding: spacing.xl,
    backgroundColor: colors.background,
    gap: spacing.md,
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
  segmented: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  segmentButton: {
    flex: 1,
  },
  arrowRow: {
    alignItems: 'center',
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
  submitButton: {
    marginTop: spacing.sm,
  },
});
