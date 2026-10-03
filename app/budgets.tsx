import { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import AppButton from '../components/AppButton';
import CategoryPicker from '../components/CategoryPicker';
import AppHeader from '../components/AppHeader';
import CurrencyPicker from '../components/CurrencyPicker';
import { defaultCategories } from '../constants/categories';
import { colors, radius, spacing, typography } from '../constants/theme';
import { useFinanceStore } from '../store/finance';
import { getBudgetProgress } from '../utils/currency';
import { CurrencyCode } from '../types';

export default function BudgetsScreen() {
  const { budgets, categories, transactions, exchangeRates, upsertBudget, deleteBudget } = useFinanceStore();

  const [category, setCategory] = useState('');
  const [monthlyLimit, setMonthlyLimit] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('ETB');

  const expenseCategories = useMemo(() => {
    const items = categories.length > 0 ? categories : defaultCategories;
    return items.filter((item) => item.type === 'expense');
  }, [categories]);

  const categoryLookup = useMemo(
    () => Object.fromEntries((categories.length > 0 ? categories : defaultCategories).map((item) => [item.name, item])),
    [categories],
  );

  const onSaveBudget = async () => {
    const numericLimit = Number(monthlyLimit);
    if (!category || !Number.isFinite(numericLimit) || numericLimit <= 0) {
      Alert.alert('Choose a category and enter a valid monthly limit.');
      return;
    }

    await upsertBudget({ category, monthlyLimit: numericLimit, currency });
    setMonthlyLimit('');
  };

  return (
    <View style={styles.screen}>
      <AppHeader title="Budgets" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Set a monthly limit</Text>
          <Text style={styles.label}>Category</Text>
          <View style={styles.entryRow}>
            <View style={styles.categoryField}>
              <CategoryPicker value={category} options={expenseCategories} onChange={(value) => setCategory(expenseCategories.find((item) => item.id === value)?.name ?? value)} />
            </View>
            <View style={styles.amountField}>
              <TextInput
                style={styles.input}
                value={monthlyLimit}
                onChangeText={setMonthlyLimit}
                placeholder="Amount"
                keyboardType="decimal-pad"
              />
            </View>
            <CurrencyPicker value={currency} onChange={setCurrency} />
          </View>

          <AppButton title="Save budget" variant="primary" onPress={() => void onSaveBudget()} />
        </View>

        {budgets.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.emptyState}>No budgets yet — set a limit for a category above.</Text>
          </View>
        ) : (
          budgets.map((budget) => {
            const { spentAmount, limitETB, percent, isOverBudget } = getBudgetProgress(budget, transactions, exchangeRates);
            const categoryMeta = categoryLookup[budget.category] ?? { icon: '💰', color: colors.orange };
            const fillWidth = Math.min(percent, 100);
            return (
              <View key={budget.id} style={[styles.card, isOverBudget && styles.warningCard]}>
                <View style={styles.budgetHeader}>
                  <View style={[styles.iconBadge, { backgroundColor: `${categoryMeta.color}1A` }]}>
                    <Text style={styles.iconText}>{categoryMeta.icon}</Text>
                  </View>
                  <View style={styles.budgetTitleGroup}>
                    <Text style={styles.sectionTitle}>{budget.category}</Text>
                    <Text style={[styles.goalText, isOverBudget && styles.overBudgetText]}>
                      {limitETB === null
                        ? `ETB ${spentAmount.toFixed(2)} spent — set a ${budget.currency} exchange rate to track this limit`
                        : `ETB ${spentAmount.toFixed(2)} / ETB ${limitETB.toFixed(2)}`}
                    </Text>
                  </View>
                  <Text style={[styles.percentBadge, isOverBudget && styles.overBudgetBadge]}>{Math.round(percent)}%</Text>
                </View>

                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${fillWidth}%`,
                        backgroundColor: isOverBudget ? colors.red : colors.olive,
                      },
                    ]}
                  />
                </View>

                {isOverBudget ? (
                  <Text style={styles.warningText}>Over budget this month</Text>
                ) : (
                  <Text style={styles.metaText}>On track for the month</Text>
                )}

                <AppButton title="Delete budget" variant="danger" onPress={() => void deleteBudget(budget.id)} />
              </View>
            );
          })
        )}
      </ScrollView>
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
  warningCard: {
    borderWidth: 1,
    borderColor: colors.redLight,
  },
  budgetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  budgetTitleGroup: {
    flex: 1,
    gap: 2,
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
  sectionTitle: {
    ...typography.sectionTitle,
    color: colors.navy,
  },
  label: {
    ...typography.helper,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  categoryField: {
    flex: 1.3,
  },
  amountField: {
    flex: 0.8,
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
  goalText: {
    ...typography.helper,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  overBudgetText: {
    color: colors.red,
  },
  percentBadge: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.olive,
  },
  overBudgetBadge: {
    color: colors.red,
  },
  progressTrack: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: '#E8ECF2',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  warningText: {
    color: colors.red,
    fontSize: 12,
    fontWeight: '700',
  },
  metaText: {
    ...typography.helper,
    color: colors.textSecondary,
  },
  emptyState: {
    ...typography.helper,
    color: colors.textSecondary,
  },
});
