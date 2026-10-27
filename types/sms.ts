import { ParsedBody } from '../utils/sms/types';
import type { DateSource } from './accounts';

// Phase 6B (V2_SPEC Part Z). A staged message: what the parser read plus what the owner has chosen so far. The message text itself is
// never kept, only its hash.
export type SuggestionStatus = 'pending' | 'confirmed' | 'ignored';

export type SmsSuggestion = ParsedBody & {
  id: string;
  rawHash: string;
  status: SuggestionStatus;
  // The ETB account chosen or matched, null until there is one. Checked against the live accounts before use: it may have been deleted.
  accountId: string | null;
  // Chosen category name; '' until chosen.
  category: string;
  // The fee line as edited. null = nothing edited, so the printed charges are used.
  feeAmount: number | null;
  // The day the entry will be dated (YYYY-MM-DD): the message's own date, or the batch date for CBE / BOA.
  date: string;
  // Where `date` came from. Read from a row that has none as 'message' (it has a printed time) or 'batch'.
  dateSource: DateSource;
  createdAt: string;
  confirmedEntryId: string | null;
};

// "Remember for this recipient": the category last used for a recipient, found again by key.
export interface RecipientRule {
  key: string;
  category: string;
  lastUsed: string;
}
