import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppText from './AppText';
import Button from './Button';
import CategoryPicker from './CategoryPicker';
import Card from './Card';
import CurrencyPicker from './CurrencyPicker';
import DateField from './DateField';
import FormInput from './FormInput';
import OptionPicker, { PickerOption } from './OptionPicker';
import SegmentedControl, { SegmentOption } from './SegmentedControl';
import { defaultCategories } from '../constants/categories';
import { useFinanceStore } from '../store/finance';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeColors } from '../theme/tokens';
import { Account, CurrencyCode, Transaction, TransactionInput, TransactionType, TransferEndpoint } from '../types';
import { getBalances, LedgerError } from '../utils/balances';
import { getRateToETB } from '../utils/currency';
import { todayKey } from '../utils/dates';
import { formatETB } from '../utils/format';

const TYPE_OPTIONS: SegmentOption<TransactionType>[] = [
  { key: 'expense', label: 'Expense' },
  { key: 'income', label: 'Income' },
  { key: 'transfer', label: 'Transfer' },
];

const ACCOUNT_OPTIONS: SegmentOption<Account>[] = [
  { key: 'available', label: 'Available' },
  { key: 'saved', label: 'Saved' },
];

const ACCOUNT_LABELS: Record<Account, string> = {
  available: 'Available',
  saved: 'Saved',
};

// Each type has its own accent from the tokens: expense red, income green, transfer purple. The text tone is for the amount; the
// disc and glyph are the pale icon disc beside the "Amount" label and behind the category icons.
const TYPE_ACCENT: Record<
  TransactionType,
  { text: keyof ThemeColors; disc: keyof ThemeColors; glyph: keyof ThemeColors; icon: keyof typeof Ionicons.glyphMap }
> = {
  expense: { text: 'expense', disc: 'expenseDisc', glyph: 'expenseGlyph', icon: 'trending-down' },
  income: { text: 'income', disc: 'incomeDisc', glyph: 'incomeGlyph', icon: 'trending-up' },
  transfer: { text: 'transfer', disc: 'transferDisc', glyph: 'transferGlyph', icon: 'swap-horizontal' },
};

