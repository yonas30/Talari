import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppHeader from '../components/AppHeader';
import AppText from '../components/AppText';
import Button from '../components/Button';
import CurrencyPicker from '../components/CurrencyPicker';
import DateField from '../components/DateField';
import FormInput from '../components/FormInput';
import InlineError from '../components/InlineError';
import OverlayModal from '../components/OverlayModal';
import SegmentedControl, { SegmentOption } from '../components/SegmentedControl';
import { defaultCategories } from '../constants/categories';
import { radius, spacing } from '../constants/theme';
import { useFinanceStore } from '../store/finance';
import { useTheme } from '../theme/ThemeProvider';
import { Account, CurrencyCode, RecurringFrequency, RecurringTransaction, RecurringType } from '../types';
import { todayKey } from '../utils/dates';
import { CONTROL_LABEL_MAX_SCALE } from '../utils/layout';
import { getNextDueDate } from '../utils/recurring';

const TYPE_OPTIONS: SegmentOption<RecurringType>[] = [
  { key: 'expense', label: 'Expense' },
  { key: 'income', label: 'Income' },
];
const ACCOUNT_OPTIONS: SegmentOption<Account>[] = [
  { key: 'available', label: 'Available' },
  { key: 'saved', label: 'Saved' },
];
const FREQUENCY_OPTIONS: SegmentOption<RecurringFrequency>[] = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
];

function getFrequencyLabel(freq: RecurringFrequency): string {
  return freq === 'daily' ? 'Every day' : freq === 'weekly' ? 'Every week' : 'Every month';
}

