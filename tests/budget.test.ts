import { describe, it, expect } from 'vitest';
import {
  allocateBudget,
  applyBudgetChange,
  budgetTotals,
  contingencyMinor,
  costPerGuest,
  distributeExactly,
  proposeBudgetChange,
  setAllocation,
} from '../src/domain/budget';
import type { BudgetCategory } from '../src/domain/types';

const entries = (spec: Record<string, 'high' | 'medium' | 'low'>) =>
  Object.entries(spec).map(([id, priority]) => ({ id: id as BudgetCategory['id'], priority }));

describe('distributeExactly', () => {
  it('always sums exactly to the available amount', () => {
    for (const available of [1, 7, 100, 999_999, 30_000_000, 12_345_678]) {
      const parts = distributeExactly(available, [3, 2, 1, 1]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(available);
    }
  });

  it('handles zero and negative weights without losing money', () => {
    const parts = distributeExactly(100, [0, 0, 5]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(parts[2]).toBe(100);
  });

  it('returns all zeros when nothing is available', () => {
    expect(distributeExactly(0, [1, 2])).toEqual([0, 0]);
  });
});

describe('allocateBudget', () => {
  it('carves contingency out first and allocates the remainder exactly', () => {
    const total = 30_000_000;
    const result = allocateBudget(total, entries({ venue: 'high', catering: 'high', decoration: 'medium', misc: 'low' }), 7);
    const sum = result.categories.reduce((s, c) => s + c.allocatedMinor, 0);
    expect(sum).toBe(total);
    expect(result.contingencyMinor).toBe(Math.round(total * 0.07));
    const contingency = result.categories.find((c) => c.isContingency)!;
    expect(contingency.allocatedMinor).toBe(result.contingencyMinor);
    expect(result.availableMinor).toBe(total - result.contingencyMinor);
  });

  it('gives high priority categories more than low priority ones', () => {
    const result = allocateBudget(1_000_000, entries({ venue: 'high', misc: 'low', decoration: 'medium' }), 0);
    const byId = Object.fromEntries(result.categories.map((c) => [c.id, c.allocatedMinor]));
    expect(byId.venue).toBeGreaterThan(byId.decoration);
    expect(byId.decoration).toBeGreaterThan(byId.misc);
  });

  it('zero contingency leaves everything allocatable', () => {
    const result = allocateBudget(500_000, entries({ venue: 'high' }), 0);
    expect(result.contingencyMinor).toBe(0);
    expect(result.categories[0].allocatedMinor).toBe(500_000);
  });
});

describe('budgetTotals', () => {
  const categories: BudgetCategory[] = [
    { id: 'venue', name: 'Venue', allocatedMinor: 40_000, estimatedMinor: 45_000, actualMinor: 10_000, priority: 'high', isContingency: false, manual: false },
    { id: 'catering', name: 'Catering', allocatedMinor: 50_000, estimatedMinor: 40_000, actualMinor: 0, priority: 'high', isContingency: false, manual: false },
    { id: 'contingency', name: 'Contingency', allocatedMinor: 10_000, estimatedMinor: 0, actualMinor: 10_000, priority: 'high', isContingency: true, manual: false },
  ];

  it('computes remaining from actuals and flags over-budget states', () => {
    const t = budgetTotals(categories, 100_000);
    expect(t.allocatedMinor).toBe(100_000);
    expect(t.actualMinor).toBe(20_000);
    expect(t.remainingMinor).toBe(80_000);
    expect(t.unallocatedMinor).toBe(0);
    expect(t.overSpent).toBe(false);
    expect(t.overAllocated).toBe(false);
    expect(t.estimatedOverBudget).toBe(false);
  });

  it('detects over-allocation and overspending', () => {
    const t = budgetTotals(categories, 80_000);
    expect(t.overAllocated).toBe(true);
    expect(t.unallocatedMinor).toBe(-20_000);

    const blown = budgetTotals(
      categories.map((c) => ({ ...c, actualMinor: 60_000 })),
      100_000,
    );
    expect(blown.actualMinor).toBe(180_000);
    expect(blown.overSpent).toBe(true);
    expect(blown.remainingMinor).toBe(-80_000);
  });

  it('flags estimated overrun', () => {
    const t = budgetTotals(categories, 90_000);
    expect(t.estimatedMinor).toBe(85_000);
    expect(t.estimatedOverBudget).toBe(false);
    const tight = budgetTotals(categories, 80_000);
    expect(tight.estimatedOverBudget).toBe(true);
  });
});

describe('setAllocation', () => {
  const categories: BudgetCategory[] = [
    { id: 'venue', name: 'Venue', allocatedMinor: 60_000, estimatedMinor: 0, actualMinor: 0, priority: 'high', isContingency: false, manual: false },
    { id: 'misc', name: 'Misc', allocatedMinor: 40_000, estimatedMinor: 0, actualMinor: 0, priority: 'low', isContingency: false, manual: false },
  ];

  it('rejects allocations beyond the total', () => {
    const result = setAllocation(categories, 100_000, 'misc', 50_000);
    expect(result.error).toBeTruthy();
    expect(result.categories).toBe(categories);
  });

  it('accepts a valid allocation and marks it manual', () => {
    const result = setAllocation(categories, 100_000, 'misc', 30_000);
    expect(result.error).toBeUndefined();
    const misc = result.categories.find((c) => c.id === 'misc')!;
    expect(misc.allocatedMinor).toBe(30_000);
    expect(misc.manual).toBe(true);
  });

  it('rejects negative allocations', () => {
    const result = setAllocation(categories, 100_000, 'misc', -1);
    expect(result.error).toBeTruthy();
  });
});

describe('proposeBudgetChange', () => {
  const base = allocateBudget(300_000, entries({ venue: 'high', catering: 'high', decoration: 'medium', entertainment: 'low', misc: 'low' }), 7);

  it('produces a cut proposal that sums exactly to the new total', () => {
    const proposal = proposeBudgetChange(base.categories, 300_000, 240_000, 7);
    expect(proposal.ok).toBe(true);
    const applied = applyBudgetChange(base.categories, proposal);
    const sum = applied.reduce((s, c) => s + c.allocatedMinor, 0);
    expect(sum).toBe(240_000);
    expect(proposal.notes.length).toBeGreaterThan(0);
    expect(proposal.shortfallMinor).toBe(0);
  });

  it('protects high-priority categories proportionally more than low-priority ones', () => {
    const proposal = proposeBudgetChange(base.categories, 300_000, 240_000, 7);
    const applied = applyBudgetChange(base.categories, proposal);
    const before = Object.fromEntries(base.categories.map((c) => [c.id, c.allocatedMinor]));
    const after = Object.fromEntries(applied.map((c) => [c.id, c.allocatedMinor]));
    const cutPct = (id: string) => (before[id] - after[id]) / before[id];
    expect(cutPct('misc')).toBeGreaterThanOrEqual(cutPct('catering'));
    expect(cutPct('entertainment')).toBeGreaterThanOrEqual(cutPct('venue'));
  });

  it('handles a budget increase without breaking the sum', () => {
    const proposal = proposeBudgetChange(base.categories, 300_000, 450_000, 7);
    expect(proposal.ok).toBe(true);
    const applied = applyBudgetChange(base.categories, proposal);
    expect(applied.reduce((s, c) => s + c.allocatedMinor, 0)).toBe(450_000);
  });

  it('rejects invalid totals', () => {
    expect(proposeBudgetChange(base.categories, 300_000, 0, 7).ok).toBe(false);
    expect(proposeBudgetChange(base.categories, 300_000, -5, 7).ok).toBe(false);
  });

  it('is a no-op when the total is unchanged', () => {
    const proposal = proposeBudgetChange(base.categories, 300_000, 300_000, 7);
    expect(proposal.ok).toBe(true);
    expect(proposal.deltas).toHaveLength(0);
  });

  it('keeps allocations non-negative under a severe cut', () => {
    const proposal = proposeBudgetChange(base.categories, 300_000, 40_000, 7);
    const applied = applyBudgetChange(base.categories, proposal);
    for (const c of applied) expect(c.allocatedMinor).toBeGreaterThanOrEqual(0);
    expect(applied.reduce((s, c) => s + c.allocatedMinor, 0)).toBe(40_000);
  });
});

describe('helpers', () => {
  it('contingencyMinor clamps to the total', () => {
    expect(contingencyMinor(1000, 7)).toBe(70);
    expect(contingencyMinor(1000, 200)).toBe(1000);
    expect(contingencyMinor(0, 7)).toBe(0);
  });

  it('costPerGuest rounds to whole minor units', () => {
    expect(costPerGuest(100_007, 3)).toBe(33_336);
    expect(costPerGuest(100, 0)).toBe(0);
  });
});
