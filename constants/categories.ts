import { Category } from '../types';

// Transfer fees are recorded as expenses in this category (V2_SPEC Part B section 5). Part of the seed, and added to an existing
// database by the schema 4 migration.
export const FEES_CATEGORY: Category = { id: 'fees', name: 'Fees', type: 'expense', icon: '🏦', color: '#64748b', isDefault: true };

// The category a message or entry gets when the owner has not chosen one (V2_SPEC Part Z). One for income and one for expense, built in:
// they cannot be deleted or renamed, so code can rely on the name. Part of the seed, and added to an existing database by the schema 6
// migration.
export const UNCATEGORISED_NAME = 'Uncategorised';
export const UNCATEGORISED_EXPENSE: Category = { id: 'uncategorised-expense', name: UNCATEGORISED_NAME, type: 'expense', icon: '❓', color: '#94a3b8', isDefault: true };
export const UNCATEGORISED_INCOME: Category = { id: 'uncategorised-income', name: UNCATEGORISED_NAME, type: 'income', icon: '❓', color: '#94a3b8', isDefault: true };

// Built in: not deletable, not renamable.
export const isProtectedCategory = (category: Pick<Category, 'name' | 'type'>): boolean =>
  category.name === UNCATEGORISED_NAME && (category.type === 'income' || category.type === 'expense');

export const defaultCategories: Category[] = [
  { id: 'salary', name: 'Salary', type: 'income', icon: '💼', color: '#16a34a', isDefault: true },
  { id: 'freelance', name: 'Freelance', type: 'income', icon: '💻', color: '#22c55e', isDefault: true },
  { id: 'food', name: 'Food', type: 'expense', icon: '🍽️', color: '#f59e0b', isDefault: true },
  { id: 'rent', name: 'Rent', type: 'expense', icon: '🏠', color: '#ef4444', isDefault: true },
  { id: 'transport', name: 'Transport', type: 'expense', icon: '🚕', color: '#3b82f6', isDefault: true },
  { id: 'shopping', name: 'Shopping', type: 'expense', icon: '🛍️', color: '#8b5cf6', isDefault: true },
  FEES_CATEGORY,
  UNCATEGORISED_INCOME,
  UNCATEGORISED_EXPENSE,
];
