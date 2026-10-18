import { toLocalDateKey } from '../dates';

// The clock and id source are passed in so the verify scripts can run the same code deterministically.
export interface Ctx {
  now: () => Date;
  newId: () => string;
}

export const defaultCtx: Ctx = {
  now: () => new Date(),
  newId: () => `${Date.now()}-${Math.random().toString(16).slice(2)}`,
};

export function todayOf(ctx: Ctx): string {
  return toLocalDateKey(ctx.now());
}
