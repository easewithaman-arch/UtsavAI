import type { EventPlan, SavedPlanMeta } from '../domain/types';
import { validatePlanShape, sanitizeVendors, sanitizeBudgetCategories } from '../domain/validate';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PLANS_KEY = 'utsavai.plans.v1';
const CURRENT_KEY = 'utsavai.current.v1';
const MAX_SAVED = 50;

interface StoredEnvelope {
  version: 1;
  savedAt: string;
  plan: unknown;
}

export function metaFor(plan: EventPlan): SavedPlanMeta {
  return {
    id: plan.id,
    name: plan.input.name || 'Untitled event',
    type: plan.input.type,
    date: plan.input.date,
    updatedAt: plan.updatedAt,
    source: plan.source,
  };
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* storage may be unavailable (privacy mode) */
  }
  return null;
}

export interface LoadResult {
  plans: EventPlan[];
  skipped: number;
}

/** Restores saved plans, validating every record before it is trusted. */
export function loadPlans(storage: StorageLike | null = defaultStorage()): LoadResult {
  if (!storage) return { plans: [], skipped: 0 };
  let raw: string | null = null;
  try {
    raw = storage.getItem(PLANS_KEY);
  } catch {
    return { plans: [], skipped: 0 };
  }
  if (!raw) return { plans: [], skipped: 0 };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { plans: [], skipped: 1 };
  }
  if (!Array.isArray(parsed)) return { plans: [], skipped: 1 };

  const plans: EventPlan[] = [];
  let skipped = 0;
  for (const item of parsed) {
    const envelope = item as StoredEnvelope;
    if (!envelope || typeof envelope !== 'object' || !envelope.plan) {
      skipped++;
      continue;
    }
    const check = validatePlanShape(envelope.plan);
    if (!check.ok) {
      skipped++;
      continue;
    }
    const plan = envelope.plan as EventPlan;
    plan.vendors = sanitizeVendors(plan.vendors);
    const categories = sanitizeBudgetCategories(plan.budget.categories);
    if (!categories) {
      skipped++;
      continue;
    }
    plan.budget.categories = categories;
    plans.push(plan);
  }
  return { plans, skipped };
}

export function persistPlans(plans: EventPlan[], storage: StorageLike | null = defaultStorage()): { ok: boolean; error?: string } {
  if (!storage) return { ok: false, error: 'This browser is blocking saving, so plans cannot be stored on this device.' };
  try {
    const envelopes: StoredEnvelope[] = plans.slice(0, MAX_SAVED).map((plan) => ({
      version: 1,
      savedAt: new Date().toISOString(),
      plan,
    }));
    storage.setItem(PLANS_KEY, JSON.stringify(envelopes));
    return { ok: true };
  } catch (e) {
    const quota = e instanceof DOMException && e.name === 'QuotaExceededError';
    return {
      ok: false,
      error: quota
        ? 'This device is full of saved plans - delete an old one, or download it first.'
        : 'We could not save your plans on this device.',
    };
  }
}

export function loadCurrentId(storage: StorageLike | null = defaultStorage()): string | null {
  try {
    return storage?.getItem(CURRENT_KEY) ?? null;
  } catch {
    return null;
  }
}

export function persistCurrentId(id: string | null, storage: StorageLike | null = defaultStorage()): void {
  try {
    if (!storage) return;
    if (id) storage.setItem(CURRENT_KEY, id);
    else storage.removeItem(CURRENT_KEY);
  } catch {
    /* ignore */
  }
}

/** Round-trip used by tests: serialize then restore a single plan. */
export function serializePlan(plan: EventPlan): string {
  const envelope: StoredEnvelope = { version: 1, savedAt: new Date().toISOString(), plan };
  return JSON.stringify(envelope);
}

export function restorePlan(serialized: string): EventPlan | null {
  try {
    const envelope = JSON.parse(serialized) as StoredEnvelope;
    if (!envelope?.plan) return null;
    const check = validatePlanShape(envelope.plan);
    if (!check.ok) return null;
    const plan = envelope.plan as EventPlan;
    plan.vendors = sanitizeVendors(plan.vendors);
    const categories = sanitizeBudgetCategories(plan.budget.categories);
    if (!categories) return null;
    plan.budget.categories = categories;
    return plan;
  } catch {
    return null;
  }
}
