import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import AppButton from '../components/AppButton';
import AppHeader from '../components/AppHeader';
import SheetModal from '../components/SheetModal';
import { colors, radius, spacing, typography } from '../constants/theme';
import { useFinanceStore } from '../store/finance';
import { Category, CategoryType } from '../types';
import { CATEGORY_EMOJI_CHOICES, suggestCategoryEmoji } from '../utils/categoryIcons';
import { CONTROL_LABEL_MAX_SCALE } from '../utils/layout';

type EditableType = 'income' | 'expense';

const SECTION_TITLES: Record<CategoryType, string> = {
  income: 'Income',
  expense: 'Expense',
  savings: 'Savings (not used by transactions)',
};

function colorForType(type: CategoryType): string {
  return type === 'income' ? colors.olive : type === 'savings' ? colors.blue : colors.orange;
}

export default function CategoriesScreen() {
  const { categories, transactions, budgets, addCategory, updateCategory, deleteCategory } = useFinanceStore();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<EditableType>('expense');
  const [icon, setIcon] = useState('✨');
  // Once the user picks an icon themselves, typing in the name no longer overrides it.
  const [iconChosen, setIconChosen] = useState(false);

  const resetForm = () => {
    setName('');
    setType('expense');
    setIcon('✨');
    setIconChosen(false);
    setEditingId(null);
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
    if (!iconChosen) {
      setIcon(suggestCategoryEmoji(text));
    }
  };

  const onSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Category name is required');
      return;
    }

    // Transactions and budgets refer to a category by name, so two with the same name and type would be
    // indistinguishable.
    const duplicate = categories.some(
      (item) => item.id !== editingId && item.type === type && item.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (duplicate) {
      Alert.alert('Already exists', `You already have a ${type} category called "${trimmed}".`);
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

  return (
    <View style={styles.screen}>
      <AppHeader title="Categories" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Text style={[styles.sectionTitle, styles.headerTitle]}>Manage categories</Text>
          <Pressable style={styles.addButton} onPress={openCreateModal} accessibilityRole="button" accessibilityLabel="New category">
            <Ionicons name="add" size={22} color="#FFFFFF" />
          </Pressable>
        </View>

        {sections.map((section) => (
          <View key={section} style={styles.card}>
            <Text style={styles.groupTitle}>{SECTION_TITLES[section]}</Text>
            {grouped[section].length === 0 ? (
              <Text style={styles.emptyState}>No {section} categories yet — tap + to add one.</Text>
            ) : (
              grouped[section].map((item, index) => {
                const used = usageCount(item);
                return (
                  <View key={item.id} style={[styles.categoryRow, index === grouped[section].length - 1 && styles.lastRow]}>
                    <View style={[styles.iconCircle, { backgroundColor: `${item.color}1A` }]}>
                      <Text style={styles.iconText} maxFontSizeMultiplier={CONTROL_LABEL_MAX_SCALE}>{item.icon}</Text>
                    </View>
                    <View style={styles.categoryText}>
                      <Text style={styles.categoryName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      {used > 0 && <Text style={styles.usage}>{used} in use</Text>}
                    </View>
                    <Pressable onPress={() => openEditModal(item)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Edit ${item.name}`}>
                      <Ionicons name="pencil-outline" size={18} color={colors.navy} />
                    </Pressable>
                    <Pressable onPress={() => onDelete(item)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Delete ${item.name}`}>
                      <Ionicons name="trash-outline" size={18} color={colors.red} />
                    </Pressable>
                  </View>
                );
              })
            )}
          </View>
        ))}
      </ScrollView>

      <SheetModal visible={isModalOpen} onClose={closeModal}>
        <Text style={styles.sectionTitle}>{editingId ? 'Edit category' : 'New category'}</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={onNameChange}
          placeholder="Category name"
          placeholderTextColor={colors.textSecondary}
        />

        <View style={styles.segmented}>
          {(['expense', 'income'] as const).map((option) => (
            <AppButton
              key={option}
              title={option === 'expense' ? 'Expense' : 'Income'}
              selected={type === option}
              onPress={() => setType(option)}
              style={styles.segmentButton}
            />
          ))}
        </View>

        <View style={styles.iconSection}>
          <Text style={styles.label}>Icon {iconChosen ? '' : '· suggested from the name'}</Text>
          <View style={styles.iconGrid}>
            {CATEGORY_EMOJI_CHOICES.map((emoji) => (
              <Pressable
                key={emoji}
                style={[styles.iconOption, icon === emoji && styles.iconOptionSelected]}
                onPress={() => {
                  setIcon(emoji);
                  setIconChosen(true);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: icon === emoji }}
              >
                <Text style={styles.iconOptionEmoji} maxFontSizeMultiplier={CONTROL_LABEL_MAX_SCALE}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <AppButton title={editingId ? 'Save changes' : 'Create category'} variant="primary" onPress={() => void onSave()} />
      </SheetModal>
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
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerTitle: {
    flex: 1,
    minWidth: 0,
  },
  sectionTitle: {
    ...typography.sectionTitle,
    color: colors.navy,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  groupTitle: {
    ...typography.helper,
    fontWeight: '800',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: spacing.xs,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.background,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 18,
  },
  categoryText: {
    flex: 1,
  },
  categoryName: {
    fontWeight: '600',
    color: colors.navy,
    fontSize: 15,
  },
  usage: {
    ...typography.helper,
    color: colors.textSecondary,
  },
  emptyState: {
    ...typography.helper,
    color: colors.textSecondary,
  },
  label: {
    ...typography.helper,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: radius.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.navy,
  },
  segmented: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  segmentButton: {
    flex: 1,
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
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  iconOptionSelected: {
    backgroundColor: colors.orangeLight,
    borderColor: colors.orange,
  },
  iconOptionEmoji: {
    fontSize: 20,
  },
});
