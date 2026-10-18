import { BASE_CURRENCY } from '../../constants/accounts';
import { ExchangeRate } from '../../types';
import { AccountsError } from './errors';
import { getRateToETB } from './rates';

// All balance arithmetic is done in integer cents so repeated sums never accumulate float error (same rule as utils/balances.ts).
export const toCents = (value: number): number => Math.round(value * 100);
export const fromCents = (cents: number): number => cents / 100;
export const round2 = (value: number): number => Math.round(value * 100) / 100;

export function formatAmount(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Converts an amount to ETB once, at entry time, with the stored rate or a per-entry override (which is never written back to the
// rate table). No silent 1:1 fallback: a missing rate blocks the entry (V2_SPEC Part D).
export function convertToETB(
  amount: number,
  currency: string,
  rates: ExchangeRate[],
  rateOverride?: number | null,
): { amountETB: number; rate: number } {
  if (currency === BASE_CURRENCY) {
    return { amountETB: round2(amount), rate: 1 };
  }

  let rate: number | null;
  if (rateOverride !== undefined && rateOverride !== null) {
    if (!Number.isFinite(rateOverride) || rateOverride <= 0) {
      throw new AccountsError('INVALID_RATE', 'Exchange rate must be a number greater than zero.');
    }
    rate = rateOverride;
  } else {
    rate = getRateToETB(currency, rates);
  }

  if (rate === null) {
    throw new AccountsError('MISSING_RATE', `Set an exchange rate for ${currency} → ETB first.`);
  }
  return { amountETB: round2(amount * rate), rate };
}
