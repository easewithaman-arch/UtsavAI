import { describe, it, expect } from 'vitest';
import { generateDemoPlan, estimateCategoryCosts, buildBudgetCategories } from '../src/planner/demo';
import { SAMPLE_EVENTS } from '../src/domain/events';
import { budgetTotals } from '../src/domain/budget';
import { validatePlanShape } from '../src/domain/validate';
import type { EventInput } from '../src/domain/types';

const birthday = SAMPLE_EVENTS.find((s) => s.key === 'birthday')!.build();
const wedding = SAMPLE_EVENTS.find((s) => s.key === 'wedding')!.build();
const community = SAMPLE_EVENTS.find((s) => s.key === 'community')!.build();

describe('generateDemoPlan', () => {
  it('produces a structurally valid plan', () => {
    for (const input of [birthday, wedding, community]) {
      const result = validatePlanShape(generateDemoPlan(input));
      expect(result.errors).toEqual([]);
    }
  });

  it('allocates exactly to the total budget', () => {
    for (const input of [birthday, wedding, community]) {
      const plan = generateDemoPlan(input);
      const totals = budgetTotals(plan.budget.categories, input.budget.totalMinor);
      expect(totals.allocatedMinor).toBe(input.budget.totalMinor);
      expect(totals.unallocatedMinor).toBe(0);
      expect(totals.overAllocated).toBe(false);
    }
  });

  it('is meaningfully different across event types, sizes and budgets', () => {
    const b = generateDemoPlan(birthday);
    const w = generateDemoPlan(wedding);
    const c = generateDemoPlan(community);

    const shares = (plan: typeof b) =>
      Object.fromEntries(plan.budget.categories.map((cat) => [cat.id, cat.allocatedMinor]));
    expect(shares(b)).not.toEqual(shares(w));
    expect(shares(w)).not.toEqual(shares(c));

    // Small birthday must not receive the wedding's catering scale.
    const bCatering = b.budget.categories.find((x) => x.id === 'catering')!;
    const wCatering = w.budget.categories.find((x) => x.id === 'catering')!;
    expect(wCatering.estimatedMinor).toBeGreaterThan(bCatering.estimatedMinor * 5);

    expect(b.overview.concept).not.toBe(w.overview.concept);
    expect(w.timeline.tasks.length).not.toBe(b.timeline.tasks.length);
  });

  it('uses the real inputs in the overview', () => {
    const plan = generateDemoPlan(wedding);
    expect(plan.overview.concept).toContain(String(wedding.guestCount));
    expect(plan.overview.concept).toContain(wedding.location);
    expect(plan.overview.concept).toContain(wedding.date);
    expect(plan.overview.theme.toLowerCase()).toContain('marigold'); // from sample preference
  });

  it('flags insufficient budgets with concrete advice', () => {
    const broke: EventInput = {
      ...wedding,
      name: 'Tiny budget wedding',
      guestCount: 400,
      budget: { ...wedding.budget, totalMinor: 4_000_000 }, // ₹40,000 for 400 guests
    };
    const plan = generateDemoPlan(broke);
    expect(plan.budget.insufficient).toBe(true);
    expect(plan.budget.risks.some((r) => /exceed/i.test(r))).toBe(true);
    expect(plan.actions.decisions.some((d) => /cut/i.test(d))).toBe(true);
  });

  it('is input-sensitive: changing guests changes catering estimates', () => {
    const a = estimateCategoryCosts({ ...birthday, guestCount: 20 });
    const b = estimateCategoryCosts({ ...birthday, guestCount: 80 });
    expect(b.catering).toBeGreaterThan(a.catering);
  });

  it('is input-sensitive: metro location raises venue and decor estimates', () => {
    const local = estimateCategoryCosts({ ...birthday, location: 'Nashik' });
    const metro = estimateCategoryCosts({ ...birthday, location: 'Mumbai' });
    expect(metro.venue).toBeGreaterThan(local.venue);
    expect(metro.decoration).toBeGreaterThan(local.decoration);
  });

  it('is input-sensitive: vegetarian menus cost less than mixed', () => {
    const veg = estimateCategoryCosts({ ...wedding, preferences: { ...wedding.preferences, food: 'vegetarian' } });
    const mixed = estimateCategoryCosts({ ...wedding, preferences: { ...wedding.preferences, food: 'mixed' } });
    expect(mixed.catering).toBeGreaterThan(veg.catering);
  });

  it('zeroes categories whose requirements are disabled', () => {
    const input: EventInput = { ...birthday, requirements: { ...birthday.requirements, decoration: false, entertainment: false } };
    const categories = buildBudgetCategories(input);
    const decor = categories.find((c) => c.id === 'decoration')!;
    expect(decor.allocatedMinor).toBe(0);
    expect(decor.estimatedMinor).toBe(0);
    const totals = budgetTotals(categories, input.budget.totalMinor);
    expect(totals.allocatedMinor).toBe(input.budget.totalMinor);
  });

  it('derives deadlines from the event date and keeps contingency intact', () => {
    const plan = generateDemoPlan(wedding);
    for (const t of plan.timeline.tasks) {
      expect(t.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const contingency = plan.budget.categories.find((c) => c.isContingency)!;
    expect(contingency.allocatedMinor).toBeGreaterThan(0);
    expect(contingency.allocatedMinor).toBeLessThan(wedding.budget.totalMinor);
    expect(plan.timeline.milestones[plan.timeline.milestones.length - 1].date).toBe(wedding.date);
  });

  it('marks every generated plan as demo source', () => {
    expect(generateDemoPlan(birthday).source).toBe('demo');
  });

  it('creates vendor requirements only for enabled categories', () => {
    const input: EventInput = { ...birthday, requirements: { ...birthday.requirements, transportation: false, photography: false, accommodation: false } };
    const plan = generateDemoPlan(input);
    expect(plan.vendorRequirements.some((v) => v.category === 'transportation')).toBe(false);
    expect(plan.vendorRequirements.some((v) => v.category === 'photography')).toBe(false);
    expect(plan.vendorRequirements.some((v) => v.category === 'venue')).toBe(true);
    for (const v of plan.vendorRequirements) {
      expect(v.questions.length).toBeGreaterThan(0);
      expect(v.budgetGuideMinor).toBeGreaterThan(0);
    }
  });
});
