import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import AppHeader from '../components/AppHeader';
import AppText from '../components/AppText';
import Button from '../components/Button';
import CategoryPicker from '../components/CategoryPicker';
import CurrencyPicker from '../components/CurrencyPicker';
import FormInput from '../components/FormInput';
import InlineError from '../components/InlineError';
import SheetModal from '../components/SheetModal';
import { defaultCategories } from '../constants/categories';
import { radius, spacing } from '../constants/theme';
import { useFinanceStore } from '../store/finance';
import { useTheme } from '../theme/ThemeProvider';
import { Budget, CurrencyCode } from '../types';
import { getBudgetProgress } from '../utils/currency';
import { formatETB } from '../utils/format';
import { CONTROL_LABEL_MAX_SCALE } from '../utils/layout';

// Share of the limit at which a budget is flagged as "close" before it is actually exceeded.
const NEAR_LIMIT_PERCENT = 80;

export default function BudgetsScreen() {
  const { colors } = useTheme();
  const { budgets, categories, transactions, exchangeRates, upsertBudget, deleteBudget } = useFinanceStore();

  const [isSheetOpen, setIsSheetOpen] = useState(false);
  // Budgets are keyed by category, so editing keeps the category fixed.
  const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
  const [category, setCategory] = useState('');
  const [monthlyLimit, setMonthlyLimit] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('ETB');
  // A validation message shown inside the sheet (it used to be a native alert).
  const [error, setError] = useState<string | null>(null);

  const allCategories = categories.length > 0 ? categories : defaultCategories;
  const expenseCategories = useMemo(() => allCategories.filter((item) => item.type === 'expense'), [allCategories]);
  const categoryLookup = useMemo(() => Object.fromEntries(allCategories.map((item) => [item.name, item])), [allCategories]);

  const openCreate = () => {
    setEditingBudget(null);
    setCategory('');
    setMonthlyLimit('');
    setCurrency('ETB');
    setError(null);
    setIsSheetOpen(true);
  };

  const openEdit = (budget: Budget) => {
    setEditingBudget(budget);
    setCategory(budget.category);
    setMonthlyLimit(String(budget.monthlyLimit));
    setCurrency(budget.currency);
    setError(null);
    setIsSheetOpen(true);
  };

  const closeSheet = () => {
    setIsSheetOpen(false);
    setEditingBudget(null);
    setError(null);
  };

  const onSave = async () => {
    const numericLimit = Number(monthlyLimit);
    if (!category || !Number.isFinite(numericLimit) || numericLimit <= 0) {
      setError('Choose a category and enter a valid monthly limit.');
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

  const label = [styles.label, { color: colors.textMuted }];

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <AppHeader title="Budgets" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.topText}>
          <AppText variant="heading" style={styles.pageTitle}>
            Monthly budgets
          </AppText>
          <AppText style={[styles.pageSubtitle, { color: colors.textMuted }]}>Spending is tracked in ETB against each limit.</AppText>
        </View>
        <Button title="New budget" icon="add" onPress={openCreate} accessibilityLabel="Add a budget" />

        {budgets.length === 0 ? (
          <AppText style={[styles.emptyState, { color: colors.textMuted }]}>
            No budgets yet — tap + to set a monthly limit for a category.
          </AppText>
        ) : (
          budgets.map((budget) => {
            const { spentAmount, limitETB, percent, isOverBudget } = getBudgetProgress(budget, transactions, exchangeRates);
            const meta = categoryLookup[budget.category] ?? { icon: '💰' };
            const isNear = !isOverBudget && percent >= NEAR_LIMIT_PERCENT;
            // The bar and the figure use one tone per state, and the state is ALSO written out with an icon, so colour is never the only signal.
            const accent = isOverBudget ? colors.expense : isNear ? colors.primaryText : colors.income;
            const statusIcon = isOverBudget ? 'alert-circle' : isNear ? 'warning' : 'checkmark-circle';
            const statusText =
              limitETB === null
                ? ''
                : isOverBudget
                  ? `Over budget by ${formatETB(spentAmount - limitETB)} this month`
                  : isNear
                    ? `Close to the limit · ${formatETB(limitETB - spentAmount)} left`
                    : `On track · ${formatETB(limitETB - spentAmount)} left`;

            return (
              <Pressable
                key={budget.id}
                style={({ pressed }) => [
                  styles.card,
                  { backgroundColor: colors.surface, borderColor: isOverBudget ? colors.expense : colors.border },
                  pressed && styles.pressed,
                ]}
                onPress={() => openEdit(budget)}
                accessibilityRole="button"
                accessibilityLabel={`${budget.category} budget, ${statusText || 'no exchange rate'}, tap to edit`}
              >
                <View style={styles.cardHeader}>
                  <View style={[styles.iconBadge, { backgroundColor: colors.expenseDisc }]}>
                    <AppText style={styles.iconText} maxFontSizeMultiplier={CONTROL_LABEL_MAX_SCALE}>{meta.icon}</AppText>
                  </View>
                  <View style={styles.cardTitleGroup}>
                    <AppText style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
                      {budget.category}
                    </AppText>
                    <AppText style={[styles.amountText, { color: colors.textMuted }]} numberOfLines={2}>
                      {limitETB === null
                        ? `${formatETB(spentAmount)} spent — set a ${budget.currency} exchange rate to track this limit`
                        : `${formatETB(spentAmount)} of ${formatETB(limitETB)}`}
                    </AppText>
                  </View>
                  {limitETB !== null && (
                    <AppText variant="number" style={[styles.percent, { color: accent }]}>
                      {Math.round(percent)}%
                    </AppText>
                  )}
                </View>

                {limitETB !== null && (
                  <>
                    <View style={[styles.progressTrack, { backgroundColor: colors.surfaceMuted }]}>
                      <View style={[styles.progressFill, { width: `${Math.min(percent, 100)}%`, backgroundColor: accent }]} />
                    </View>
                    <View style={styles.statusRow}>
                      <Ionicons name={statusIcon} size={16} color={accent} />
                      <AppText style={[styles.status, { color: isOverBudget ? colors.expense : isNear ? colors.primaryText : colors.textMuted }]}>
                        {statusText}
                      </AppText>
                    </View>
                  </>
                )}
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <SheetModal visible={isSheetOpen} onClose={closeSheet}>
        <AppText variant="title" style={styles.sheetTitle} accessibilityRole="header">
          {editingBudget ? `Edit ${editingBudget.category} budget` : 'Set a monthly limit'}
        </AppText>

        {!editingBudget && (
          <>
            <AppText style={label}>Category</AppText>
            <CategoryPicker
              value={category}
              options={expenseCategories}
              onChange={(value) => setCategory(expenseCategories.find((item) => item.id === value)?.name ?? value)}
              discColor={colors.expenseDisc}
              glyphColor={colors.expenseGlyph}
            />
          </>
        )}

        <AppText style={label}>Monthly limit</AppText>
        <View style={styles.amountRow}>
          <FormInput
            style={styles.input}
            value={monthlyLimit}
            onChangeText={setMonthlyLimit}
            placeholder="Amount"
            keyboardType="decimal-pad"
            accessibilityLabel="Monthly limit"
            invalid={error !== null && !(Number(monthlyLimit) > 0)}
          />
          <CurrencyPicker value={currency} onChange={setCurrency} />
        </View>

        {error ? <InlineError message={error} /> : null}

        <Button title={editingBudget ? 'Save changes' : 'Save budget'} variant="primary" onPress={() => void onSave()} />
        {editingBudget && (
          <Pressable
            style={({ pressed }) => [styles.deleteLink, pressed && { backgroundColor: colors.surfaceMuted }]}
            onPress={() => onDelete(editingBudget)}
            accessibilityRole="button"
            accessibilityLabel="Delete budget"
          >
            <Ionicons name="trash-outline" size={18} color={colors.expense} />
            <AppText style={[styles.deleteLinkText, { color: colors.expense }]}>Delete budget</AppText>
          </Pressable>
        )}
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
    gap: 12,
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
  pressed: {
    opacity: 0.8,
  },
  card: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 14,
    gap: spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
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
  cardTitleGroup: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  amountText: {
    fontSize: 13,
    fontWeight: '600',
  },
  percent: {
    fontSize: 14,
    fontWeight: '800',
  },
  progressTrack: {
    height: 8,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  status: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: '600',
  },
  emptyState: {
    fontSize: 13,
    lineHeight: 18,
  },
  sheetTitle: {
    fontSize: 17,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minWidth: 0,
  },
  deleteLink: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.button,
  },
  deleteLinkText: {
    fontWeight: '600',
    fontSize: 14,
  },
});
