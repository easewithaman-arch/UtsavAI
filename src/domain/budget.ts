import type { BudgetCategory, CategoryId, CurrencyCode, Priority } from './types';
import { CATEGORY_NAMES } from './events';
import { clampMinor, formatMoney, percentOf } from './money';

const PRIORITY_WEIGHT: Record<Priority, number> = { high: 3, medium: 2, low: 1 };

export interface AllocationEntry {
  id: CategoryId;
  priority: Priority;
  /** Optional explicit share (0..1) overriding priority weights. */
  share?: number;
}

export interface BudgetTotals {
  totalMinor: number;
  allocatedMinor: number;
  estimatedMinor: number;
  actualMinor: number;
  /** Money still available to spend: total - actual. */
  remainingMinor: number;
  /** Budget not yet assigned to any category. */
  unallocatedMinor: number;
  contingencyMinor: number;
  overAllocated: boolean;
  overSpent: boolean;
  estimatedOverBudget: boolean;
}

export function contingencyMinor(totalMinor: number, pct: number): number {
  if (totalMinor <= 0 || pct <= 0) return 0;
  return clampMinor(Math.round((totalMinor * pct) / 100), 0, totalMinor);
}

/** Largest-remainder distribution: values always sum exactly to `available`. */
export function distributeExactly(available: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  if (available <= 0) return weights.map(() => 0);
  const safeWeights = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const weightSum = safeWeights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) {
    const base = Math.floor(available / weights.length);
    const out = weights.map(() => base);
    out[0] += available - base * weights.length;
    return out;
  }
  const raw = safeWeights.map((w) => (available * w) / weightSum);
  const floors = raw.map((r) => Math.floor(r));
  let remainder = available - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const result = [...floors];
  for (const { i } of order) {
    if (remainder <= 0) break;
    result[i] += 1;
    remainder -= 1;
  }
  return result;
}

export function weightsFor(entries: AllocationEntry[]): number[] {
  return entries.map((e) => (e.share !== undefined && e.share > 0 ? e.share : PRIORITY_WEIGHT[e.priority]));
}

export interface AllocationResult {
  categories: BudgetCategory[];
  contingencyMinor: number;
  availableMinor: number;
}

/** Carves the contingency out first, then distributes the rest by priority weight. */
export function allocateBudget(
  totalMinor: number,
  entries: AllocationEntry[],
  contingencyPct: number,
): AllocationResult {
  const contingency = contingencyMinor(totalMinor, contingencyPct);
  const available = Math.max(0, totalMinor - contingency);
  const shares = distributeExactly(available, weightsFor(entries));
  const categories: BudgetCategory[] = entries.map((entry, i) => ({
    id: entry.id,
    name: CATEGORY_NAMES[entry.id],
    allocatedMinor: shares[i] ?? 0,
    estimatedMinor: 0,
    actualMinor: 0,
    priority: entry.priority,
    isContingency: false,
    manual: false,
  }));
  categories.push({
    id: 'contingency',
    name: CATEGORY_NAMES.contingency,
    allocatedMinor: contingency,
    estimatedMinor: 0,
    actualMinor: contingency,
    priority: 'high',
    isContingency: true,
    manual: false,
  });
  return { categories, contingencyMinor: contingency, availableMinor: available };
}

export function budgetTotals(categories: BudgetCategory[], totalMinor: number): BudgetTotals {
  let allocated = 0;
  let estimated = 0;
  let actual = 0;
  let contingency = 0;
  for (const c of categories) {
    allocated += c.allocatedMinor;
    estimated += c.estimatedMinor;
    actual += c.actualMinor;
    if (c.isContingency) contingency += c.allocatedMinor;
  }
  return {
    totalMinor,
    allocatedMinor: allocated,
    estimatedMinor: estimated,
    actualMinor: actual,
    remainingMinor: totalMinor - actual,
    unallocatedMinor: totalMinor - allocated,
    contingencyMinor: contingency,
    overAllocated: allocated > totalMinor,
    overSpent: actual > totalMinor,
    estimatedOverBudget: estimated > totalMinor,
  };
}

export function setAllocation(
  categories: BudgetCategory[],
  totalMinor: number,
  categoryId: CategoryId,
  valueMinor: number,
  currency?: CurrencyCode,
): { categories: BudgetCategory[]; error?: string } {
  const target = categories.find((c) => c.id === categoryId);
  if (!target) return { categories, error: 'Unknown budget category.' };
  const others = categories.filter((c) => c.id !== categoryId).reduce((sum, c) => sum + c.allocatedMinor, 0);
  const max = totalMinor - others;
  if (valueMinor < 0) return { categories, error: 'Allocation cannot be negative.' };
  if (valueMinor > max) {
    return {
      categories,
      error: currency
        ? `Only ${formatMoney(max, currency)} is left for this category after setting amounts for the others.`
        : `Only ${max} is left for this category after setting amounts for the others.`,
    };
  }
  return {
    categories: categories.map((c) =>
      c.id === categoryId ? { ...c, allocatedMinor: valueMinor, manual: true } : c,
    ),
  };
}

