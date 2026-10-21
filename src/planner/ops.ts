import type {
  CategoryId,
  ChangeRecord,
  EventInput,
  EventPlan,
  PlanTask,
  Priority,
  RequirementKey,
  Vendor,
} from '../domain/types';
import {
  applyBudgetChange,
  budgetTotals,
  distributeExactly,
  proposeBudgetChange,
  reallocateForPriorities,
  setAllocation,
} from '../domain/budget';
import {
  addTask,
  deleteTask,
  rescheduleForNewEventDate,
  updateTask,
} from '../domain/timeline';
import { isValidIsoDate, daysBetween, todayIso } from '../domain/validate';
import { newId, REQUIREMENT_LABELS, CATEGORY_NAMES } from '../domain/events';
import { buildVendorRequirements, estimateCategoryCosts } from './demo';
import { formatMoney } from '../domain/money';

/**
 * The copilot speaks in validated, whitelisted operations.
 * Model output (or intent parsing) is never executed - it is validated here,
 * previewed for the user, then applied deterministically by these functions.
 */

export type PlanOp =
  | { op: 'setBudgetTotal'; totalMinor: number }
  | { op: 'setGuestCount'; count: number }
  | { op: 'setEventDate'; date: string }
  | { op: 'setEventField'; field: 'name' | 'location' | 'setting' | 'durationHours'; value: string | number }
  | { op: 'setPreference'; field: 'theme' | 'food' | 'cultural' | 'accessibility' | 'special'; value: string }
  | { op: 'setColors'; value: string[] }
  | { op: 'setCategoryAllocation'; categoryId: CategoryId; allocatedMinor: number }
  | { op: 'setCategoryPriority'; categoryId: CategoryId; priority: Priority }
  | { op: 'rebalanceBudget' }
  | { op: 'setRequirement'; key: RequirementKey; enabled: boolean }
  | { op: 'addTask'; task: Omit<PlanTask, 'id'> & { id?: string } }
  | { op: 'updateTask'; taskId: string; patch: Record<string, unknown> }
  | { op: 'deleteTask'; taskId: string }
  | { op: 'setTaskStatus'; taskId: string; status: PlanTask['status'] }
  | { op: 'addVendor'; vendor: Omit<Vendor, 'id'> & { id?: string } }
  | { op: 'updateVendor'; vendorId: string; patch: Record<string, unknown> }
  | { op: 'deleteVendor'; vendorId: string };

const CATEGORY_IDS = new Set<CategoryId>([
  'venue', 'catering', 'decoration', 'photography', 'entertainment',
  'invitations', 'transportation', 'accommodation', 'misc', 'contingency',
]);
const REQUIREMENT_KEYS = new Set<RequirementKey>([
  'venue', 'catering', 'decoration', 'photography', 'entertainment',
  'invitations', 'transportation', 'accommodation',
]);
const PRIORITIES = new Set<Priority>(['high', 'medium', 'low']);
const FOODS = new Set(['vegetarian', 'vegan', 'non-vegetarian', 'mixed', 'unspecified']);
const SETTINGS = new Set(['indoor', 'outdoor', 'either']);
const TASK_STATUSES = new Set<PlanTask['status']>(['todo', 'in-progress', 'done']);

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length <= max ? v : null;
}

