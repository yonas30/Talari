import { AccountEntry, AccountsState, DateSource, MoneyAccount } from '../../types/accounts';
import { SmsSuggestion } from '../../types/sms';
import { formatAmount, fromCents, toCents } from '../accounts/money';
import { eligibleAccounts } from './accountMatch';
import { matchesOwnName } from './ownNames';
import { serviceFromSender } from './parse';
import { printedCharges } from './saveSuggestion';
import { SmsService } from './types';

// Pairing own-account transfers (V2_SPEC Part Z, Phase 6C-1). Pure: it only SUGGESTS. Nothing here changes a ledger.

// An entry the owner typed for what LEFT the account (amount + fee) can still be the sending side of a transfer whose message shows only the
// amount. How big a difference is believable as a fee when no sending message says what the fee was: the larger of 2% and ETB 100.
export const PAIR_FEE_TOLERANCE_PERCENT = 2;
export const PAIR_FEE_TOLERANCE_MIN = 100;
export const feeTolerance = (amount: number): number => Math.max(fromCents(Math.round((toCents(amount) * PAIR_FEE_TOLERANCE_PERCENT) / 100)), PAIR_FEE_TOLERANCE_MIN);

// How each service's name appears in another service's message ("received from Commercial Bank of Ethiopia", "by TeleBirr C2B").
const SERVICE_NAMES: Record<SmsService, RegExp> = {
  telebirr: /tele\s*-?\s*birr/i,
  cbe: /commercial\s+bank\s+of\s+ethiopia|\bcbe\b/i,
  boa: /bank\s+of\s+abyssinia|abyssinia|\bboa\b/i,
  awash: /awash/i,
};

export interface PairSide {
  kind: 'suggestion' | 'entry';
  id: string;
  accountId: string;
  direction: 'in' | 'out';
  amount: number;
  date: string;
  // A manual entry's date is the owner's own: 'manual'.
  dateSource: DateSource;
  occurredAt: string | null;
  reference: string | null;
  counterpartyBank: string | null;
  // The person the message names as the other side (the recipient of a debit, the sender of a credit). null for an entry.
  counterpartyName: string | null;
  // What the message printed as its charges (fee + VAT + other). 0 for an entry and for a message that prints none.
  printedFee: number;
  // Which message service it belongs to (a suggestion's own, or the service the entry's account is linked to).
  service: SmsService | null;
  rawHash: string | null;
  label: string;
}

// 'owner' (Phase 6D-3) is the weakest: one side names the owner themselves. See evaluate and searchPairs.
export type PairRule = 'reference' | 'names' | 'owner';
const RULE_ORDER: Record<PairRule, number> = { reference: 0, names: 1, owner: 2 };

export interface PairCandidate {
  // Stable for the same two messages, whatever order they are in: what "not a pair" is remembered by.
  key: string;
  rule: PairRule;
  out: PairSide;
  inn: PairSide;
  fromAccountId: string;
  toAccountId: string;
  // What moves between the accounts: the RECEIVING side's amount (the sending entry may be larger by the fee).
  amount: number;
  // An ordinary entry that already records one side. Set when a side IS an entry, or when a side's message already has a manual entry
  // for it (the same account and day, and the amount, or the amount plus the fee). Accepting is then a conversion of that entry, never
  // a second record.
  existingEntryId: string | null;
  // True when the existing entry stands in for a side that ALSO has a pending message (so "add as new" would record it twice).
  existingDuplicatesAMessage: boolean;
  // How much LARGER the sending entry is than the transfer: the difference that becomes the transfer's linked fee (0 when equal).
  feeFromEntry: number;
  // More than one of the owner's entries could be the same movement: none is offered, because converting the wrong one would be a mistake.
  ambiguousEntryIds: string[];
}

export interface PairNotice {
  key: string;
  message: string;
  // The waiting messages the note is about. A batch that saves "everything clean" leaves them alone (they could be one movement).
  heldIds?: string[];
}