// The amount stays large but never outgrows its field: the size steps down as the number gets longer (a TextInput cannot
// shrink-to-fit by itself).
function amountFontSize(text: string): number {
  if (text.length > 14) return 20;
  if (text.length > 11) return 22;
  if (text.length > 8) return 25;
  return 29;
}

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
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const categories = useFinanceStore((state) => state.categories);
  const goals = useFinanceStore((state) => state.goals);
  const transactions = useFinanceStore((state) => state.transactions);
  const exchangeRates = useFinanceStore((state) => state.exchangeRates);

  const [type, setTypeState] = useState<TransactionType>(initial?.type ?? 'expense');
  const [amount, setAmountState] = useState(initial ? String(initial.amount) : '');
  const [currency, setCurrencyState] = useState<CurrencyCode>(initial?.currency ?? 'ETB');
  const [category, setCategoryState] = useState(initial?.category ?? '');
  const [source, setSourceState] = useState(initial?.source ?? '');
  const [note, setNoteState] = useState(initial?.note ?? '');
  const [date, setDateState] = useState(initial?.date ?? todayKey());
  const [account, setAccountState] = useState<Account>(initial?.account ?? 'available');
  const [from, setFromState] = useState(toEndpointValue(initial?.fromAccount ?? null, initial?.fromGoalId ?? null, 'available'));
  const [to, setToState] = useState(toEndpointValue(initial?.toAccount ?? null, initial?.toGoalId ?? null, 'saved'));
  const [showRateSection, setShowRateSection] = useState(false);
  // Empty = use the stored default (or, when editing, the rate the entry was made at). A value is a
  // ONE-OFF override for this transaction only - the stored rate changes only on the Exchange Rates page.
  const [rateInput, setRateInputState] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  // The ledger's reason for refusing an entry, shown inline above Save. Any edit to the form clears it.
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  // Category ids that existed when the user left for Categories; anything new that appears afterwards (of this
  // form's type) is what they just created, so it gets selected on return.
  const idsBeforeAddRef = useRef<Set<string> | null>(null);

  // Every field change goes through one of these, so a stale message never outlives the input it was about.
  const edited = <T,>(setter: (value: T) => void) => (value: T) => {
    setError(null);
    setter(value);
  };
  const setType = edited(setTypeState);
  const setAmount = edited(setAmountState);
  const setCurrency = edited(setCurrencyState);
  const setCategory = edited(setCategoryState);
  const setSource = edited(setSourceState);
  const setNote = edited(setNoteState);
  const setDate = edited(setDateState);
  const setAccount = edited(setAccountState);
  const setFrom = edited(setFromState);
  const setTo = edited(setToState);
  const setRateInput = edited(setRateInputState);

  // The form stays mounted underneath the Categories screen (it is pushed on top of the tabs / the edit screen), so
  // nothing typed here is lost while the user is away - and Back returns straight to it.
  const onAddCategory = () => {
    idsBeforeAddRef.current = new Set(categories.map((item) => item.id));
    router.push('/categories');
  };

  useEffect(() => {
    const before = idsBeforeAddRef.current;
    if (!before) {
      return;
    }
    const created = categories.find((item) => !before.has(item.id) && item.type === type);
    if (created) {
      setCategoryState(created.id);
      idsBeforeAddRef.current = null;
    }
  }, [categories, type]);

  // Back on this screen without having created anything: stop watching, so a category added from Settings later
  // doesn't unexpectedly get selected here.
  useFocusEffect(
    useCallback(() => {
      idsBeforeAddRef.current = null;
    }, []),
  );

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
    setAmountState('');
    setSourceState('');
    setNoteState('');
    setRateInputState('');
    setShowRateSection(false);
  };

  // A ledger rejection is an expected, user-facing outcome: show its message inline. Anything else is a real bug and is rethrown.
  const showError = (reason: unknown) => {
    if (reason instanceof LedgerError) {
      setError(reason.message);
      AccessibilityInfo.announceForAccessibility(reason.message);
      return;
    }
    throw reason;
  };

  const submit = async () => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      showError(new LedgerError('INVALID_AMOUNT', 'Enter an amount greater than zero.'));
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
    setError(null);
    try {
      await onSubmit(input);
      if (resetOnSuccess) {
        reset();
      }
    } catch (reason) {
      // Blocked entries (negative balance, no exchange rate, same From/To, ...) leave the form untouched.
      showError(reason);
    } finally {
      setIsSaving(false);
    }
  };

  const accent = TYPE_ACCENT[type];
  const accentText = colors[accent.text];
  const label = [styles.label, { color: colors.textMuted }];
  const helper = [styles.helper, { color: colors.textMuted }];

  return (
    // Same technique as the Goals sheets: the soft keyboard does not resize the window (the app draws
    // edge-to-edge), so shrink the form by the keyboard's height; the ScrollView then keeps the focused
    // field visible instead of the keyboard covering it. Save is the last item of the scroll content, so it can always be
    // scrolled into view; a tap on empty space (not on a control) closes the keyboard.
    <KeyboardAvoidingView style={styles.flex} behavior="padding">
      <ScrollView
        contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 28, backgroundColor: colors.bg }]}
        keyboardShouldPersistTaps="handled"
      >
        <SegmentedControl options={TYPE_OPTIONS} value={type} onChange={setType} />

        <Card style={styles.card}>
          <View style={styles.amountLabelRow}>
            <View style={[styles.disc, { backgroundColor: colors[accent.disc] }]}>
              <Ionicons name={accent.icon} size={16} color={colors[accent.glyph]} />
            </View>
            <AppText style={label}>Amount</AppText>
          </View>
          <View style={styles.amountRow}>
            <FormInput
              style={[styles.amountInput, { color: accentText, fontSize: amountFontSize(amount) }]}
              value={amount}
              onChangeText={setAmount}
              placeholder="0"
              keyboardType="decimal-pad"
              maxFontSizeMultiplier={1.3}
              accessibilityLabel="Amount"
              invalid={error !== null && Number(amount) <= 0}
            />
            <CurrencyPicker value={currency} onChange={setCurrency} />
          </View>
        </Card>

        {type === 'transfer' ? (
          <Card style={styles.card}>
            <AppText style={label}>From</AppText>
            <OptionPicker value={from} options={endpointOptions} onChange={setFrom} />
            <View style={styles.arrowRow}>
              <View style={[styles.disc, { backgroundColor: colors.transferDisc }]}>
                <Ionicons name="arrow-down" size={16} color={colors.transferGlyph} />
              </View>
            </View>
            <AppText style={label}>To</AppText>
            <OptionPicker value={to} options={endpointOptions} onChange={setTo} />
            <AppText style={helper}>A transfer moves money you already have. Total Balance does not change.</AppText>
          </Card>
        ) : (
          <>
            <Card style={styles.card}>
              <AppText style={label}>{type === 'income' ? 'Into' : 'Pay from'}</AppText>
              {/* Goal is deliberately not offered here: a goal can never pay for an expense (V2 Part B.6). */}
              <SegmentedControl options={ACCOUNT_OPTIONS} value={account} onChange={setAccount} />
              <AppText style={helper}>
                {ACCOUNT_LABELS[account]} balance: {formatETB(balances[account])}
              </AppText>
              {type === 'expense' && <AppText style={helper}>To spend goal money, transfer it out of the goal first.</AppText>}
            </Card>

            <Card style={styles.card}>
              <AppText style={label}>Category</AppText>
              <CategoryPicker
                value={selectedCategory?.id ?? category}
                options={categoryOptions}
                onChange={setCategory}
                onAddCategory={onAddCategory}
                discColor={colors[accent.disc]}
                glyphColor={colors[accent.glyph]}
              />
            </Card>
          </>
        )}

        <Card style={styles.card}>
          <AppText style={label}>Date</AppText>
          <DateField label="Date" value={date} onChange={setDate} />
        </Card>

        {type !== 'transfer' && (
          <Card style={styles.card}>
            <AppText style={label}>{type === 'income' ? 'Source' : 'Where / Merchant'}</AppText>
            <FormInput
              value={source}
              onChangeText={setSource}
              placeholder={type === 'income' ? 'e.g. Employer' : 'e.g. Burger Station'}
              accessibilityLabel={type === 'income' ? 'Source' : 'Where or merchant'}
            />
          </Card>
        )}

        <Card style={styles.card}>
          <AppText style={label}>Note (optional)</AppText>
          <FormInput value={note} onChangeText={setNote} placeholder="Add a note..." accessibilityLabel="Note" />
        </Card>

        {currency !== 'ETB' && (
          <Card style={styles.card}>
            <Pressable
              style={styles.collapsibleHeader}
              onPress={() => setShowRateSection((prev) => !prev)}
              accessibilityRole="button"
              accessibilityLabel="Exchange rate"
              accessibilityState={{ expanded: showRateSection }}
            >
              <AppText style={label}>Exchange rate</AppText>
              <Ionicons name={showRateSection ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
            </Pressable>
            {showRateSection && (
              <View style={styles.rateSection}>
                <AppText style={helper}>
                  1 {currency} = ? ETB — leave empty to use {defaultRate ? `the rate ${defaultRate}` : 'the saved rate'}. A rate entered
                  here applies to this transaction only.
                </AppText>
                <FormInput
                  value={rateInput}
                  onChangeText={setRateInput}
                  placeholder={defaultRate ? String(defaultRate) : 'No saved rate - enter one'}
                  keyboardType="decimal-pad"
                  accessibilityLabel="Exchange rate for this transaction"
                />
              </View>
            )}
          </Card>
        )}

        {error !== null && (
          // The ledger's own message, in the expense text tone (4.9:1 or better on the screen in both themes).
          <View style={styles.errorBox} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Ionicons name="alert-circle" size={18} color={colors.expense} />
            <AppText style={[styles.errorText, { color: colors.expense }]}>{error}</AppText>
          </View>
        )}

        <View style={styles.submitButton}>
          <Button title={submitLabel} variant="primary" disabled={isSaving} onPress={() => void submit()} />
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
    paddingHorizontal: 20,
    paddingTop: 4,
    gap: 12,
  },
  card: {
    padding: 14,
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
  helper: {
    fontSize: 12,
    lineHeight: 17,
  },
  amountLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  disc: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  amountInput: {
    flex: 1,
    minWidth: 0,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
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
    gap: 8,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 4,
  },
  errorText: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  submitButton: {
    marginTop: 4,
  },
});
