import { AccountGoal, ReserveNotification } from '../../types/accounts';
import { formatETB } from '../format';

export interface ReserveNotificationText {
  title: string;
  description: string;
  // Tapping opens this goal (Phase 5D gives the Goals tab a param for it). Null when the goal has since been deleted.
  goalId: string | null;
}

// "ETB X reserved for <goal> was used. <goal> is now ETB A of B." A is what the goal held right after the money was used, so it is
// stored on the notification; the goal name and target are read from the goal as it is now.
export function describeReserveNotification(notification: ReserveNotification, goal: AccountGoal | undefined): ReserveNotificationText {
  if (!goal) {
    return {
      title: 'Reserved money used',
      description: `${formatETB(notification.amount)} reserved for a goal was used.`,
      goalId: null,
    };
  }
  return {
    title: 'Reserved money used',
    description: `${formatETB(notification.amount)} reserved for ${goal.name} was used. ${goal.name} is now ${formatETB(notification.amountAfter)} of ${formatETB(goal.targetAmount)}.`,
    goalId: goal.id,
  };
}
