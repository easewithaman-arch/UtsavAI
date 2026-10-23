import type { EventInput, EventTypeId, CurrencyCode, PlanTask, BudgetCategory, Vendor } from './types';
import { EVENT_TYPES, CATEGORY_NAMES } from './events';

export interface ValidationResult<T> {
  ok: boolean;
  data?: T;
  errors: Record<string, string>;
}

const EVENT_TYPE_IDS = new Set(EVENT_TYPES.map((t) => t.id));
const CURRENCIES = new Set<CurrencyCode>(['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD']);
const CATEGORY_IDS = new Set(Object.keys(CATEGORY_NAMES));
const PRIORITIES = new Set(['high', 'medium', 'low']);
const TASK_CATEGORIES = new Set([
  'planning', 'venue', 'catering', 'decoration', 'photography', 'entertainment',
  'invitations', 'guests', 'logistics', 'finance',
]);
const TASK_STATUSES = new Set(['todo', 'in-progress', 'done']);
const FOODS = new Set(['vegetarian', 'vegan', 'non-vegetarian', 'mixed', 'unspecified']);
const REQUIREMENT_KEYS: (keyof EventInput['requirements'])[] = [
  'venue', 'catering', 'decoration', 'photography', 'entertainment', 'invitations', 'transportation', 'accommodation',
];

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function validateEventInput(raw: unknown): ValidationResult<EventInput> {
  const errors: Record<string, string> = {};
  const obj = asRecord(raw);
  if (!obj) return { ok: false, errors: { form: 'Some of the event details are missing. Please check the form and try again.' } };

  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (!name) errors.name = 'Event name is required.';
  else if (name.length > 80) errors.name = 'Keep the event name under 80 characters.';

  const type = obj.type as EventTypeId;
  if (!EVENT_TYPE_IDS.has(type)) errors.type = 'Choose a valid event type.';

  const date = obj.date;
  if (!isValidIsoDate(date)) errors.date = 'Enter a valid date.';

  const location = typeof obj.location === 'string' ? obj.location.trim() : '';
  if (!location) errors.location = 'Location is required.';
  else if (location.length > 120) errors.location = 'Keep the location under 120 characters.';

  const guestCount = obj.guestCount;
  if (typeof guestCount !== 'number' || !Number.isInteger(guestCount) || guestCount < 1 || guestCount > 100_000) {
    errors.guestCount = 'Guest count must be a whole number between 1 and 100,000.';
  }

  const setting = obj.setting;
  if (setting !== 'indoor' && setting !== 'outdoor' && setting !== 'either') {
    errors.setting = 'Choose indoor, outdoor or either.';
  }

  const durationHours = obj.durationHours;
  if (typeof durationHours !== 'number' || !Number.isFinite(durationHours) || durationHours < 1 || durationHours > 72) {
    errors.durationHours = 'Duration must be between 1 and 72 hours.';
  }

  const budgetRaw = asRecord(obj.budget);
  if (!budgetRaw) {
    errors.budget = 'Budget details are required.';
  } else {
    const total = budgetRaw.totalMinor;
    if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 100) {
      errors['budget.totalMinor'] = 'Enter a budget greater than zero.';
    } else if (total > 100_000_000_000_00) {
      errors['budget.totalMinor'] = 'Budget looks unrealistic. Please check the amount.';
    }
    const currency = budgetRaw.currency;
    if (typeof currency !== 'string' || !CURRENCIES.has(currency as CurrencyCode)) {
      errors['budget.currency'] = 'Choose a supported currency.';
    }
    const flex = budgetRaw.flexibility;
    if (flex !== 'strict' && flex !== 'moderate' && flex !== 'flexible') {
      errors['budget.flexibility'] = 'Choose a budget flexibility level.';
    }
    const pct = budgetRaw.contingencyPct;
    if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 30) {
      errors['budget.contingencyPct'] = 'The reserve must be between 0% and 30%.';
    }
  }

  const prefs = asRecord(obj.preferences);
  if (prefs) {
    if (typeof prefs.theme !== 'string' || prefs.theme.length > 200) errors['preferences.theme'] = 'Theme must be short text.';
    if (!FOODS.has(prefs.food as string)) errors['preferences.food'] = 'Choose a food preference.';
    if (prefs.colors !== undefined && (!Array.isArray(prefs.colors) || prefs.colors.length > 8 || prefs.colors.some((c) => typeof c !== 'string' || c.length > 40))) {
      errors['preferences.colors'] = 'Use up to 8 short colour names.';
    }
    for (const key of ['cultural', 'accessibility', 'special'] as const) {
      if (prefs[key] !== undefined && (typeof prefs[key] !== 'string' || prefs[key].length > 400)) {
        errors[`preferences.${key}`] = 'Keep this note under 400 characters.';
      }
    }
  } else {
    errors.preferences = 'Preferences are required.';
  }

  const reqs = asRecord(obj.requirements);
  if (!reqs) {
    errors.requirements = 'Planning requirements are required.';
  } else {
    for (const key of REQUIREMENT_KEYS) {
      if (typeof reqs[key] !== 'boolean') errors[`requirements.${key}`] = 'Planning requirements must be yes or no.';
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const input = obj as unknown as EventInput;
  return {
    ok: true,
    errors: {},
    data: {
      ...input,
      name,
      location,
      budget: {
        ...(input.budget as EventInput['budget']),
        priorities: input.budget.priorities ?? {},
      },
      preferences: {
        theme: input.preferences.theme?.trim() ?? '',
        colors: Array.isArray(input.preferences.colors) ? input.preferences.colors.filter((c) => typeof c === 'string').slice(0, 8) : [],
        food: input.preferences.food,
        cultural: typeof input.preferences.cultural === 'string' ? input.preferences.cultural : '',
        accessibility: typeof input.preferences.accessibility === 'string' ? input.preferences.accessibility : '',
        special: typeof input.preferences.special === 'string' ? input.preferences.special : '',
      },
    },
  };
}

function isStr(v: unknown, max = 500): v is string {
  return typeof v === 'string' && v.length <= max;
}

function isMinor(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

function isStringList(value: unknown, maxItems: number, maxLen: number): value is string[] {
  return Array.isArray(value) && value.length <= maxItems && value.every((item) => typeof item === 'string' && item.length <= maxLen);
}

/** Validates plan sections coming from an untrusted source (AI response, storage). */
export function validatePlanShape(raw: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const plan = asRecord(raw);
  if (!plan) return { ok: false, errors: ['Plan is not an object.'] };

  const input = validateEventInput(plan.input);
  if (!input.ok) errors.push('Plan event input is invalid.');

  const overview = asRecord(plan.overview);
  if (
    !overview ||
    !isStr(overview.concept, 2000) ||
    !isStr(overview.theme, 200) ||
    !isStringList(overview.objectives, 20, 600) ||
    !isStringList(overview.assumptions, 20, 600)
  ) {
    errors.push('Overview is malformed.');
  }

  const budget = asRecord(plan.budget);
  if (!budget || !Array.isArray(budget.categories) || budget.categories.length === 0) {
    errors.push('Budget section is malformed.');
  } else {
    const ids = new Set<string>();
    for (const c of budget.categories) {
      const cat = asRecord(c);
      if (!cat || typeof cat.id !== 'string' || !CATEGORY_IDS.has(cat.id)) {
        errors.push('Budget contains an unknown category.');
        break;
      }
      if (ids.has(cat.id)) {
        errors.push('Budget contains duplicate categories.');
        break;
      }
      ids.add(cat.id);
      if ((cat.id === 'contingency') !== (cat.isContingency === true)) {
        errors.push('Budget reserve flag does not match its category.');
        break;
      }
      if (!isMinor(cat.allocatedMinor) || !isMinor(cat.estimatedMinor) || !isMinor(cat.actualMinor)) {
        errors.push('Budget contains invalid amounts.');
        break;
      }
      if (!PRIORITIES.has(cat.priority as string) || typeof cat.manual !== 'boolean') {
        errors.push('Budget contains an invalid category.');
        break;
      }
    }
    if (!isStringList(budget.risks, 20, 800) || !isStringList(budget.savings, 20, 800) || typeof budget.insufficient !== 'boolean') {
      errors.push('Budget notes are malformed.');
    }
  }

  const timeline = asRecord(plan.timeline);
  if (!timeline || !Array.isArray(timeline.tasks) || !Array.isArray(timeline.milestones)) {
    errors.push('Timeline section is malformed.');
  } else {
    const ids = new Set<string>();
    const allIds = new Set<string>();
    for (const t of timeline.tasks) {
      const record = asRecord(t);
      if (record && isStr(record.id, 80)) allIds.add(record.id);
    }
    for (const t of timeline.tasks) {
      const task = asRecord(t) as unknown as PlanTask | null;
      if (
        !task ||
        !isStr(task.id, 80) ||
        !task.id.trim() ||
        !isStr(task.title, 200) ||
        !task.title.trim() ||
        !isStr(task.description, 1000) ||
        !TASK_CATEGORIES.has(task.category) ||
        !TASK_STATUSES.has(task.status) ||
        !PRIORITIES.has(task.priority) ||
        !Number.isInteger(task.leadDays) ||
        !isValidIsoDate(task.dueDate)
      ) {
        errors.push('Timeline contains an invalid task.');
        break;
      }
      if (task.estimatedCostMinor !== undefined && !isMinor(task.estimatedCostMinor)) {
        errors.push('Timeline contains an invalid task cost.');
        break;
      }
      if (ids.has(task.id)) {
        errors.push('Timeline contains duplicate task ids.');
        break;
      }
      ids.add(task.id);
      if (task.dependsOn && !allIds.has(task.dependsOn)) {
        errors.push(`Task "${task.title}" references an unknown dependency.`);
        break;
      }
      if (task.dependsOn && task.dependsOn === task.id) {
        errors.push(`Task "${task.title}" cannot depend on itself.`);
        break;
      }
    }

    const milestoneIds = new Set<string>();
    for (const m of timeline.milestones) {
      const milestone = asRecord(m);
      if (!milestone || !isStr(milestone.id, 80) || !isStr(milestone.label, 160) || !isValidIsoDate(milestone.date)) {
        errors.push('Timeline contains an invalid milestone.');
        break;
      }
      if (milestoneIds.has(milestone.id)) {
        errors.push('Timeline contains duplicate milestone ids.');
        break;
      }
      milestoneIds.add(milestone.id);
    }
  }

  if (!Array.isArray(plan.vendorRequirements)) {
    errors.push('Vendor requirements are malformed.');
  } else {
    const ids = new Set<string>();
    for (const item of plan.vendorRequirements) {
      const v = asRecord(item);
      if (
        !v ||
        !isStr(v.id, 80) ||
        !VENDOR_CATEGORIES.has(v.category as string) ||
        !isStringList(v.services, 12, 400) ||
        !isStringList(v.questions, 12, 400) ||
        !isStringList(v.comparisonCriteria, 12, 400) ||
        !PRIORITIES.has(v.bookingPriority as string) ||
        !isMinor(v.budgetGuideMinor) ||
        typeof v.booked !== 'boolean'
      ) {
        errors.push('A vendor requirement is malformed.');
        break;
      }
      if (ids.has(v.id)) {
        errors.push('Vendor requirements contain duplicate ids.');
        break;
      }
      ids.add(v.id);
    }
  }

  if (!Array.isArray(plan.vendors)) {
    errors.push('Vendors are malformed.');
  } else {
    const ids = new Set<string>();
    for (const item of plan.vendors) {
      const v = asRecord(item);
      if (
        !v ||
        !isStr(v.id, 80) ||
        !isStr(v.name, 120) ||
        !String(v.name).trim() ||
        !VENDOR_CATEGORIES.has(v.category as string) ||
        !VENDOR_BOOKING.has(v.bookingStatus as string) ||
        !VENDOR_PAYMENT.has(v.paymentStatus as string) ||
        !isStr(v.contact, 300) ||
        !isStr(v.notes, 2000) ||
        (v.quotedPriceMinor !== undefined && !isMinor(v.quotedPriceMinor)) ||
        (v.followUpDate !== undefined && !isValidIsoDate(v.followUpDate)) ||
        (v.source !== 'user' && v.source !== 'ai-suggestion')
      ) {
        errors.push('A vendor record is malformed.');
        break;
      }
      if (ids.has(v.id)) {
        errors.push('Vendors contain duplicate ids.');
        break;
      }
      ids.add(v.id);
    }
  }

  const ideas = asRecord(plan.ideas);
  if (
    !ideas ||
    !isStringList(ideas.themes, 20, 600) ||
    !isStringList(ideas.decoration, 20, 600) ||
    !isStringList(ideas.catering, 20, 600) ||
    !isStringList(ideas.entertainment, 20, 600) ||
    !isStringList(ideas.guestExperience, 20, 600)
  ) {
    errors.push('Ideas section is malformed.');
  }

  if (!Array.isArray(plan.risks)) {
    errors.push('Risks section is malformed.');
  } else {
    const ids = new Set<string>();
    for (const item of plan.risks) {
      const risk = asRecord(item);
      if (
        !risk ||
        !isStr(risk.id, 80) ||
        !isStr(risk.area, 120) ||
        !isStr(risk.description, 1200) ||
        !isStr(risk.mitigation, 1200)
      ) {
        errors.push('A risk item is malformed.');
        break;
      }
      if (ids.has(risk.id)) {
        errors.push('Risks contain duplicate ids.');
        break;
      }
      ids.add(risk.id);
    }
  }

  const actions = asRecord(plan.actions);
  if (
    !actions ||
    !isStringList(actions.immediate, 20, 600) ||
    !isStringList(actions.upcoming, 20, 600) ||
    !isStringList(actions.decisions, 20, 600)
  ) {
    errors.push('Actions section is malformed.');
  }
  if (plan.source !== 'demo' && plan.source !== 'ai') errors.push('Plan source must be "demo" or "ai".');

  return { ok: errors.length === 0, errors };
}

const VENDOR_CATEGORIES = new Set(['venue', 'catering', 'photography', 'decoration', 'entertainment', 'transportation', 'accommodation', 'other']);
const VENDOR_BOOKING = new Set(['not-contacted', 'shortlist', 'contacted', 'quoted', 'booked', 'declined']);
const VENDOR_PAYMENT = new Set(['none', 'advance-paid', 'partial', 'paid']);

export function sanitizeVendors(raw: unknown): Vendor[] {
  if (!Array.isArray(raw)) return [];
  const out: Vendor[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    const v = asRecord(item);
    if (!v || !isStr(v.name, 120) || !v.name.trim()) continue;
    let id = isStr(v.id, 80) && v.id.trim() ? v.id : `vnd_${out.length}`;
    let suffix = 0;
    while (ids.has(id)) id = `vnd_${out.length}_${++suffix}`;
    ids.add(id);
    out.push({
      id,
      name: v.name.trim(),
      category: isStr(v.category, 30) && VENDOR_CATEGORIES.has(v.category) ? (v.category as Vendor['category']) : 'other',
      contact: isStr(v.contact, 300) ? v.contact : '',
      quotedPriceMinor: isMinor(v.quotedPriceMinor) ? v.quotedPriceMinor : undefined,
      bookingStatus: isStr(v.bookingStatus, 30) && VENDOR_BOOKING.has(v.bookingStatus)
        ? (v.bookingStatus as Vendor['bookingStatus'])
        : 'not-contacted',
      paymentStatus: isStr(v.paymentStatus, 30) && VENDOR_PAYMENT.has(v.paymentStatus)
        ? (v.paymentStatus as Vendor['paymentStatus'])
        : 'none',
      notes: isStr(v.notes, 2000) ? v.notes : '',
      followUpDate: isValidIsoDate(v.followUpDate) ? v.followUpDate : undefined,
      source: v.source === 'ai-suggestion' ? 'ai-suggestion' : 'user',
    });
  }
  return out;
}

export function sanitizeBudgetCategories(raw: unknown): BudgetCategory[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: BudgetCategory[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    const c = asRecord(item);
    if (!c || typeof c.id !== 'string' || !CATEGORY_IDS.has(c.id)) return null;
    if (ids.has(c.id)) return null;
    if (!isMinor(c.allocatedMinor) || !isMinor(c.estimatedMinor) || !isMinor(c.actualMinor)) return null;
    ids.add(c.id);
    out.push({
      id: c.id as BudgetCategory['id'],
      name: CATEGORY_NAMES[c.id as BudgetCategory['id']],
      allocatedMinor: c.allocatedMinor,
      estimatedMinor: c.estimatedMinor,
      actualMinor: c.actualMinor,
      priority: (c.priority === 'high' || c.priority === 'low' ? c.priority : 'medium') as BudgetCategory['priority'],
      isContingency: c.id === 'contingency',
      manual: Boolean(c.manual),
    });
  }
  return out;
}
