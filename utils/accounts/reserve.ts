import { BASE_CURRENCY } from '../../constants/accounts';
import { AccountsState, GoalAllocation, ReserveNotification } from '../../types/accounts';
import { getAccountBalances } from './balances';
import { Ctx, todayOf } from './context';
import { fromCents, toCents } from './money';

// Goals are reservations inside an ETB account (V2_SPEC Part B section 6). Nothing here is stored as a running total: a goal's
// amount and an account's reserved amount are sums over the append-only goal_allocations rows (Part C).

export function getGoalAmounts(allocations: GoalAllocation[]): Record<string, number> {
  const cents = new Map<string, number>();
  for (const row of allocations) {
    cents.set(row.goalId, (cents.get(row.goalId) ?? 0) + toCents(row.amount));
  }
  return Object.fromEntries(Array.from(cents, ([id, value]) => [id, fromCents(value)]));
}

export function getGoalAmount(allocations: GoalAllocation[], goalId: string): number {
  return fromCents(allocations.filter((row) => row.goalId === goalId).reduce((sum, row) => sum + toCents(row.amount), 0));
}

export function getReservedByAccount(allocations: GoalAllocation[]): Record<string, number> {
  const cents = new Map<string, number>();
  for (const row of allocations) {
    cents.set(row.accountId, (cents.get(row.accountId) ?? 0) + toCents(row.amount));
  }
  return Object.fromEntries(Array.from(cents, ([id, value]) => [id, fromCents(value)]));
}

// One account's reserved goal money and what is left to spend without touching it.
export function getReserve(state: AccountsState, accountId: string): { balance: number; reserved: number; freeToSpend: number } {
  const balance = getAccountBalances(state.entries, state.accounts)[accountId] ?? 0;
  const reserved = getReservedByAccount(state.allocations)[accountId] ?? 0;
  return { balance, reserved, freeToSpend: fromCents(toCents(balance) - toCents(reserved)) };
}

// What a write returns. `state` is the new state; the other fields say what the write caused beyond the row the caller asked for.
export interface WriteResult {
  state: AccountsState;
  // Negative allocation rows added because reserved money was spent.
  autoReductions: GoalAllocation[];
  // One per goal that was reduced.
  notifications: ReserveNotification[];
  // Per account, how much of the reserved money this write uses. The Add form shows this as a warning BEFORE saving
  // ("This uses ETB X of the ETB Y reserved for goals"), by planning the write without persisting it.
  reserveUsed: Array<{ accountId: string; shortfall: number; reservedBefore: number }>;
}

// "Most recently contributed" = the latest manual positive allocation the goal has in that account (V2_SPEC Part E). createdAt
// decides, and for rows made at the same instant the one added later wins.
function lastContribution(allocations: GoalAllocation[], goalId: string): [number, number] {
  let best: [number, number] = [-Infinity, -1];
  allocations.forEach((row, index) => {
    if (row.goalId !== goalId || row.kind !== 'manual' || !(row.amount > 0)) {
      return;
    }
    const at = Date.parse(row.createdAt);
    if (at > best[0] || (at === best[0] && index > best[1])) {
      best = [at, index];
    }
  });
  return best;
}

// Run after EVERY ledger change (add, edit, delete). If an account's balance has fallen below what is reserved in it, the shortfall is
// taken from the goals held there, most recently contributed first, as negative allocation rows, and one notification is made per
// goal that shrank. This is a record of what happened: nothing is restored if the entry is edited back (V2_SPEC Part B section 7).
// It is a goal withdrawal, not a ledger entry, so it never touches income, expenses or the streak.
export function enforceReserved(state: AccountsState, ctx: Ctx): WriteResult {
  const balances = getAccountBalances(state.entries, state.accounts);
  let allocations = state.allocations;
  const autoReductions: GoalAllocation[] = [];
  const notifications: ReserveNotification[] = [];
  const reserveUsed: WriteResult['reserveUsed'] = [];

  for (const account of state.accounts) {
    if (account.currency !== BASE_CURRENCY) {
      continue; // goals are only ever held in ETB accounts
    }
    const reservedCents = toCents(getReservedByAccount(allocations)[account.id] ?? 0);
    const balanceCents = toCents(balances[account.id] ?? 0);
    if (reservedCents <= balanceCents) {
      continue;
    }

    let remaining = reservedCents - balanceCents;
    reserveUsed.push({ accountId: account.id, shortfall: fromCents(remaining), reservedBefore: fromCents(reservedCents) });

    const held = state.goals
      .filter((goal) => goal.heldInAccountId === account.id)
      .map((goal) => ({ goal, order: lastContribution(allocations, goal.id) }))
      .sort((a, b) => (a.order[0] === b.order[0] ? b.order[1] - a.order[1] : b.order[0] > a.order[0] ? 1 : -1));

    for (const { goal } of held) {
      if (remaining <= 0) {
        break;
      }
      const goalCents = toCents(getGoalAmount(allocations, goal.id));
      if (goalCents <= 0) {
        continue;
      }
      const cut = Math.min(goalCents, remaining);
      remaining -= cut;

      const createdAt = ctx.now().toISOString();
      const row: GoalAllocation = {
        id: ctx.newId(),
        goalId: goal.id,
        accountId: account.id,
        amount: -fromCents(cut),
        date: todayOf(ctx),
        kind: 'auto_reduce',
        createdAt,
      };
      allocations = [...allocations, row];
      autoReductions.push(row);
      notifications.push({
        id: ctx.newId(),
        kind: 'goal_reserve_used',
        goalId: goal.id,
        accountId: account.id,
        amount: fromCents(cut),
        amountAfter: fromCents(goalCents - cut),
        createdAt,
        read: false,
      });
    }
  }

  return {
    state: {
      ...state,
      allocations,
      notifications: [...state.notifications, ...notifications],
    },
    autoReductions,
    notifications,
    reserveUsed,
  };
}
