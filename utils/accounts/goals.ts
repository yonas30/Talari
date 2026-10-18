import { BASE_CURRENCY } from '../../constants/accounts';
import { AccountGoal, AccountsState, GoalAllocation } from '../../types/accounts';
import { GoalStatus } from '../../types';
import { mapAccounts } from './balances';
import { Ctx, defaultCtx, todayOf } from './context';
import { AccountsError } from './errors';
import { formatAmount, toCents } from './money';
import { getGoalAmount, getReserve } from './reserve';

export interface GoalInput {
  name: string;
  targetAmount: number;
  deadline?: string | null;
  heldInAccountId: string;
}

function findGoal(state: AccountsState, goalId: string): AccountGoal {
  const goal = state.goals.find((item) => item.id === goalId);
  if (!goal) {
    throw new AccountsError('UNKNOWN_GOAL', 'That goal no longer exists.');
  }
  return goal;
}

// A goal can only live in an ETB account that is still in use.
function requireGoalAccount(state: AccountsState, accountId: string): void {
  const account = mapAccounts(state.accounts).get(accountId);
  if (!account) {
    throw new AccountsError('UNKNOWN_ACCOUNT', 'Choose the account this goal is held in.');
  }
  if (account.archived) {
    throw new AccountsError('ACCOUNT_ARCHIVED', `${account.name} is archived.`);
  }
  if (account.currency !== BASE_CURRENCY) {
    throw new AccountsError('GOAL_NOT_ETB', 'Goals can only be held in an ETB account.');
  }
}

export function planCreateGoal(state: AccountsState, input: GoalInput, ctx: Ctx = defaultCtx): { state: AccountsState; goal: AccountGoal } {
  const name = input.name.trim();
  if (!name) {
    throw new AccountsError('INVALID_ENTRY', 'Give the goal a name.');
  }
  if (!Number.isFinite(input.targetAmount) || toCents(input.targetAmount) <= 0) {
    throw new AccountsError('INVALID_AMOUNT', 'The target must be greater than zero.');
  }
  requireGoalAccount(state, input.heldInAccountId);

  const nowIso = ctx.now().toISOString();
  const goal: AccountGoal = {
    id: ctx.newId(),
    name,
    targetAmount: input.targetAmount,
    deadline: input.deadline ?? null,
    status: 'active' as GoalStatus,
    heldInAccountId: input.heldInAccountId,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  return { state: { ...state, goals: [...state.goals, goal] }, goal };
}

// Adding money to a goal only RESERVES it inside the goal's account. It writes no ledger entry, so the account balance is unchanged
// and still matches the bank (V2_SPEC Part B section 6). What can be reserved is what is free to spend.
export function planAddToGoal(
  state: AccountsState,
  goalId: string,
  amount: number,
  ctx: Ctx = defaultCtx,
): { state: AccountsState; allocation: GoalAllocation } {
  const goal = findGoal(state, goalId);
  if (!Number.isFinite(amount) || toCents(amount) <= 0) {
    throw new AccountsError('INVALID_AMOUNT', 'Amount must be greater than zero.');
  }
  requireGoalAccount(state, goal.heldInAccountId);

  const { freeToSpend } = getReserve(state, goal.heldInAccountId);
  if (toCents(amount) > toCents(freeToSpend)) {
    throw new AccountsError(
      'GOAL_NOT_FREE',
      `Only ETB ${formatAmount(freeToSpend)} is free to reserve in this account.`,
    );
  }

  const allocation: GoalAllocation = {
    id: ctx.newId(),
    goalId,
    accountId: goal.heldInAccountId,
    amount,
    date: todayOf(ctx),
    kind: 'manual',
    createdAt: ctx.now().toISOString(),
  };
  return { state: { ...state, allocations: [...state.allocations, allocation] }, allocation };
}

// Frees reserved money again. The account balance does not change.
export function planWithdrawFromGoal(
  state: AccountsState,
  goalId: string,
  amount: number,
  ctx: Ctx = defaultCtx,
): { state: AccountsState; allocation: GoalAllocation } {
  const goal = findGoal(state, goalId);
  if (!Number.isFinite(amount) || toCents(amount) <= 0) {
    throw new AccountsError('INVALID_AMOUNT', 'Amount must be greater than zero.');
  }
  const held = getGoalAmount(state.allocations, goalId);
  if (toCents(amount) > toCents(held)) {
    throw new AccountsError('GOAL_BELOW_ZERO', `This goal only holds ETB ${formatAmount(held)}.`);
  }

  const allocation: GoalAllocation = {
    id: ctx.newId(),
    goalId,
    accountId: goal.heldInAccountId,
    amount: -amount,
    date: todayOf(ctx),
    kind: 'manual',
    createdAt: ctx.now().toISOString(),
  };
  return { state: { ...state, allocations: [...state.allocations, allocation] }, allocation };
}

// A goal can only change account while it holds nothing, so its history never straddles two accounts.
export function planMoveGoal(state: AccountsState, goalId: string, accountId: string, ctx: Ctx = defaultCtx): AccountsState {
  const goal = findGoal(state, goalId);
  if (toCents(getGoalAmount(state.allocations, goalId)) !== 0) {
    throw new AccountsError('GOAL_HAS_AMOUNT', 'Withdraw this goal first; it can only move to another account while it holds nothing.');
  }
  requireGoalAccount(state, accountId);
  return {
    ...state,
    goals: state.goals.map((item) =>
      item.id === goal.id ? { ...item, heldInAccountId: accountId, updatedAt: ctx.now().toISOString() } : item,
    ),
  };
}

// Deleting needs the goal to hold nothing; its (net zero) allocation rows go with it, and so do its saved "reserved money was used"
// notifications (they would only point at a goal that is gone). A restored backup can still carry one for a missing goal; the Goals tab
// handles that with "That goal no longer exists".
export function planDeleteGoal(state: AccountsState, goalId: string): AccountsState {
  findGoal(state, goalId);
  if (toCents(getGoalAmount(state.allocations, goalId)) !== 0) {
    throw new AccountsError('GOAL_HAS_AMOUNT', 'Withdraw this goal first; it can only be deleted while it holds nothing.');
  }
  return {
    ...state,
    goals: state.goals.filter((goal) => goal.id !== goalId),
    allocations: state.allocations.filter((row) => row.goalId !== goalId),
    notifications: state.notifications.filter((item) => item.goalId !== goalId),
  };
}
