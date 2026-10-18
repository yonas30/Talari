import { BASE_CURRENCY } from '../../constants/accounts';
import { CurrencyCode, ExchangeRate } from '../../types';

// The stored default rate (X -> ETB). Only a direct row counts: no reverse/triangulated guesses, and no silent 1:1 fallback - a missing
// rate must block entry (V2 Part D). Kept in its own module so the money helpers and utils/currency.ts can both use it without a cycle.
export function getRateToETB(currency: CurrencyCode, rates: ExchangeRate[]): number | null {
  if (currency === BASE_CURRENCY) {
    return 1;
  }
  const direct = rates.find((rate) => rate.fromCurrency === currency && rate.toCurrency === BASE_CURRENCY);
  return direct && Number.isFinite(direct.rate) && direct.rate > 0 ? direct.rate : null;
}
