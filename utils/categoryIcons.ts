import { Ionicons } from '@expo/vector-icons';

// Maps known category names to a consistent icon family instead of relying on emojis.
const iconByName: Record<string, keyof typeof Ionicons.glyphMap> = {
  salary: 'briefcase',
  freelance: 'laptop-outline',
  food: 'restaurant',
  rent: 'home',
  transport: 'car',
  shopping: 'bag-handle',
  savings: 'wallet',
  bills: 'receipt',
  health: 'medkit',
  education: 'school',
  entertainment: 'film',
};

export function getCategoryIconName(categoryName: string): keyof typeof Ionicons.glyphMap {
  const key = categoryName.trim().toLowerCase();
  return iconByName[key] ?? 'pricetag-outline';
}
