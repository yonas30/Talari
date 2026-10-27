import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import AppHeader from '../components/AppHeader';
import AppText from '../components/AppText';
import Button from '../components/Button';
import FormInput from '../components/FormInput';
import InlineError from '../components/InlineError';
import SegmentedControl, { SegmentOption } from '../components/SegmentedControl';
import SheetModal from '../components/SheetModal';
import { isProtectedCategory } from '../constants/categories';
import { radius, spacing } from '../constants/theme';
import { useFinanceStore } from '../store/finance';
import { useTheme } from '../theme/ThemeProvider';
import { storedCategoryColors } from '../theme/tokens';
import { Category, CategoryType } from '../types';
import { CATEGORY_EMOJI_CHOICES, suggestCategoryEmoji } from '../utils/categoryIcons';
import { CONTROL_LABEL_MAX_SCALE } from '../utils/layout';

type EditableType = 'income' | 'expense';

const SECTION_TITLES: Record<CategoryType, string> = {
  income: 'Income',
  expense: 'Expense',
  savings: 'Savings (not used by transactions)',
};

const TYPE_OPTIONS: SegmentOption<EditableType>[] = [
  { key: 'expense', label: 'Expense' },
  { key: 'income', label: 'Income' },
];

function colorForType(type: CategoryType): string {
  return type === 'income' ? storedCategoryColors.income : type === 'savings' ? storedCategoryColors.savings : storedCategoryColors.expense;
}

