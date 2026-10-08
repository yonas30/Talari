import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import AppButton from '../components/AppButton';
import AppHeader from '../components/AppHeader';
import CategoryPicker from '../components/CategoryPicker';
import CurrencyPicker from '../components/CurrencyPicker';
import SheetModal from '../components/SheetModal';
import { defaultCategories } from '../constants/categories';
import { colors, radius, spacing, typography } from '../constants/theme';
import { useFinanceStore } from '../store/finance';
import { Budget, CurrencyCode } from '../types';
import { getBudgetProgress } from '../utils/currency';
import { formatETB } from '../utils/format';
import { CONTROL_LABEL_MAX_SCALE } from '../utils/layout';
import AppText from '../components/AppText';
import AppTextInput from '../components/AppTextInput';

// Share of the limit at which a budget is flagged as "close" before it is actually exceeded.
const NEAR_LIMIT_PERCENT = 80;

export default function BudgetsScreen() {
  const { budgets, categories, transactions, exchangeRates, upsertBudget, deleteBudget } = useFinanceStore();

  const [isSheetOpen, setIsSheetOpen] = useState(false);
  // Budgets are keyed by category, so editing keeps the category fixed.
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [category, setCategory] = useState('');
  const [monthlyLimit, setMonthlyLimit] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('ETB');

  const allCategories = categories.length > 0 ? categories : defaultCategories;
  const expenseCategories = useMemo(() => allCategories.filter((item) => item.type === 'expense'), [allCategories]);
  const categoryLookup = useMemo(() => Object.fromEntries(allCategories.map((item) => [item.name, item])), [allCategories]);

  const openCreate = () => {
    setEditingBudget(null);
    setCategory('');
    setMonthlyLimit('');
    setCurrency('ETB');
    setIsSheetOpen(true);
  };

  const openEdit = (budget: Budget) => {
    setEditingBudget(budget);
    setCategory(budget.category);
    setMonthlyLimit(String(budget.monthlyLimit));
    setCurrency(budget.currency);
    setIsSheetOpen(true);
  };

  const closeSheet = () => {
    setIsSheetOpen(false);
    setEditingBudget(null);
  };

  const onSave = async () => {
    const numericLimit = Number(monthlyLimit);
    if (!category || !Number.isFinite(numericLimit) || numericLimit <= 0) {
      Alert.alert('Choose a category and enter a valid monthly limit.');
      return;
    }

    await upsertBudget({ category, monthlyLimit: numericLimit, currency });
    closeSheet();
  };

  const onDelete = (budget: Budget) => {
    Alert.alert('Delete budget', `Remove the monthly limit for ${budget.category}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void deleteBudget(budget.id);
          closeSheet();
        },
      },
    ]);
  };

  return (
    <View style={styles.screen}>
      <AppHeader title="Budgets" />
      <View style={styles.topBar}>
        <View style={styles.topBarText}>
          <AppText style={styles.pageTitle}>Monthly budgets</AppText>
          <AppText style={styles.pageSubtitle}>Spending is tracked in ETB against each limit.</AppText>
        </View>
        <Pressable style={styles.addButton} onPress={openCreate} accessibilityRole="button" accessibilityLabel="Add a budget">
          <Ionicons name="add" size={22} color="#FFFFFF" />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        {budgets.length === 0 ? (
          <View style={styles.card}>
            <AppText style={styles.emptyState}>No budgets yet — tap + to set a monthly limit for a category.</AppText>
          </View>
        ) : (
          budgets.map((budget) => {
            const { spentAmount, limitETB, percent, isOverBudget } = getBudgetProgress(budget, transactions, exchangeRates);
            const meta = categoryLookup[budget.category] ?? { icon: '💰', color: colors.orange };
            const isNear = !isOverBudget && percent >= NEAR_LIMIT_PERCENT;
            const accent = isOverBudget ? colors.red : isNear ? colors.statusWarning : colors.statusIncome;

            return (
              <Pressable
                key={budget.id}
                style={({ pressed }) => [styles.card, isOverBudget && styles.overCard, pressed && styles.pressed]}
                onPress={() => openEdit(budget)}
                accessibilityRole="button"
                accessibilityLabel={`${budget.category} budget, tap to edit`}
              >
                <View style={styles.cardHeader}>
                  <View style={[styles.iconBadge, { backgroundColor: `${meta.color}1A` }]}>
                    <AppText style={styles.iconText} maxFontSizeMultiplier={CONTROL_LABEL_MAX_SCALE}>{meta.icon}</AppText>
                  </View>
                  <View style={styles.cardTitleGroup}>
                    <AppText style={styles.cardTitle} numberOfLines={1}>
                      {budget.category}
                    </AppText>
                    <AppText style={styles.amountText} numberOfLines={2}>
                      {limitETB === null
                        ? `${formatETB(spentAmount)} spent — set a ${budget.currency} exchange rate to track this limit`
                        : `${formatETB(spentAmount)} of ${formatETB(limitETB)}`}
                    </AppText>
                  </View>
                  {limitETB !== null && <AppText style={[styles.percent, { color: accent }]}>{Math.round(percent)}%</AppText>}
                </View>

                {limitETB !== null && (
                  <>
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${Math.min(percent, 100)}%`, backgroundColor: accent }]} />
                    </View>
                    <AppText style={[styles.status, { color: isOverBudget ? colors.red : colors.textSecondary }]}>
                      {isOverBudget
                        ? `Over budget by ${formatETB(spentAmount - limitETB)} this month`
                        : isNear
                          ? `Close to the limit · ${formatETB(limitETB - spentAmount)} left`
                          : `On track · ${formatETB(limitETB - spentAmount)} left`}
                    </AppText>
                  </>
                )}
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <SheetModal visible={isSheetOpen} onClose={closeSheet}>
        <AppText style={styles.sheetTitle}>{editingBudget ? `Edit ${editingBudget.category} budget` : 'Set a monthly limit'}</AppText>

        {!editingBudget && (
          <>
            <AppText style={styles.label}>Category</AppText>
            <CategoryPicker
              value={category}
              options={expenseCategories}
              onChange={(value) => setCategory(expenseCategories.find((item) => item.id === value)?.name ?? value)}
            />
          </>
        )}

        <AppText style={styles.label}>Monthly limit</AppText>
        <View style={styles.amountRow}>
          <AppTextInput
            style={styles.input}
            value={monthlyLimit}
            onChangeText={setMonthlyLimit}
            placeholder="Amount"
            placeholderTextColor={colors.textSecondary}
            keyboardType="decimal-pad"
          />
          <CurrencyPicker value={currency} onChange={setCurrency} />
        </View>

        <AppButton title={editingBudget ? 'Save changes' : 'Save budget'} variant="primary" onPress={() => void onSave()} />
        {editingBudget && (
          <Pressable style={styles.deleteLink} onPress={() => onDelete(editingBudget)} accessibilityRole="button">
            <Ionicons name="trash-outline" size={16} color={colors.red} />
            <AppText style={styles.deleteLinkText}>Delete budget</AppText>
          </Pressable>
        )}
      </SheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  topBarText: {
    flex: 1,
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
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    gap: spacing.md,
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
  overCard: {
    borderWidth: 1,
    borderColor: colors.redLight,
  },
  pressed: {
    opacity: 0.8,
  },
  cardHeader: {
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
  cardTitleGroup: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.navy,
  },
  amountText: {
    ...typography.helper,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  percent: {
    fontSize: 14,
    fontWeight: '800',
  },
  progressTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  status: {
    ...typography.helper,
    fontWeight: '600',
  },
  emptyState: {
    ...typography.helper,
    color: colors.textSecondary,
  },
  sheetTitle: {
    ...typography.sectionTitle,
    color: colors.navy,
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
  input: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radius.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.navy,
  },
  deleteLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  deleteLinkText: {
    color: colors.red,
    fontWeight: '600',
    fontSize: 14,
  },
});
