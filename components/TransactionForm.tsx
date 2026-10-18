import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AccountChips from './accounts/AccountChips';
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
import { useAccountsState, useFinanceStore } from '../store/finance';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeColors } from '../theme/tokens';
import { CurrencyCode, TransactionType } from '../types';
import { AccountEntry, MoneyAccount } from '../types/accounts';
import { getAccountBalances } from '../utils/accounts/balances';
import { EntryInput, planAddEntry, planEditEntry } from '../utils/accounts/entries';
import { AccountsError } from '../utils/accounts/errors';
import { defaultCtx } from '../utils/accounts/context';
import { convertToETB, round2 } from '../utils/accounts/money';
import { getRateToETB } from '../utils/currency';
import { todayKey } from '../utils/dates';
import { formatETB, formatMoney } from '../utils/format';

const TYPE_OPTIONS: SegmentOption<TransactionType>[] = [
  { key: 'expense', label: 'Expense' },
  { key: 'income', label: 'Income' },
  { key: 'transfer', label: 'Transfer' },
];

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

interface TransactionFormProps {
  // Present when editing: the row is replaced in place (V2 Part G), nothing is "reversed". Never a fee row or a system row.
  initial?: AccountEntry;
  submitLabel: string;
  // Should throw (AccountsError) when the ledger rejects the entry; the form shows the warning and stays put.
  onSubmit: (input: EntryInput) => Promise<void>;
  resetOnSuccess?: boolean;
  footer?: ReactNode;
}

const initialType = (entry?: AccountEntry): TransactionType => (entry && (entry.type === 'income' || entry.type === 'transfer') ? entry.type : 'expense');

