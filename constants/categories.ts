import { Category } from '../types';

export const defaultCategories: Category[] = [
  { id: 'salary', name: 'Salary', type: 'income', icon: '💼', color: '#16a34a', isDefault: true },
  { id: 'freelance', name: 'Freelance', type: 'income', icon: '💻', color: '#22c55e', isDefault: true },
  { id: 'food', name: 'Food', type: 'expense', icon: '🍽️', color: '#f59e0b', isDefault: true },
  { id: 'rent', name: 'Rent', type: 'expense', icon: '🏠', color: '#ef4444', isDefault: true },
  { id: 'transport', name: 'Transport', type: 'expense', icon: '🚕', color: '#3b82f6', isDefault: true },
  { id: 'shopping', name: 'Shopping', type: 'expense', icon: '🛍️', color: '#8b5cf6', isDefault: true },
];
