import type {
  BudgetCategory,
  CategoryId,
  EventInput,
  EventPlan,
  IdeasSection,
  PlanTask,
  Priority,
  RiskItem,
  TaskCategory,
  VendorCategory,
  VendorRequirement,
} from '../domain/types';
import { allocateBudget, type AllocationEntry } from '../domain/budget';
import { dueDateForLead } from '../domain/timeline';
import { newId } from '../domain/events';
import { generateDemoPlan, estimateCategoryCosts } from './demo';
import { validatePlanShape } from '../domain/validate';

/** Shape produced by the server after validating model output. */
export interface AiPlanDraft {
  overview: { concept: string; objectives: string[]; theme: string; assumptions: string[] };
  budget: {
    shares: Record<string, number> | null;
    estimates: Record<string, number>;
    risks: string[];
    savings: string[];
  };
  timeline: {
    tasks: {
      key: string;
      title: string;
      description: string;
      category: string;
      leadDays: number;
      priority: Priority;
      dependsOn?: string;
      estimatedCostMinor?: number;
    }[];
  };
  vendorRequirements: {
    category: string;
    services: string[];
    questions: string[];
    comparisonCriteria: string[];
    bookingPriority: Priority;
  }[];
  ideas: IdeasSection;
  risks: { area: string; description: string; mitigation: string }[];
  actions: { immediate: string[]; upcoming: string[]; decisions: string[] };
}

export interface AiCopilotProposal {
  ops: unknown[];
  summary: string;
  tradeoffs: string[];
  clarify: string | null;
}

export interface AiError {
  code: string;
  message: string;
}

export interface StatusInfo {
  mode: 'ai' | 'demo';
  configured: boolean;
  model: string | null;
  provider: string | null;
}

