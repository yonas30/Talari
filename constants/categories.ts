import { Category } from '../types';

// Transfer fees are recorded as expenses in this category (V2_SPEC Part B section 5). Part of the seed, and added to an existing
// database by the schema 4 migration.
export const FEES_CATEGORY: Category = { id: 'fees', name: 'Fees', type: 'expense', icon: '🏦', color: '#64748b', isDefault: true };

export const defaultCategories: Category[] = [
  { id: 'salary', name: 'Salary', type: 'income', icon: '💼', color: '#16a34a', isDefault: true },
  { id: 'freelance', name: 'Freelance', type: 'income', icon: '💻', color: '#22c55e', isDefault: true },
  { id: 'food', name: 'Food', type: 'expense', icon: '🍽️', color: '#f59e0b', isDefault: true },
  { id: 'rent', name: 'Rent', type: 'expense', icon: '🏠', color: '#ef4444', isDefault: true },
  { id: 'transport', name: 'Transport', type: 'expense', icon: '🚕', color: '#3b82f6', isDefault: true },
  { id: 'shopping', name: 'Shopping', type: 'expense', icon: '🛍️', color: '#8b5cf6', isDefault: true },
  FEES_CATEGORY,
];
