import { Category } from '../../types';
import { RecipientRule } from '../../types/sms';
import { SmsSuggestion } from '../../types/sms';

type RecipientFields = Pick<SmsSuggestion, 'counterpartyName' | 'counterpartyPhoneTail' | 'counterpartyBank' | 'counterpartyAccountTail' | 'counterpartyCode'>;

// Lower case, letters and digits only, single spaces: "Abel  Haile-Gebre" and "abel haile gebre" are the same recipient.
export function normaliseRecipientName(name: string | null): string | null {
  if (name === null) {
    return null;
  }
  const cleaned = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned === '' ? null : cleaned;
}

// What "remember for this recipient" is keyed by: the merchant / bill / payment code when there is one (a merchant's name changes with its
// branch, its code does not); otherwise the normalised name; with no name, the phone tail; with neither, the bank and account tail. Null
// when the message names nobody, so there is nothing to remember.
export function recipientKey(message: RecipientFields): string | null {
  if (message.counterpartyCode) {
    return `code:${message.counterpartyCode}`;
  }
  const name = normaliseRecipientName(message.counterpartyName);
  if (name !== null) {
    return `name:${name}`;
  }
  if (message.counterpartyPhoneTail) {
    return `phone:${message.counterpartyPhoneTail}`;
  }
  if (message.counterpartyAccountTail) {
    return `acct:${(message.counterpartyBank ?? '').toLowerCase().trim()}:${message.counterpartyAccountTail}`;
  }
  return null;
}

export function findRule(rules: RecipientRule[], key: string | null): RecipientRule | null {
  return key === null ? null : (rules.find((rule) => rule.key === key) ?? null);
}

const PHONE_LIKE = /phone|internet|airtime|\bdata\b|telecom|mobile/i;
const BILLS_LIKE = /bill|utilit|electric|water/i;

// The category a card starts with: the remembered one (only if it still exists for this direction), otherwise, for a package payment,
// a category named like Phone / Internet / Airtime / Data (airtime too) or Bills (bills) if the owner has one, otherwise none ('') and the
// card starts as Uncategorised.
export function suggestCategory(message: RecipientFields & Pick<SmsSuggestion, 'direction' | 'kind'>, rules: RecipientRule[], categories: Category[]): string {
  const wanted = message.direction === 'out' ? 'expense' : 'income';
  const valid = categories.filter((category) => category.type === wanted);
  const rule = findRule(rules, recipientKey(message));
  if (rule && valid.some((category) => category.name === rule.category)) {
    return rule.category;
  }
  if (message.direction === 'out') {
    // Packages and airtime go to a Phone / Internet-style category, bills to a Bills-style one, if the owner has them.
    const pattern = message.kind === 'package_payment' || message.kind === 'airtime' ? PHONE_LIKE : message.kind === 'bill_payment' ? BILLS_LIKE : null;
    const hinted = pattern ? valid.find((category) => category.name !== 'Fees' && pattern.test(category.name)) : undefined;
    if (hinted) {
      return hinted.name;
    }
  }
  return '';
}
