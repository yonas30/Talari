import { accountFills } from '../theme/tokens';
import { AccountType } from '../types/accounts';

// Cash gold, Wallet orange, Bank teal. The values live in theme/tokens.ts (accountFills); this is the colour stored with a new
// account. Screens draw accounts from the per-scheme tokens (accountColors), which verify-contrast.ts checks.
export const ACCOUNT_COLOURS: Record<AccountType, string> = accountFills;

export const ACCOUNT_TYPES: AccountType[] = ['cash', 'wallet', 'bank'];

export function accountColour(type: AccountType): string {
  return ACCOUNT_COLOURS[type];
}

// A foreign account is valued at today's stored rate; past this age the UI says how old the rate is (V2_SPEC Part D).
export const RATE_STALE_AFTER_DAYS = 7;

export const BASE_CURRENCY = 'ETB';