export default function CategoriesScreen() {
  const { colors } = useTheme();
  const { categories, transactions, budgets, addCategory, updateCategory, deleteCategory } = useFinanceStore();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<EditableType>('expense');
  const [icon, setIcon] = useState('✨');
  // Once the user picks an icon themselves, typing in the name no longer overrides it.
  const [iconChosen, setIconChosen] = useState(false);
  // A validation message shown inside the sheet (it used to be a native alert).
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setName('');
    setType('expense');
    setIcon('✨');
    setIconChosen(false);
    setEditingId(null);
    setError(null);
  };

  const openCreateModal = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEditModal = (category: Category) => {
    setEditingId(category.id);
    setName(category.name);
    // V2 transactions are income or expense only; a legacy savings category must be re-typed to be usable.
    setType(category.type === 'income' ? 'income' : 'expense');
    setIcon(category.icon);
    setIconChosen(true);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    resetForm();
  };

  const onNameChange = (text: string) => {
    setName(text);
    setError(null);
    if (!iconChosen) {
      setIcon(suggestCategoryEmoji(text));
    }
  };

  const onSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Category name is required');
      return;
    }

    // Transactions and budgets refer to a category by name, so two with the same name and type would be
    // indistinguishable.
    const duplicate = categories.some(
      (item) => item.id !== editingId && item.type === type && item.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (duplicate) {
      setError(`You already have a ${type} category called "${trimmed}".`);
      return;
    }

    const input = { name: trimmed, type, icon, color: colorForType(type) };
    if (editingId) {
      await updateCategory(editingId, input);
    } else {
      await addCategory(input);
    }
    closeModal();
  };

  const usageCount = (category: Category): number => {
    const ledger = transactions.filter((item) => item.category === category.name && item.type === category.type).length;
    const budgeted = category.type === 'expense' ? budgets.filter((item) => item.category === category.name).length : 0;
    return ledger + budgeted;
  };

  const onDelete = (category: Category) => {
    const used = usageCount(category);
    Alert.alert(
      'Delete category',
      used > 0
        ? `"${category.name}" is used by ${used} transaction${used === 1 ? '' : 's'} or budget${used === 1 ? '' : 's'}. They keep the name, but it will no longer appear in the category lists.`
        : `Delete "${category.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void deleteCategory(category.id) },
      ],
    );
  };

  const grouped = useMemo(
    () => ({
      income: categories.filter((item) => item.type === 'income'),
      expense: categories.filter((item) => item.type === 'expense'),
      savings: categories.filter((item) => item.type === 'savings'),
    }),
    [categories],
  );

  // Legacy savings categories are only listed while some still exist, so they can be re-typed or deleted.
  const sections: CategoryType[] = grouped.savings.length > 0 ? ['income', 'expense', 'savings'] : ['income', 'expense'];

  const discFor = (itemType: CategoryType) => (itemType === 'income' ? colors.incomeDisc : itemType === 'savings' ? colors.netDisc : colors.expenseDisc);

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader title="Categories" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <AppText variant="heading" style={styles.pageTitle}>
          Manage categories
        </AppText>
        <Button title="New category" icon="add" onPress={openCreateModal} accessibilityLabel="New category" />

        {sections.map((section) => (
          <View key={section} style={styles.group}>
            <AppText style={[styles.groupTitle, { color: colors.textMuted }]} accessibilityRole="header">
              {SECTION_TITLES[section]}
            </AppText>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {grouped[section].length === 0 ? (
                <AppText style={[styles.emptyState, { color: colors.textMuted }]}>No {section} categories yet — tap + to add one.</AppText>
              ) : (
                grouped[section].map((item, index) => {
                  const used = usageCount(item);
                  return (
                    <View
                      key={item.id}
                      style={[styles.categoryRow, index < grouped[section].length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
                    >
                      <View style={[styles.iconCircle, { backgroundColor: discFor(item.type) }]}>
                        <AppText style={styles.iconText} maxFontSizeMultiplier={CONTROL_LABEL_MAX_SCALE}>{item.icon}</AppText>
                      </View>
                      <View style={styles.categoryText}>
                        <AppText style={[styles.categoryName, { color: colors.text }]} numberOfLines={1}>
                          {item.name}
                        </AppText>
                        {used > 0 && <AppText style={[styles.usage, { color: colors.textMuted }]}>{used} in use</AppText>}
                      </View>
                      {isProtectedCategory(item) ? (
                        <AppText style={[styles.usage, { color: colors.textMuted }]}>Built in</AppText>
                      ) : (
                        <>
                          <Pressable
                            onPress={() => openEditModal(item)}
                            style={({ pressed }) => [styles.rowButton, pressed && { backgroundColor: colors.surfaceMuted }]}
                            accessibilityRole="button"
                            accessibilityLabel={`Edit ${item.name}`}
                          >
                            <Ionicons name="pencil-outline" size={18} color={colors.text} />
                          </Pressable>
                          <Pressable
                            onPress={() => onDelete(item)}
                            style={({ pressed }) => [styles.rowButton, pressed && { backgroundColor: colors.surfaceMuted }]}
                            accessibilityRole="button"
                            accessibilityLabel={`Delete ${item.name}`}
                          >
                            <Ionicons name="trash-outline" size={18} color={colors.expense} />
                          </Pressable>
                        </>
                      )}
                    </View>
                  );
                })
              )}
            </View>
          </View>
        ))}
      </ScrollView>

      <SheetModal visible={isModalOpen} onClose={closeModal}>
        <AppText variant="title" style={styles.sheetTitle} accessibilityRole="header">
          {editingId ? 'Edit category' : 'New category'}
        </AppText>
        <FormInput
          value={name}
          onChangeText={onNameChange}
          placeholder="Category name"
          accessibilityLabel="Category name"
          invalid={error !== null}
        />

        <SegmentedControl
          options={TYPE_OPTIONS}
          value={type}
          onChange={(next) => {
            setType(next);
            setError(null);
          }}
        />

        <View style={styles.iconSection}>
          <AppText style={[styles.label, { color: colors.textMuted }]}>Icon {iconChosen ? '' : '· suggested from the name'}</AppText>
          <View style={styles.iconGrid}>
            {CATEGORY_EMOJI_CHOICES.map((emoji) => {
              const selected = icon === emoji;
              return (
                <Pressable
                  key={emoji}
                  // Selected: the pale orange disc, a heavier dark edge AND a check mark - not colour alone.
                  style={[
                    styles.iconOption,
                    { backgroundColor: selected ? colors.accentDisc : colors.bg, borderColor: selected ? colors.text : colors.border },
                    selected && styles.iconOptionSelected,
                  ]}
                  onPress={() => {
                    setIcon(emoji);
                    setIconChosen(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Icon ${emoji}`}
                  accessibilityState={{ selected }}
                >
                  <AppText style={styles.iconOptionEmoji} maxFontSizeMultiplier={CONTROL_LABEL_MAX_SCALE}>{emoji}</AppText>
                  {selected ? (
                    <View style={[styles.checkBadge, { backgroundColor: colors.text }]}>
                      <Ionicons name="checkmark" size={10} color={colors.surface} />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>

        {error ? <InlineError message={error} /> : null}

        <Button title={editingId ? 'Save changes' : 'Create category'} variant="primary" onPress={() => void onSave()} />
      </SheetModal>
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
  pageTitle: {
    fontSize: 18,
  },
  group: {
    gap: 8,
  },
  groupTitle: {
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 4,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 16,
  },
  categoryText: {
    flex: 1,
    minWidth: 0,
  },
  categoryName: {
    fontWeight: '600',
    fontSize: 15,
  },
  usage: {
    fontSize: 13,
  },
  rowButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    fontSize: 13,
    lineHeight: 18,
    padding: 14,
  },
  sheetTitle: {
    fontSize: 17,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
  },
  iconSection: {
    gap: spacing.sm,
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  iconOption: {
    width: '14%',
    aspectRatio: 1,
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  iconOptionSelected: {
    borderWidth: 2,
  },
  iconOptionEmoji: {
    fontSize: 20,
  },
  checkBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
