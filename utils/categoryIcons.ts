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

// Emoji suggested for a new category from its name (V2 Part O: new categories get a fitting icon
// automatically). Words are matched by prefix ("grocer" -> groceries), first matching group wins, so the
// more specific groups come first; unknown names get a neutral sparkle.
const emojiKeywords: Array<[string[], string]> = [
  [['salary', 'wage', 'paycheck', 'payroll'], '💼'],
  [['freelance', 'consult', 'project'], '💻'],
  [['bonus', 'gift', 'present'], '🎁'],
  [['invest', 'dividend', 'stock', 'interest'], '📈'],
  [['refund', 'cashback'], '💰'],
  [['insurance'], '🛡️'],
  [['fuel', 'petrol', 'gasoline', 'gas'], '⛽'],
  [['pet', 'dog'], '🐾'],
  [['rent', 'rental', 'housing', 'mortgage'], '🏠'],
  [['grocer', 'supermarket'], '🛒'],
  [['coffee', 'cafe', 'tea'], '☕'],
  [['food', 'eat', 'restaurant', 'lunch', 'dinner', 'meal'], '🍽️'],
  [['transport', 'taxi', 'uber', 'bus', 'car', 'ride'], '🚕'],
  [['shop', 'cloth', 'mall', 'fashion'], '🛍️'],
  [['health', 'medical', 'doctor', 'medicine', 'pharmacy', 'hospital'], '⚕️'],
  [['phone', 'airtime', 'internet', 'data', 'wifi'], '📱'],
  [['electric', 'water', 'utilit', 'bill'], '💡'],
  [['entertain', 'movie', 'game', 'music', 'netflix'], '🎬'],
  [['gym', 'fitness', 'exercise', 'sport'], '💪'],
  [['educat', 'course', 'school', 'tuition', 'book'], '📚'],
  [['travel', 'hotel', 'flight', 'trip', 'vacation'], '✈️'],
  [['charity', 'donat', 'church', 'tithe'], '🤝'],
  [['kid', 'child', 'baby', 'family'], '👨‍👩‍👧'],
  [['saving', 'save', 'emergency', 'fund'], '🏦'],
];

// Short keywords must match the whole word ("car" must not catch "card"/"care"); longer ones match by
// prefix so "grocer" covers grocery/groceries.
function matchesKeyword(word: string, keyword: string): boolean {
  return keyword.length <= 4 ? word === keyword || word === `${keyword}s` : word.startsWith(keyword);
}

export function suggestCategoryEmoji(categoryName: string): string {
  const words = categoryName.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (const [keywords, emoji] of emojiKeywords) {
    if (words.some((word) => keywords.some((keyword) => matchesKeyword(word, keyword)))) {
      return emoji;
    }
  }
  return '✨';
}

// The emoji offered in the category icon picker.
export const CATEGORY_EMOJI_CHOICES = [
  '✨', '💼', '💻', '🎁', '📈', '💰', '🍽️', '🛒', '☕', '🏠', '🚕', '⛽',
  '🛍️', '⚕️', '📱', '💡', '🛡️', '🎬', '💪', '📚', '✈️', '🤝', '🐾', '🏦',
];