export interface BudgetChangeProposal {
  ok: boolean;
  reason?: string;
  oldTotalMinor: number;
  newTotalMinor: number;
  newContingencyMinor: number;
  deltas: { id: CategoryId; name: string; beforeMinor: number; afterMinor: number }[];
  notes: string[];
  shortfallMinor: number;
}

/**
 * Recomputes allocations for a new total budget.
 * High-priority categories are preserved as long as the maths allows;
 * medium/low categories absorb the change first. Nothing is applied
 * until the caller confirms the proposal.
 */
export function proposeBudgetChange(
  categories: BudgetCategory[],
  oldTotalMinor: number,
  newTotalMinor: number,
  contingencyPct: number,
): BudgetChangeProposal {
  const empty: BudgetChangeProposal = {
    ok: false,
    oldTotalMinor,
    newTotalMinor,
    newContingencyMinor: 0,
    deltas: [],
    notes: [],
    shortfallMinor: 0,
  };
  if (!Number.isSafeInteger(newTotalMinor) || newTotalMinor <= 0) {
    return { ...empty, reason: 'New budget must be a positive amount.' };
  }
  if (newTotalMinor === oldTotalMinor) {
    return { ...empty, ok: true, newContingencyMinor: contingencyMinor(oldTotalMinor, contingencyPct), reason: 'unchanged' };
  }

  const oldContingency = contingencyMinor(oldTotalMinor, contingencyPct);
  let newContingency = contingencyMinor(newTotalMinor, contingencyPct);
  if (newContingency >= newTotalMinor) {
    newContingency = Math.floor(newTotalMinor * 0.05);
  }
  const newAvailable = newTotalMinor - newContingency;

  const normal = categories.filter((c) => !c.isContingency);
  const oldAvailable = normal.reduce((s, c) => s + c.allocatedMinor, 0);
  const notes: string[] = [];

  let nextAllocations: Map<CategoryId, number>;

  if (newTotalMinor > oldTotalMinor) {
    const factor = oldAvailable > 0 ? newAvailable / oldAvailable : 1;
    const scaled = normal.map((c) => Math.floor(c.allocatedMinor * factor));
    const extra = newAvailable - scaled.reduce((a, b) => a + b, 0);
    if (scaled.length > 0 && extra > 0) {
      const idx = scaled.reduce((best, value, i) => (value > scaled[best] ? i : best), 0);
      scaled[idx] += extra;
    }
    nextAllocations = new Map(normal.map((c, i) => [c.id, scaled[i]]));
    const pctUp = Math.round(((newTotalMinor - oldTotalMinor) / oldTotalMinor) * 100);
    notes.push(`Budget increased by ${pctUp}%. All categories received extra room in proportion to their priority.`);
  } else {
    const reductionNeeded = oldAvailable - newAvailable;
    const byPriority: Priority[] = ['low', 'medium', 'high'];
    const remaining = new Map(normal.map((c) => [c.id, c.allocatedMinor]));
    let toFree = reductionNeeded;

    for (const prio of byPriority) {
      if (toFree <= 0) break;
      const group = normal.filter((c) => c.priority === prio);
      if (group.length === 0) continue;
      const groupSum = group.reduce((s, c) => s + (remaining.get(c.id) ?? 0), 0);
      if (groupSum <= 0) continue;
      const take = Math.min(toFree, groupSum);
      const shares = distributeExactly(
        take,
        group.map((c) => Math.max(1, remaining.get(c.id) ?? 0)),
      );
      group.forEach((c, i) => {
        remaining.set(c.id, (remaining.get(c.id) ?? 0) - shares[i]);
      });
      toFree -= take;
      notes.push(
        prio === 'low'
          ? `Lower-priority categories absorb the first cut (${pctOfBudget(take, newTotalMinor)}% of the new budget).`
          : prio === 'medium'
            ? `Medium-priority categories are reduced next to protect the essentials.`
            : `Even high-priority categories must shrink to fit the new budget.`,
      );
    }

    let shortfall = toFree;
    if (shortfall > 0) {
      const ids = normal.map((c) => c.id);
      const extra = distributeExactly(
        shortfall,
        ids.map((id) => Math.max(1, remaining.get(id) ?? 0)),
      );
      ids.forEach((id, i) => remaining.set(id, Math.max(0, (remaining.get(id) ?? 0) - extra[i])));
      shortfall = 0;
    }
    nextAllocations = remaining;
    notes.unshift(
      `Budget cut of ${Math.round(((oldTotalMinor - newTotalMinor) / oldTotalMinor) * 100)}%. The reserve was recalculated to ${formatPctOfTotal(newContingency, newTotalMinor)} of the budget.`,
    );
    if (newContingency < oldContingency) {
      notes.push('The reserve was reduced along with the budget - keep a buffer if you can.');
    }
  }

  const deltas: BudgetChangeProposal['deltas'] = [];
  for (const c of categories) {
    if (c.isContingency) {
      if (newContingency !== c.allocatedMinor) {
        deltas.push({ id: c.id, name: c.name, beforeMinor: c.allocatedMinor, afterMinor: newContingency });
      }
      continue;
    }
    const after = nextAllocations.get(c.id) ?? 0;
    if (after !== c.allocatedMinor) {
      deltas.push({ id: c.id, name: c.name, beforeMinor: c.allocatedMinor, afterMinor: after });
    }
  }

  const hypothetical = categories.map((c) =>
    c.isContingency
      ? { ...c, allocatedMinor: newContingency }
      : { ...c, allocatedMinor: nextAllocations.get(c.id) ?? 0 },
  );
  for (const c of hypothetical) {
    if (c.isContingency) continue;
    if (c.estimatedMinor > c.allocatedMinor) {
      const gap = c.estimatedMinor - c.allocatedMinor;
      notes.push(
        `${c.name}: allocation is now below the estimated cost by ${formatPctOfTotal(gap, newTotalMinor)}% of the budget - trim scope here or find a cheaper option.`,
      );
    }
  }

  const sumAfter = hypothetical.reduce((s, c) => s + c.allocatedMinor, 0);
  const shortfallMinor = Math.max(0, sumAfter - newTotalMinor);

  return {
    ok: true,
    oldTotalMinor,
    newTotalMinor,
    newContingencyMinor: newContingency,
    deltas,
    notes,
    shortfallMinor,
  };
}

