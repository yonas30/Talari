// Expected, user-facing rejections from the accounts ledger. Anything that is not an AccountsError is a real bug and should be
// rethrown by the caller (the same convention the old ledger used).
export type AccountsErrorCode =
  | 'INVALID_AMOUNT'
  | 'INVALID_ENTRY'
  | 'NO_ACCOUNTS'
  | 'UNKNOWN_ACCOUNT'
  | 'ACCOUNT_ARCHIVED'
  | 'WRONG_CURRENCY'
  | 'SAME_ACCOUNT'
  | 'TRANSFER_AMOUNT_MISMATCH'
  | 'NEGATIVE_BALANCE'
  | 'MISSING_RATE'
  | 'INVALID_RATE'
  | 'UNKNOWN_CURRENCY'
  | 'CURRENCY_IN_USE'
  | 'INVALID_ACCOUNT'
  | 'DUPLICATE_ACCOUNT_NAME'
  | 'ACCOUNT_NOT_EMPTY'
  | 'ACCOUNT_HAS_ENTRIES'
  | 'ACCOUNT_HAS_GOALS'
  | 'FEE_LINKED'
  | 'UNKNOWN_GOAL'
  | 'GOAL_NOT_ETB'
  | 'GOAL_NOT_FREE'
  | 'GOAL_BELOW_ZERO'
  | 'GOAL_HAS_AMOUNT'
  | 'RESTORE_FAILED';

export class AccountsError extends Error {
  readonly code: AccountsErrorCode;

  constructor(code: AccountsErrorCode, message: string) {
    super(message);
    this.name = 'AccountsError';
    this.code = code;
  }
}
