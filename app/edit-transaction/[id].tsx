import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import AppButton from '../../components/AppButton';
import AppHeader from '../../components/AppHeader';
import CurrencyPicker from '../../components/CurrencyPicker';
import DateField from '../../components/DateField';
import { defaultCategories } from '../../constants/categories';
import { colors, radius, spacing, typography } from '../../constants/theme';
import { useFinanceStore } from '../../store/finance';
import { CurrencyCode } from '../../types';
import { alertLedgerError } from '../../utils/alerts';
import { todayKey } from '../../utils/dates';

// Editing a Transfer (From/To) arrives with the Step 3 form work; for now a transfer can be deleted.
type EntryType = 'income' | 'expense';

interface CategoryPickerProps {
  value: string;
  options: Array<{ id: string; name: string; icon: string }>;
  onChange: (value: string) => void;
}

function CategoryPicker({ value, options, onChange }: CategoryPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find((item) => item.name === value);

  return (
    <>
      <Pressable style={styles.dropdown} onPress={() => setIsOpen(true)}>
        <Text style={styles.dropdownText}>{selected ? `${selected.icon} ${selected.name}` : 'Choose a category'}</Text>
        <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
      </Pressable>
      <Modal visible={isOpen} transparent animationType="fade" onRequestClose={() => setIsOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setIsOpen(false)}>
          <View style={styles.optionSheet}>
            {options.map((item) => (
              <Pressable
                key={item.id}
                style={styles.optionRow}
                onPress={() => {
                  onChange(item.name);
                  setIsOpen(false);
                }}
              >
                <Text style={[styles.optionText, item.name === value && styles.optionTextSelected]}>
                  {item.icon} {item.name}
                </Text>
                {item.name === value && <Ionicons name="checkmark" size={18} color={colors.orange} />}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

export default function EditTransactionScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const transactions = useFinanceStore((state) => state.transactions);
  const categories = useFinanceStore((state) => state.categories);
  const updateTransaction = useFinanceStore((state) => state.updateTransaction);
  const deleteTransaction = useFinanceStore((state) => state.deleteTransaction);

  const original = transactions.find((item) => item.id === id);

  const [type, setType] = useState<EntryType>(original?.type === 'income' ? 'income' : 'expense');
  const [amount, setAmount] = useState(String(original?.amount ?? '0'));
  const [currency, setCurrency] = useState<CurrencyCode>(original?.currency ?? 'ETB');
  const [category, setCategory] = useState(original?.category ?? '');
  const [source, setSource] = useState(original?.source ?? '');
  const [note, setNote] = useState(original?.note ?? '');
  const [date, setDate] = useState(original?.date ?? todayKey());

  const categoryOptions = useMemo(() => {
    const items = categories.length > 0 ? categories : defaultCategories;
    return items.filter((item) => item.type === type);
  }, [categories, type]);

  if (!original) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Transaction not found</Text>
      </View>
    );
  }

  const isTransfer = original.type === 'transfer';

  const onSave = async () => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      Alert.alert('Enter a valid amount.');
      return;
    }

    try {
      await updateTransaction(original.id, {
        type,
        amount: numericAmount,
        currency,
        category: category || original.category,
        source: source.trim() || 'Manual entry',
        account: original.account ?? 'available',
        date,
        note: note.trim() || null,
      });
    } catch (error) {
      alertLedgerError(error);
      return;
    }

    router.back();
  };

  const onDelete = () => {
    Alert.alert('Delete transaction', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteTransaction(original.id);
          } catch (error) {
            alertLedgerError(error);
            return;
          }
          router.back();
        },
      },
    ]);
  };

  return (
    <View style={styles.screen}>
      <AppHeader title="Edit transaction" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <Text style={styles.label}>Transaction type</Text>
          <View style={styles.typeSegmented}>
            {(['income', 'expense'] as const).map((option) => (
              <Pressable
                key={option}
                style={[styles.typeSegment, type === option && styles.typeSegmentSelected]}
                onPress={() => setType(option)}
              >
                <Text style={[styles.typeSegmentText, type === option && styles.typeSegmentTextSelected]}>
                  {option[0].toUpperCase() + option.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Amount</Text>
          <View style={styles.amountRow}>
            <TextInput style={styles.amountInput} value={amount} onChangeText={setAmount} placeholder="0" keyboardType="decimal-pad" />
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
          <Text style={styles.label}>Where / Source</Text>
          <TextInput style={styles.input} value={source} onChangeText={setSource} placeholder="Source / place" />
          <Text style={styles.label}>Note</Text>
          <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="Add a note" />
        </View>

        <View style={styles.actions}>
          {isTransfer ? (
            <Text style={styles.label}>Transfers can't be edited yet — delete it and add a new one.</Text>
          ) : (
            <AppButton title="Save changes" variant="primary" style={styles.mutedAction} onPress={() => void onSave()} />
          )}
          <AppButton title="Delete transaction" variant="danger" style={styles.mutedAction} onPress={onDelete} />
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
  title: {
    ...typography.sectionTitle,
    color: colors.navy,
    padding: spacing.xl,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  label: {
    ...typography.helper,
    color: colors.textSecondary,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  typeSegmented: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderRadius: radius.button,
    padding: spacing.xs,
  },
  typeSegment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.button - 2,
  },
  typeSegmentSelected: {
    backgroundColor: colors.orange,
  },
  typeSegmentText: {
    color: colors.navy,
    fontWeight: '700',
  },
  typeSegmentTextSelected: {
    color: '#FFFFFF',
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
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(23, 32, 51, 0.4)',
    justifyContent: 'flex-end',
  },
  optionSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.background,
  },
  optionText: {
    color: colors.navy,
    fontSize: 16,
    fontWeight: '600',
  },
  optionTextSelected: {
    color: colors.orange,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: radius.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.navy,
    fontSize: 15,
  },
  actions: {
    gap: spacing.sm,
  },
  mutedAction: {
    opacity: 0.65,
  },
});
