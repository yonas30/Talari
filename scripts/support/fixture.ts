// A small builder the verify scripts share: a fresh accounts ledger, a deterministic clock, and shortcuts to open accounts and record
// entries through the same planners the app uses (utils/accounts), so a script checks the real rules and not a copy of them.
import { ExchangeRate } from '../../types';
import { AccountsState, AccountType } from '../../types/accounts';
import { Ctx } from '../../utils/accounts/context';
import { EntryInput, planAddEntry } from '../../utils/accounts/entries';
import { planCreateAccount } from '../../utils/accounts/manage';
import { WriteResult } from '../../utils/accounts/reserve';

export const USD_55: ExchangeRate[] = [
  { id: 'USD-ETB', fromCurrency: 'USD', toCurrency: 'ETB', rate: 55, updatedAt: '2026-01-01T00:00:00Z' },
];

export interface Fixture {
  ctx: Ctx;
  state: () => AccountsState;
  setState: (next: AccountsState) => void;
  // Opens an account with what is in it now (an `opening` entry dated `date`, or today) and returns its id.
  account: (name: string, type: AccountType, currency?: string, openingAmount?: number, date?: string) => string;
  add: (input: EntryInput) => WriteResult;
}

export function newFixture(rates: ExchangeRate[] = USD_55): Fixture {
  let counter = 0;
  const ctx: Ctx = {
    // Local noon: the same calendar day in every timezone.
    now: () => new Date(2026, 0, 10, 12, 0, counter),
    newId: () => `f-${++counter}`,
  };
  let state: AccountsState = {
    accounts: [],
    entries: [],
    goals: [],
    allocations: [],
    notifications: [],
    rates,
    currencies: ['ETB', 'USD', 'EUR', 'GBP'],
  };
  return {
    ctx,
    state: () => state,
    setState: (next) => {
      state = next;
    },
    account: (name, type, currency = 'ETB', openingAmount = 0, date) => {
      const created = planCreateAccount(state, { name, type, currency, openingAmount, date }, ctx);
      state = created.state;
      return created.account.id;
    },
    add: (input) => {
      const result = planAddEntry(state, input, ctx);
      state = result.state;
      return result;
    },
  };
}
