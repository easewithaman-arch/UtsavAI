import type { FoodPreference, Priority, Setting, TaskStatus } from './types';

/**
 * Plain-language labels for internal codes.
 * The UI never shows a raw id (`in-progress`, `non-vegetarian`, `copilot-ai`).
 */

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'Not started',
  'in-progress': 'In progress',
  done: 'Done',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const FOOD_LABELS: Record<FoodPreference, string> = {
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  'non-vegetarian': 'Non-vegetarian',
  mixed: 'Mixed veg and non-veg',
  unspecified: 'Not decided yet',
};

export const SETTING_LABELS: Record<Setting, string> = {
  indoor: 'Indoor',
  outdoor: 'Outdoor',
  either: 'Indoor or outdoor',
};

export const PLAN_SOURCE_LABELS = {
  demo: 'Built-in plan',
  ai: 'AI-assisted',
} as const;

export const CHANGE_SOURCE_LABELS = {
  user: 'You',
  'copilot-demo': 'Built-in rules',
  'copilot-ai': 'Planning assistant',
} as const;

export function taskStatusLabel(status: TaskStatus): string {
  return TASK_STATUS_LABELS[status] ?? status;
}

export function priorityLabel(priority: Priority): string {
  return PRIORITY_LABELS[priority] ?? priority;
}

export function foodLabel(food: string): string {
  return FOOD_LABELS[food as FoodPreference] ?? food;
}

export function settingLabel(setting: string): string {
  return SETTING_LABELS[setting as Setting] ?? setting;
}

/** Friendly names for the plan fields the assistant can change. */
export const FIELD_LABELS: Record<string, string> = {
  name: 'Event name',
  location: 'Location',
  setting: 'Setting',
  durationHours: 'Duration (hours)',
  theme: 'Theme',
  food: 'Food preference',
  cultural: 'Cultural preference',
  accessibility: 'Accessibility',
  special: 'Special requests',
  colors: 'Colours',
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/** "120 days before the event" / "5 days after the event" - no T-minus shorthand. */
export function leadTimeLabel(leadDays: number): string {
  if (leadDays === 0) return 'On the event day';
  const days = Math.abs(leadDays);
  const unit = days === 1 ? 'day' : 'days';
  return leadDays > 0 ? `${days} ${unit} before the event` : `${days} ${unit} after the event`;
}

/** "1 change" / "2 changes" */
export function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

export function formatDate(iso: string): string {
  const parsed = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatDateTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
