import { stripChatPrefix } from './normalise';

// Cuts a pasted block into separate messages. A message starts at a line beginning with "Dear", at a line with a chat-export prefix
// ("[date time] Name:", which is removed), or at the first line after a blank line, except a paragraph starting with "Alert:", which stays
// attached to the message above it (the parser drops it later). Text before the
// first "Dear" becomes its own item, so nothing pasted is lost, and the pieces are returned trimmed with plain "\n" line endings.
export function splitMessages(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const messages: string[][] = [];
  let current: string[] | null = null;
  let afterBlank = true;

  for (const rawLine of lines) {
    const prefix = stripChatPrefix(rawLine);
    const trimmed = prefix.text.trim();
    if (trimmed === '') {
      afterBlank = true;
      if (current) current.push('');
      continue;
    }
    const startsNew = prefix.had || /^Dear\b/i.test(trimmed) || (afterBlank && !/^Alert:/i.test(trimmed));
    if (startsNew || current === null) {
      current = [];
      messages.push(current);
    }
    current.push(trimmed);
    afterBlank = false;
  }

  return messages.map((m) => m.join('\n').trim()).filter((m) => m !== '');
}
