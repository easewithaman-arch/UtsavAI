import { describe, it, expect } from 'vitest';
import {
  validateEventInput,
  validatePlanShape,
  isValidIsoDate,
  daysBetween,
  sanitizeVendors,
} from '../src/domain/validate';
import { SAMPLE_EVENTS, emptyEventInput } from '../src/domain/events';
import { generateDemoPlan } from '../src/planner/demo';
import type { EventInput } from '../src/domain/types';

const wedding = SAMPLE_EVENTS.find((s) => s.key === 'wedding')!.build();

describe('isValidIsoDate', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(isValidIsoDate('2027-02-14')).toBe(true);
    expect(isValidIsoDate('2028-02-29')).toBe(true); // leap year
    expect(isValidIsoDate('2027-02-29')).toBe(false);
    expect(isValidIsoDate('2027-13-01')).toBe(false);
    expect(isValidIsoDate('2027-01-32')).toBe(false);
    expect(isValidIsoDate('14/02/2027')).toBe(false);
    expect(isValidIsoDate('')).toBe(false);
    expect(isValidIsoDate(20270214)).toBe(false);
  });
});

describe('daysBetween', () => {
  it('counts calendar days across month boundaries', () => {
    expect(daysBetween('2027-01-31', '2027-02-01')).toBe(1);
    expect(daysBetween('2027-02-01', '2027-01-31')).toBe(-1);
    expect(daysBetween('2027-01-01', '2027-12-31')).toBe(364);
  });
});

describe('validateEventInput', () => {
  it('accepts a well-formed event', () => {
    const result = validateEventInput(wedding);
    expect(result.ok).toBe(true);
    expect(result.data!.name).toBe(wedding.name);
  });

  it('requires name, location and valid date', () => {
    const bad = { ...wedding, name: '', location: '', date: '2027-02-30' };
    const result = validateEventInput(bad);
    expect(result.ok).toBe(false);
    expect(result.errors.name).toBeTruthy();
    expect(result.errors.location).toBeTruthy();
    expect(result.errors.date).toBeTruthy();
  });

  it('validates guest count bounds and integrality', () => {
    expect(validateEventInput({ ...wedding, guestCount: 0 }).ok).toBe(false);
    expect(validateEventInput({ ...wedding, guestCount: 1.5 }).ok).toBe(false);
    expect(validateEventInput({ ...wedding, guestCount: 999_999 }).ok).toBe(false);
    expect(validateEventInput({ ...wedding, guestCount: 100 }).ok).toBe(true);
  });

  it('validates budget fields', () => {
    expect(validateEventInput({ ...wedding, budget: { ...wedding.budget, totalMinor: 0 } }).ok).toBe(false);
    expect(validateEventInput({ ...wedding, budget: { ...wedding.budget, contingencyPct: 50 } }).ok).toBe(false);
    expect(validateEventInput({ ...wedding, budget: { ...wedding.budget, currency: 'XYZ' } }).ok).toBe(false);
    expect(validateEventInput({ ...wedding, budget: { ...wedding.budget, flexibility: 'wild' } }).ok).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(validateEventInput(null).ok).toBe(false);
    expect(validateEventInput('wedding').ok).toBe(false);
    expect(validateEventInput([]).ok).toBe(false);
  });

  it('accepts every sample scenario', () => {
    for (const sample of SAMPLE_EVENTS) {
      expect(validateEventInput(sample.build()).ok).toBe(true);
    }
    expect(validateEventInput(emptyEventInput('community')).ok).toBe(false); // name/budget required
  });
});

describe('validatePlanShape', () => {
  it('accepts a generated demo plan', () => {
    const plan = generateDemoPlan(wedding);
    const result = validatePlanShape(plan);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('rejects corrupted category amounts', () => {
    const plan = generateDemoPlan(wedding);
    (plan.budget.categories[0] as unknown as { allocatedMinor: string }).allocatedMinor = '100';
    expect(validatePlanShape(plan).ok).toBe(false);
  });

  it('rejects unknown budget categories', () => {
    const plan = generateDemoPlan(wedding);
    (plan.budget.categories[0] as unknown as { id: string }).id = 'drinks-fountain';
    expect(validatePlanShape(plan).ok).toBe(false);
  });

  it('rejects tasks with invalid due dates', () => {
    const plan = generateDemoPlan(wedding);
    plan.timeline.tasks[0].dueDate = 'someday';
    expect(validatePlanShape(plan).ok).toBe(false);
  });

  it('rejects duplicate task ids', () => {
    const plan = generateDemoPlan(wedding);
    plan.timeline.tasks[1].id = plan.timeline.tasks[0].id;
    expect(validatePlanShape(plan).ok).toBe(false);
  });

  it('rejects unknown task dependencies', () => {
    const plan = generateDemoPlan(wedding);
    plan.timeline.tasks[0].dependsOn = 'ghost_task';
    expect(validatePlanShape(plan).ok).toBe(false);
  });

  it('rejects plans without input or with a bad source flag', () => {
    const plan = generateDemoPlan(wedding);
    (plan as unknown as { input: null }).input = null;
    expect(validatePlanShape(plan).ok).toBe(false);
    const plan2 = generateDemoPlan(wedding);
    (plan2 as unknown as { source: string }).source = 'mystery';
    expect(validatePlanShape(plan2).ok).toBe(false);
  });
});

describe('sanitizeVendors', () => {
  it('drops malformed records and normalizes valid ones', () => {
    const cleaned = sanitizeVendors([
      { id: 'v1', name: 'Sunrise Decor', category: 'decoration', contact: 'phone', quotedPriceMinor: 50000, bookingStatus: 'quoted', paymentStatus: 'none', notes: '', source: 'user' },
      { name: '' },
      null,
      { name: 'A', category: 'not-a-category', followUpDate: 'bad-date', quotedPriceMinor: -5, source: 'weird' },
    ]);
    expect(cleaned).toHaveLength(2);
    expect(cleaned[0].name).toBe('Sunrise Decor');
    expect(cleaned[1].category).toBe('other');
    expect(cleaned[1].quotedPriceMinor).toBeUndefined();
    expect(cleaned[1].followUpDate).toBeUndefined();
    expect(cleaned[1].source).toBe('user');
  });
});

describe('emptyEventInput', () => {
  it('produces sensible defaults per type', () => {
    const w = emptyEventInput('wedding');
    expect(w.requirements.accommodation).toBe(true);
    const b: EventInput = emptyEventInput('birthday');
    expect(b.requirements.accommodation).toBe(false);
    expect(b.budget.currency).toBe('INR');
    expect(b.guestCount).toBeGreaterThan(0);
  });
});
