import { Alert } from 'react-native';

import { AccountsError } from './accounts/errors';

// Ledger rejections (negative balance, missing rate, ...) are expected user-facing outcomes, so
// they get a plain warning; anything else is a real bug and is rethrown.
export function alertLedgerError(error: unknown): void {
  if (error instanceof AccountsError) {
    Alert.alert('Cannot save', error.message);
    return;
  }
  throw error;
}
