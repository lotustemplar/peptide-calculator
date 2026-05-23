import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

import { SavedPlan } from "../types";
import { formatMg, formatMl } from "./calculator";

const CHANNEL_ID = "dose-reminders";
const REMINDER_WINDOW = 48;

// Notifications are not supported on web
const IS_WEB = Platform.OS === "web";

if (!IS_WEB) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export const prepareNotificationsAsync = async () => {
  if (IS_WEB || Platform.OS !== "android") {
    return;
  }

  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: "Dose reminders",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 150, 250],
    lightColor: "#2563eb",
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    sound: "default",
  });
};

export const requestReminderPermissionsAsync = async () => {
  if (IS_WEB) return false;
  await prepareNotificationsAsync();

  const current = await Notifications.getPermissionsAsync();
  if (current.granted) {
    return true;
  }

  const requested = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });

  return requested.granted;
};

const buildReminderDates = (intervalDays: number, reminderTimeIso: string) => {
  const now = new Date();
  const reminderTime = new Date(reminderTimeIso);
  const first = new Date(now);

  first.setHours(reminderTime.getHours(), reminderTime.getMinutes(), 0, 0);

  if (first <= now) {
    first.setDate(first.getDate() + intervalDays);
  }

  const dates: Date[] = [];
  for (let index = 0; index < REMINDER_WINDOW; index += 1) {
    const scheduled = new Date(first);
    scheduled.setDate(first.getDate() + index * intervalDays);
    dates.push(scheduled);
  }

  return dates;
};

export const cancelReminderSeriesAsync = async (notificationIds: string[]) => {
  if (IS_WEB) return;
  await Promise.all(
    notificationIds.map((notificationId) =>
      Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => undefined),
    ),
  );
};

export const scheduleReminderSeriesAsync = async (plan: SavedPlan) => {
  if (IS_WEB) return [];
  await prepareNotificationsAsync();

  const reminderDates = buildReminderDates(plan.intervalDays, plan.reminderTimeIso);
  const notificationIds: string[] = [];

  for (const date of reminderDates) {
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: `${plan.name} dose reminder`,
        body: `Take ${formatMg(plan.targetDoseMg)} and draw ${formatMl(plan.selectedDrawMl)} from your constituted vial.`,
        data: {
          planId: plan.id,
        },
        sound: "default",
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date,
        channelId: CHANNEL_ID,
      },
    });

    notificationIds.push(notificationId);
  }

  return notificationIds;
};

/** Call once on mount. Returns a subscription that must be removed on unmount. */
export const addNotificationTapListener = (onTap: () => void) => {
  if (IS_WEB) return { remove: () => {} };
  return Notifications.addNotificationResponseReceivedListener(() => onTap());
};

export const refreshActiveReminderWindowsAsync = async (plans: SavedPlan[]) => {
  if (IS_WEB) return plans;
  const permissions = await Notifications.getPermissionsAsync().catch(() => null);
  const canSchedule = Boolean(permissions?.granted);
  const refreshedPlans: SavedPlan[] = [];

  for (const plan of plans) {
    if (!plan.reminderEnabled) {
      refreshedPlans.push(plan);
      continue;
    }

    await cancelReminderSeriesAsync(plan.notificationIds);
    if (!canSchedule) {
      refreshedPlans.push({
        ...plan,
        notificationIds: [],
      });
      continue;
    }

    const notificationIds = await scheduleReminderSeriesAsync(plan);
    refreshedPlans.push({
      ...plan,
      notificationIds,
    });
  }

  return refreshedPlans;
};