export default function RecurringScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const {
    recurringTransactions,
    categories,
    addRecurringTransaction,
    updateRecurringTransaction,
    toggleRecurringTransaction,
    deleteRecurringTransaction,
  } = useFinanceStore();

  const [type, setType] = useState<RecurringType>('expense');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('ETB');
  const [category, setCategory] = useState('');
  const [source, setSource] = useState('');
  const [frequency, setFrequency] = useState<RecurringFrequency>('monthly');
  const [startDate, setStartDate] = useState(todayKey());
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  // The rule being edited, or null when creating a new one.
  const [editing, setEditing] = useState<RecurringTransaction | null>(null);
  const [account, setAccount] = useState<Account>('available');
  // New rules start active; editing only changes this if the switch is flipped.
  const [isActive, setIsActive] = useState(true);
  const [tab, setTab] = useState<'upcoming' | 'all'>('upcoming');
  // A validation message shown inside the sheet (it used to be a native alert).
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setType('expense');
    setAmount('');
    setCurrency('ETB');
    setCategory('');
    setSource('');
    setFrequency('monthly');
    setStartDate(todayKey());
    setAccount('available');
    setIsActive(true);
    setEditing(null);
    setIsCategoryOpen(false);
    setError(null);
    setIsFormOpen(false);
  };

  const openEdit = (rule: RecurringTransaction) => {
    setEditing(rule);
    setType(rule.type);
    setAmount(String(rule.amount));
    setCurrency(rule.currency);
    setCategory(rule.category);
    setSource(rule.source === 'Recurring' ? '' : rule.source);
    setFrequency(rule.frequency);
    setStartDate(rule.startDate);
    setAccount(rule.account);
    setIsActive(rule.isActive);
    setError(null);
    setIsFormOpen(true);
  };

  // A rule that has already posted keeps its schedule (changing the date would re-post or skip entries); only a
  // rule that has never fired can move its start date.
  const canEditDate = !editing || !editing.lastGeneratedDate;

  const categoryLookup = useMemo(
    () => Object.fromEntries((categories.length > 0 ? categories : defaultCategories).map((item) => [item.name, item])),
    [categories],
  );

  const categoryOptions = useMemo(() => {
    const items = categories.length > 0 ? categories : defaultCategories;
    return items.filter((item) => item.type === type || item.type === 'savings');
  }, [categories, type]);

  // Each rule with the date it fires next, soonest first; paused rules sink to the end. 'Upcoming' is the
  // active rules, 'All' includes paused ones.
  const rules = useMemo(
    () =>
      recurringTransactions
        .map((rule) => ({ rule, nextDate: getNextDueDate(rule) }))
        .sort((a, b) => Number(!a.rule.isActive) - Number(!b.rule.isActive) || a.nextDate.getTime() - b.nextDate.getTime()),
    [recurringTransactions],
  );
  const upcomingCount = rules.filter((item) => item.rule.isActive).length;
  const visibleRules = tab === 'upcoming' ? rules.filter((item) => item.rule.isActive) : rules;

  const confirmDelete = (rule: RecurringTransaction) => {
    Alert.alert('Delete recurring transaction', `Stop "${rule.category}" from recurring? Entries already posted are kept.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void deleteRecurringTransaction(rule.id) },
    ]);
  };

  const onSave = async () => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !category) {
      setError('Enter a valid amount and choose a category.');
      return;
    }

    const input = {
      type,
      account,
      amount: numericAmount,
      currency,
      category,
      source: source.trim() || 'Recurring',
      frequency,
      startDate,
    };

    // Editing changes the rule going forward only; entries it already posted are untouched.
    if (editing) {
      await updateRecurringTransaction(editing.id, input);
      if (isActive !== editing.isActive) {
        await toggleRecurringTransaction(editing.id, isActive);
      }
    } else {
      const created = await addRecurringTransaction(input);
      if (!isActive) {
        await toggleRecurringTransaction(created.id, false);
      }
    }

    resetForm();
  };

  const upcomingOptions: SegmentOption<'upcoming' | 'all'>[] = [
    { key: 'upcoming', label: `Upcoming (${upcomingCount})` },
    { key: 'all', label: `All (${rules.length})` },
  ];
  const label = [styles.label, { color: colors.textMuted }];
  const amountInvalid = error !== null && !(Number(amount) > 0);

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader title="Recurring" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.topText}>
          <AppText variant="heading" style={styles.pageTitle}>
            Recurring transactions
          </AppText>
          <AppText style={[styles.pageSubtitle, { color: colors.textMuted }]}>Automate the entries you make regularly.</AppText>
        </View>
        {/* A labelled button, like "New goal" - no round raised + that reads as the tab bar's add button. */}
        <Button
          title="New recurring"
          icon="add"
          onPress={() => {
            resetForm();
            setIsFormOpen(true);
          }}
          accessibilityLabel="Add a recurring transaction"
        />

        <SegmentedControl options={upcomingOptions} value={tab} onChange={setTab} />

        {visibleRules.length === 0 ? (
          <AppText style={[styles.emptyState, { color: colors.textMuted }]}>
            {rules.length === 0
              ? 'No recurring transactions yet — tap + to set up automated tracking.'
              : 'Nothing is scheduled. Switch a rule back on from the All tab.'}
          </AppText>
        ) : (
          visibleRules.map(({ rule, nextDate }) => {
            const categoryMeta = categoryLookup[rule.category] ?? { icon: '💰' };
            const isExpense = rule.type === 'expense';
            return (
              // One compact flat card: pale icon disc, category + amount on the first line, frequency + next date on the second,
              // then the Active switch and delete. Tapping the row edits the rule. A paused rule is a quieter fill and says "Paused".
              <Pressable
                key={rule.id}
                style={({ pressed }) => [
                  styles.ruleRow,
                  { backgroundColor: rule.isActive ? colors.surface : colors.surfaceMuted, borderColor: colors.border },
                  pressed && { backgroundColor: colors.surfaceMuted },
                ]}
                onPress={() => openEdit(rule)}
                accessibilityRole="button"
                accessibilityLabel={`${rule.category}, tap to edit`}
              >
                <View style={[styles.iconBadge, { backgroundColor: isExpense ? colors.expenseDisc : colors.incomeDisc }]}>
                  <AppText style={styles.iconText} maxFontSizeMultiplier={CONTROL_LABEL_MAX_SCALE}>{categoryMeta.icon}</AppText>
                </View>
                <View style={styles.ruleInfo}>
                  <View style={styles.ruleTopLine}>
                    <AppText style={[styles.ruleCategory, { color: colors.text }]} numberOfLines={1}>
                      {rule.category}
                    </AppText>
                    <AppText
                      variant="number"
                      style={[styles.ruleAmount, { color: isExpense ? colors.expense : colors.income }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.8}
                    >
                      {isExpense ? '-' : '+'}
                      {rule.currency} {rule.amount.toFixed(2)}
                    </AppText>
                  </View>
                  <AppText style={[styles.ruleMeta, { color: colors.textMuted }]} numberOfLines={1}>
                    {getFrequencyLabel(rule.frequency)} ·{' '}
                    {rule.isActive
                      ? `Next: ${nextDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                      : 'Paused'}
                  </AppText>
                </View>
                <Switch
                  value={rule.isActive}
                  onValueChange={(value) => void toggleRecurringTransaction(rule.id, value)}
                  trackColor={{ false: colors.inputBorder, true: colors.primary }}
                  thumbColor={rule.isActive ? colors.onPrimary : colors.surface}
                  accessibilityLabel={`${rule.category} active`}
                />
                <Pressable
                  onPress={() => confirmDelete(rule)}
                  style={styles.deleteButton}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${rule.category}`}
                >
                  <Ionicons name="trash-outline" size={20} color={colors.expense} />
                </Pressable>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {/*
        This sheet deliberately keeps its own plain Modal, not the shared keyboard-aware SheetModal: with SheetModal the
        Amount field stopped accepting input on Android. The content scrolls (keyboardShouldPersistTaps) so the lower fields
        and the Save button can be reached while the keyboard is open.
      */}
      <OverlayModal visible={isFormOpen} animationType="slide" onRequestClose={resetForm}>
        <Pressable style={[styles.modalBackdrop, { backgroundColor: colors.scrim }]} onPress={resetForm}>
          <Pressable
            style={[
              styles.modalSheet,
              { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: spacing.xl + insets.bottom },
            ]}
            onPress={(event) => event.stopPropagation()}
          >
            <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.modalHeader}>
                <AppText variant="title" style={styles.modalTitle} accessibilityRole="header">
                  {editing ? 'Edit recurring transaction' : 'New recurring transaction'}
                </AppText>
                <Pressable onPress={resetForm} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                  <Ionicons name="close" size={22} color={colors.textMuted} />
                </Pressable>
              </View>

              <SegmentedControl
                options={TYPE_OPTIONS}
                value={type}
                onChange={(next) => {
                  setType(next);
                  setCategory('');
                }}
              />

              <View style={styles.amountRow}>
                <FormInput
                  style={styles.amountInput}
                  value={amount}
                  onChangeText={setAmount}
                  placeholder="Amount"
                  keyboardType="decimal-pad"
                  accessibilityLabel="Amount"
                  invalid={amountInvalid}
                />
                <CurrencyPicker value={currency} onChange={setCurrency} />
              </View>

              <AppText style={label}>Category</AppText>
              <Pressable
                style={[styles.dropdown, { backgroundColor: colors.bg, borderColor: colors.inputBorder }]}
                onPress={() => setIsCategoryOpen((value) => !value)}
                accessibilityRole="button"
                accessibilityLabel={`Category, ${category || 'not chosen'}`}
                accessibilityState={{ expanded: isCategoryOpen }}
              >
                <AppText style={[styles.dropdownText, { color: category ? colors.text : colors.textMuted }]} numberOfLines={1}>
                  {category || 'Choose a category'}
                </AppText>
                <Ionicons name={isCategoryOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
              </Pressable>
              {isCategoryOpen && (
                <View style={[styles.categoryOptions, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                  {categoryOptions.map((item) => (
                    <Pressable
                      key={item.id}
                      style={({ pressed }) => [
                        styles.categoryOption,
                        { borderBottomColor: colors.border },
                        pressed && { backgroundColor: colors.surfaceMuted },
                      ]}
                      onPress={() => {
                        setCategory(item.name);
                        setIsCategoryOpen(false);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: category === item.name }}
                    >
                      <AppText style={[styles.dropdownText, { color: colors.text }, category === item.name && styles.optionSelected]}>
                        {item.icon} {item.name}
                      </AppText>
                      {category === item.name ? <Ionicons name="checkmark" size={18} color={colors.primaryText} /> : null}
                    </Pressable>
                  ))}
                </View>
              )}

              <FormInput value={source} onChangeText={setSource} placeholder="Source / place" accessibilityLabel="Source or place" />

              <AppText style={label}>{type === 'income' ? 'Into' : 'Pay from'}</AppText>
              <SegmentedControl options={ACCOUNT_OPTIONS} value={account} onChange={setAccount} />

              <AppText style={label}>Frequency</AppText>
              <SegmentedControl options={FREQUENCY_OPTIONS} value={frequency} onChange={setFrequency} />
              {canEditDate ? (
                <DateField label="Start date" value={startDate} onChange={setStartDate} />
              ) : (
                <AppText style={label}>
                  Next: {editing ? getNextDueDate(editing).toLocaleDateString() : ''} · changes apply to future entries only.
                </AppText>
              )}

              <View style={styles.switchRow}>
                <AppText style={[styles.switchLabel, { color: colors.text }]}>Active</AppText>
                <Switch
                  value={isActive}
                  onValueChange={setIsActive}
                  trackColor={{ false: colors.inputBorder, true: colors.primary }}
                  thumbColor={isActive ? colors.onPrimary : colors.surface}
                  accessibilityLabel="Active"
                />
              </View>

              {error ? <InlineError message={error} /> : null}

              <Button title={editing ? 'Save changes' : 'Create recurring transaction'} variant="primary" onPress={() => void onSave()} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </OverlayModal>
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
  topText: {
    gap: 2,
  },
  pageTitle: {
    fontSize: 18,
  },
  pageSubtitle: {
    fontSize: 13,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
  },
  emptyState: {
    fontSize: 13,
    lineHeight: 18,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    padding: spacing.xl,
    maxHeight: '90%',
  },
  sheetContent: {
    gap: spacing.md,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  amountInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 22,
    fontWeight: '800',
  },
  dropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  dropdownText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  optionSelected: {
    fontWeight: '800',
  },
  categoryOptions: {
    borderWidth: 1,
    borderRadius: radius.button,
    overflow: 'hidden',
  },
  categoryOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 16,
  },
  ruleInfo: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  ruleTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  ruleCategory: {
    flex: 1,
    minWidth: 0,
    fontWeight: '700',
    fontSize: 15,
  },
  ruleAmount: {
    flexShrink: 1,
    fontWeight: '800',
    fontSize: 14,
  },
  ruleMeta: {
    fontSize: 13,
  },
  deleteButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Wraps instead of shoving the close icon out of the sheet at large font sizes.
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  modalTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 17,
  },
});
