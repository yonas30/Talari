import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import AppButton from '../components/AppButton';
import AppHeader from '../components/AppHeader';
import { colors, radius, spacing, typography } from '../constants/theme';
import { useFinanceStore } from '../store/finance';
import { CategoryType } from '../types';

// Icon suggestion logic based on category name
function suggestIcon(categoryName: string): string {
  const lower = categoryName.toLowerCase();

  // Income
  if (lower.includes('salary')) return '💼';
  if (lower.includes('freelance') || lower.includes('project')) return '💻';
  if (lower.includes('bonus')) return '🎁';
  if (lower.includes('investment') || lower.includes('dividend')) return '📈';
  if (lower.includes('refund')) return '💰';

  // Expenses
  if (lower.includes('food') || lower.includes('eat') || lower.includes('restaurant')) return '🍽️';
  if (lower.includes('rent') || lower.includes('housing') || lower.includes('mortgage')) return '🏠';
  if (lower.includes('transport') || lower.includes('car') || lower.includes('taxi') || lower.includes('uber')) return '🚕';
  if (lower.includes('shop') || lower.includes('clothing') || lower.includes('mall')) return '🛍️';
  if (lower.includes('health') || lower.includes('medical') || lower.includes('doctor') || lower.includes('medicine')) return '⚕️';
  if (lower.includes('phone') || lower.includes('internet') || lower.includes('utility')) return '📱';
  if (lower.includes('entertainment') || lower.includes('movie') || lower.includes('game') || lower.includes('music')) return '🎬';
  if (lower.includes('gym') || lower.includes('fitness') || lower.includes('exercise')) return '💪';
  if (lower.includes('education') || lower.includes('course') || lower.includes('book')) return '📚';
  if (lower.includes('travel') || lower.includes('hotel') || lower.includes('flight')) return '✈️';

  // Savings
  if (lower.includes('savings') || lower.includes('save')) return '🏦';
  if (lower.includes('emergency') || lower.includes('fund')) return '🆘';
  if (lower.includes('investment')) return '📈';

  return '✨';
}

export default function CategoriesScreen() {
  const { categories, addCategory, updateCategory, deleteCategory } = useFinanceStore();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<CategoryType>('expense');
  const [icon, setIcon] = useState('✨');

  const resetForm = () => {
    setName('');
    setType('expense');
    setIcon('✨');
    setEditingId(null);
  };

  const openCreateModal = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEditModal = (category: (typeof categories)[number]) => {
    setEditingId(category.id);
    setName(category.name);
    setType(category.type);
    setIcon(category.icon);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    resetForm();
  };

  const onNameChange = (text: string) => {
    setName(text);
    // Auto-suggest icon
    if (text.trim()) {
      setIcon(suggestIcon(text));
    }
  };

  const onCreate = async () => {
    if (!name.trim()) {
      Alert.alert('Category name is required');
      return;
    }

    if (editingId) {
      await updateCategory(editingId, {
        name: name.trim(),
        type,
        icon,
        color: type === 'income' ? colors.olive : type === 'savings' ? colors.blue : colors.orange,
      });
    } else {
      await addCategory({
        name: name.trim(),
        type,
        icon,
        color: type === 'income' ? colors.olive : type === 'savings' ? colors.blue : colors.orange,
      });
    }

    closeModal();
  };

  const grouped = useMemo(
    () => ({
      income: categories.filter((item) => item.type === 'income'),
      expense: categories.filter((item) => item.type === 'expense'),
      savings: categories.filter((item) => item.type === 'savings'),
    }),
    [categories],
  );

  return (
    <View style={styles.screen}>
      <AppHeader title="Categories" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.sectionTitle}>Manage categories</Text>
          <Pressable style={styles.addButton} onPress={openCreateModal}>
            <Ionicons name="add" size={22} color="#FFFFFF" />
          </Pressable>
        </View>

        {(['income', 'expense', 'savings'] as const).map((section) => (
          <View key={section} style={styles.card}>
            <Text style={styles.groupTitle}>{section[0].toUpperCase() + section.slice(1)}</Text>
            {grouped[section].length === 0 ? (
              <Text style={styles.emptyState}>No {section} categories yet</Text>
            ) : (
              grouped[section].map((item) => (
                <View key={item.id} style={styles.categoryRow}>
                  <View style={[styles.iconCircle, { backgroundColor: `${item.color}1A` }]}>
                    <Text style={styles.iconText}>{item.icon}</Text>
                  </View>
                  <Text style={styles.categoryName}>{item.name}</Text>
                  <View style={styles.actionButtons}>
                    <Pressable onPress={() => openEditModal(item)} hitSlop={8}>
                      <Ionicons name="pencil" size={16} color={colors.navy} />
                    </Pressable>
                    <Pressable
                      onPress={() => void deleteCategory(item.id)}
                      hitSlop={8}
                      style={{ marginLeft: spacing.sm }}
                    >
                      <Ionicons name="trash" size={16} color={colors.red} />
                    </Pressable>
                  </View>
                </View>
              ))
            )}
          </View>
        ))}
      </ScrollView>

      <Modal visible={isModalOpen} transparent animationType="slide" onRequestClose={closeModal}>
        <Pressable style={styles.modalBackdrop} onPress={closeModal}>
          <Pressable style={styles.modalSheet} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.sectionTitle}>{editingId ? 'Edit category' : 'New category'}</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={onNameChange}
              placeholder="Category name"
              placeholderTextColor={colors.textSecondary}
            />

            <View style={styles.segmented}>
              {(['income', 'expense', 'savings'] as const).map((option) => (
                <AppButton key={option} title={option} selected={type === option} onPress={() => setType(option)} />
              ))}
            </View>

            <View style={styles.iconSection}>
              <Text style={styles.label}>Icon</Text>
              <View style={styles.iconGrid}>
                {['✨', '💼', '💻', '💰', '🎁', '📈', '🍽️', '🏠', '🚕', '🛍️', '⚕️', '📱', '🎬', '💪', '📚', '✈️', '🏦', '🆘'].map(
                  (emoji) => (
                    <Pressable
                      key={emoji}
                      style={[styles.iconOption, icon === emoji && styles.iconOptionSelected]}
                      onPress={() => setIcon(emoji)}
                    >
                      <Text style={styles.iconOptionEmoji}>{emoji}</Text>
                    </Pressable>
                  ),
                )}
              </View>
            </View>

            <AppButton
              title={editingId ? 'Save changes' : 'Create category'}
              variant="primary"
              onPress={() => void onCreate()}
            />
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
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
    gap: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  groupTitle: {
    fontWeight: '700',
    color: colors.navy,
    fontSize: 15,
    marginBottom: spacing.sm,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.background,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 18,
  },
  categoryName: {
    flex: 1,
    fontWeight: '600',
    color: colors.navy,
    fontSize: 15,
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
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
  },
  label: {
    ...typography.helper,
    color: colors.textSecondary,
    fontWeight: '700',
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
  segmented: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
    flexWrap: 'wrap',
  },
  iconSection: {
    gap: spacing.md,
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  iconOption: {
    width: '25%',
    aspectRatio: 1,
    borderRadius: radius.button,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconOptionSelected: {
    backgroundColor: colors.orange,
  },
  iconOptionEmoji: {
    fontSize: 20,
  },
});
