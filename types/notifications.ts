// What the Notifications page and the bell badge list. Budget alerts are worked out from the data on every launch; goal notifications are saved
// (the reserved-money events of V2_SPEC Part E) and turned into these items by utils/notificationList.ts.
export type NotificationKind = 'budget' | 'system' | 'goal';

export interface AppNotification {
  id: string;
  title: string;
  description: string;
  isRead: boolean;
  type: NotificationKind;
  // Where tapping a budget or system notification goes (e.g. '/budgets'); none for purely informational ones. Goal notifications go to
  // the Goals tab with their goal id (see notificationTarget), whatever this says.
  route?: string;
  // 'warning' = a budget at 80% or more (an alert icon, not the "over budget" wallet icon).
  level?: 'warning';
  // Read out instead of "title. description" when the plain text is not the best thing to say.
  accessibilityLabel?: string;
  // Goal notifications only: the goal the money was taken from. Kept even after that goal is deleted, so a tap can say it is gone.
  goalId?: string | null;
  // When it happened (goal notifications) or when this session first saw it (the others). Newest first is decided by this.
  createdAt?: string;
}
