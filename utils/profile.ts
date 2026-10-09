// Pure rules for the user's name, the greeting and the onboarding / name-prompt state machine. No React Native imports,
// so scripts/verify-greeting.ts can check every boundary in Node.

// ---- name -----------------------------------------------------------------------------------------------------------
export const NAME_MAX_LENGTH = 30;

/**
 * Trim, collapse runs of whitespace to one space, keep at most NAME_MAX_LENGTH characters. Any script is allowed
 * (Amharic, Arabic, emoji...), so length is counted in characters (code points), never UTF-16 units: a name must not be
 * cut in the middle of a character. Returns null when nothing is left.
 */
export function sanitiseName(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) {
    return null;
  }
  const characters = Array.from(collapsed);
  if (characters.length <= NAME_MAX_LENGTH) {
    return collapsed;
  }
  // Over the limit (only possible from a paste that bypassed maxLength): cut, and do not leave a dangling space.
  return characters.slice(0, NAME_MAX_LENGTH).join('').trim();
}

export const EMPTY_NAME_MESSAGE = 'Add a name, or tap Skip for now.';

// ---- greeting -------------------------------------------------------------------------------------------------------
/** By LOCAL time: 05:00-11:59 morning, 12:00-16:59 afternoon, 17:00-20:59 evening, 21:00-04:59 "Hello". */
export function getGreeting(date: Date): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  if (hour >= 17 && hour < 21) return 'Good evening';
  return 'Hello';
}

/** "Good evening, Yonas 👋", or "Good evening 👋" with no name - never a trailing comma or a gap. */
export function formatGreeting(date: Date, name: string | null | undefined): string {
  const greeting = getGreeting(date);
  const clean = name ? sanitiseName(name) : null;
  return clean ? `${greeting}, ${clean} 👋` : `${greeting} 👋`;
}

// ---- name prompt for people who already have data -------------------------------------------------------------------
export const REMIND_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export type PromptStatus = 'unset' | 'set' | 'skipped-once' | 'done';

export interface PromptState {
  status: PromptStatus;
  /** When "Not now" was tapped the first time (ms since epoch). */
  skippedAt?: number;
}

export const INITIAL_PROMPT: PromptState = { status: 'unset' };

/** Ask when never asked, or once more when 7 days have passed since the first "Not now". Never after that. */
export function isPromptDue(state: PromptState, now: number): boolean {
  if (state.status === 'unset') {
    return true;
  }
  return state.status === 'skipped-once' && state.skippedAt !== undefined && now - state.skippedAt >= REMIND_AFTER_MS;
}

export function promptAfterNotNow(state: PromptState, now: number): PromptState {
  if (state.status === 'unset') {
    return { status: 'skipped-once', skippedAt: now };
  }
  if (state.status === 'skipped-once') {
    return { status: 'done' };
  }
  return state;
}

export const promptAfterSave: PromptState = { status: 'set' };
export const promptAfterClear: PromptState = { status: 'done' };

// ---- onboarding -----------------------------------------------------------------------------------------------------
export interface StoredProfile {
  /** 'pending' = the full Welcome screen still has to be shown. */
  welcome: 'pending' | 'done';
  name: string | null;
  prompt: PromptState;
}

export type FirstScreen = 'welcome' | 'app';

/**
 * Which screen comes first. Nothing stored yet (first run of this version): someone who already has transactions, goals
 * or an origin story skips the Welcome screen and gets the one-time name sheet instead; a fresh install gets Welcome.
 * `persist` says whether the decision must be written down right away (the silent "skip Welcome" case).
 */
export function decideFirstScreen(
  stored: StoredProfile | null,
  hasUserData: boolean,
): { screen: FirstScreen; profile: StoredProfile; persist: boolean } {
  if (stored) {
    return { screen: stored.welcome === 'pending' ? 'welcome' : 'app', profile: stored, persist: false };
  }
  if (hasUserData) {
    return { screen: 'app', profile: { welcome: 'done', name: null, prompt: INITIAL_PROMPT }, persist: true };
  }
  return { screen: 'welcome', profile: { welcome: 'pending', name: null, prompt: INITIAL_PROMPT }, persist: false };
}

/** Finishing Welcome: a name ends the prompt story ('set'); Skip means we do not nag a fresh user ('done'). */
export function finishWelcome(name: string | null): StoredProfile {
  return name
    ? { welcome: 'done', name, prompt: promptAfterSave }
    : { welcome: 'done', name: null, prompt: promptAfterClear };
}
