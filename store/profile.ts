import { create } from 'zustand';

import {
  decideFirstScreen,
  FirstScreen,
  finishWelcome,
  INITIAL_PROMPT,
  isPromptDue,
  promptAfterClear,
  promptAfterNotNow,
  promptAfterSave,
  REMIND_AFTER_MS,
  sanitiseName,
  StoredProfile,
} from '../utils/profile';
import { readProfile, writeProfile } from '../utils/profileStorage';

interface ProfileState {
  /** The first-screen decision has been made. The splash does not leave before this is true. */
  resolved: boolean;
  screen: FirstScreen;
  profile: StoredProfile;
  /** The name sheet is offered at most once per app session. */
  promptOfferedThisSession: boolean;

  /** Decide welcome / app. Needs the ledger loaded, because "existing data" skips the full Welcome screen. */
  resolve: (hasUserData: boolean) => Promise<void>;
  completeWelcome: (rawName: string | null) => void;
  /** Save a name from the sheet or Settings. Returns false when nothing usable was typed. */
  saveName: (rawName: string) => boolean;
  clearName: () => void;
  /** "Not now" on the one-time sheet. */
  notNow: () => void;
  isPromptDueNow: () => boolean;
  markPromptOffered: () => void;

  // Development helpers (only reachable from the __DEV__ rows in Settings).
  devShowWelcomeAgain: () => void;
  devResetToExistingUser: () => void;
  devAgeNotNowByDays: (days: number) => void;
}

const FALLBACK_PROFILE: StoredProfile = { welcome: 'done', name: null, prompt: { status: 'done' } };

function persist(profile: StoredProfile): void {
  void writeProfile(profile);
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  resolved: false,
  screen: 'app',
  profile: FALLBACK_PROFILE,
  promptOfferedThisSession: false,

  resolve: async (hasUserData) => {
    try {
      const stored = await readProfile();
      const decision = decideFirstScreen(stored, hasUserData);
      if (decision.persist) {
        persist(decision.profile);
      }
      set({ resolved: true, screen: decision.screen, profile: decision.profile });
    } catch {
      // An unreadable keystore or a damaged value must never trap the user: go to the app and do not ask anything.
      set({ resolved: true, screen: 'app', profile: FALLBACK_PROFILE });
    }
  },

  completeWelcome: (rawName) => {
    const name = rawName === null ? null : sanitiseName(rawName);
    const profile = finishWelcome(name);
    persist(profile);
    set({ profile, screen: 'app' });
  },

  saveName: (rawName) => {
    const name = sanitiseName(rawName);
    if (name === null) {
      return false;
    }
    const profile: StoredProfile = { ...get().profile, name, prompt: promptAfterSave };
    persist(profile);
    set({ profile });
    return true;
  },

  clearName: () => {
    const profile: StoredProfile = { ...get().profile, name: null, prompt: promptAfterClear };
    persist(profile);
    set({ profile });
  },

  notNow: () => {
    const current = get().profile;
    const profile: StoredProfile = { ...current, prompt: promptAfterNotNow(current.prompt, Date.now()) };
    persist(profile);
    set({ profile });
  },

  isPromptDueNow: () => {
    const { profile, resolved, screen } = get();
    return resolved && screen === 'app' && profile.name === null && isPromptDue(profile.prompt, Date.now());
  },

  markPromptOffered: () => set({ promptOfferedThisSession: true }),

  devShowWelcomeAgain: () => {
    const profile: StoredProfile = { welcome: 'pending', name: null, prompt: INITIAL_PROMPT };
    persist(profile);
    set({ profile, screen: 'welcome', promptOfferedThisSession: false });
  },

  devResetToExistingUser: () => {
    const profile: StoredProfile = { welcome: 'done', name: null, prompt: INITIAL_PROMPT };
    persist(profile);
    set({ profile, screen: 'app', promptOfferedThisSession: false });
  },

  devAgeNotNowByDays: (days) => {
    const { profile } = get();
    if (profile.prompt.status !== 'skipped-once' || profile.prompt.skippedAt === undefined) {
      return;
    }
    const aged: StoredProfile = {
      ...profile,
      prompt: { status: 'skipped-once', skippedAt: profile.prompt.skippedAt - days * (REMIND_AFTER_MS / 7) },
    };
    persist(aged);
    set({ profile: aged, promptOfferedThisSession: false });
  },
}));