const accountService = (account: MoneyAccount | undefined): SmsService | null => {
  if (!account) return null;
  const fromSender = serviceFromSender(account.smsSender);
  if (fromSender) return fromSender;
  return (Object.keys(SERVICE_NAMES) as SmsService[]).find((service) => SERVICE_NAMES[service].test(account.name)) ?? null;
};

const normaliseName = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Does `bankText` (what one message prints for the other side) name the account that the other side is in?
function namesAccount(bankText: string | null, other: PairSide, accounts: MoneyAccount[]): boolean {
  if (!bankText) return false;
  if (other.service && SERVICE_NAMES[other.service].test(bankText)) return true;
  const account = accounts.find((item) => item.id === other.accountId);
  if (!account) return false;
  const a = normaliseName(account.name);
  const b = normaliseName(bankText);
  return a.length >= 3 && b.length >= 3 && (b.includes(a) || a.includes(b));
}

export function pairKey(x: PairSide, y: PairSide): string {
  const id = (side: PairSide) => (side.kind === 'suggestion' ? `s:${side.rawHash ?? side.id}` : `e:${side.id}`);
  return [id(x), id(y)].sort().join('|');
}

function suggestionSide(s: SmsSuggestion, accounts: MoneyAccount[]): PairSide | null {
  const usable = eligibleAccounts(accounts).find((account) => account.id === s.accountId);
  if (!usable || s.status !== 'pending') return null;
  return {
    kind: 'suggestion',
    id: s.id,
    accountId: usable.id,
    direction: s.direction,
    amount: s.amount,
    date: s.date,
    dateSource: s.dateSource,
    occurredAt: s.occurredAt,
    reference: s.reference,
    counterpartyBank: s.counterpartyBank,
    counterpartyName: s.counterpartyName,
    printedFee: s.direction === 'out' ? printedCharges(s) : 0,
    service: s.service,
    rawHash: s.rawHash,
    label: s.counterpartyName ?? s.counterpartyBank ?? s.service,
  };
}

// An ordinary income or expense an owner (or an earlier import) saved. Never an opening, adjustment, transfer, a fee, a recurring row, or
// one in a foreign currency.
export function isConvertibleEntry(entry: AccountEntry, accounts: MoneyAccount[]): boolean {
  if (entry.type !== 'income' && entry.type !== 'expense') return false;
  if (entry.linkedTransferId !== null || entry.isAutomatic || entry.category === 'Fees') return false;
  return eligibleAccounts(accounts).some((account) => account.id === entry.accountId) && entry.currency === 'ETB';
}

function entrySide(entry: AccountEntry, accounts: MoneyAccount[]): PairSide {
  const account = accounts.find((item) => item.id === entry.accountId);
  return {
    kind: 'entry',
    id: entry.id,
    accountId: entry.accountId as string,
    direction: entry.type === 'expense' ? 'out' : 'in',
    amount: entry.amount,
    date: entry.date,
    dateSource: entry.dateSource ?? 'manual',
    occurredAt: null,
    reference: null,
    counterpartyBank: null,
    counterpartyName: null,
    printedFee: 0,
    service: accountService(account),
    rawHash: null,
    label: entry.source || entry.category || 'Your entry',
  };
}

// Does an entry's amount stand for the SENDING side's movement? Exactly the transfer amount, or larger by the fee. When the sending message
// prints a fee the entry must be exactly amount + that fee; otherwise any positive difference up to the tolerance is believable.
// Returns the difference (>= 0) that would become the fee, or null when it does not match.
function amountDifference(transferAmount: number, entryAmount: number, printedFee: number): number | null {
  const diff = toCents(entryAmount) - toCents(transferAmount);
  if (diff === 0) return 0;
  if (diff < 0) return null;
  if (printedFee > 0) return diff === toCents(printedFee) ? fromCents(diff) : null;
  return diff <= toCents(feeTolerance(transferAmount)) ? fromCents(diff) : null;
}

