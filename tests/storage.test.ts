import { describe, it, expect } from 'vitest';
import {
  loadPlans,
  persistPlans,
  loadCurrentId,
  persistCurrentId,
  serializePlan,
  restorePlan,
  metaFor,
  type StorageLike,
} from '../src/persistence/storage';
import { generateDemoPlan } from '../src/planner/demo';
import { SAMPLE_EVENTS } from '../src/domain/events';

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

const wedding = SAMPLE_EVENTS.find((s) => s.key === 'wedding')!.build();

describe('persistence round-trip', () => {
  it('saves and restores a plan with all sections intact', () => {
    const storage = memoryStorage();
    const plan = generateDemoPlan(wedding);
    expect(persistPlans([plan], storage).ok).toBe(true);

    const loaded = loadPlans(storage);
    expect(loaded.skipped).toBe(0);
    expect(loaded.plans).toHaveLength(1);
    const restored = loaded.plans[0];
    expect(restored.id).toBe(plan.id);
    expect(restored.input.name).toBe(plan.input.name);
    expect(restored.budget.categories).toEqual(plan.budget.categories);
    expect(restored.timeline.tasks).toEqual(plan.timeline.tasks);
    expect(restored.overview.concept).toBe(plan.overview.concept);
  });

  it('restores after a simulated refresh using the current-plan id', () => {
    const storage = memoryStorage();
    const plan = generateDemoPlan(wedding);
    persistPlans([plan], storage);
    persistCurrentId(plan.id, storage);

    expect(loadCurrentId(storage)).toBe(plan.id);
    const restored = loadPlans(storage).plans.find((p) => p.id === loadCurrentId(storage));
    expect(restored).toBeTruthy();
  });

  it('preserves vendor records across a round-trip', () => {
    const plan = generateDemoPlan(wedding);
    plan.vendors.push({
      id: 'v_test',
      name: 'Test Venue',
      category: 'venue',
      contact: 'contact-sheet',
      quotedPriceMinor: 100_000,
      bookingStatus: 'quoted',
      paymentStatus: 'none',
      notes: 'Includes chairs',
      followUpDate: '2027-01-15',
      source: 'user',
    });
    const restored = restorePlan(serializePlan(plan));
    expect(restored!.vendors).toHaveLength(1);
    expect(restored!.vendors[0].quotedPriceMinor).toBe(100_000);
    expect(restored!.vendors[0].source).toBe('user');
  });
});

describe('corrupted or hostile storage data', () => {
  it('reports skipped entries for invalid JSON', () => {
    const storage = memoryStorage({ 'utsavai.plans.v1': '{not json' });
    const result = loadPlans(storage);
    expect(result.plans).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  it('rejects plans that fail structural validation', () => {
    const plan = generateDemoPlan(wedding);
    const broken = JSON.parse(JSON.stringify(plan));
    broken.budget.categories[0].allocatedMinor = ' lots ';
    const storage = memoryStorage({
      'utsavai.plans.v1': JSON.stringify([{ version: 1, savedAt: 'now', plan: broken }]),
    });
    const result = loadPlans(storage);
    expect(result.plans).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });

  it('keeps valid plans while skipping broken neighbours', () => {
    const good = generateDemoPlan(wedding);
    const storage = memoryStorage({
      'utsavai.plans.v1': JSON.stringify([
        { version: 1, savedAt: 'now', plan: { junk: true } },
        { version: 1, savedAt: 'now', plan: good },
      ]),
    });
    const result = loadPlans(storage);
    expect(result.plans).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });

  it('handles missing storage gracefully', () => {
    const result = loadPlans(null);
    expect(result.plans).toEqual([]);
    expect(persistPlans([generateDemoPlan(wedding)], null).ok).toBe(false);
  });

  it('restorePlan returns null for garbage', () => {
    expect(restorePlan('nope')).toBeNull();
    expect(restorePlan(JSON.stringify({ plan: null }))).toBeNull();
    expect(restorePlan(JSON.stringify({ plan: { source: 'evil' } }))).toBeNull();
  });

  it('reports a helpful error when storage throws (quota)', () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      removeItem: () => {},
    };
    const result = persistPlans([generateDemoPlan(wedding)], storage);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/quota/i);
  });
});

describe('metaFor', () => {
  it('builds list metadata from the plan', () => {
    const plan = generateDemoPlan(wedding);
    const meta = metaFor(plan);
    expect(meta.id).toBe(plan.id);
    expect(meta.name).toBe(plan.input.name);
    expect(meta.type).toBe('wedding');
    expect(meta.source).toBe('demo');
  });
});
