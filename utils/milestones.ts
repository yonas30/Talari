import { Milestone } from '../types';

// Whether this goal's completion has already been recorded. Matched by goal ID, never by title: titles are
// user-typed and reusable (a deleted goal, a renamed goal, or a leftover record from an older version can share
// a name with a new goal), and matching on them silently suppressed milestones for unrelated goals.
export function hasCompletionMilestone(milestones: Milestone[], goalId: string): boolean {
  return milestones.some((item) => item.type === 'goal_completed' && item.goalId === goalId);
}