// Does one outgoing and one incoming side describe a single movement between two accounts of the owner? Returns the rule and, when the
// sending side is an entry that includes a fee, the difference. null when they do not match.
function evaluate(out: PairSide, inn: PairSide, accounts: MoneyAccount[], ownNames: readonly string[]): { rule: PairRule; feeDiff: number } | null {
  if (out.direction !== 'out' || inn.direction !== 'in') return null;
  if (out.accountId === inn.accountId) return null;
  if (out.kind === 'entry' && inn.kind === 'entry') return null;
  // Only a sending ENTRY can be larger than what arrived (it records what left, fee included); two messages must agree exactly.
  const feeDiff = out.kind === 'entry' ? amountDifference(inn.amount, out.amount, 0) : toCents(out.amount) === toCents(inn.amount) ? 0 : null;
  if (feeDiff === null) return null;
  if (out.reference !== null && out.reference !== '' && out.reference === inn.reference) return { rule: 'reference', feeDiff };
  if (out.date === inn.date && (namesAccount(out.counterpartyBank, inn, accounts) || namesAccount(inn.counterpartyBank, out, accounts))) return { rule: 'names', feeDiff };
  // Rule 3: the sending message names the owner as who it went to, or the receiving message names the owner as who it came from.
  if (out.date === inn.date && (matchesOwnName(out.counterpartyName, ownNames) || matchesOwnName(inn.counterpartyName, ownNames))) return { rule: 'owner', feeDiff };
  return null;
}

// Every saved entry that records this side already: the same account and day, in the direction the side goes, with the amount (or, for a
// sending side, the amount plus its fee). More than one means we cannot tell which is the real one.
function matchingEntries(side: PairSide, entries: AccountEntry[], accounts: MoneyAccount[]): Array<{ entry: AccountEntry; diff: number }> {
  if (side.kind !== 'suggestion') return [];
  const type = side.direction === 'out' ? 'expense' : 'income';
  const found: Array<{ entry: AccountEntry; diff: number }> = [];
  for (const entry of entries) {
    if (entry.type !== type || entry.accountId !== side.accountId || entry.date !== side.date || !isConvertibleEntry(entry, accounts)) continue;
    const exact = toCents(entry.amount) === toCents(side.amount);
    const diff = exact ? 0 : side.direction === 'out' ? amountDifference(side.amount, entry.amount, side.printedFee) : null;
    if (diff !== null) found.push({ entry, diff });
  }
  return found;
}

const describeEntry = (entry: AccountEntry): string => `ETB ${formatAmount(entry.amount)} on ${entry.date}`;

export interface PairSearch {
  candidates: PairCandidate[];
  // Possible transfers that are NOT offered because more than one of the owner's entries could be one side, with the reason.
  notices: PairNotice[];
}

