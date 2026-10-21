import { describe, it, expect } from 'vitest';
import { applyPlanOps, validateOp, validateOps } from '../src/planner/ops';
import { generateDemoPlan } from '../src/planner/demo';
import { SAMPLE_EVENTS } from '../src/domain/events';
import { budgetTotals } from '../src/domain/budget';
import { dueDateForLead } from '../src/domain/timeline';

const wedding = SAMPLE_EVENTS.find((s) => s.key === 'wedding')!.build();
const birthday = SAMPLE_EVENTS.find((s) => s.key === 'birthday')!.build();
const basePlan = () => generateDemoPlan(wedding);

describe('validateOp', () => {
  it('accepts well-formed operations', () => {
    expect(validateOp({ op: 'setGuestCount', count: 80 })).toHaveProperty('op');
    expect(validateOp({ op: 'rebalanceBudget' })).toHaveProperty('op');
    expect(validateOp({ op: 'setCategoryPriority', categoryId: 'decoration', priority: 'low' })).toHaveProperty('op');
    expect(validateOp({ op: 'setEventDate', date: '2027-06-01' })).toHaveProperty('op');
  });

  it('rejects unknown operations (no arbitrary execution)', () => {
    expect(validateOp({ op: 'execShell', cmd: 'rm -rf /' })).toHaveProperty('error');
    expect(validateOp({ op: '__proto__' })).toHaveProperty('error');
    expect(validateOp({ op: 'setGuestCount', count: 'lots' })).toHaveProperty('error');
    expect(validateOp({ op: 'setBudgetTotal', totalMinor: -1 })).toHaveProperty('error');
    expect(validateOp({ op: 'setEventDate', date: 'tomorrow' })).toHaveProperty('error');
    expect(validateOp({ op: 'setCategoryPriority', categoryId: 'decoration', priority: 'urgent' })).toHaveProperty('error');
    expect(validateOp(null)).toHaveProperty('error');
    expect(validateOp({ op: 'setRequirement', key: 'music', enabled: true })).toHaveProperty('error');
    expect(validateOp({ op: 'setPreference', field: 'food', value: 'gluten-free-only' })).toHaveProperty('error');
  });

  it('caps operation batches', () => {
    const many = Array.from({ length: 60 }, () => ({ op: 'rebalanceBudget' }));
    const result = validateOps(many);
    expect(result.ops).toHaveLength(0);
    expect(result.errors[0]).toMatch(/Too many/);
  });

  it('collects per-op errors without applying partial junk', () => {
    const result = validateOps([{ op: 'setGuestCount', count: 10 }, { op: 'nope' }, { op: 'setGuestCount', count: -5 }]);
    expect(result.ops).toHaveLength(1);
    expect(result.errors).toHaveLength(2);
  });
});

