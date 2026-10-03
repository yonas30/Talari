import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

const DAILY_REMINDER_IDENTIFIER = 'daily-streak-reminder';
const STORAGE_HOUR_DEFAULT = 20;
const STORAGE_MINUTE_DEFAULT = 0;

// expo-notifications throws on import for Android Expo Go (push removed in SDK 53+), so it must never be required there.
const isPushUnsupportedHere =
  Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

type NotificationsModule = typeof import('expo-notifications');
let cachedNotifications: NotificationsModule | null = null;

function getNotifications(): NotificationsModule | null {
  if (isPushUnsupportedHere) {
    return null;
  }

  if (!cachedNotifications) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedNotifications = require('expo-notifications') as NotificationsModule;
    cachedNotifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  }

  return cachedNotifications;
}

export function isReminderSupported(): boolean {
  return !isPushUnsupportedHere;
}

export async function requestNotificationPermission(): Promise<boolean> {
  const Notifications = getNotifications();
  if (!Notifications) {
    return false;
  }

  const current = await Notifications.getPermissionsAsync();
  if (current.granted) {
    return true;
  }

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function isDailyReminderScheduled(): Promise<boolean> {
  const Notifications = getNotifications();
  if (!Notifications) {
    return false;
  }

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  return scheduled.some((item) => item.identifier === DAILY_REMINDER_IDENTIFIER);
}

export async function scheduleDailyReminder(
  hour: number = STORAGE_HOUR_DEFAULT,
  minute: number = STORAGE_MINUTE_DEFAULT,
): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) {
    return;
  }

  await Notifications.cancelScheduledNotificationAsync(DAILY_REMINDER_IDENTIFIER).catch(() => undefined);

  await Notifications.scheduleNotificationAsync({
    identifier: DAILY_REMINDER_IDENTIFIER,
    content: {
      title: 'Keep your streak alive',
      body: 'Log today\'s income, expenses, or savings before the day ends.',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
    },
  });
}

export async function cancelDailyReminder(): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) {
    return;
  }

  await Notifications.cancelScheduledNotificationAsync(DAILY_REMINDER_IDENTIFIER).catch(() => undefined);
}
