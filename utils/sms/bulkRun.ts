import { AccountsState } from '../../types/accounts';
import { SmsSuggestion } from '../../types/sms';
import { Ctx, defaultCtx } from '../accounts/context';
import { AccountsError } from '../accounts/errors';
import { CardCheck, checkSuggestion, cleanOrder, planSuggestionSave, SuggestionSavePlan } from './saveSuggestion';

// "Save all that are clean", as a pure orchestrator (V2_SPEC Part Z). It decides what is saved and why anything is not; the caller supplies
// what writing means (the database) and what showing progress means (the screen). It NEVER throws: a batch always ends with a result that
// lists every message that was not saved and the reason, so the screen can always say what happened.

export interface BulkFailure {
  id: string;
  reason: string;
}

export interface BulkProgress {
  // Messages dealt with so far (saved or not) out of the messages that were waiting.
  done: number;
  total: number;
}

export interface BulkResult {
  saved: string[];
  failures: BulkFailure[];
  // The ledger with exactly the saved messages in it, so the screen can be brought up to date in ONE step.
  state: AccountsState;
  total: number;
  // Set when an unexpected error (not a ledger rule) stopped the batch: its text. The messages not yet tried are listed as failures.
  stopped: string | null;
  error: unknown;
}

export interface BulkRun {
  state: AccountsState;
  suggestions: SmsSuggestion[];
  ctx?: Ctx;
  // The chain time for a message that printed none (Phase 6C-2).
  timestampFor?: (suggestion: SmsSuggestion) => string | null;
  // Messages that must wait for the owner (a possible transfer): not saved, and reported with this reason instead of silently skipped.
  held?: ReadonlyMap<string, string>;
  // Writes one message. `before` is the ledger the earlier messages left, which is what its database diff is made against. A ledger rule
  // that refuses it is an AccountsError; anything else is a real failure and stops the batch.
  commit: (plan: SuggestionSavePlan, before: AccountsState, suggestion: SmsSuggestion) => void | Promise<void>;
  onProgress?: (progress: BulkProgress) => void;
  // Gives the screen a turn between messages (setTimeout 0 in the app) so progress can be painted and the app stays responsive.
  yieldToUi?: () => Promise<void>;
}

// Why a card is not "clean", in words for the result list.
export function whyNotClean(check: CardCheck): string {
  if (check.missing.includes('account')) return 'No account chosen yet.';
  if (check.blocked !== null) return check.blocked;
  if (check.warnings.length > 0) return check.warnings[0].message;
  return 'Needs your attention.';
}

export async function runBulkSave(run: BulkRun): Promise<BulkResult> {
  const ctx = run.ctx ?? defaultCtx;
  const candidates = cleanOrder(run.suggestions);
  const result: BulkResult = { saved: [], failures: [], state: run.state, total: candidates.length, stopped: null, error: null };
  const progress = (done: number) => run.onProgress?.({ done, total: candidates.length });
  progress(0);

  for (let index = 0; index < candidates.length; index += 1) {
    const suggestion = candidates[index];
    const heldReason = run.held?.get(suggestion.id);
    if (heldReason !== undefined) {
      result.failures.push({ id: suggestion.id, reason: heldReason });
    } else {
      // Judged against the ledger the messages before it left (two cards that are each fine alone can overdraw an account together).
      const check = checkSuggestion(result.state, suggestion, ctx);
      if (!check.clean) {
        result.failures.push({ id: suggestion.id, reason: whyNotClean(check) });
      } else {
        try {
          const plan = planSuggestionSave(result.state, suggestion, { remember: true, timestamp: run.timestampFor?.(suggestion) ?? null }, ctx);
          await run.commit(plan, result.state, suggestion);
          result.state = plan.result.state;
          result.saved.push(suggestion.id);
        } catch (error) {
          if (error instanceof AccountsError) {
            result.failures.push({ id: suggestion.id, reason: error.message });
          } else {
            // Not a ledger rule: something is really wrong (the database). Stop here, say what happened, and list what was not tried.
            const text = error instanceof Error ? error.message : String(error);
            result.stopped = text;
            result.error = error;
            result.failures.push({ id: suggestion.id, reason: `Could not save: ${text}` });
            for (const rest of candidates.slice(index + 1)) {
              result.failures.push({ id: rest.id, reason: 'Not tried: the batch stopped after an error.' });
            }
            progress(candidates.length);
            return result;
          }
        }
      }
    }
    progress(index + 1);
    await run.yieldToUi?.();
  }
  return result;
}

export interface BulkSummary {
  headline: string;
  // One line per message not saved: who it was and why.
  lines: string[];
  // True whenever anything was not saved or the batch stopped: the owner stays on the review screen and sees why.
  stayOnScreen: boolean;
}

// The words at the end of a batch. Never empty: even "nothing to do" says so.
export function bulkSummary(result: BulkResult, label: (id: string) => string): BulkSummary {
  const lines = result.failures.map((failure) => `${label(failure.id)}: ${failure.reason}`);
  if (result.stopped !== null) {
    return {
      headline: `Stopped after an error (${result.stopped}). Saved ${result.saved.length}; ${result.failures.length} not saved because:`,
      lines,
      stayOnScreen: true,
    };
  }
  if (result.total === 0 && result.saved.length === 0 && result.failures.length === 0) {
    return { headline: 'Nothing was waiting to be saved.', lines: [], stayOnScreen: false };
  }
  if (result.failures.length === 0) {
    return { headline: `Saved ${result.saved.length}.`, lines: [], stayOnScreen: false };
  }
  return { headline: `Saved ${result.saved.length}. ${result.failures.length} not saved because:`, lines, stayOnScreen: true };
}

// The older entry point (a plain list of ids, rethrowing a real error), kept for the scripts that check the clean-save rules.
export async function bulkSave(
  state: AccountsState,
  suggestions: SmsSuggestion[],
  save: (plan: SuggestionSavePlan, suggestion: SmsSuggestion) => void | Promise<void>,
  ctx: Ctx = defaultCtx,
  timestampFor: (suggestion: SmsSuggestion) => string | null = () => null,
): Promise<{ saved: string[]; needAttention: string[]; state: AccountsState }> {
  const result = await runBulkSave({ state, suggestions, ctx, timestampFor, commit: (plan, _before, suggestion) => save(plan, suggestion) });
  if (result.error !== null) {
    throw result.error;
  }
  return { saved: result.saved, needAttention: result.failures.map((failure) => failure.id), state: result.state };
}
