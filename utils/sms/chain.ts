import { SmsSuggestion } from '../../types/sms';
import { formatAmount, fromCents, toCents } from '../accounts/money';
import { eligibleAccounts } from './accountMatch';
import { timestampFromOccurredAt } from './dateSource';
import { effectiveFee } from './saveSuggestion';
import { MoneyAccount } from '../../types/accounts';

// The balance chain (V2_SPEC Part Z, Phase 6C-2). Pure. Most messages print the balance AFTER the transaction, so each one can be checked
// against the one before it: previous balance + what came in, or - what went out (and its fees), must equal its own balance.

export interface ChainItem {
  id: string;
  accountId: string;
  date: string;
  // Only a time the message printed AND that is still the message's own date (an owner-edited date has no matching time).
  occurredAt: string | null;
  direction: 'in' | 'out';
  amount: number;
  // What the message charged on top: its printed charges, or the fee the owner set on the card.
  fees: number;
  balanceAfter: number | null;
  // True when the message printed no charges and the owner has not set a fee: the only case in which a larger drop can be an unprinted fee.
  noFeeKnown: boolean;
  // True when the date is only the batch date chosen on the paste screen (a guess: a message imported later gets a later date than the day it
  // really happened). Such a message is ordered by the balance chain, not by its date.
  estimated: boolean;
  // Input position, for a stable order when nothing else decides it.
  position: number;
}

export function chainItemOf(s: SmsSuggestion, position: number): ChainItem | null {
  if (s.accountId === null) {
    return null;
  }
  return {
    id: s.id,
    accountId: s.accountId,
    date: s.date,
    occurredAt: s.dateSource === 'message' ? s.occurredAt : null,
    direction: s.direction,
    amount: s.amount,
    fees: effectiveFee(s),
    balanceAfter: s.balanceAfter,
    noFeeKnown: s.direction === 'out' && s.fee === null && s.vat === null && s.otherCharge === null && s.feeAmount === null,
    estimated: s.dateSource === 'batch',
    position,
  };
}

// How the balance moves because of this message, in cents: money in adds its amount; money out takes its amount and its fees.
export const effectCents = (item: ChainItem): number => (item.direction === 'in' ? toCents(item.amount) : -(toCents(item.amount) + toCents(item.fees)));

const follows = (a: ChainItem, b: ChainItem): boolean => a.balanceAfter !== null && b.balanceAfter !== null && toCents(a.balanceAfter) + effectCents(b) === toCents(b.balanceAfter);

const byTimeThenPosition = (a: ChainItem, b: ChainItem): number =>
  a.occurredAt !== null && b.occurredAt !== null ? a.occurredAt.localeCompare(b.occurredAt) || a.position - b.position : a.position - b.position;

// One day's messages in the order they happened. If every message has a printed time, the times decide. Otherwise the balance chain does:
// start from a message that nothing in the day leads to, and keep taking the message whose balance follows from the last one. A break in the
// chain starts a new run; messages with no balance go where their time says, else last.
export function orderDay(items: ChainItem[]): ChainItem[] {
  if (items.length <= 1) {
    return [...items];
  }
  if (items.every((item) => item.occurredAt !== null)) {
    return [...items].sort(byTimeThenPosition);
  }
  const withBalance = items.filter((item) => item.balanceAfter !== null);
  const without = items.filter((item) => item.balanceAfter === null).sort(byTimeThenPosition);
  const placed = new Set<string>();
  const sequence: ChainItem[] = [];
  const remaining = () => withBalance.filter((item) => !placed.has(item.id));

  while (remaining().length > 0) {
    const left = remaining();
    // A start has no predecessor among the messages still unplaced; if every one has (a loop), take the earliest.
    const starts = left.filter((candidate) => !left.some((other) => other.id !== candidate.id && follows(other, candidate)));
    let current = [...(starts.length > 0 ? starts : left)].sort(byTimeThenPosition)[0];
    for (;;) {
      placed.add(current.id);
      sequence.push(current);
      const next = withBalance.filter((item) => !placed.has(item.id) && follows(current, item)).sort(byTimeThenPosition)[0];
      if (!next) break;
      current = next;
    }
  }
  // Messages with no balance: by time among the sequence where they have one, otherwise at the end.
  for (const item of without) {
    if (item.occurredAt === null) {
      sequence.push(item);
      continue;
    }
    const at = sequence.findIndex((other) => other.occurredAt !== null && other.occurredAt > (item.occurredAt as string));
    sequence.splice(at === -1 ? sequence.length : at, 0, item);
  }
  return sequence;
}

