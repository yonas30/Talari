import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import AppButton from '../components/AppButton';
import AppHeader from '../components/AppHeader';
import CurrencyPicker from '../components/CurrencyPicker';
import DateField from '../components/DateField';
import { defaultCategories } from '../constants/categories';
import { colors, radius, spacing, typography } from '../constants/theme';
import { useFinanceStore } from '../store/finance';
import { CurrencyCode, RecurringFrequency, TransactionType } from '../types';

function getFrequencyLabel(freq: RecurringFrequency): string {
  return freq === 'daily' ? 'Every day' : freq === 'weekly' ? 'Every week' : 'Every month';
}

function getNextOccurrenceDate(startDate: string, frequency: RecurringFrequency): Date {
  const start = new Date(`${startDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (start > today) {
    return start;
  }

  const next = new Date(start);
  if (frequency === 'daily') {
    while (next <= today) {
      next.setDate(next.getDate() + 1);
    }
  } else if (frequency === 'weekly') {
    while (next <= today) {
      next.setDate(next.getDate() + 7);
    }
  } else {
    while (next <= today) {
      next.setMonth(next.getMonth() + 1);
    }
  }

  return next;
}

export default function RecurringScreen() {
  const { recurringTransactions, categories, addRecurringTransaction, toggleRecurringTransaction, deleteRecurringTransaction } =
    useFinanceStore();

  const [type, setType] = useState<TransactionType>('expense');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('ETB');
  const [category, setCategory] = useState('');
  const [source, setSource] = useState('');
  const [frequency, setFrequency] = useState<RecurringFrequency>('monthly');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);

  const resetForm = () => {
    setType('expense');
    setAmount('');
    setCurrency('ETB');
    setCategory('');
    setSource('');
    setFrequency('monthly');
    setStartDate(new Date().toISOString().slice(0, 10));
    setIsFormOpen(false);
  };

  const categoryLookup = useMemo(
    () => Object.fromEntries((categories.length > 0 ? categories : defaultCategories).map((item) => [item.name, item])),
    [categories],
  );

  const categoryOptions = useMemo(() => {
    const items = categories.length > 0 ? categories : defaultCategories;
    return items.filter((item) => item.type === type || item.type === 'savings');
  }, [categories, type]);

  const onCreate = async () => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || !category) {
      Alert.alert('Enter a valid amount and choose a category.');
      return;
    }

    await addRecurringTransaction({
      type,
      amount: numericAmount,
      currency,
      category,
      source: source.trim() || 'Recurring',
      frequency,
      startDate,
    });

    resetForm();
  };

  return (
    <View style={styles.screen}>
      <AppHeader title="Recurring" />
      <View style={styles.topBar}>
        <View>
          <Text style={styles.pageTitle}>Recurring transactions</Text>
          <Text style={styles.pageSubtitle}>Automate the entries you make regularly.</Text>
        </View>
        <Pressable style={styles.addButton} onPress={() => setIsFormOpen(true)}>
          <Ionicons name="add" size={24} color="#FFFFFF" />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.container}>
        {recurringTransactions.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.emptyState}>No recurring transactions yet — tap + to set up automated tracking.</Text>
          </View>
        ) : (
          recurringTransactions.map((rule) => {
            const categoryMeta = categoryLookup[rule.category] ?? { icon: '💰', color: colors.orange };
            const nextDate = getNextOccurrenceDate(rule.startDate, rule.frequency);
            return (
              <View key={rule.id} style={styles.ruleCard}>
                <View style={styles.ruleHeader}>
                  <View style={[styles.iconBadge, { backgroundColor: `${categoryMeta.color}1A` }]}>
                    <Text style={styles.iconText}>{categoryMeta.icon}</Text>
                  </View>
                  <View style={styles.ruleInfo}>
                    <Text style={styles.ruleCategory}>{rule.category}</Text>
                    <Text style={styles.ruleSource}>{rule.source}</Text>
                  </View>
                  <Pressable
                    onPress={() => void toggleRecurringTransaction(rule.id, !rule.isActive)}
                    style={styles.toggleContainer}
                  >
                    <View style={[styles.toggle, rule.isActive && styles.toggleActive]}>
                      <View style={[styles.toggleCircle, rule.isActive && styles.toggleCircleActive]} />
                    </View>
                  </Pressable>
                </View>

                <View style={styles.ruleDetails}>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Amount</Text>
                    <Text style={styles.detailValue}>
                      {rule.currency} {rule.amount.toFixed(2)}
                    </Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Frequency</Text>
                    <Text style={styles.detailValue}>{getFrequencyLabel(rule.frequency)}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Next</Text>
                    <Text style={styles.detailValue}>{nextDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text>
                  </View>
                </View>

                <View style={styles.actionRow}>
                  <AppButton title="Delete" variant="danger" onPress={() => void deleteRecurringTransaction(rule.id)} />
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      <Modal visible={isFormOpen} transparent animationType="slide" onRequestClose={() => setIsFormOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setIsFormOpen(false)}>
          <Pressable style={styles.modalSheet} onPress={(event) => event.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={styles.sectionTitle}>New recurring transaction</Text>
              <Pressable onPress={() => setIsFormOpen(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </Pressable>
            </View>

            <View style={styles.segmented}>
              {(['income', 'expense', 'savings'] as const).map((option) => (
                <AppButton
                  key={option}
                  title={option === 'savings' ? 'saving' : option}
                  selected={type === option}
                  onPress={() => {
                    setType(option);
                    setCategory('');
                  }}
                />
              ))}
            </View>

            <View style={styles.amountRow}>
              <TextInput style={styles.amountInput} value={amount} onChangeText={setAmount} placeholder="Amount" keyboardType="decimal-pad" />
              <CurrencyPicker value={currency} onChange={setCurrency} />
            </View>

            <Text style={styles.label}>Category</Text>
            <Pressable style={styles.dropdown} onPress={() => setIsCategoryOpen((value) => !value)}>
              <Text style={styles.dropdownText}>{category || 'Choose a category'}</Text>
              <Ionicons name={isCategoryOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
            </Pressable>
            {isCategoryOpen && (
              <View style={styles.categoryOptions}>
                {categoryOptions.map((item) => (
                  <Pressable key={item.id} style={styles.categoryOption} onPress={() => { setCategory(item.name); setIsCategoryOpen(false); }}>
                    <Text style={styles.dropdownText}>{item.icon} {item.name}</Text>
                  </Pressable>
                ))}
              </View>
            )}

            <TextInput style={styles.input} value={source} onChangeText={setSource} placeholder="Source / place" />
            <Text style={styles.label}>Frequency</Text>
            <View style={styles.segmented}>
              {(['daily', 'weekly', 'monthly'] as const).map((option) => (
                <AppButton key={option} title={option} selected={frequency === option} onPress={() => setFrequency(option)} />
              ))}
            </View>
            <DateField label="Start date" value={startDate} onChange={setStartDate} />
            <AppButton title="Create recurring transaction" variant="primary" onPress={() => void onCreate()} />
          </Pressable>
        </Pressable>
      </Modal>
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
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
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
  ruleCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  ruleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 18,
  },
  ruleInfo: {
    flex: 1,
    gap: 2,
  },
  ruleCategory: {
    fontWeight: '700',
    color: colors.navy,
    fontSize: 15,
  },
  ruleSource: {
    ...typography.helper,
    color: colors.textSecondary,
  },
  toggleContainer: {
    padding: 8,
  },
  toggle: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E2E8F0',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleActive: {
    backgroundColor: colors.olive,
  },
  toggleCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  toggleCircleActive: {
    alignSelf: 'flex-end',
  },
  ruleDetails: {
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.background,
    paddingTop: spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    ...typography.helper,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  detailValue: {
    fontWeight: '700',
    color: colors.navy,
    fontSize: 14,
  },
  actionRow: {
    marginTop: spacing.sm,
  },
  emptyState: {
    ...typography.helper,
    color: colors.textSecondary,
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
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