// Every pair that could be offered, strongest rule first, and the near-pairs that are held back as ambiguous. A message can appear in more
// than one candidate; use selectPairs to show each only once.
export function searchPairs(state: AccountsState, suggestions: SmsSuggestion[], rejectedKeys: ReadonlySet<string> = new Set(), ownNames: readonly string[] = []): PairSearch {
  const accounts = state.accounts;
  const sides: PairSide[] = [];
  for (const s of suggestions) {
    const side = suggestionSide(s, accounts);
    if (side) sides.push(side);
  }
  const entries = state.entries.filter((entry) => isConvertibleEntry(entry, accounts)).map((entry) => entrySide(entry, accounts));
  const found: PairCandidate[] = [];
  const seen = new Set<string>();

  const consider = (a: PairSide, b: PairSide) => {
    const out = a.direction === 'out' ? a : b;
    const inn = a.direction === 'out' ? b : a;
    const match = evaluate(out, inn, accounts, ownNames);
    if (!match) return;
    const key = pairKey(out, inn);
    if (seen.has(key) || rejectedKeys.has(key)) return;
    seen.add(key);

    let existingEntryId: string | null = null;
    let duplicates = false;
    let feeFromEntry = match.feeDiff;
    let ambiguous: string[] = [];
    if (out.kind === 'entry' || inn.kind === 'entry') {
      existingEntryId = (out.kind === 'entry' ? out : inn).id;
    } else {
      // Two messages: is one of them already in the ledger as an entry the owner typed?
      const outMatches = matchingEntries(out, state.entries, accounts);
      const inMatches = matchingEntries(inn, state.entries, accounts);
      const all = [...outMatches.map((m) => ({ ...m, side: 'out' as const })), ...inMatches.map((m) => ({ ...m, side: 'in' as const }))];
      if (all.length === 1) {
        existingEntryId = all[0].entry.id;
        duplicates = true;
        feeFromEntry = all[0].side === 'out' ? all[0].diff : 0;
      } else if (all.length > 1) {
        ambiguous = all.map((m) => m.entry.id);
      }
    }
    found.push({
      key, rule: match.rule, out, inn, fromAccountId: out.accountId, toAccountId: inn.accountId, amount: inn.amount,
      existingEntryId, existingDuplicatesAMessage: duplicates, feeFromEntry, ambiguousEntryIds: ambiguous,
    });
  };

  for (let i = 0; i < sides.length; i += 1) {
    for (let j = i + 1; j < sides.length; j += 1) {
      consider(sides[i], sides[j]);
    }
    for (const entry of entries) {
      consider(sides[i], entry);
    }
  }

  // A message that matches MORE THAN ONE of the owner's entries is not offered with any of them: converting the wrong one would record a
  // different movement as a transfer. It is reported instead, so the owner can fix the extra entry.
  const notices: PairNotice[] = [];
  const entryCandidates = new Map<string, PairCandidate[]>();
  for (const candidate of found) {
    const messageSide = candidate.out.kind === 'suggestion' ? candidate.out : candidate.inn.kind === 'suggestion' ? candidate.inn : null;
    const entryEnd = candidate.out.kind === 'entry' || candidate.inn.kind === 'entry';
    if (entryEnd && messageSide) {
      entryCandidates.set(messageSide.id, [...(entryCandidates.get(messageSide.id) ?? []), candidate]);
    }
  }
  const dropped = new Set<string>();
  for (const [messageId, list] of entryCandidates) {
    if (list.length < 2) continue;
    list.forEach((candidate) => dropped.add(candidate.key));
    const sample = list[0];
    const entryOf = (c: PairCandidate) => state.entries.find((entry) => entry.id === c.existingEntryId);
    const names = list.map((c) => entryOf(c)).filter((entry): entry is AccountEntry => !!entry).map(describeEntry).join(' and ');
    const account = accounts.find((item) => item.id === (sample.out.kind === 'entry' ? sample.out.accountId : sample.inn.accountId))?.name ?? 'an account';
    notices.push({
      key: `ambiguous:${messageId}`,
      message: `A message of ETB ${formatAmount(sample.amount)} could be a transfer, but more than one of your entries in ${account} could be its other side (${names}). Remove or change the extra one and the offer will appear.`,
    });
  }

  // Rule 3 is only a hint, so it is offered only when nothing else is in the way:
  //  - not for a movement that rules 1 or 2 already offer in another pair (that pair wins; this one is not needed);
  //  - and only when it is unambiguous: if one movement fits rule 3 with more than one other movement, none of them is offered.
  const live = found.filter((candidate) => !dropped.has(candidate.key));
  const sideKeys = (c: PairCandidate) => [c.out, c.inn].map((side) => `${side.kind}:${side.id}`);
  const strong = new Set(live.filter((c) => c.rule !== 'owner').flatMap(sideKeys));
  const ownerCandidates = live.filter((c) => c.rule === 'owner' && !sideKeys(c).some((key) => strong.has(key)));
  const bySide = new Map<string, PairCandidate[]>();
  for (const candidate of ownerCandidates) {
    for (const key of sideKeys(candidate)) bySide.set(key, [...(bySide.get(key) ?? []), candidate]);
  }
  const ambiguousOwner = new Set<string>();
  for (const [sideKey, list] of bySide) {
    if (list.length < 2) continue;
    list.forEach((candidate) => ambiguousOwner.add(candidate.key));
    const sample = list[0];
    const here = [sample.out, sample.inn].find((side) => `${side.kind}:${side.id}` === sideKey) as PairSide;
    const others = list.map((c) => (`${c.out.kind}:${c.out.id}` === sideKey ? c.inn : c.out));
    const describe = (side: PairSide) => `${side.direction === 'out' ? 'sent' : 'received'} ETB ${formatAmount(side.amount)} in ${accounts.find((item) => item.id === side.accountId)?.name ?? 'an account'}`;
    notices.push({
      key: `owner-ambiguous:${sideKey}`,
      heldIds: [here, ...others].filter((side) => side.kind === 'suggestion').map((side) => side.id),
      message: `Your own name is on a message of ETB ${formatAmount(sample.amount)} on ${here.date}, which could be a transfer between your accounts, but more than one other movement fits it (${others.map(describe).join(' and ')}). Nothing is offered. Skip or fix one of them and the offer will appear.`,
    });
  }

  const messages = (c: PairCandidate) => [c.out, c.inn].filter((side) => side.kind === 'suggestion').length;
  // Strongest rule first; then two messages before a message plus an entry (so one real movement is shown once, with both messages); then oldest.
  const candidates = live
    .filter((candidate) => !ambiguousOwner.has(candidate.key) && !(candidate.rule === 'owner' && !ownerCandidates.includes(candidate)))
    .sort((a, b) => (a.rule === b.rule ? messages(b) - messages(a) || a.out.date.localeCompare(b.out.date) : RULE_ORDER[a.rule] - RULE_ORDER[b.rule]));
  return { candidates, notices };
}