async function postJson<T>(path: string, body: unknown, timeoutMs = 100_000): Promise<T | AiError> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      return { code: 'BAD_RESPONSE', message: 'We could not read the reply from the server.' };
    }
    const obj = data as Record<string, unknown>;
    if (!response.ok || obj?.ok === false) {
      const err = (obj?.error ?? {}) as { code?: string; message?: string };
      return {
        code: err.code || `HTTP_${response.status}`,
        message: err.message || `The server had a problem (error ${response.status}).`,
      };
    }
    return data as T;
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      return { code: 'TIMEOUT', message: 'That took too long. Try again, or keep using the built-in rules.' };
    }
    return {
      code: 'SERVER_UNREACHABLE',
      message: 'We could not reach the UtsavAI server. Make sure it is running, then try again.',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchStatus(): Promise<StatusInfo | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('/api/status', { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as StatusInfo;
    return data && (data.mode === 'ai' || data.mode === 'demo') ? data : null;
  } catch {
    return null;
  }
}

export async function requestAiPlan(
  input: EventInput,
): Promise<{ ok: true; draft: AiPlanDraft } | { ok: false; error: AiError }> {
  const result = await postJson<{ ok: true; draft: AiPlanDraft }>('/api/plan', { input });
  if ('error' in result && !('ok' in result)) return { ok: false, error: result as AiError };
  if (!(result as { ok?: boolean }).ok) {
    return { ok: false, error: { code: 'UNKNOWN', message: 'We could not build the plan just now. Please try again.' } };
  }
  return { ok: true, draft: (result as { draft: AiPlanDraft }).draft };
}

export async function requestAiCopilot(
  plan: EventPlan,
  request: string,
): Promise<{ ok: true; proposal: AiCopilotProposal } | { ok: false; error: AiError }> {
  const result = await postJson<{ ok: true; proposal: AiCopilotProposal }>('/api/copilot', { plan, request });
  if ('error' in result && !('ok' in result)) return { ok: false, error: result as AiError };
  if (!(result as { ok?: boolean }).ok) {
    return { ok: false, error: { code: 'UNKNOWN', message: 'We could not answer that just now. Please try again.' } };
  }
  return { ok: true, proposal: (result as { proposal: AiCopilotProposal }).proposal };
}

/**
 * Assembles a full EventPlan from a validated AI draft.
 * All arithmetic (allocation sums, dates, totals) is recomputed deterministically here;
 * the model only supplies intent (weights, estimates, lead days, prose).
 */
export function buildPlanFromDraft(input: EventInput, draft: AiPlanDraft): EventPlan {
  const base = generateDemoPlan(input);

  const budget = { ...base.budget };
  const total = input.budget.totalMinor;

  if (draft.budget.shares && Object.keys(draft.budget.shares).length > 0) {
    const entries: AllocationEntry[] = Object.entries(draft.budget.shares)
      .filter(([id]) => !id.includes('contingency'))
      .map(([id, share]) => ({
        id: id as CategoryId,
        priority: input.budget.priorities[id as CategoryId] ?? 'medium',
        share: typeof share === 'number' && share > 0 ? share : 0.01,
      }));
    const disabled = entries.filter((e) => !isEnabled(input, e.id));
    const enabled = entries.filter((e) => isEnabled(input, e.id));
    if (enabled.length > 0) {
      const allocation = allocateBudget(total, enabled, input.budget.contingencyPct);
      const baseById = new Map(base.budget.categories.map((c) => [c.id, c]));
      const merged: BudgetCategory[] = allocation.categories.map((c) => {
        const prev = baseById.get(c.id);
        const draftEstimate = draft.budget.estimates[c.id];
        const estimate =
          typeof draftEstimate === 'number' && draftEstimate > 0 && draftEstimate <= total * 15
            ? draftEstimate
            : prev?.estimatedMinor ?? 0;
        return { ...c, estimatedMinor: estimate, actualMinor: 0 };
      });
      for (const e of disabled) {
        const prev = baseById.get(e.id);
        merged.push(
          prev ?? {
            id: e.id,
            name: e.id,
            allocatedMinor: 0,
            estimatedMinor: 0,
            actualMinor: 0,
            priority: e.priority,
            isContingency: false,
            manual: false,
          },
        );
      }
      budget.categories = merged;
    }
  } else {
    const estimates = estimateCategoryCosts(input);
    budget.categories = base.budget.categories.map((c) =>
      c.isContingency ? c : { ...c, estimatedMinor: estimates[c.id] ?? 0 },
    );
  }

  if (draft.budget.risks.length > 0) budget.risks = draft.budget.risks;
  if (draft.budget.savings.length > 0) budget.savings = draft.budget.savings;
  const allocated = budget.categories.reduce((s, c) => s + c.allocatedMinor, 0);
  const estimated = budget.categories.reduce((s, c) => s + c.estimatedMinor, 0);
  const contingency = budget.categories.find((c) => c.isContingency)?.allocatedMinor ?? 0;
  budget.insufficient = estimated > total - contingency || allocated > total;

  let tasks: PlanTask[] = base.timeline.tasks;
  if (draft.timeline.tasks.length >= 4) {
    const ids = new Map<string, string>();
    for (const t of draft.timeline.tasks) ids.set(t.key, newId('tsk'));
    tasks = draft.timeline.tasks.map((t, index) => {
      const task: PlanTask = {
        id: ids.get(t.key) ?? `tsk_ai_${index}`,
        title: t.title,
        description: t.description,
        category: t.category as TaskCategory,
        dueDate: dueDateForLead(input.date, t.leadDays),
        leadDays: t.leadDays,
        priority: t.priority,
        status: 'todo',
      };
      if (t.dependsOn && ids.has(t.dependsOn) && t.dependsOn !== t.key) task.dependsOn = ids.get(t.dependsOn);
      if (typeof t.estimatedCostMinor === 'number') task.estimatedCostMinor = t.estimatedCostMinor;
      return task;
    });
  }

  let vendorRequirements: VendorRequirement[] = base.vendorRequirements;
  if (draft.vendorRequirements.length > 0) {
    vendorRequirements = draft.vendorRequirements.map((v) => {
      const cat = budget.categories.find((c) => c.id === (v.category as CategoryId));
      return {
        id: newId('vrq'),
        category: v.category as VendorCategory,
        services: v.services,
        questions: v.questions,
        comparisonCriteria: v.comparisonCriteria,
        bookingPriority: v.bookingPriority,
        budgetGuideMinor: cat?.allocatedMinor ?? 0,
        booked: false,
      };
    });
  }

  const mergeIdeas = (section: keyof IdeasSection): string[] => {
    const draftList = draft.ideas[section];
    return draftList.length > 0 ? draftList : base.ideas[section];
  };

  const ideas: IdeasSection = {
    themes: mergeIdeas('themes'),
    decoration: mergeIdeas('decoration'),
    catering: mergeIdeas('catering'),
    entertainment: mergeIdeas('entertainment'),
    guestExperience: mergeIdeas('guestExperience'),
  };
  if (input.preferences.theme.trim() && !ideas.themes.includes(input.preferences.theme.trim())) {
    ideas.themes = [input.preferences.theme.trim(), ...ideas.themes].slice(0, 3);
  }

  const risks: RiskItem[] =
    draft.risks.length > 0
      ? draft.risks.map((r, i) => ({ id: `risk_ai_${i}`, area: r.area, description: r.description, mitigation: r.mitigation }))
      : base.risks;

  const actions: EventPlan['actions'] = {
    immediate: draft.actions.immediate.length > 0 ? draft.actions.immediate : base.actions.immediate,
    upcoming: draft.actions.upcoming.length > 0 ? draft.actions.upcoming : base.actions.upcoming,
    decisions: draft.actions.decisions.length > 0 ? draft.actions.decisions : base.actions.decisions,
  };

  const plan: EventPlan = {
    ...base,
    overview: {
      concept: draft.overview.concept || base.overview.concept,
      objectives: draft.overview.objectives.length > 0 ? draft.overview.objectives : base.overview.objectives,
      theme: draft.overview.theme || input.preferences.theme || base.overview.theme,
      assumptions: [...new Set([...draft.overview.assumptions, ...base.overview.assumptions])],
    },
    budget,
    timeline: { tasks, milestones: base.timeline.milestones },
    vendorRequirements,
    ideas,
    risks,
    actions,
    source: 'ai',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Safety net: if anything about the merged plan is structurally invalid, fall back
  // to the deterministic plan rather than showing a broken workspace.
  const check = validatePlanShape(plan);
  if (!check.ok) return base;
  return plan;
}

function isEnabled(input: EventInput, id: CategoryId): boolean {
  const map: Partial<Record<CategoryId, keyof EventInput['requirements']>> = {
    venue: 'venue',
    catering: 'catering',
    decoration: 'decoration',
    photography: 'photography',
    entertainment: 'entertainment',
    invitations: 'invitations',
    transportation: 'transportation',
    accommodation: 'accommodation',
  };
  const key = map[id];
  if (!key) return true;
  return Boolean(input.requirements[key]);
}