/** Validates a single operation from an untrusted source. Returns an error string or the normalized op. */
export function validateOp(raw: unknown): { op: PlanOp } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Operation is not an object.' };
  const o = raw as Record<string, unknown>;
  switch (o.op) {
    case 'setBudgetTotal': {
      if (typeof o.totalMinor !== 'number' || !Number.isSafeInteger(o.totalMinor) || o.totalMinor < 100 || o.totalMinor > 100_000_000_000_00) {
        return { error: 'Invalid budget amount.' };
      }
      return { op: { op: 'setBudgetTotal', totalMinor: o.totalMinor } };
    }
    case 'setGuestCount': {
      if (typeof o.count !== 'number' || !Number.isInteger(o.count) || o.count < 1 || o.count > 100_000) {
        return { error: 'Guest count must be between 1 and 100,000.' };
      }
      return { op: { op: 'setGuestCount', count: o.count } };
    }
    case 'setEventDate': {
      const date = str(o.date, 10);
      if (!date || !isValidIsoDate(date)) return { error: 'Event date must be YYYY-MM-DD.' };
      return { op: { op: 'setEventDate', date } };
    }
    case 'setEventField': {
      const field = o.field;
      if (field !== 'name' && field !== 'location' && field !== 'setting' && field !== 'durationHours') {
        return { error: 'Unsupported event field.' };
      }
      if (field === 'setting') {
        const value = str(o.value, 10);
        if (!value || !SETTINGS.has(value as EventInput['setting'])) return { error: 'Invalid setting.' };
        return { op: { op: 'setEventField', field, value } };
      }
      if (field === 'durationHours') {
        if (typeof o.value !== 'number' || o.value < 1 || o.value > 72) return { error: 'Duration must be 1-72 hours.' };
        return { op: { op: 'setEventField', field, value: Math.round(o.value) } };
      }
      const value = str(o.value, 120);
      if (value === null || !value.trim()) return { error: `${field} must be non-empty text.` };
      return { op: { op: 'setEventField', field, value: value.trim() } };
    }
    case 'setPreference': {
      const field = o.field;
      if (field !== 'theme' && field !== 'food' && field !== 'cultural' && field !== 'accessibility' && field !== 'special') {
        return { error: 'Unsupported preference field.' };
      }
      if (field === 'food') {
        const value = str(o.value, 30);
        if (!value || !FOODS.has(value)) return { error: 'Invalid food preference.' };
        return { op: { op: 'setPreference', field, value } };
      }
      const value = str(o.value, 400);
      if (value === null) return { error: 'Preference value is too long.' };
      return { op: { op: 'setPreference', field, value } };
    }
    case 'setColors': {
      if (!Array.isArray(o.value) || o.value.length > 8 || o.value.some((c) => typeof c !== 'string' || c.length > 40)) {
        return { error: 'Colors must be a short list of text values.' };
      }
      return { op: { op: 'setColors', value: (o.value as string[]).map((c) => c.trim()).filter(Boolean) } };
    }
    case 'setCategoryAllocation': {
      const id = o.categoryId as CategoryId;
      if (!CATEGORY_IDS.has(id)) return { error: 'Unknown budget category.' };
      if (typeof o.allocatedMinor !== 'number' || !Number.isSafeInteger(o.allocatedMinor) || o.allocatedMinor < 0) {
        return { error: 'Allocation must be a non-negative amount.' };
      }
      return { op: { op: 'setCategoryAllocation', categoryId: id, allocatedMinor: o.allocatedMinor } };
    }
    case 'setCategoryPriority': {
      const id = o.categoryId as CategoryId;
      if (!CATEGORY_IDS.has(id)) return { error: 'Unknown budget category.' };
      if (!PRIORITIES.has(o.priority as Priority)) return { error: 'Invalid priority.' };
      return { op: { op: 'setCategoryPriority', categoryId: id, priority: o.priority as Priority } };
    }
    case 'rebalanceBudget':
      return { op: { op: 'rebalanceBudget' } };
    case 'setRequirement': {
      if (!REQUIREMENT_KEYS.has(o.key as RequirementKey)) return { error: 'Unknown planning requirement.' };
      if (typeof o.enabled !== 'boolean') return { error: 'Requirement flag must be true or false.' };
      return { op: { op: 'setRequirement', key: o.key as RequirementKey, enabled: o.enabled } };
    }
    case 'addTask': {
      const t = o.task;
      if (!t || typeof t !== 'object') return { error: 'Task payload missing.' };
      const task = t as Record<string, unknown>;
      const title = str(task.title, 160);
      if (!title || !title.trim()) return { error: 'Task title is required.' };
      const dueDate = str(task.dueDate, 10);
      if (!dueDate || !isValidIsoDate(dueDate)) return { error: 'Task due date must be YYYY-MM-DD.' };
      if (task.priority !== 'high' && task.priority !== 'medium' && task.priority !== 'low') return { error: 'Task priority invalid.' };
      const leadDays = typeof task.leadDays === 'number' ? Math.round(task.leadDays) : 0;
      return {
        op: {
          op: 'addTask',
          task: {
            title: title.trim(),
            description: str(task.description, 1000) ?? '',
            category: (str(task.category, 30) as PlanTask['category']) ?? 'planning',
            dueDate,
            leadDays,
            priority: task.priority as Priority,
            status: TASK_STATUSES.has(task.status as PlanTask['status']) ? (task.status as PlanTask['status']) : 'todo',
            dependsOn: str(task.dependsOn, 80) ?? undefined,
            estimatedCostMinor:
              typeof task.estimatedCostMinor === 'number' && Number.isSafeInteger(task.estimatedCostMinor) && task.estimatedCostMinor >= 0
                ? task.estimatedCostMinor
                : undefined,
          },
        },
      };
    }
    case 'updateTask': {
      const taskId = str(o.taskId, 80);
      if (!taskId) return { error: 'Task id missing.' };
      if (!o.patch || typeof o.patch !== 'object') return { error: 'Task patch missing.' };
      const patch: Record<string, unknown> = {};
      const p = o.patch as Record<string, unknown>;
      if (p.title !== undefined) {
        const title = str(p.title, 160);
        if (!title?.trim()) return { error: 'Task title invalid.' };
        patch.title = title.trim();
      }
      if (p.description !== undefined) patch.description = str(p.description, 1000) ?? '';
      if (p.dueDate !== undefined) {
        const d = str(p.dueDate, 10);
        if (!d || !isValidIsoDate(d)) return { error: 'Task due date invalid.' };
        patch.dueDate = d;
      }
      if (p.priority !== undefined) {
        if (!PRIORITIES.has(p.priority as Priority)) return { error: 'Task priority invalid.' };
        patch.priority = p.priority;
      }
      if (p.status !== undefined) {
        if (!TASK_STATUSES.has(p.status as PlanTask['status'])) return { error: 'Task status invalid.' };
        patch.status = p.status;
      }
      if (p.category !== undefined) patch.category = p.category;
      if (p.estimatedCostMinor !== undefined) {
        if (typeof p.estimatedCostMinor !== 'number' || !Number.isSafeInteger(p.estimatedCostMinor) || p.estimatedCostMinor < 0) {
          return { error: 'Task cost invalid.' };
        }
        patch.estimatedCostMinor = p.estimatedCostMinor;
      }
      return { op: { op: 'updateTask', taskId, patch } };
    }
    case 'deleteTask': {
      const taskId = str(o.taskId, 80);
      if (!taskId) return { error: 'Task id missing.' };
      return { op: { op: 'deleteTask', taskId } };
    }
    case 'setTaskStatus': {
      const taskId = str(o.taskId, 80);
      if (!taskId) return { error: 'Task id missing.' };
      if (!TASK_STATUSES.has(o.status as PlanTask['status'])) return { error: 'Task status invalid.' };
      return { op: { op: 'setTaskStatus', taskId, status: o.status as PlanTask['status'] } };
    }
    case 'addVendor': {
      const v = o.vendor;
      if (!v || typeof v !== 'object') return { error: 'Vendor payload missing.' };
      const vendor = v as Record<string, unknown>;
      const name = str(vendor.name, 120);
      if (!name?.trim()) return { error: 'Vendor name is required.' };
      return {
        op: {
          op: 'addVendor',
          vendor: {
            name: name.trim(),
            category: (str(vendor.category, 30) as Vendor['category']) ?? 'other',
            contact: str(vendor.contact, 300) ?? '',
            quotedPriceMinor:
              typeof vendor.quotedPriceMinor === 'number' && Number.isSafeInteger(vendor.quotedPriceMinor) && vendor.quotedPriceMinor >= 0
                ? vendor.quotedPriceMinor
                : undefined,
            bookingStatus: (str(vendor.bookingStatus, 30) as Vendor['bookingStatus']) ?? 'not-contacted',
            paymentStatus: (str(vendor.paymentStatus, 30) as Vendor['paymentStatus']) ?? 'none',
            notes: str(vendor.notes, 2000) ?? '',
            followUpDate: isValidIsoDate(vendor.followUpDate) ? vendor.followUpDate : undefined,
            source: 'user',
          },
        },
      };
    }
    case 'updateVendor': {
      const vendorId = str(o.vendorId, 80);
      if (!vendorId) return { error: 'Vendor id missing.' };
      if (!o.patch || typeof o.patch !== 'object') return { error: 'Vendor patch missing.' };
      return { op: { op: 'updateVendor', vendorId, patch: o.patch as Record<string, unknown> } };
    }
    case 'deleteVendor': {
      const vendorId = str(o.vendorId, 80);
      if (!vendorId) return { error: 'Vendor id missing.' };
      return { op: { op: 'deleteVendor', vendorId } };
    }
    default:
      return { error: `Unsupported operation: ${String(o.op).slice(0, 40)}` };
  }
}

