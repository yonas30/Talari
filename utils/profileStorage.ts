import * as SecureStore from 'expo-secure-store';

import { PromptState, PromptStatus, StoredProfile } from './profile';

// The user's name and the onboarding state, as ONE small JSON value next to the theme preference and the app lock
// (SecureStore): no schema change, not part of a backup, and the name never touches the ledger tables.
const PROFILE_KEY = 'profile';

const PROMPT_STATUSES: PromptStatus[] = ['unset', 'set', 'skipped-once', 'done'];

function isPromptState(value: unknown): value is PromptState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { status?: unknown; skippedAt?: unknown };
  return (
    PROMPT_STATUSES.includes(candidate.status as PromptStatus) &&
    (candidate.skippedAt === undefined || typeof candidate.skippedAt === 'number')
  );
}

function isStoredProfile(value: unknown): value is StoredProfile {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { welcome?: unknown; name?: unknown; prompt?: unknown };
  return (
    (candidate.welcome === 'pending' || candidate.welcome === 'done') &&
    (candidate.name === null || typeof candidate.name === 'string') &&
    isPromptState(candidate.prompt)
  );
}

/** null = nothing stored yet. Throws when the keystore cannot be read or the value is damaged (the caller falls back). */
export async function readProfile(): Promise<StoredProfile | null> {
  const raw = await SecureStore.getItemAsync(PROFILE_KEY);
  if (raw === null) {
    return null;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isStoredProfile(parsed)) {
    throw new Error('Stored profile is not valid.');
  }
  return parsed;
}

export async function writeProfile(profile: StoredProfile): Promise<void> {
  try {
    await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // The choice still applies for this session; worst case the question is asked again next launch.
  }
}
