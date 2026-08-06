/** Device-local preferences, persisted under `ai-travel-planner:settings`. */

export type ThemePreference = 'system' | 'light' | 'dark';

export type NotificationSettings = {
  tripReminders: boolean;
  priceAlerts: boolean;
};

export type AppSettings = {
  theme: ThemePreference;
  notifications: NotificationSettings;
};
