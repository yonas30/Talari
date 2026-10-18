// The hidden-balances setting (V2_SPEC Part I). There is ONE flag, `isBalanceHidden` in the shared UI store (store/ui.ts): it starts hidden on
// every launch, is not saved, and only the eye buttons change it. Every screen that shows a balance reads that same flag, so revealing
// on one screen reveals on all of them, and moving between screens never changes it (a route carries no visibility information).

export const INITIAL_BALANCES_HIDDEN = true;

export function toggleBalancesHidden(current: boolean): boolean {
  return !current;
}

// What the eye button says (and shows): the action it will do, not the current state.
export function balanceToggleLabel(hidden: boolean): 'Show balances' | 'Hide balances' {
  return hidden ? 'Show balances' : 'Hide balances';
}
