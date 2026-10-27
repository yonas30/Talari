// A chat export puts "[10/20/2026 3:42 PM] Name: " (or "20/10/2026, 3:42 PM - Name: ") in front of every message. It is not part of the
// message, and it would make the same message hash differently depending on how it was copied.
const CHAT_PREFIX = new RegExp(
  '^\\s*(?:\\[[^\\]\\n]{4,40}\\]\\s*[^:\\n]{1,60}:|\\d{1,2}/\\d{1,2}/\\d{2,4},?\\s+\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s*[AaPp][Mm])?\\s+-\\s+[^:\\n]{1,60}:)\\s*',
);

// Removes one leading chat prefix and says whether there was one (the pasted line then starts a new message).
export function stripChatPrefix(line: string): { text: string; had: boolean } {
  const m = CHAT_PREFIX.exec(line);
  return m ? { text: line.slice(m[0].length), had: true } : { text: line, had: false };
}

// Telebirr ends some messages with a support block (Send SMS to 126, Telegram, Facebook, website). It is boilerplate, and it is removed
// up to the "Thank you for using telebirr" line so messages with and without it are the same message.
const TELEBIRR_SUPPORT_FOOTER = /For any support and information related to telebirr service[\s\S]*?(?=Thank you for using telebirr|$)/gi;

// The text every parser sees: one line, single spaces, and without the chat prefix, the Telebirr support block and the "Alert:" security
// notice some Awash messages end with (all boilerplate, and each would make the same transaction hash differently depending on whether
// it was pasted).
export function normalise(text: string): string {
  return stripChatPrefix(text.replace(/\r\n?/g, '\n'))
    .text.replace(TELEBIRR_SUPPORT_FOOTER, ' ')
    .replace(/\bAlert:[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const FNV_OFFSET = BigInt('0xcbf29ce484222325');
const FNV_PRIME = BigInt('0x100000001b3');

function utf8Bytes(s: string): number[] {
  const bytes: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return bytes;
}

// FNV-1a, 64 bit, over the UTF-8 bytes. It only has to be the same for the same message on any device, so a small pure hash is enough
// (nothing here is secret) and keeps this module free of Expo imports.
export function fnv1a64(s: string): string {
  let hash = FNV_OFFSET;
  for (const byte of utf8Bytes(s)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * FNV_PRIME);
  }
  return hash.toString(16).padStart(16, '0');
}

export const hashNormalised = (normalised: string): string => fnv1a64(normalised);