export default function TransactionForm({ initial, submitLabel, onSubmit, resetOnSuccess = false, footer }: TransactionFormProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const categories = useFinanceStore((state) => state.categories);
  const accounts = useFinanceStore((state) => state.accounts);
  const transactions = useFinanceStore((state) => state.transactions);
  const exchangeRates = useFinanceStore((state) => state.exchangeRates);
  const ledger = useAccountsState();

  // The accounts the owner can pick: those still in use, plus the one this entry is already in (so editing an old entry still loads).
  const usable = useMemo(
    () => accounts.filter((account) => !account.archived || account.id === initial?.accountId || account.id === initial?.fromAccountId || account.id === initial?.toAccountId),
    [accounts, initial],
  );
  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const initialFee = initial?.type === 'transfer' ? transactions.find((entry) => entry.linkedTransferId === initial.id) : undefined;
  const firstId = usable[0]?.id ?? null;

  const [type, setTypeState] = useState<TransactionType>(initialType(initial));
  const [amount, setAmountState] = useState(initial ? String(initial.amount) : '');
  const [currency, setCurrencyState] = useState<CurrencyCode>(initial && initial.type !== 'transfer' ? initial.currency : 'ETB');
  const [category, setCategoryState] = useState(initial?.category ?? '');
  const [source, setSourceState] = useState(initial?.source ?? '');
  const [note, setNoteState] = useState(initial?.note ?? '');
  const [date, setDateState] = useState(initial?.date ?? todayKey());
  const [accountId, setAccountIdState] = useState<string | null>(initial?.accountId ?? firstId);
  const [fromId, setFromIdState] = useState<string | null>(initial?.fromAccountId ?? firstId);
  const [toId, setToIdState] = useState<string | null>(initial?.toAccountId ?? usable.find((account) => account.id !== (initial?.fromAccountId ?? firstId))?.id ?? null);
  const [toAmount, setToAmountState] = useState(initial?.toAmount != null ? String(initial.toAmount) : '');
  const [feeAmount, setFeeAmountState] = useState(initialFee ? String(initialFee.amount) : '');
  const [feeCurrency, setFeeCurrencyState] = useState<string>(initialFee ? initialFee.currency : 'ETB');
  const [showRateSection, setShowRateSection] = useState(false);
  // Empty = use the stored default (or, when editing, the rate the entry was made at). A value is a
  // ONE-OFF override for this transaction only - the stored rate changes only on the Exchange Rates page.
  const [rateInput, setRateInputState] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  // The ledger's reason for refusing an entry, shown inline above Save. Any edit to the form clears it.
  const [error, setError] = useState<{ message: string; code: string | null } | null>(null);
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
  const setToAmount = edited(setToAmountState);
  const setFeeAmount = edited(setFeeAmountState);
  const setFeeCurrency = edited(setFeeCurrencyState);
  const setRateInput = edited(setRateInputState);

  const account: MoneyAccount | undefined = accountId ? accountById.get(accountId) : undefined;
  const fromAccount: MoneyAccount | undefined = fromId ? accountById.get(fromId) : undefined;
  const toAccount: MoneyAccount | undefined = toId ? accountById.get(toId) : undefined;
  const isTransfer = type === 'transfer';
  // A foreign account only takes its own currency; an ETB account takes any listed currency (converted to ETB at the stored rate).
  const entryCurrency = isTransfer ? (fromAccount?.currency ?? 'ETB') : account && account.currency !== 'ETB' ? account.currency : currency;
  const crossCurrency = isTransfer && fromAccount !== undefined && toAccount !== undefined && fromAccount.currency !== toAccount.currency;

  const setAccount = (id: string) => {
    setError(null);
    const next = accountById.get(id);
    const previous = account;
    setAccountIdState(id);
    if (next && next.currency !== 'ETB') {
      setCurrencyState(next.currency);
    } else if (previous && previous.currency !== 'ETB' && currency === previous.currency) {
      // Left a foreign account for an ETB one: back to ETB rather than carrying the old account's currency over.
      setCurrencyState('ETB');
    }
  };
  const setFrom = (id: string) => {
    setError(null);
    setFromIdState(id);
    if (id === toId) {
      setToIdState(usable.find((item) => item.id !== id)?.id ?? null);
    }
    const next = accountById.get(id);
    if (next && next.currency === 'ETB') {
      setFeeCurrencyState('ETB');
    }
  };
  const setTo = edited(setToIdState);
  const swap = () => {
    setError(null);
    setFromIdState(toId);
    setToIdState(fromId);
    setAmountState(toAmount);
    setToAmountState(amount);
  };

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

  // Balances as they'd be without the row being edited (and its fee), so the hints show what is actually spendable.
  const balances = useMemo(
    () => getAccountBalances(transactions.filter((item) => item.id !== initial?.id && item.linkedTransferId !== initial?.id), accounts),
    [transactions, accounts, initial?.id],
  );

  const accountOptions = useCallback(
    (list: MoneyAccount[]): PickerOption[] =>
      list.map((item) => ({ value: item.id, label: item.name, hint: `${formatMoney(balances[item.id] ?? 0, item.currency)} · ${item.currency}` })),
    [balances],
  );

  const storedRate = getRateToETB(entryCurrency, exchangeRates);
  const defaultRate = initial && initial.type !== 'transfer' && initial.currency === entryCurrency ? initial.exchangeRate : storedRate;

  const reset = () => {
    setAmountState('');
    setToAmountState('');
    setFeeAmountState('');
    setSourceState('');
    setNoteState('');
    setRateInputState('');
    setShowRateSection(false);
  };

  // What the owner entered as a ledger input, or null while the form cannot be one yet. Used by Save and by the live checks below.
  const buildInput = (): EntryInput | null => {
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return null;
    }
    if (type === 'transfer') {
      if (!fromId || !toId || fromId === toId) {
        return null;
      }
      const received = crossCurrency ? Number(toAmount) : numeric;
      if (!Number.isFinite(received) || received <= 0) {
        return null;
      }
      const feeValue = Number(feeAmount);
      return {
        type,
        fromAccountId: fromId,
        toAccountId: toId,
        fromAmount: numeric,
        toAmount: received,
        fee: Number.isFinite(feeValue) && feeValue > 0 ? { amount: feeValue, currency: feeCurrency } : null,
        date,
        note: note.trim() || null,
      };
    }
    if (!accountId) {
      return null;
    }
    const override = entryCurrency !== 'ETB' && rateInput.trim() !== '' ? Number(rateInput) : null;
    return {
      type,
      accountId,
      amount: numeric,
      currency: entryCurrency,
      rateOverride: override,
      category: selectedCategory?.name ?? category,
      source: source.trim() || 'Manual entry',
      date,
      note: note.trim() || null,
    };
  };

  // Live check against the real ledger, without saving anything: does this entry use money reserved for goals? Shown before Save, as the
  // owner decides (V2_SPEC Part E). A rejection here (not enough money, no rate...) is left to Save to report.
  const reserveWarning = useMemo(() => {
    if (type === 'income') {
      return null;
    }
    const input = buildInput();
    if (!input) {
      return null;
    }
    try {
      const result = initial ? planEditEntry(ledger, initial.id, input, defaultCtx) : planAddEntry(ledger, input, defaultCtx);
      const used = result.reserveUsed[0];
      return used ? `This uses ${formatETB(used.shortfall)} of the ${formatETB(used.reservedBefore)} reserved for goals.` : null;
    } catch (reason) {
      if (reason instanceof AccountsError) {
        return null;
      }
      throw reason;
    }
    // buildInput reads the form state below; the ledger is what changes under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledger, initial, type, amount, toAmount, feeAmount, feeCurrency, accountId, fromId, toId, date, entryCurrency, rateInput, crossCurrency]);

  // "after this" for the chosen account: its balance with this entry applied. Skipped while the amount cannot be turned into the account's
  // currency (for example a foreign amount with no stored rate).
  const afterThis = (target: MoneyAccount | undefined, direction: 1 | -1, value: string, valueCurrency: string): string | null => {
    const numeric = Number(value);
    if (!target || !Number.isFinite(numeric) || numeric <= 0) {
      return null;
    }
    let delta = numeric;
    if (target.currency === 'ETB' && valueCurrency !== 'ETB') {
      try {
        delta = convertToETB(numeric, valueCurrency, exchangeRates, rateInput.trim() !== '' ? Number(rateInput) : null).amountETB;
      } catch {
        return null;
      }
    } else if (target.currency !== valueCurrency) {
      return null;
    }
    return formatMoney(round2((balances[target.id] ?? 0) + direction * delta), target.currency);
  };

  // A message from the ledger, shown in place. Anything that is not one is a real bug and is rethrown.
  const showError = (reason: unknown) => {
    if (reason instanceof AccountsError) {
      setError({ message: reason.message, code: reason.code });
      AccessibilityInfo.announceForAccessibility(reason.message);
      return;
    }
    throw reason;
  };
  const showMessage = (message: string) => {
    setError({ message, code: null });
    AccessibilityInfo.announceForAccessibility(message);
  };

  const submit = async () => {
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      showMessage('Enter an amount greater than zero.');
      return;
    }
    if (crossCurrency && !(Number(toAmount) > 0)) {
      showMessage(`Enter the amount that arrives in ${toAccount?.name ?? 'the other account'}.`);
      return;
    }
    const input = buildInput();
    if (!input) {
      showMessage(isTransfer ? 'Choose two different accounts.' : 'Choose an account.');
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await onSubmit(input);
      if (resetOnSuccess) {
        reset();
      }
    } catch (reason) {
      // Blocked entries (not enough money, no exchange rate, ...) leave the form untouched.
      showError(reason);
    } finally {
      setIsSaving(false);
    }
  };

  const accent = TYPE_ACCENT[type];
  const accentText = colors[accent.text];
  const label = [styles.label, { color: colors.textMuted }];
  const helper = [styles.helper, { color: colors.textMuted }];
  const noAccounts = usable.length === 0;
  const needsTwo = isTransfer && usable.length < 2;
  const balanceAfter = !isTransfer ? afterThis(account, type === 'income' ? 1 : -1, amount, entryCurrency) : null;
  const fromAfter = isTransfer ? afterThis(fromAccount, -1, amount, fromAccount?.currency ?? 'ETB') : null;
  const feeChoices: SegmentOption<string>[] = fromAccount && fromAccount.currency !== 'ETB' ? [{ key: 'ETB', label: 'ETB' }, { key: fromAccount.currency, label: fromAccount.currency }] : [];

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
            <AppText style={label}>{isTransfer ? 'Amount sent' : 'Amount'}</AppText>
          </View>
          <View style={styles.amountRow}>
            <FormInput
              style={[styles.amountInput, { color: accentText, fontSize: amountFontSize(amount) }]}
              value={amount}
              onChangeText={setAmount}
              placeholder="0"
              keyboardType="decimal-pad"
              maxFontSizeMultiplier={1.3}
              accessibilityLabel={isTransfer ? 'Amount sent' : 'Amount'}
              invalid={error !== null && Number(amount) <= 0}
            />
            {isTransfer || (account && account.currency !== 'ETB') ? (
              // Fixed: a transfer leg and a foreign account are always in the account's own currency.
              <View style={[styles.currencyPill, { backgroundColor: colors.bg, borderColor: colors.inputBorder }]}>
                <AppText style={[styles.currencyPillText, { color: colors.text }]}>{entryCurrency}</AppText>
              </View>
            ) : (
              <CurrencyPicker value={currency} onChange={setCurrency} />
            )}
          </View>
          {!isTransfer && account && account.currency !== 'ETB' ? (
            <AppText style={helper}>{account.name} holds {account.currency}, so this is in {account.currency}.</AppText>
          ) : null}
        </Card>

        {noAccounts ? (
          <Card style={styles.card}>
            <AppText style={label}>No account yet</AppText>
            <AppText style={helper}>Add an account first: every transaction is recorded in one.</AppText>
            <Button title="Add an account" variant="secondary" onPress={() => router.push('/accounts')} />
          </Card>
        ) : isTransfer ? (
          needsTwo ? (
            <Card style={styles.card}>
              <AppText style={label}>Two accounts needed</AppText>
              <AppText style={helper}>A transfer moves money between two of your accounts. Add another account to use it.</AppText>
              <Button title="Add an account" variant="secondary" onPress={() => router.push('/accounts')} />
            </Card>
          ) : (
            <>
              <Card style={styles.card}>
                <AppText style={label}>From</AppText>
                <OptionPicker value={fromId ?? ''} options={accountOptions(usable)} onChange={setFrom} placeholder="Choose an account" />
                {fromAfter ? <AppText style={helper}>After this: {fromAfter}</AppText> : null}
                <Pressable
                  style={styles.arrowRow}
                  onPress={swap}
                  accessibilityRole="button"
                  accessibilityLabel="Swap From and To"
                  hitSlop={8}
                >
                  <View style={[styles.disc, { backgroundColor: colors.transferDisc }]}>
                    <Ionicons name="swap-vertical" size={16} color={colors.transferGlyph} />
                  </View>
                </Pressable>
                <AppText style={label}>To</AppText>
                <OptionPicker
                  value={toId ?? ''}
                  options={accountOptions(usable.filter((item) => item.id !== fromId))}
                  onChange={setTo}
                  placeholder="Choose an account"
                />
                <AppText style={helper}>
                  {crossCurrency
                    ? 'Type both amounts. The difference between them is the exchange cost; it is not income or spending.'
                    : 'A transfer moves money you already have. Total Balance does not change.'}
                </AppText>
              </Card>

              {crossCurrency && toAccount ? (
                <Card style={styles.card}>
                  <AppText style={label}>Amount received in {toAccount.name}</AppText>
                  <View style={styles.amountRow}>
                    <FormInput
                      style={[styles.amountInput, { color: accentText, fontSize: amountFontSize(toAmount) }]}
                      value={toAmount}
                      onChangeText={setToAmount}
                      placeholder="0"
                      keyboardType="decimal-pad"
                      maxFontSizeMultiplier={1.3}
                      accessibilityLabel={`Amount received in ${toAccount.name}`}
                      invalid={error !== null && !(Number(toAmount) > 0)}
                    />
                    <View style={[styles.currencyPill, { backgroundColor: colors.bg, borderColor: colors.inputBorder }]}>
                      <AppText style={[styles.currencyPillText, { color: colors.text }]}>{toAccount.currency}</AppText>
                    </View>
                  </View>
                </Card>
              ) : null}

              <Card style={styles.card}>
                <AppText style={label}>Fee (optional)</AppText>
                <View style={styles.amountRow}>
                  <FormInput
                    style={styles.feeInput}
                    value={feeAmount}
                    onChangeText={setFeeAmount}
                    placeholder="0"
                    keyboardType="decimal-pad"
                    accessibilityLabel="Transfer fee"
                  />
                  {feeChoices.length > 0 ? (
                    <View style={styles.feeChoices}>
                      <SegmentedControl options={feeChoices} value={feeCurrency} onChange={setFeeCurrency} />
                    </View>
                  ) : (
                    <View style={[styles.currencyPill, { backgroundColor: colors.bg, borderColor: colors.inputBorder }]}>
                      <AppText style={[styles.currencyPillText, { color: colors.text }]}>ETB</AppText>
                    </View>
                  )}
                </View>
                <AppText style={helper}>A fee is recorded as an expense (category Fees) in {fromAccount?.name ?? 'the account the money leaves'}. The transfer itself is not an expense.</AppText>
              </Card>
            </>
          )
        ) : (
          <>
            <Card style={styles.card}>
              <AppText style={label}>{type === 'income' ? 'Received in' : 'Paid from'}</AppText>
              <AccountChips accounts={usable} value={accountId} onChange={setAccount} />
              {account ? (
                <AppText style={helper}>
                  {account.name} balance: {formatMoney(balances[account.id] ?? 0, account.currency)}
                  {balanceAfter ? ` · after this: ${balanceAfter}` : ''}
                </AppText>
              ) : null}
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

        {reserveWarning ? (
          <View style={styles.warningBox} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Ionicons name="alert-circle-outline" size={18} color={colors.primaryText} />
            <AppText style={[styles.warningText, { color: colors.text }]}>
              {reserveWarning} You can still save: the goals will shrink to match.
            </AppText>
          </View>
        ) : null}

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

        {!isTransfer && entryCurrency !== 'ETB' && (
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
                  1 {entryCurrency} = ? ETB — leave empty to use {defaultRate ? `the rate ${defaultRate}` : 'the saved rate'}. A rate entered
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
            <View style={styles.errorBody}>
              <AppText style={[styles.errorText, { color: colors.expense }]}>{error.message}</AppText>
              {error.code === 'MISSING_RATE' ? (
                <Button title="Set the exchange rate" variant="link" onPress={() => router.push('/exchange-rates')} />
              ) : null}
            </View>
          </View>
        )}

        <View style={styles.submitButton}>
          <Button title={submitLabel} variant="primary" disabled={isSaving || noAccounts || needsTwo} onPress={() => void submit()} />
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
  feeInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  feeChoices: {
    width: 130,
  },
  currencyPill: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  currencyPillText: {
    fontWeight: '700',
    fontSize: 14,
  },
  arrowRow: {
    alignItems: 'center',
    paddingVertical: 2,
  },
  collapsibleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rateSection: {
    gap: 8,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 4,
  },
  warningText: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 4,
  },
  errorBody: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  submitButton: {
    marginTop: 4,
  },
});
