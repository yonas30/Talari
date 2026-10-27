// Known footers and greetings that can end up as a piece of their own when a paste is cut at blank lines (V2_SPEC Part Z, "Boilerplate
// pieces"). Each pattern must match the WHOLE piece, so the same words inside a real message, or a piece with anything else in it, are
// never taken for boilerplate: an unknown fragment still shows under "Not transactions".
const BOILERPLATE: RegExp[] = [
  // Telebirr
  /^Thank you for using telebirr\.?(?: Ethio ?telecom\.?)?$/i,
  /^Ethio ?telecom\.?$/i,
  // A lone greeting. At most three words after "Dear", so a sentence that starts with "Dear" is not one.
  /^Dear\s+[\p{L}'’.-]+(?:\s+[\p{L}'’.-]+){0,2}\s*[,:]?$/iu,
  // Awash
  /^Alert:.{0,200}\bnever ask for your PIN\b.{0,200}$/i,
  // CBE
  /^Thank(?:s| you) for Banking with CBE\s*[!.]*$/i,
  /^(?:Thank(?:s| you) for Banking with CBE\s*[!.]*\s*)?For (?:feedback|Reciept|receipt)\b.{0,160}$/i,
  // Bank of Abyssinia
  /^Link your Fayda\b.{0,160}$/i,
  /^For help,? call\b.{0,80}$/i,
];

// Whitespace is collapsed first: a footer split over lines ("Thank you for using telebirr" / "Ethio telecom") is one piece.
export function isBoilerplate(piece: string): boolean {
  const text = piece.replace(/\s+/g, ' ').trim();
  return text !== '' && BOILERPLATE.some((pattern) => pattern.test(text));
}
