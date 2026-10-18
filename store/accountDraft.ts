import { create } from 'zustand';

import { AccountType } from '../types/accounts';

// What the owner has typed into the New account form. It lives in a store (not in the form's own state) so it survives a trip to the
// Exchange rates screen: a foreign account cannot be created until its currency has a rate, so the form sends the owner there and
// the choices are still in place when they come back.
export interface AccountDraft {
  type: AccountType;
  name: string;
  amount: string;
  currency: string;
}

export const EMPTY_ACCOUNT_DRAFT: AccountDraft = { type: 'bank', name: '', amount: '', currency: 'ETB' };

interface AccountDraftState {
  draft: AccountDraft;
  // The sheet closed to let the owner set a rate; reopen it when the screen under it is shown again.
  reopenSheet: boolean;
  setDraft: (patch: Partial<AccountDraft>) => void;
  resetDraft: () => void;
  setReopenSheet: (value: boolean) => void;
}

export const useAccountDraft = create<AccountDraftState>((set) => ({
  draft: EMPTY_ACCOUNT_DRAFT,
  reopenSheet: false,
  setDraft: (patch) => set((state) => ({ draft: { ...state.draft, ...patch } })),
  resetDraft: () => set({ draft: EMPTY_ACCOUNT_DRAFT, reopenSheet: false }),
  setReopenSheet: (value) => set({ reopenSheet: value }),
}));
