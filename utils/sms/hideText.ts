// "Copy this message with names and numbers hidden" (V2_SPEC Part Z, Phase 6D-2). Pure.
//
// BEST EFFORT, never a promise of anonymity: an unusual way of writing a name can be missed, so the screen always tells the owner to check the
// copy before sharing it. What it keeps is what makes a message useful to look at: amounts, balances, dates, times and the wording. What it
// replaces with XXXX is anything that says who or which account: names, phone and account numbers, ids, links and every other run of digits.

export const HIDDEN = 'XXXX';

// Shown next to the button, and the only way the app describes the copy.
export const HIDDEN_COPY_NOTE = 'Hidden as far as possible: names, numbers and links are replaced with XXXX, but this is not guaranteed. Check it before you share it.';

// Words that can follow "to / from / by / at / Dear" without being a person: the services and banks, and the words of the sentence around them.
const NOT_A_NAME = new Set([
  'account', 'acct', 'commercial', 'bank', 'ethiopia', 'ethiopian', 'cbe', 'awash', 'telebirr', 'tele', 'birr', 'ips', 'c2b', 'boa', 'abyssinia', 'dashen', 'etb',
  'customer', 'you', 'your', 'the', 'this', 'that', 'it', 'thank', 'thanks', 'thank', 'ethio', 'telecom', 'm-pesa', 'mpesa', 'visa', 'atm', 'pos', 'vat', 'sms', 'e-money',
]);
const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'eng', 'ato', 'wro', 'wzt', 'sir', 'madam']);

const MONTHS = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*';