export const findPairs = (state: AccountsState, suggestions: SmsSuggestion[], rejectedKeys: ReadonlySet<string> = new Set(), ownNames: readonly string[] = []): PairCandidate[] =>
  searchPairs(state, suggestions, rejectedKeys, ownNames).candidates;

// One card per message: when a message is in several candidates, the strongest keeps it and the others wait (they come back if that pair
// is rejected). An entry can also be claimed by one pair only.
export function selectPairs(candidates: PairCandidate[]): PairCandidate[] {
  const used = new Set<string>();
  const chosen: PairCandidate[] = [];
  for (const candidate of candidates) {
    const ids = [candidate.out, candidate.inn].map((side) => `${side.kind}:${side.id}`);
    if (candidate.existingEntryId) ids.push(`entry:${candidate.existingEntryId}`);
    if (ids.some((id) => used.has(id))) continue;
    ids.forEach((id) => used.add(id));
    chosen.push(candidate);
  }
  return chosen;
}

// The ids of the pending messages a card stands for (their own cards are hidden while the pair card is shown).
export const pairedSuggestionIds = (candidates: PairCandidate[]): Set<string> =>
  new Set(candidates.flatMap((candidate) => [candidate.out, candidate.inn]).filter((side) => side.kind === 'suggestion').map((side) => side.id));

// ---- dates ------------------------------------------------------------------------------------------------------------------------------

// Lower wins. A date the owner set beats everything; then message > paired > receipt > batch (V2_SPEC Part Z).
const RANK: Record<DateSource, number> = { manual: 0, message: 1, paired: 2, receipt: 3, batch: 4 };

export interface PairDate {
  date: string;
  source: DateSource;
  // The side whose date was taken, and so whose printed time (if any) becomes the timestamp.
  from: PairSide;
  // Messages whose own date was weaker and is recorded as 'paired' with this one.
  upgraded: PairSide[];
  // "The dates disagree": a receipt date more than a day from the date taken. A warning only.
  disagrees: boolean;
}

const dayNumber = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

export function decidePairDate(out: PairSide, inn: PairSide): PairDate {
  const sides = [out, inn];
  const best = [...sides].sort((a, b) => RANK[a.dateSource] - RANK[b.dateSource] || (a.occurredAt !== null ? 0 : 1) - (b.occurredAt !== null ? 0 : 1) || (a === out ? -1 : 1))[0];
  const upgraded = sides.filter((side) => side !== best && side.kind === 'suggestion' && (side.dateSource === 'receipt' || side.dateSource === 'batch') && RANK[side.dateSource] > RANK[best.dateSource]);
  const disagrees = sides.some((side) => side !== best && side.dateSource === 'receipt' && Math.abs(dayNumber(side.date) - dayNumber(best.date)) > 1);
  return { date: best.date, source: best.dateSource, from: best, upgraded, disagrees };
}