describe('applyPlanOps: budget', () => {
  it('reduces the budget, keeps the sum exact and preserves high-priority shares better', () => {
    const plan = basePlan();
    const oldTotal = plan.input.budget.totalMinor;
    const newTotal = Math.round(oldTotal * 0.8);
    const before = Object.fromEntries(plan.budget.categories.map((c) => [c.id, c.allocatedMinor]));

    const result = applyPlanOps(plan, [{ op: 'setBudgetTotal', totalMinor: newTotal }]);
    expect(result.plan.input.budget.totalMinor).toBe(newTotal);

    const totals = budgetTotals(result.plan.budget.categories, newTotal);
    expect(totals.allocatedMinor).toBe(newTotal);
    expect(totals.overAllocated).toBe(false);

    const after = Object.fromEntries(result.plan.budget.categories.map((c) => [c.id, c.allocatedMinor]));
    const catering = plan.budget.categories.find((c) => c.id === 'catering')!;
    const misc = plan.budget.categories.find((c) => c.id === 'misc')!;
    const cut = (id: string) => (before[id] - after[id]) / before[id];
    if (catering.allocatedMinor > 0 && misc.allocatedMinor > 0) {
      expect(cut('misc')).toBeGreaterThanOrEqual(cut('catering'));
    }
    expect(result.changes.some((c) => /Budget changed/.test(c))).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('recalculates estimates and contingency after a budget change', () => {
    const plan = generateDemoPlan(birthday);
    const result = applyPlanOps(plan, [{ op: 'setBudgetTotal', totalMinor: Math.round(plan.input.budget.totalMinor * 0.5) }]);
    const contingency = result.plan.budget.categories.find((c) => c.isContingency)!;
    const expected = Math.round((plan.input.budget.totalMinor * 0.5 * plan.input.budget.contingencyPct) / 100);
    expect(contingency.allocatedMinor).toBe(expected);
    expect(result.plan.budget.insufficient).toBe(true); // halved budget vs same estimates
  });

  it('rejects an invalid budget amount with a warning, not a crash', () => {
    const plan = basePlan();
    const result = applyPlanOps(plan, [{ op: 'setBudgetTotal', totalMinor: 0 }]);
    expect(result.plan.input.budget.totalMinor).toBe(plan.input.budget.totalMinor);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe('applyPlanOps: guest count', () => {
  it('updates estimates, keeps allocations inside budget and preserves unrelated data', () => {
    const plan = basePlan();
    const result = applyPlanOps(plan, [{ op: 'setGuestCount', count: 80 }]);
    const p = result.plan;

    expect(p.input.guestCount).toBe(80);
    expect(p.input.name).toBe(plan.input.name);
    expect(p.input.preferences).toEqual(plan.input.preferences);
    expect(p.timeline.tasks.length).toBe(plan.timeline.tasks.length + 1); // headcount reminder added

    const catering = p.budget.categories.find((c) => c.id === 'catering')!;
    const oldCatering = plan.budget.categories.find((c) => c.id === 'catering')!;
    expect(catering.estimatedMinor).toBeLessThan(oldCatering.estimatedMinor);

    const totals = budgetTotals(p.budget.categories, p.input.budget.totalMinor);
    expect(totals.allocatedMinor).toBe(p.input.budget.totalMinor);
    expect(result.changes.some((c) => /Guest count/.test(c))).toBe(true);
  });

  it('raises catering estimates when guests increase', () => {
    const plan = generateDemoPlan(birthday);
    const result = applyPlanOps(plan, [{ op: 'setGuestCount', count: plan.input.guestCount * 2 }]);
    const catering = result.plan.budget.categories.find((c) => c.id === 'catering')!;
    expect(catering.estimatedMinor).toBeGreaterThan(plan.budget.categories.find((c) => c.id === 'catering')!.estimatedMinor);
    const totals = budgetTotals(result.plan.budget.categories, result.plan.input.budget.totalMinor);
    expect(totals.allocatedMinor).toBe(result.plan.input.budget.totalMinor);
  });
});

describe('applyPlanOps: date changes', () => {
  it('reschedules open tasks and leaves completed tasks alone', () => {
    const plan = basePlan();
    const doneTask = plan.timeline.tasks[0];
    const prepared = applyPlanOps(plan, [{ op: 'setTaskStatus', taskId: doneTask.id, status: 'done' }]).plan;

    const result = applyPlanOps(prepared, [{ op: 'setEventDate', date: '2028-03-15' }]);
    const p = result.plan;
    expect(p.input.date).toBe('2028-03-15');

    const done = p.timeline.tasks.find((t) => t.id === doneTask.id)!;
    expect(done.status).toBe('done');
    expect(done.dueDate).toBe(doneTask.dueDate); // untouched

    for (const t of p.timeline.tasks) {
      if (t.status === 'done') continue;
      expect(t.dueDate).toBe(dueDateForLead('2028-03-15', t.leadDays));
    }
    expect(result.changes.some((c) => /Event date moved/.test(c))).toBe(true);
  });

  it('preserves milestone ordering relative to the new date', () => {
    const plan = basePlan();
    const result = applyPlanOps(plan, [{ op: 'setEventDate', date: '2028-07-10' }]);
    const last = result.plan.timeline.milestones[result.plan.timeline.milestones.length - 1];
    expect(last.date).toBe('2028-07-10');
  });
});

describe('applyPlanOps: scope and structure', () => {
  it('adding a vegetarian preference recalculates catering estimates only where relevant', () => {
    const plan = generateDemoPlan({ ...wedding, preferences: { ...wedding.preferences, food: 'mixed' } });
    const result = applyPlanOps(plan, [{ op: 'setPreference', field: 'food', value: 'vegetarian' }]);
    const catering = result.plan.budget.categories.find((c) => c.id === 'catering')!;
    const venue = result.plan.budget.categories.find((c) => c.id === 'venue')!;
    const oldCatering = plan.budget.categories.find((c) => c.id === 'catering')!;
    const oldVenue = plan.budget.categories.find((c) => c.id === 'venue')!;
    expect(catering.estimatedMinor).toBeLessThan(oldCatering.estimatedMinor);
    expect(venue.allocatedMinor).toBe(oldVenue.allocatedMinor); // allocations untouched
    expect(result.plan.input.preferences.cultural).toBe(plan.input.preferences.cultural);
  });

  it('disabling a requirement removes the category and redistributes its budget', () => {
    const plan = basePlan();
    const decoration = plan.budget.categories.find((c) => c.id === 'decoration')!;
    expect(decoration.allocatedMinor).toBeGreaterThan(0);

    const result = applyPlanOps(plan, [{ op: 'setRequirement', key: 'decoration', enabled: false }]);
    expect(result.plan.input.requirements.decoration).toBe(false);
    expect(result.plan.budget.categories.some((c) => c.id === 'decoration')).toBe(false);
    const totals = budgetTotals(result.plan.budget.categories, plan.input.budget.totalMinor);
    expect(totals.allocatedMinor).toBe(plan.input.budget.totalMinor);
    expect(result.plan.vendorRequirements.some((v) => v.category === 'decoration')).toBe(false);
  });

  it('re-enabling a requirement restores the category and a vendor requirement', () => {
    const plan = applyPlanOps(basePlan(), [{ op: 'setRequirement', key: 'decoration', enabled: false }]).plan;
    const result = applyPlanOps(plan, [{ op: 'setRequirement', key: 'decoration', enabled: true }]);
    const cat = result.plan.budget.categories.find((c) => c.id === 'decoration');
    expect(cat).toBeTruthy();
    expect(result.plan.vendorRequirements.some((v) => v.category === 'decoration')).toBe(true);
    const totals = budgetTotals(result.plan.budget.categories, plan.input.budget.totalMinor);
    expect(totals.allocatedMinor).toBe(plan.input.budget.totalMinor);
  });

  it('task ops add, update and delete with dependency cleanup', () => {
    const plan = basePlan();
    const addResult = applyPlanOps(plan, [
      {
        op: 'addTask',
        task: {
          title: 'Confirm sound check',
          description: '',
          category: 'entertainment',
          dueDate: plan.input.date,
          leadDays: 3,
          priority: 'medium',
          status: 'todo',
        },
      },
    ]);
    const added = addResult.plan.timeline.tasks.find((t) => t.title === 'Confirm sound check')!;
    expect(added).toBeTruthy();

    const updated = applyPlanOps(addResult.plan, [{ op: 'updateTask', taskId: added.id, patch: { status: 'done' } }]);
    expect(updated.plan.timeline.tasks.find((t) => t.id === added.id)!.status).toBe('done');

    const dependent = addResult.plan.timeline.tasks.find((t) => t.dependsOn === added.id);
    const deleted = applyPlanOps(addResult.plan, [{ op: 'deleteTask', taskId: added.id }]);
    expect(deleted.plan.timeline.tasks.some((t) => t.id === added.id)).toBe(false);
    if (dependent) {
      expect(deleted.plan.timeline.tasks.find((t) => t.id === dependent.id)!.dependsOn).toBeUndefined();
    }
  });

  it('vendor ops record user-entered data with source "user"', () => {
    const plan = basePlan();
    const result = applyPlanOps(plan, [
      { op: 'addVendor', vendor: { name: 'Blue Leaf Caterers', category: 'catering', contact: 'asked at expo', notes: '', bookingStatus: 'contacted', paymentStatus: 'none', source: 'user' } },
    ]);
    const vendor = result.plan.vendors[0];
    expect(vendor.name).toBe('Blue Leaf Caterers');
    expect(vendor.source).toBe('user');

    const removed = applyPlanOps(result.plan, [{ op: 'deleteVendor', vendorId: vendor.id }]);
    expect(removed.plan.vendors).toHaveLength(0);
  });

  it('moving a budget total by an absurd amount cannot break arithmetic', () => {
    const plan = basePlan();
    const result = applyPlanOps(plan, [{ op: 'setBudgetTotal', totalMinor: 1_000_00 }]);
    const totals = budgetTotals(result.plan.budget.categories, 1_000_00);
    expect(totals.allocatedMinor).toBe(1_000_00);
    expect(totals.overAllocated).toBe(false);
    for (const c of result.plan.budget.categories) expect(c.allocatedMinor).toBeGreaterThanOrEqual(0);
  });
});