// Does `a` lead to `b`? 1 when both print a balance and it does NOT follow, otherwise 0 (a message with no balance can neither break nor make a link).
const breaks = (a: ChainItem | undefined, b: ChainItem | undefined): number => (a && b && a.balanceAfter !== null && b.balanceAfter !== null && !follows(a, b) ? 1 : 0);

// Splits an order into runs of messages that each lead to the next (a break in the chain starts a new run).
function runsOf(order: ChainItem[]): ChainItem[][] {
  const runs: ChainItem[][] = [];
  order.forEach((item, index) => {
    if (index > 0 && breaks(order[index - 1], item) === 0) {
      runs[runs.length - 1].push(item);
    } else {
      runs.push([item]);
    }
  });
  return runs;
}

// The order of ALL of an account's messages. Messages with a firm date (printed, taken from a receipt, set by the owner) stay in date order.
// A message whose date is only the batch date chosen on the paste screen is a guess (it was imported on that day, not necessarily sent on it),
// so a run of such messages that follow each other is moved, as a whole, to where the balance chain fits it best: the place that leaves the
// fewest broken links. It only moves if that is strictly better, so a run that fits nowhere stays near its date. This is what puts a missing
// message pasted later back between its neighbours, and messages imported on different days back in the order the bank sent them.
export function orderAccount(items: ChainItem[]): ChainItem[] {
  const days = [...new Set(items.map((item) => item.date))].sort();
  const base = days.flatMap((day) => orderDay(items.filter((item) => item.date === day)));
  if (!base.some((item) => item.estimated && item.balanceAfter !== null) || base.length < 2) {
    return base;
  }
  let runs = runsOf(base);
  // Repeat until a whole pass moves nothing. It always ends: every move strictly lowers the number of broken links; the cap is for safety.
  for (let pass = 0; pass < 25; pass += 1) {
    let moved = false;
    for (let from = 0; from < runs.length; from += 1) {
      const run = runs[from];
      if (!run.every((item) => item.estimated)) continue;
      const first = run[0];
      const last = run[run.length - 1];
      const before = runs[from - 1]?.[runs[from - 1].length - 1];
      const after = runs[from + 1]?.[0];
      const leaving = breaks(before, first) + breaks(last, after);
      const closing = breaks(before, after);
      const rest = runs.filter((_, index) => index !== from);
      let bestTo = from;
      let bestDelta = 0;
      for (let to = 0; to <= rest.length; to += 1) {
        if (to === from) continue;
        const left = rest[to - 1]?.[rest[to - 1].length - 1];
        const right = rest[to]?.[0];
        const delta = breaks(left, first) + breaks(last, right) - breaks(left, right) - leaving + closing;
        if (delta < bestDelta) {
          bestDelta = delta;
          bestTo = to;
        }
      }
      if (bestTo !== from) {
        runs = [...rest.slice(0, bestTo), run, ...rest.slice(bestTo)];
        moved = true;
      }
    }
    if (!moved) break;
    // Runs that now touch may have become one run; look again.
    runs = runsOf(runs.flat());
  }
  return runs.flat();
}

// Which message is the OLDEST, when that can be known for certain (Phase 6C-3: the opening balance is worked out from it). The first message of
// the order is the oldest only if every other run of linked messages provably comes later: a later FIRM date, the same day with a later printed
// time, or linked after it by the balance chain (then it is in the same run). An unlinked run on the same day without times, or one whose date
// is only the batch date, could be older, so nothing is decided.
export type OldestResult = { kind: 'none' } | { kind: 'oldest'; item: ChainItem } | { kind: 'undecided' };

const provablyAfter = (first: ChainItem, other: ChainItem): boolean => {
  if (first.estimated || other.estimated) return false;
  if (other.date > first.date) return true;
  return other.date === first.date && first.occurredAt !== null && other.occurredAt !== null && first.occurredAt < other.occurredAt;
};

export function oldestOf(ordered: ChainItem[]): OldestResult {
  if (ordered.length === 0) return { kind: 'none' };
  const first = ordered[0];
  const rivals = runsOf(ordered).slice(1).filter((run) => !provablyAfter(first, run[0]));
  return rivals.length === 0 ? { kind: 'oldest', item: first } : { kind: 'undecided' };
}