// Everything that is kept as it is. Each pattern is applied in this order; a kept piece is parked behind a placeholder so no later rule touches it.
const KEEP: RegExp[] = [
  // the figure after "balance" (with or without ETB, with or without decimals)
  /(\bbalance\b[^0-9\n]{0,30}?)(?:ETB|Birr|Br\.?)?\s*-?\s*\d[\d,]*(?:\.\d+)?/gi,
  // dates and times
  /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/g,
  /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g,
  /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?\b/g,
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?[ -]${MONTHS}\\.?,?[ -]*\\d{2,4}\\b`, 'gi'),
  new RegExp(`\\b${MONTHS}\\.? \\d{1,2}(?:st|nd|rd|th)?,? \\d{2,4}\\b`, 'gi'),
  // amounts: after ETB / Birr, or before it, or any figure with decimals
  /(?:ETB|Birr|Br\.?)\s*-?\s*\d[\d,]*(?:\.\d+)?/gi,
  /-?\d[\d,]*(?:\.\d+)?\s*(?:ETB|Birr)\b/gi,
  /\d+(?:\.\d+)?%/g,
];
// A bare figure with one or two decimals ("of 0.03") that is not part of a longer token.
const BARE_DECIMAL = /(^|[^\w*.])(-?\d[\d,]*\.\d{1,2})(?![\w*])/g;

const PLACEHOLDER_OPEN = '';
const PLACEHOLDER_CLOSE = '';

// A name word: starts with a capital letter, or is a name the bank half-hid with x's ("Gxxx", "dxxxxx").
const isNameWord = (word: string): boolean => {
  const bare = word.replace(/\(.*$/, '').replace(/[.,;:]+$/, '');
  if (bare === '' || NOT_A_NAME.has(bare.toLowerCase())) return false;
  return /^[A-Z]/.test(bare) || /x{3,}/i.test(bare);
};

// After a keyword, masks the run of name words that follows (titles stay). One XXXX stands for the whole run.
function maskNameRuns(text: string): string {
  // (no look-behind: not every JavaScript engine has it)
  const keyword = /(^|[\s(])(dear|to|from|by|at|-)(?=[ \t])/gi;
  let out = '';
  let last = 0;
  for (const match of text.matchAll(keyword)) {
    const start = (match.index ?? 0) + match[0].length;
    if (start < last) continue;
    let at = start;
    let runStart = -1;
    let runEnd = -1;
    for (let guard = 0; guard < 6; guard += 1) {
      const gap = /^[ \t]+/.exec(text.slice(at));
      if (!gap) break;
      const wordMatch = /^[A-Za-z][A-Za-z'-]*(?:\.[A-Za-z]+)*(?:\([^)\n]*\))?/.exec(text.slice(at + gap[0].length));
      if (!wordMatch) break;
      const word = wordMatch[0];
      const next = at + gap[0].length + word.length;
      if (TITLES.has(word.toLowerCase().replace(/\.$/, ''))) {
        at = next;
        continue;
      }
      if (!isNameWord(word)) break;
      if (runStart === -1) runStart = at + gap[0].length;
      runEnd = next;
      at = next;
    }
    if (runStart !== -1) {
      out += text.slice(last, runStart) + HIDDEN;
      last = runEnd;
    }
  }
  return out + text.slice(last);
}

// Hides one message. Line breaks stay.
export function hideMessageText(input: string): string {
  let text = input.replace(/\r\n?/g, '\n').trim();

  // links first: a receipt link carries the transaction id
  text = text.replace(/(?:https?:\/\/|www\.)\S+/gi, HIDDEN);
  // the name in a chat export's prefix ("[10/20/2026 3:42 PM] Name:" or "20/10/2026, 3:42 PM - Name:")
  text = text.replace(/^(\s*\[[^\]\n]{4,40}\]\s*)[^:\n]{1,60}(:)/gm, `$1${HIDDEN}$2`);
  text = text.replace(/^(\s*\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?\s+-\s+)[^:\n]{1,60}(:)/gm, `$1${HIDDEN}$2`);

  // park what is kept
  const kept: string[] = [];
  const park = (piece: string): string => {
    kept.push(piece);
    return `${PLACEHOLDER_OPEN}${String.fromCharCode(0xe100 + kept.length - 1)}${PLACEHOLDER_CLOSE}`;
  };
  text = text.replace(KEEP[0], (whole, lead: string) => `${lead}${park(whole.slice(lead.length))}`);
  for (const pattern of KEEP.slice(1)) {
    text = text.replace(pattern, (whole) => park(whole));
  }
  text = text.replace(BARE_DECIMAL, (_whole, lead: string, figure: string) => `${lead}${park(figure)}`);

  // ids: after "transaction number / reference / txn id / receipt", a token with a digit (the digit rule below also catches it) or a long run of capitals
  text = text.replace(
    /\b(transaction\s*(?:number|no\.?|id)|txn\s*(?:id|no\.?)?|reference(?:\s*(?:number|no\.?))?|ref\.?|re[c]?[ie]{1,2}pt|trx)((?:\s+is)?\s*[:-]?\s+)([A-Za-z0-9&_-]{4,}(?:[./][A-Za-z0-9&_-]+)*)/gi,
    (whole, label: string, gap: string, token: string) => (/\d/.test(token) || /^[A-Z]{6,}$/.test(token) ? `${label}${gap}${HIDDEN}` : whole),
  );

  text = maskNameRuns(text);
  // a name in brackets ("(Fiker Mulu Alem)"), but not a service word or a percentage
  text = text.replace(/\(\s*([A-Za-z][A-Za-z .'-]{1,50}?)\s*\)/g, (whole, inner: string) => {
    const words = inner.split(/\s+/);
    return /^[A-Z]/.test(inner) && !words.every((word) => NOT_A_NAME.has(word.toLowerCase())) ? `(${HIDDEN})` : whole;
  });
  // a name the bank already half-hid, wherever it stands
  text = text.replace(/\b[A-Za-z]*[xX]{3,}[A-Za-z]*\b/g, HIDDEN);
  // every other token that has a digit in it: phone and account numbers (digits, stars, x's), tails, ids, package sizes
  text = text.replace(/[A-Za-z0-9*_-]*\d[A-Za-z0-9*_-]*/g, HIDDEN);

  // bring back what was kept
  text = text.replace(new RegExp(`${PLACEHOLDER_OPEN}(.)${PLACEHOLDER_CLOSE}`, 'g'), (_whole, code: string) => kept[code.charCodeAt(0) - 0xe100] ?? '');
  return text;
}
