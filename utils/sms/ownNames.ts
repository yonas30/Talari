import { cleanName } from './shared';

// "Your name as banks write it" (V2_SPEC Part Z, Phase 6D-3). Pure. The owner's own names, used only by pairing rule 3: a message that names the
// owner as the other person is a hint that the movement is between the owner's own accounts. Never guessed from the messages.

export const MAX_OWN_NAMES = 20;
export const MAX_OWN_NAME_LENGTH = 60;

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'ato', 'wro', 'wzt', 'eng', 'sir', 'madam']);

// What two names are compared by: cleaned the way every name read from a message is, then lower case, letters and digits only, one space between
// words, and without a leading title. Two names are the same name when this is equal.
export function normaliseOwnName(raw: string | null | undefined): string {
  const cleaned = cleanName(raw ?? undefined) ?? '';
  const words = cleaned
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((word) => word !== '');
  while (words.length > 1 && TITLES.has(words[0])) words.shift();
  return words.join(' ');
}

// The text kept for a typed name: trimmed, spaces collapsed, cut at the limit (by characters, never in the middle of one). null when nothing is left.
export function cleanOwnNameInput(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed === '') return null;
  return Array.from(collapsed).slice(0, MAX_OWN_NAME_LENGTH).join('').trim();
}

// Why a name cannot be added (or saved over `editingIndex`), or null when it can. Case, spacing and punctuation do not make a new name.
export function ownNameProblem(names: readonly string[], raw: string, editingIndex: number | null = null): string | null {
  const text = cleanOwnNameInput(raw);
  if (text === null || normaliseOwnName(text) === '') return 'Type your name the way your bank prints it.';
  const key = normaliseOwnName(text);
  const clash = names.findIndex((name, index) => index !== editingIndex && normaliseOwnName(name) === key);
  if (clash !== -1) return `${names[clash]} is already on your list.`;
  if (editingIndex === null && names.length >= MAX_OWN_NAMES) return `You can keep up to ${MAX_OWN_NAMES} names.`;
  return null;
}

// Does the name a message prints for the other person (as read from the message) equal one of the owner's names? The WHOLE name must match: a short
// name never matches inside a longer different name, and a message with no name never matches.
export function matchesOwnName(printed: string | null | undefined, names: readonly string[]): boolean {
  const key = normaliseOwnName(printed);
  if (key === '') return false;
  return names.some((name) => normaliseOwnName(name) === key);
}