export interface ChainGap {
  // The message that does not follow from the one before it, and that one.
  id: string;
  previousId: string;
  // Bank balance minus what the previous balance and this message explain, in ETB. Positive: money arrived that no message explains;
  // negative: money left that no message explains.
  difference: number;
}

export interface AccountChain {
  accountId: string;
  // Oldest first.
  ordered: ChainItem[];
  gaps: ChainGap[];
  // Messages the chain could not check because the one before it prints no balance, or it has none itself.
  unchecked: string[];
}

export function buildChain(accountId: string, items: ChainItem[]): AccountChain {
  const ordered = orderAccount(items);
  const gaps: ChainGap[] = [];
  const unchecked: string[] = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1];
    const item = ordered[i];
    if (previous.balanceAfter === null || item.balanceAfter === null) {
      unchecked.push(item.id);
      continue;
    }
    const difference = toCents(item.balanceAfter) - (toCents(previous.balanceAfter) + effectCents(item));
    if (difference !== 0) {
      gaps.push({ id: item.id, previousId: previous.id, difference: fromCents(difference) });
    }
  }
  return { accountId, ordered, gaps, unchecked };
}

// One chain per account that has messages. Every status counts: a skipped message is still a real movement of the bank balance, so leaving it
// out would only invent gaps.
export function buildChains(suggestions: SmsSuggestion[], accounts: MoneyAccount[]): Map<string, AccountChain> {
  const usable = new Set(eligibleAccounts(accounts).map((account) => account.id));
  const byAccount = new Map<string, ChainItem[]>();
  suggestions.forEach((s, index) => {
    const item = chainItemOf(s, index);
    if (item && usable.has(item.accountId)) {
      byAccount.set(item.accountId, [...(byAccount.get(item.accountId) ?? []), item]);
    }
  });
  return new Map([...byAccount].map(([accountId, items]) => [accountId, buildChain(accountId, items)]));
}

// The note on a card: which message it follows, what is missing, and that this is normal when only some messages were imported. It is rebuilt
// from the current list every time, so it goes away once the missing message is pasted. When the difference is exactly this message's own fee,
// it also says why that is probably not a missing message: the balance it printed dropped by only its amount.
export function gapNotes(chains: Map<string, AccountChain>, feeProposalIds: ReadonlySet<string> = new Set()): Map<string, string> {
  const notes = new Map<string, string>();
  for (const chain of chains.values()) {
    for (const gap of chain.gaps) {
      // A message that printed no fee and whose balance dropped more than its amount gets a fee proposal instead: that IS the explanation.
      if (feeProposalIds.has(gap.id)) continue;
      const item = chain.ordered.find((candidate) => candidate.id === gap.id);
      const previous = chain.ordered.find((candidate) => candidate.id === gap.previousId);
      const word = gap.difference > 0 ? 'came in' : 'left';
      const after = previous ? `after the ETB ${formatAmount(previous.amount)} message of ${previous.date}` : 'before this message';
      let note = `Something is missing ${after}: ETB ${formatAmount(Math.abs(gap.difference))} ${word} that no message explains. This is expected if only some of your messages were imported.`;
      if (item && item.fees > 0 && gap.difference > 0 && toCents(gap.difference) === toCents(item.fees)) {
        note += ` The difference is the same as this message's own fee (ETB ${formatAmount(item.fees)}), so the balance it printed dropped by only its amount. If the amount already includes the fee, set the fee to 0: the whole amount is then saved as one expense, which is what left the account.`;
      }
      notes.set(gap.id, note);
    }
  }
  return notes;
}

export interface FeeProposal {
  fee: number;
  // The whole drop in the balance, for the text.
  drop: number;
}

// An outgoing message that printed no charges, whose balance dropped by MORE than its amount since the message right before it: the
// difference is probably the fee. Only a proposal; the owner taps "Use as fee" (nothing is applied silently).
export function feeProposals(chains: Map<string, AccountChain>): Map<string, FeeProposal> {
  const proposals = new Map<string, FeeProposal>();
  for (const chain of chains.values()) {
    for (let i = 1; i < chain.ordered.length; i += 1) {
      const previous = chain.ordered[i - 1];
      const item = chain.ordered[i];
      if (!item.noFeeKnown || previous.balanceAfter === null || item.balanceAfter === null) continue;
      const drop = toCents(previous.balanceAfter) - toCents(item.balanceAfter);
      const extra = drop - toCents(item.amount);
      if (extra > 0) {
        proposals.set(item.id, { fee: fromCents(extra), drop: fromCents(drop) });
      }
    }
  }
  return proposals;
}