function pctOfBudget(value: number, total: number): string {
  return String(percentOf(value, total));
}

function formatPctOfTotal(value: number, total: number): string {
  return `${percentOf(value, total)}%`;
}

export function applyBudgetChange(
  categories: BudgetCategory[],
  proposal: BudgetChangeProposal,
): BudgetCategory[] {
  if (!proposal.ok) return categories;
  return categories.map((c) => {
    const delta = proposal.deltas.find((d) => d.id === c.id);
    if (!delta) return c;
    return { ...c, allocatedMinor: delta.afterMinor, manual: false };
  });
}

/** Warnings shown in the budget workspace. Pure and deterministic. */
export function budgetWarnings(
  categories: BudgetCategory[],
  totalMinor: number,
  currency?: CurrencyCode,
  totals = budgetTotals(categories, totalMinor),
): string[] {
  const t = totals;
  const amount = (minor: number) => (currency ? formatMoney(minor, currency) : String(minor));
  const out: string[] = [];
  if (t.overSpent) {
    out.push(`Actual spending exceeds the total budget by ${amount(t.actualMinor - totalMinor)}.`);
  }
  if (t.overAllocated) {
    out.push('Allocations exceed the total budget - reduce one or more categories.');
  }
  if (t.unallocatedMinor > 0 && !t.overAllocated) {
    out.push(`${amount(t.unallocatedMinor)} of your budget has not been given to a category yet.`);
  }
  for (const c of categories) {
    if (c.isContingency) continue;
    if (c.actualMinor > c.allocatedMinor) {
      out.push(`${c.name}: actual spend is above allocation.`);
    } else if (c.actualMinor > 0 && c.estimatedMinor > 0 && c.actualMinor > c.estimatedMinor) {
      out.push(`${c.name}: actual spend came in above the original estimate.`);
    }
    if (c.estimatedMinor > c.allocatedMinor && c.actualMinor === 0) {
      out.push(`${c.name}: estimate exceeds allocation - expect to negotiate or cut scope.`);
    }
  }
  return out;
}

export function costPerGuest(totalMinor: number, guestCount: number): number {
  if (guestCount <= 0) return 0;
  return Math.round(totalMinor / guestCount);
}

export function reallocateForPriorities(
  categories: BudgetCategory[],
  totalMinor: number,
  contingencyPct: number,
  priorities: Partial<Record<CategoryId, Priority>>,
): BudgetCategory[] {
  const entries: AllocationEntry[] = categories
    .filter((c) => !c.isContingency)
    .map((c) => ({ id: c.id, priority: priorities[c.id] ?? c.priority }));
  const result = allocateBudget(totalMinor, entries, contingencyPct);
  const actuals = new Map(categories.map((c) => [c.id, c.actualMinor]));
  const estimates = new Map(categories.map((c) => [c.id, c.estimatedMinor]));
  const manuals = new Map(categories.map((c) => [c.id, c.manual]));
  return result.categories.map((c) => ({
    ...c,
    actualMinor: actuals.get(c.id) ?? c.actualMinor,
    estimatedMinor: estimates.get(c.id) ?? 0,
    manual: manuals.get(c.id) ?? false,
  }));
}