export function validateOps(raw: unknown): { ops: PlanOp[]; errors: string[] } {
  if (!Array.isArray(raw)) return { ops: [], errors: ['Operations must be an array.'] };
  if (raw.length > 40) return { ops: [], errors: ['Too many operations in one request.'] };
  const ops: PlanOp[] = [];
  const errors: string[] = [];
  for (const item of raw) {
    const result = validateOp(item);
    if ('error' in result) errors.push(result.error);
    else ops.push(result.op);
  }
  return { ops, errors };
}

export interface ApplyResult {
  plan: EventPlan;
  changes: string[];
  warnings: string[];
}

/** Applies validated operations, recalculates affected values and preserves unrelated data. */
export function applyPlanOps(plan: EventPlan, ops: PlanOp[]): ApplyResult {
  let current: EventPlan = {
    ...plan,
    input: { ...plan.input, budget: { ...plan.input.budget, priorities: { ...plan.input.budget.priorities } }, preferences: { ...plan.input.preferences }, requirements: { ...plan.input.requirements } },
    budget: { ...plan.budget, categories: plan.budget.categories.map((c) => ({ ...c })) },
    timeline: { ...plan.timeline, tasks: plan.timeline.tasks.map((t) => ({ ...t })), milestones: plan.timeline.milestones.map((m) => ({ ...m })) },
    vendorRequirements: plan.vendorRequirements.map((v) => ({ ...v })),
    vendors: plan.vendors.map((v) => ({ ...v })),
    overview: { ...plan.overview, objectives: [...plan.overview.objectives], assumptions: [...plan.overview.assumptions] },
    ideas: { ...plan.ideas },
    risks: plan.risks.map((r) => ({ ...r })),
    actions: { ...plan.actions, immediate: [...plan.actions.immediate], upcoming: [...plan.actions.upcoming], decisions: [...plan.actions.decisions] },
  };
  const changes: string[] = [];
  const warnings: string[] = [];

  for (const op of ops) {
    switch (op.op) {
      case 'setBudgetTotal': {
        const oldTotal = current.input.budget.totalMinor;
        if (op.totalMinor === oldTotal) break;
        const proposal = proposeBudgetChange(
          current.budget.categories,
          oldTotal,
          op.totalMinor,
          current.input.budget.contingencyPct,
        );
        if (!proposal.ok) {
          warnings.push(proposal.reason ?? 'Budget change could not be applied.');
          break;
        }
        current = {
          ...current,
          input: { ...current.input, budget: { ...current.input.budget, totalMinor: op.totalMinor } },
          budget: {
            ...current.budget,
            categories: applyBudgetChange(current.budget.categories, proposal),
          },
        };
        refreshEstimates(current);
        changes.push(
          `Budget changed from ${formatMoney(oldTotal, current.input.budget.currency)} to ${formatMoney(op.totalMinor, current.input.budget.currency)}; ${proposal.deltas.length} categor${proposal.deltas.length === 1 ? 'y' : 'ies'} rebalanced.`,
        );
        for (const note of proposal.notes) warnings.push(note);
        break;
      }
      case 'setGuestCount': {
        const oldCount = current.input.guestCount;
        if (op.count === oldCount) break;
        const nextInput: EventInput = { ...current.input, guestCount: op.count };
        const oldEstimates = new Map(current.budget.categories.map((c) => [c.id, c.estimatedMinor]));
        const newEstimates = estimateCategoryCosts(nextInput);
        const guestLinked: CategoryId[] = ['catering', 'invitations', 'transportation', 'accommodation', 'decoration'];
        const normal = current.budget.categories.filter((c) => !c.isContingency);
        const contingency = current.budget.categories.find((c) => c.isContingency);
        const nextAlloc = new Map<CategoryId, number>();
        let drift = 0;
        for (const c of normal) {
          const before = oldEstimates.get(c.id) ?? 0;
          const after = newEstimates[c.id] ?? 0;
          if (guestLinked.includes(c.id)) {
            const delta = after - before;
            const value = Math.max(0, c.allocatedMinor + delta);
            drift += value - c.allocatedMinor;
            nextAlloc.set(c.id, value);
          } else {
            nextAlloc.set(c.id, c.allocatedMinor);
          }
        }
        const totalAvailable = current.input.budget.totalMinor - (contingency?.allocatedMinor ?? 0);
        const sum = [...nextAlloc.values()].reduce((a, b) => a + b, 0);
        const gap = totalAvailable - sum;
        const donors = normal.filter((c) => !guestLinked.includes(c.id));
        if (gap > 0 && donors.length > 0) {
          const shares = distributeExactly(gap, donors.map((c) => Math.max(1, nextAlloc.get(c.id) ?? 0)));
          donors.forEach((c, i) => nextAlloc.set(c.id, (nextAlloc.get(c.id) ?? 0) + shares[i]));
        } else if (gap < 0 && donors.length > 0) {
          const need = -gap;
          const donorSum = donors.reduce((s, c) => s + (nextAlloc.get(c.id) ?? 0), 0);
          if (donorSum >= need) {
            const take = distributeExactly(need, donors.map((c) => Math.max(1, nextAlloc.get(c.id) ?? 0)));
            donors.forEach((c, i) => nextAlloc.set(c.id, (nextAlloc.get(c.id) ?? 0) - take[i]));
          } else {
            for (const c of donors) nextAlloc.set(c.id, 0);
            let stillNeeded = need - donorSum;
            const linked = normal.filter((c) => guestLinked.includes(c.id) && (nextAlloc.get(c.id) ?? 0) > 0);
            const linkedSum = linked.reduce((s, c) => s + (nextAlloc.get(c.id) ?? 0), 0);
            if (linked.length > 0 && linkedSum > 0) {
              const cut = distributeExactly(Math.min(stillNeeded, linkedSum), linked.map((c) => Math.max(1, nextAlloc.get(c.id) ?? 0)));
              linked.forEach((c, i) => nextAlloc.set(c.id, (nextAlloc.get(c.id) ?? 0) - cut[i]));
              stillNeeded -= cut.reduce((a, b) => a + b, 0);
            }
            warnings.push(
              `At ${op.count} guests the guest-linked needs (mostly catering) exceed the spendable budget. Flexible categories were cut to zero and guest-linked categories were trimmed by ${need - donorSum} to stay inside your limit - the remaining shortfall is ${stillNeeded}. Reduce the guest count, raise the budget, or cut scope.`,
            );
          }
        }
        current = {
          ...current,
          input: nextInput,
          budget: {
            ...current.budget,
            categories: current.budget.categories.map((c) =>
              c.isContingency ? c : { ...c, allocatedMinor: nextAlloc.get(c.id) ?? c.allocatedMinor, estimatedMinor: newEstimates[c.id] ?? 0, manual: false },
            ),
          },
        };
        changes.push(`Guest count changed from ${oldCount} to ${op.count}; catering and per-guest estimates recalculated.`);
        if (Math.abs(drift) > 0) {
          warnings.push(
            drift > 0
              ? 'Higher guest count needs more in guest-linked categories; other categories were reduced to stay inside the budget.'
              : 'Lower guest count freed budget, which was redistributed across other categories.',
          );
        }
        const hasHeadcountTask = current.timeline.tasks.some((t) => /reconfirm.*headcount|headcount.*caterer/i.test(t.title));
        if (!hasHeadcountTask) {
          current = {
            ...current,
            timeline: {
              ...current.timeline,
              tasks: addTask(current.timeline.tasks, {
                title: 'Reconfirm final headcount with caterer and venue',
                description: `Guest count is now ${op.count}. Update every vendor whose quote depends on headcount.`,
                category: 'catering',
                dueDate: current.input.date,
                leadDays: 7,
                priority: 'high',
                status: 'todo',
              }),
            },
          };
        }
        refreshInsufficient(current);
        if (current.budget.insufficient) {
          warnings.push(
            'After the guest-count change, estimated costs exceed the spendable budget - see the Budget tab for where the gap is.',
          );
        }
        break;
      }
      case 'setEventDate': {
        const oldDate = current.input.date;
        if (op.date === oldDate) break;
        const result = rescheduleForNewEventDate(current.timeline.tasks, op.date);
        const delta = daysBetween(oldDate, op.date);
        current = {
          ...current,
          input: { ...current.input, date: op.date },
          timeline: {
            tasks: result.tasks,
            milestones: current.timeline.milestones.map((m) => ({ ...m, date: shiftIso(m.date, delta) })),
          },
        };
        changes.push(`Event date moved from ${oldDate} to ${op.date}; ${result.updated.length} open task deadlines recalculated.`);
        if (result.skippedCompleted.length > 0) {
          warnings.push(`${result.skippedCompleted.length} completed task(s) kept their original dates.`);
        }
        if (result.conflicts.length > 0) {
          warnings.push(
            `Dependency check: ${result.conflicts.map((c) => `"${c.title}"`).join(', ')} now falls before its prerequisite - review the order.`,
          );
        }
        const daysOut = daysBetween(todayIso(), op.date);
        if (daysOut < 0) warnings.push('The new date is in the past. Deadlines will show as overdue until you pick a future date.');
        break;
      }
      case 'setEventField': {
        const { field, value } = op;
        current = { ...current, input: { ...current.input, [field]: value } };
        changes.push(`${labelForField(field)} updated to "${String(value)}".`);
        if (field === 'setting') {
          if (value === 'outdoor') warnings.push('Outdoor setting: keep the weather contingency from the risks section in play.');
          if (value === 'indoor') warnings.push('Indoor setting: the outdoor weather risk is reduced but venue layout may change.');
          refreshIdeas(current);
        }
        break;
      }
      case 'setPreference': {
        const { field, value } = op;
        current = { ...current, input: { ...current.input, preferences: { ...current.input.preferences, [field]: value } } };
        changes.push(`Preference "${labelForField(field)}" updated.`);
        if (field === 'food') {
          const estimates = estimateCategoryCosts(current.input);
          current = {
            ...current,
            budget: { ...current.budget, categories: current.budget.categories.map((c) => (c.isContingency ? c : { ...c, estimatedMinor: estimates[c.id] ?? 0 })) },
          };
          warnings.push(`Catering estimate recalculated for a ${value} menu - allocation left unchanged unless you rebalance.`);
          const hasDietTask = current.timeline.tasks.some((t) => /dietary|menu preference|food preference/i.test(t.title));
          if (!hasDietTask) {
            current = {
              ...current,
              timeline: {
                ...current.timeline,
                tasks: addTask(current.timeline.tasks, {
                  title: 'Confirm menu and dietary requirements with caterer',
                  description: `Food preference is now ${value}. Make sure labelling and separate preparation needs are communicated.`,
                  category: 'catering',
                  dueDate: current.input.date,
                  leadDays: 14,
                  priority: 'high',
                  status: 'todo',
                }),
              },
            };
          }
        }
        if (field === 'theme' || field === 'accessibility') refreshIdeas(current);
        break;
      }
      case 'setColors': {
        current = { ...current, input: { ...current.input, preferences: { ...current.input.preferences, colors: op.value } } };
        changes.push(`Colour palette updated to ${op.value.join(', ') || '(cleared)'}.`);
        refreshIdeas(current);
        break;
      }
      case 'setCategoryAllocation': {
        if (op.categoryId === 'contingency') {
          warnings.push('Contingency reserve is driven by the contingency percentage, not edited directly.');
          break;
        }
        const result = setAllocation(
          current.budget.categories,
          current.input.budget.totalMinor,
          op.categoryId,
          op.allocatedMinor,
        );
        if (result.error) {
          warnings.push(result.error);
          break;
        }
        current = { ...current, budget: { ...current.budget, categories: result.categories } };
        changes.push(`${CATEGORY_NAMES[op.categoryId]} allocation set to ${op.allocatedMinor}.`);
        refreshInsufficient(current);
        break;
      }
      case 'setCategoryPriority': {
        current = {
          ...current,
          input: {
            ...current.input,
            budget: { ...current.input.budget, priorities: { ...current.input.budget.priorities, [op.categoryId]: op.priority } },
          },
          budget: {
            ...current.budget,
            categories: current.budget.categories.map((c) => (c.id === op.categoryId ? { ...c, priority: op.priority, manual: false } : c)),
          },
        };
        changes.push(`${CATEGORY_NAMES[op.categoryId]} priority set to ${op.priority}.`);
        break;
      }
      case 'rebalanceBudget': {
        const nextCategories = reallocateForPriorities(
          current.budget.categories,
          current.input.budget.totalMinor,
          current.input.budget.contingencyPct,
          current.input.budget.priorities,
        );
        current = { ...current, budget: { ...current.budget, categories: nextCategories } };
        changes.push('Budget rebalanced across categories using current priorities.');
        refreshInsufficient(current);
        break;
      }
      case 'setRequirement': {
        const { key, enabled } = op;
        current = { ...current, input: { ...current.input, requirements: { ...current.input.requirements, [key]: enabled } } };
        changes.push(`${REQUIREMENT_LABELS[key]} ${enabled ? 'added to' : 'removed from'} planning requirements.`);
        const categoryId = key as CategoryId;
        const hasCategory = current.budget.categories.some((c) => c.id === categoryId);
        if (!enabled && hasCategory) {
          const cat = current.budget.categories.find((c) => c.id === categoryId)!;
          const freed = cat.allocatedMinor;
          current = {
            ...current,
            budget: {
              ...current.budget,
              categories: current.budget.categories.filter((c) => c.id !== categoryId),
            },
            vendorRequirements: current.vendorRequirements.filter((v) => v.category !== key),
          };
          current = redistributeFreed(current, freed);
          warnings.push(`${CATEGORY_NAMES[categoryId]} removed; its budget was redistributed across remaining categories.`);
        } else if (enabled && !hasCategory) {
          const estimates = estimateCategoryCosts(current.input);
          current = {
            ...current,
            budget: {
              ...current.budget,
              categories: [
                ...current.budget.categories.filter((c) => c.isContingency),
                ...current.budget.categories.filter((c) => !c.isContingency),
                {
                  id: categoryId,
                  name: CATEGORY_NAMES[categoryId],
                  allocatedMinor: 0,
                  estimatedMinor: estimates[categoryId] ?? 0,
                  actualMinor: 0,
                  priority: current.input.budget.priorities[categoryId] ?? 'medium',
                  isContingency: false,
                  manual: false,
                },
              ],
            },
          };
          const rebalanced = reallocateForPriorities(
            current.budget.categories,
            current.input.budget.totalMinor,
            current.input.budget.contingencyPct,
            current.input.budget.priorities,
          );
          current = { ...current, budget: { ...current.budget, categories: rebalanced } };
          const built = buildVendorRequirements(current.input, current.budget.categories);
          const missing = built.find((v) => v.category === key);
          if (missing && !current.vendorRequirements.some((v) => v.category === key)) {
            current = { ...current, vendorRequirements: [...current.vendorRequirements, missing] };
          }
          warnings.push(`${CATEGORY_NAMES[categoryId]} added and the budget rebalanced - check the new allocations.`);
        }
        refreshInsufficient(current);
        break;
      }
      case 'addTask': {
        current = { ...current, timeline: { ...current.timeline, tasks: addTask(current.timeline.tasks, op.task) } };
        changes.push(`Task added: "${op.task.title}".`);
        break;
      }
      case 'updateTask': {
        const task = current.timeline.tasks.find((t) => t.id === op.taskId);
        if (!task) {
          warnings.push('Task not found - it may have been deleted.');
          break;
        }
        const before = task.dueDate;
        const nextTasks = updateTask(current.timeline.tasks, op.taskId, op.patch);
        const after = nextTasks.find((t) => t.id === op.taskId)!;
        if (after.status === 'done' && task.status !== 'done') {
          changes.push(`Task marked done: "${task.title}".`);
        } else if (after.dueDate !== before) {
          changes.push(`Task "${task.title}" moved from ${before} to ${after.dueDate}.`);
        } else {
          changes.push(`Task "${task.title}" updated.`);
        }
        current = { ...current, timeline: { ...current.timeline, tasks: nextTasks } };
        if (after.dueDate !== before && after.status !== 'done') {
          const dependents = nextTasks.filter((t) => t.dependsOn === op.taskId && t.status !== 'done' && t.dueDate < after.dueDate);
          if (dependents.length > 0) {
            warnings.push(`Dependent task(s) affected: ${dependents.map((d) => `"${d.title}"`).join(', ')} - they now fall before this one.`);
          }
        }
        break;
      }
      case 'deleteTask': {
        const task = current.timeline.tasks.find((t) => t.id === op.taskId);
        if (!task) break;
        current = { ...current, timeline: { ...current.timeline, tasks: deleteTask(current.timeline.tasks, op.taskId) } };
        changes.push(`Task deleted: "${task.title}".`);
        break;
      }
      case 'setTaskStatus': {
        const next = current.timeline.tasks.map((t) => (t.id === op.taskId ? { ...t, status: op.status } : t));
        current = { ...current, timeline: { ...current.timeline, tasks: next } };
        const t = next.find((x) => x.id === op.taskId);
        if (t) changes.push(`"${t.title}" marked ${op.status}.`);
        break;
      }
      case 'addVendor': {
        const vendor: Vendor = { ...op.vendor, id: newId('vnd') };
        current = { ...current, vendors: [...current.vendors, vendor] };
        changes.push(`Vendor added: ${vendor.name}.`);
        break;
      }
      case 'updateVendor': {
        const vendor = current.vendors.find((v) => v.id === op.vendorId);
        if (!vendor) {
          warnings.push('Vendor not found.');
          break;
        }
        const allowed: (keyof Vendor)[] = ['name', 'category', 'contact', 'quotedPriceMinor', 'bookingStatus', 'paymentStatus', 'notes', 'followUpDate'];
        const patch: Partial<Vendor> = {};
        for (const key of allowed) {
          if (op.patch[key] !== undefined) {
            (patch as Record<string, unknown>)[key] = op.patch[key];
          }
        }
        current = { ...current, vendors: current.vendors.map((v) => (v.id === op.vendorId ? { ...v, ...patch } : v)) };
        changes.push(`Vendor updated: ${vendor.name}.`);
        break;
      }
      case 'deleteVendor': {
        const vendor = current.vendors.find((v) => v.id === op.vendorId);
        if (!vendor) break;
        current = { ...current, vendors: current.vendors.filter((v) => v.id !== op.vendorId) };
        changes.push(`Vendor removed: ${vendor.name}.`);
        break;
      }
    }
  }

  current = { ...current, updatedAt: new Date().toISOString() };
  return { plan: current, changes, warnings };
}