// A time inside the day for each saved message that printed none, from its place in the chain: one second after the message before it
// (or just after local midnight if it is first). Messages with a printed time keep it and anchor the ones around them. Returns UTC ISO
// strings, like every entry timestamp.
export function chainTimestamps(chains: Map<string, AccountChain>): Map<string, string> {
  const times = new Map<string, string>();
  for (const chain of chains.values()) {
    const days = [...new Set(chain.ordered.map((item) => item.date))];
    for (const day of days) {
      let last = null as number | null;
      for (const item of chain.ordered.filter((candidate) => candidate.date === day)) {
        const printed = timestampFromOccurredAt(item.occurredAt);
        if (printed !== null) {
          last = Date.parse(printed);
          continue;
        }
        const [y, m, d] = day.split('-').map(Number);
        const start: number = last !== null ? last : new Date(y, m - 1, d, 0, 0, 0).getTime();
        const stamped: number = start + 1000;
        last = stamped;
        times.set(item.id, new Date(stamped).toISOString());
      }
    }
  }
  return times;
}

// ---- where a difference likely comes from (banner and opening refusals) -------------------------------------------------------------------------

export interface LikelyGap {
  // Unsigned amount, and whether it left or came in without a message explaining it.
  amount: number;
  direction: 'left' | 'came in';
  // The dates of the message before the gap and of the one after it.
  fromDate: string;
  toDate: string;
}

// The two largest gaps of an account's chain (by amount). Built from the chain, so it uses exactly the messages the chain uses.
export function likelyGaps(chain: AccountChain | undefined, limit = 2): LikelyGap[] {
  if (!chain) return [];
  const byId = new Map(chain.ordered.map((item) => [item.id, item]));
  return chain.gaps
    .map((gap) => ({ gap, from: byId.get(gap.previousId), to: byId.get(gap.id) }))
    .filter((row): row is { gap: ChainGap; from: ChainItem; to: ChainItem } => row.from !== undefined && row.to !== undefined)
    .sort((a, b) => Math.abs(b.gap.difference) - Math.abs(a.gap.difference))
    .slice(0, limit)
    .map(({ gap, from, to }) => ({ amount: Math.abs(gap.difference), direction: gap.difference > 0 ? 'came in' : 'left', fromDate: from.date, toDate: to.date }));
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// "12 June"; with the year ("12 June 2025") when the two days are in different years, so a gap across New Year is not ambiguous.
function plainDay(date: string, withYear: boolean): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ''}`;
}

// "ETB 201.04 left between your 12 June message and your 21 July message that no message explains." `mask` hides the amount while balances are hidden.
export function gapSentence(gap: LikelyGap, mask: (text: string) => string = (text) => text): string {
  const withYear = gap.fromDate.slice(0, 4) !== gap.toDate.slice(0, 4);
  return `${mask(`ETB ${formatAmount(gap.amount)}`)} ${gap.direction} between your ${plainDay(gap.fromDate, withYear)} message and your ${plainDay(gap.toDate, withYear)} message that no message explains.`;
}

export function gapSentences(chain: AccountChain | undefined, mask: (text: string) => string = (text) => text): string[] {
  return likelyGaps(chain).map((gap) => gapSentence(gap, mask));
}

export const MISSING_BEFORE_REASON = 'A message seems to be missing before it. Check it, then save it yourself.';

// The messages "Save all that are clean" leaves alone because their card shows the missing-message note (the owner is asked before saving one).
export function heldForMissing(suggestions: SmsSuggestion[], accounts: MoneyAccount[]): Map<string, string> {
  const chains = buildChains(suggestions, accounts);
  return new Map([...gapNotes(chains, new Set(feeProposals(chains).keys())).keys()].map((id) => [id, MISSING_BEFORE_REASON]));
}

// Tapping Save on a card that shows the missing-message note asks once; after "Save anyway" it does not ask again for that card.
export const saveNeedsConfirm = (chainNote: string | null, alreadyAsked: boolean): boolean => chainNote !== null && !alreadyAsked;
