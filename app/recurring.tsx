import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppButton from '../components/AppButton';
import AppHeader from '../components/AppHeader';
import CurrencyPicker from '../components/CurrencyPicker';
import OverlayModal from '../components/OverlayModal';
import DateField from '../components/DateField';
import SegmentedTabs from '../components/SegmentedTabs';
import { defaultCategories } from '../constants/categories';
import { colors, radius, spacing, typography } from '../constants/theme';
import { useFinanceStore } from '../store/finance';
import { Account, CurrencyCode, RecurringFrequency, RecurringTransaction, RecurringType } from '../types';
import { todayKey } from '../utils/dates';
import { CONTROL_LABEL_MAX_SCALE } from '../utils/layout';
import { getNextDueDate } from '../utils/recurring';
import AppText from '../components/AppText';
import AppTextInput from '../components/AppTextInput';

function getFrequencyLabel(freq: RecurringFrequency): string {
  return freq === 'daily' ? 'Every day' : freq === 'weekly' ? 'Every week' : 'Every month';
}

export default function RecurringScreen() {
  const insets = useSafeAreaInsets();
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
      Alert.alert('Enter a valid amount and choose a category.');
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

  return (
    <View style={styles.screen}>
      <AppHeader title="Recurring" />
      <View style={styles.topBar}>
        <View style={styles.topBarText}>
          <AppText style={styles.pageTitle}>Recurring transactions</AppText>
          <AppText style={styles.pageSubtitle}>Automate the entries you make regularly.</AppText>
        </View>
        <Pressable
          style={styles.addButton}
          onPress={() => {
            resetForm();
            setIsFormOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Add a recurring transaction"
        >
          <Ionicons name="add" size={24} color="#FFFFFF" />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.container}>
        <SegmentedTabs
          tabs={[
            { key: 'upcoming', label: `Upcoming (${upcomingCount})` },
            { key: 'all', label: `All (${rules.length})` },
          ]}
          value={tab}
          onChange={setTab}
        />

        {visibleRules.length === 0 ? (
          <View style={styles.card}>
            <AppText style={styles.emptyState}>
              {rules.length === 0
                ? 'No recurring transactions yet — tap + to set up automated tracking.'
                : 'Nothing is scheduled. Switch a rule back on from the All tab.'}
            </AppText>
          </View>
        ) : (
          visibleRules.map(({ rule, nextDate }) => {
            const categoryMeta = categoryLookup[rule.category] ?? { icon: '💰', color: colors.orange };
            const isExpense = rule.type === 'expense';
            return (
              // One compact row: icon, category + amount on the first line, frequency + next date on the second,
              // then the Active toggle and delete. Tapping the row edits the rule.
              <Pressable
                key={rule.id}
                style={({ pressed }) => [styles.ruleRow, !rule.isActive && styles.ruleRowPaused, pressed && styles.ruleRowPressed]}
                onPress={() => openEdit(rule)}
                accessibilityRole="button"
                accessibilityLabel={`${rule.category}, tap to edit`}
              >
                <View style={[styles.iconBadge, { backgroundColor: `${categoryMeta.color}1A` }]}>
                  <AppText style={styles.iconText} maxFontSizeMultiplier={CONTROL_LABEL_MAX_SCALE}>{categoryMeta.icon}</AppText>
                </View>
                <View style={styles.ruleInfo}>
                  <View style={styles.ruleTopLine}>
                    <AppText style={styles.ruleCategory} numberOfLines={1}>
                      {rule.category}
                    </AppText>
                    <AppText
                      style={[styles.ruleAmount, { color: isExpense ? colors.statusExpense : colors.statusIncome }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.8}
                    >
                      {isExpense ? '-' : '+'}
                      {rule.currency} {rule.amount.toFixed(2)}
                    </AppText>
                  </View>
                  <AppText style={styles.ruleMeta} numberOfLines={1}>
                    {getFrequencyLabel(rule.frequency)} ·{' '}
                    {rule.isActive
                      ? `Next: ${nextDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                      : 'Paused'}
                  </AppText>
                </View>
                <Pressable
                  onPress={() => void toggleRecurringTransaction(rule.id, !rule.isActive)}
                  style={styles.toggleContainer}
                  hitSlop={8}
                  accessibilityRole="switch"
                  accessibilityLabel={`${rule.category} active`}
                  accessibilityState={{ checked: rule.isActive }}
                >
                  <View style={[styles.toggle, rule.isActive && styles.toggleActive]}>
                    <View style={[styles.toggleCircle, rule.isActive && styles.toggleCircleActive]} />
                  </View>
                </Pressable>
                <Pressable
                  onPress={() => confirmDelete(rule)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${rule.category}`}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.red} />
                </Pressable>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {/*
        This sheet deliberately uses its own plain Modal, not the shared keyboard-aware SheetModal: with SheetModal the
        Amount field stopped accepting input on Android. Known limitation: the keyboard can cover the lower fields.
      */}
      <OverlayModal visible={isFormOpen} animationType="slide" onRequestClose={resetForm}>
        <Pressable style={styles.modalBackdrop} onPress={resetForm}>
          <Pressable
            style={[styles.modalSheet, { paddingBottom: spacing.xl + insets.bottom }]}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.modalHeader}>
              <AppText style={[styles.sectionTitle, styles.modalTitle]}>{editing ? 'Edit recurring transaction' : 'New recurring transaction'}</AppText>
              <Pressable onPress={resetForm}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </Pressable>
            </View>

            <View style={styles.segmented}>
              {(['income', 'expense'] as const).map((option) => (
            <AppButton
              key={option}
              title={option}
              selected={type === option}
              onPress={() => {
                setType(option);
                setCategory('');
              }}
            />
          ))}
        </View>

        <View style={styles.amountRow}>
          <AppTextInput style={styles.amountInput} value={amount} onChangeText={setAmount} placeholder="Amount" keyboardType="decimal-pad" />
          <CurrencyPicker value={currency} onChange={setCurrency} />
        </View>

        <AppText style={styles.label}>Category</AppText>
        <Pressable style={styles.dropdown} onPress={() => setIsCategoryOpen((value) => !value)}>
          <AppText style={styles.dropdownText}>{category || 'Choose a category'}</AppText>
          <Ionicons name={isCategoryOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
        </Pressable>
        {isCategoryOpen && (
          <View style={styles.categoryOptions}>
            {categoryOptions.map((item) => (
              <Pressable key={item.id} style={styles.categoryOption} onPress={() => { setCategory(item.name); setIsCategoryOpen(false); }}>
                <AppText style={styles.dropdownText}>{item.icon} {item.name}</AppText>
              </Pressable>
            ))}
          </View>
        )}

        <AppTextInput style={styles.input} value={source} onChangeText={setSource} placeholder="Source / place" />

        <AppText style={styles.label}>{type === 'income' ? 'Into' : 'Pay from'}</AppText>
        <View style={styles.segmented}>
          {(['available', 'saved'] as const).map((option) => (
            <AppButton
              key={option}
              title={option === 'available' ? 'Available' : 'Saved'}
              selected={account === option}
              onPress={() => setAccount(option)}
            />
          ))}
        </View>

        <AppText style={styles.label}>Frequency</AppText>
        <View style={styles.segmented}>
          {(['daily', 'weekly', 'monthly'] as const).map((option) => (
            <AppButton key={option} title={option} selected={frequency === option} onPress={() => setFrequency(option)} />
          ))}
        </View>
        {canEditDate ? (
          <DateField label="Start date" value={startDate} onChange={setStartDate} />
        ) : (
          <AppText style={styles.label}>
            Next: {editing ? getNextDueDate(editing).toLocaleDateString() : ''} · changes apply to future entries only.
          </AppText>
        )}

        <View style={styles.switchRow}>
          <AppText style={styles.label}>Active</AppText>
          <Switch
            value={isActive}
            onValueChange={setIsActive}
            trackColor={{ false: '#D9DCE4', true: colors.statusIncome }}
            thumbColor="#FFFFFF"
            accessibilityLabel="Active"
          />
        </View>

            <AppButton
              title={editing ? 'Save changes' : 'Create recurring transaction'}
              variant="primary"
              onPress={() => void onSave()}
            />
          </Pressable>
        </Pressable>
      </OverlayModal>
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  // Takes the width the + button leaves and wraps. Without flex: 1 the title keeps its full natural width at large
  // font sizes and shoves the button past the screen edge.
  topBarText: {
    flex: 1,
    minWidth: 0,
  },
  pageTitle: {
    ...typography.sectionTitle,
    color: colors.navy,
  },
  pageSubtitle: {
    ...typography.helper,
    color: colors.textSecondary,
    marginTop: 2,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.navy,
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
  label: {
    ...typography.helper,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(23, 32, 51, 0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    padding: spacing.xl,
    gap: spacing.md,
    maxHeight: '90%',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  segmented: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
    flexWrap: 'wrap',
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: '#E2E5DE',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.navy,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  amountInput: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radius.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 24,
    fontWeight: '800',
    color: colors.navy,
  },
  dropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  dropdownText: {
    color: colors.navy,
    fontSize: 15,
    fontWeight: '600',
  },
  categoryOptions: {
    backgroundColor: colors.background,
    borderRadius: radius.button,
    overflow: 'hidden',
  },
  categoryOption: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.button,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  ruleRowPaused: {
    opacity: 0.6,
  },
  ruleRowPressed: {
    opacity: 0.8,
  },
  iconBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 16,
  },
  ruleInfo: {
    flex: 1,
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
    fontWeight: '700',
    color: colors.navy,
    fontSize: 15,
  },
  ruleAmount: {
    flexShrink: 0,
    fontWeight: '800',
    fontSize: 14,
  },
  ruleMeta: {
    ...typography.helper,
    color: colors.textSecondary,
  },
  toggleContainer: {
    padding: 2,
  },
  toggle: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#E2E8F0',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleActive: {
    backgroundColor: colors.olive,
  },
  toggleCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
  },
  toggleCircleActive: {
    alignSelf: 'flex-end',
  },
  emptyState: {
    ...typography.helper,
    color: colors.textSecondary,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  // Wraps instead of shoving the close icon out of the sheet at large font sizes.
  modalTitle: {
    flex: 1,
    minWidth: 0,
  },
});