function shiftIso(iso: string, days: number): string {
  if (!isValidIsoDate(iso)) return iso;
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function labelForField(field: string): string {
  const map: Record<string, string> = {
    name: 'Event name',
    location: 'Location',
    setting: 'Setting',
    durationHours: 'Duration (hours)',
    theme: 'Theme',
    food: 'Food preference',
    cultural: 'Cultural preference',
    accessibility: 'Accessibility',
    special: 'Special requests',
  };
  return map[field] ?? field;
}

function redistributeFreed(plan: EventPlan, freed: number): EventPlan {
  if (freed <= 0) return plan;
  const donors = plan.budget.categories.filter((c) => !c.isContingency);
  if (donors.length === 0) return plan;
  const shares = distributeExactly(freed, donors.map((c) => Math.max(1, c.allocatedMinor)));
  return {
    ...plan,
    budget: {
      ...plan.budget,
      categories: plan.budget.categories.map((c) =>
        c.isContingency ? c : { ...c, allocatedMinor: c.allocatedMinor + (shares[donors.findIndex((d) => d.id === c.id)] ?? 0) },
      ),
    },
  };
}

function refreshInsufficient(plan: EventPlan): void {
  const totals = budgetTotals(plan.budget.categories, plan.input.budget.totalMinor);
  plan.budget.insufficient = totals.estimatedMinor > totals.totalMinor - totals.contingencyMinor;
}

function refreshEstimates(plan: EventPlan): void {
  const estimates = estimateCategoryCosts(plan.input);
  plan.budget.categories = plan.budget.categories.map((c) =>
    c.isContingency ? c : { ...c, estimatedMinor: estimates[c.id] ?? 0 },
  );
  refreshInsufficient(plan);
}

function refreshIdeas(plan: EventPlan): void {
  const input = plan.input;
  if (input.preferences.theme.trim()) {
    plan.ideas = {
      ...plan.ideas,
      themes: [input.preferences.theme.trim(), ...plan.ideas.themes.filter((t) => t !== input.preferences.theme.trim())].slice(0, 3),
    };
  }
  if (input.preferences.accessibility.trim()) {
    plan.ideas = {
      ...plan.ideas,
      guestExperience: [
        `Accessibility requirement in effect: ${input.preferences.accessibility.trim()} - confirm it with the venue`,
        ...plan.ideas.guestExperience.filter((g) => !g.startsWith('Accessibility')),
      ],
    };
  }
}

export function makeChangeRecord(
  summary: string,
  details: string[],
  source: ChangeRecord['source'],
): ChangeRecord {
  return { id: newId('chg'), at: new Date().toISOString(), summary, details, source };
}
