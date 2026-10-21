import type { EventInput, PlanTask, Priority, TaskCategory, TaskStatus } from './types';
import { buildTaskTemplates } from './events';
import { isValidIsoDate, daysBetween, todayIso } from './validate';
import { newId } from './events';

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dueDateForLead(eventDate: string, leadDays: number): string {
  return addDaysIso(eventDate, -leadDays);
}

function leadScale(flexibility: 'strict' | 'moderate' | 'flexible'): number {
  if (flexibility === 'strict') return 1.15;
  if (flexibility === 'flexible') return 0.85;
  return 1;
}

export function generateTasks(input: EventInput): PlanTask[] {
  const templates = buildTaskTemplates(input.type);
  const scale = leadScale(input.budget.flexibility);
  const keyToId = new Map<string, string>();

  const planned = templates.map((t) => {
    const id = newId('tsk');
    keyToId.set(t.key, id);
    const scaled = t.leadDays > 7 ? Math.round(t.leadDays * scale) : t.leadDays;
    return { template: t, id, leadDays: scaled };
  });

  return planned.map(({ template, id, leadDays }) => {
    const task: PlanTask = {
      id,
      title: template.title,
      description: template.description,
      category: template.category,
      dueDate: dueDateForLead(input.date, leadDays),
      leadDays,
      priority: template.priority,
      status: 'todo',
    };
    const depId = template.dependsOnKey ? keyToId.get(template.dependsOnKey) : undefined;
    if (depId) task.dependsOn = depId;
    const cost = estimateTaskCost(input, template.category);
    if (cost > 0) task.estimatedCostMinor = cost;
    return task;
  });
}

function estimateTaskCost(input: EventInput, category: TaskCategory): number {
  const total = input.budget.totalMinor;
  const share: Partial<Record<TaskCategory, number>> = {
    catering: 0.5,
    venue: 0.4,
    decoration: 0.15,
    photography: 0.2,
    entertainment: 0.15,
    logistics: 0.05,
    invitations: 0.03,
    finance: 0,
    planning: 0,
    guests: 0.03,
  };
  const pct = share[category];
  if (!pct) return 0;
  return Math.round(total * pct);
}

export interface TaskFlags {
  overdue: boolean;
  dueSoon: boolean;
  completed: boolean;
}

export function taskFlags(task: PlanTask, today = todayIso()): TaskFlags {
  const completed = task.status === 'done';
  const overdue = !completed && isValidIsoDate(task.dueDate) && daysBetween(today, task.dueDate) < 0;
  const delta = daysBetween(today, task.dueDate);
  const dueSoon = !completed && delta >= 0 && delta <= 7;
  return { overdue, dueSoon, completed };
}

export interface ProgressInfo {
  done: number;
  total: number;
  pct: number;
}

export function progressInfo(tasks: PlanTask[]): ProgressInfo {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

export function overdueTasks(tasks: PlanTask[], today = todayIso()): PlanTask[] {
  return tasks.filter((t) => taskFlags(t, today).overdue);
}

export function upcomingTasks(tasks: PlanTask[], today = todayIso(), withinDays = 14): PlanTask[] {
  return tasks
    .filter((t) => {
      const f = taskFlags(t, today);
      if (f.completed) return false;
      const delta = daysBetween(today, t.dueDate);
      return delta >= 0 && delta <= withinDays;
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export interface MoveResult {
  tasks: PlanTask[];
  moved: PlanTask;
  /** Dependents that now fall before their prerequisite and need attention. */
  conflicts: PlanTask[];
  /** All transitive dependents of the moved task. */
  affected: PlanTask[];
}

/** Moving a task never silently rewrites completed work; dependents are reported instead. */
export function moveTask(
  tasks: PlanTask[],
  taskId: string,
  newDueDate: string,
  eventDate: string,
): MoveResult | { error: string } {
  if (!isValidIsoDate(newDueDate)) return { error: 'Invalid date.' };
  if (!isValidIsoDate(eventDate)) return { error: 'Invalid event date.' };
  const target = tasks.find((t) => t.id === taskId);
  if (!target) return { error: 'Task not found.' };
  if (target.status === 'done') return { error: 'Completed tasks keep their original dates.' };

  const leadDays = daysBetween(newDueDate, eventDate);
  const next = tasks.map((t) => (t.id === taskId ? { ...t, dueDate: newDueDate, leadDays } : t));
  const movedTask = next.find((t) => t.id === taskId)!;
  const affected = collectDependents(next, taskId);
  const conflicts = affected.filter((t) => t.status !== 'done' && t.dueDate < newDueDate);
  return { tasks: next, moved: movedTask, conflicts, affected };
}

export function collectDependents(tasks: PlanTask[], taskId: string): PlanTask[] {
  const out: PlanTask[] = [];
  const seen = new Set<string>([taskId]);
  let frontier = [taskId];
  while (frontier.length > 0) {
    const nextFrontier: string[] = [];
    for (const t of tasks) {
      if (t.dependsOn && frontier.includes(t.dependsOn) && !seen.has(t.id)) {
        seen.add(t.id);
        out.push(t);
        nextFrontier.push(t.id);
      }
    }
    frontier = nextFrontier;
  }
  return out;
}

export interface RescheduleResult {
  tasks: PlanTask[];
  updated: string[];
  skippedCompleted: string[];
  conflicts: PlanTask[];
}

/** Recomputes due dates from stored lead days when the event date changes.
 *  Completed tasks are never touched. */
export function rescheduleForNewEventDate(tasks: PlanTask[], newEventDate: string): RescheduleResult {
  const updated: string[] = [];
  const skippedCompleted: string[] = [];
  const next = tasks.map((t) => {
    if (t.status === 'done') {
      skippedCompleted.push(t.id);
      return t;
    }
    const dueDate = dueDateForLead(newEventDate, t.leadDays);
    if (dueDate !== t.dueDate) updated.push(t.id);
    return { ...t, dueDate };
  });
  const conflicts: PlanTask[] = [];
  for (const t of next) {
    if (!t.dependsOn || t.status === 'done') continue;
    const dep = next.find((d) => d.id === t.dependsOn);
    if (dep && t.dueDate < dep.dueDate) conflicts.push(t);
  }
  return { tasks: next, updated, skippedCompleted, conflicts };
}

export function setTaskStatus(tasks: PlanTask[], taskId: string, status: TaskStatus): PlanTask[] {
  return tasks.map((t) => (t.id === taskId ? { ...t, status } : t));
}

export function addTask(tasks: PlanTask[], task: Omit<PlanTask, 'id'> & { id?: string }): PlanTask[] {
  const id = task.id && !tasks.some((t) => t.id === task.id) ? task.id : newId('tsk');
  return [...tasks, { ...task, id } as PlanTask];
}

export function updateTask(
  tasks: PlanTask[],
  taskId: string,
  patch: Partial<Pick<PlanTask, 'title' | 'description' | 'category' | 'dueDate' | 'priority' | 'status' | 'estimatedCostMinor'>>,
): PlanTask[] {
  return tasks.map((t) => {
    if (t.id !== taskId) return t;
    // Completed tasks keep their history unless status itself is being changed deliberately.
    if (t.status === 'done' && patch.status === undefined && (patch.dueDate !== undefined || patch.title !== undefined)) {
      const safePatch = { ...patch };
      delete safePatch.dueDate;
      return { ...t, ...safePatch };
    }
    const merged = { ...t, ...patch };
    return merged;
  });
}

export function deleteTask(tasks: PlanTask[], taskId: string): PlanTask[] {
  return tasks.filter((t) => t.id !== taskId).map((t) => (t.dependsOn === taskId ? { ...t, dependsOn: undefined } : t));
}

export function sortTasks(tasks: PlanTask[]): PlanTask[] {
  const priorityRank: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
  return [...tasks].sort((a, b) => {
    const flagA = taskFlags(a);
    const flagB = taskFlags(b);
    if (flagA.overdue !== flagB.overdue) return flagA.overdue ? -1 : 1;
    if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    return priorityRank[a.priority] - priorityRank[b.priority];
  });
}

export function validateTaskDraft(raw: Record<string, unknown>): { ok: boolean; errors: Record<string, string>; data?: Omit<PlanTask, 'id'> } {
  const errors: Record<string, string> = {};
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title) errors.title = 'Task title is required.';
  else if (title.length > 160) errors.title = 'Title is too long.';
  const dueDate = raw.dueDate;
  if (!isValidIsoDate(dueDate)) errors.dueDate = 'Enter a valid due date.';
  const validCats: TaskCategory[] = ['planning', 'venue', 'catering', 'decoration', 'photography', 'entertainment', 'invitations', 'guests', 'logistics', 'finance'];
  const category = raw.category as TaskCategory;
  if (!validCats.includes(category)) errors.category = 'Choose a valid category.';
  const priority = raw.priority as Priority;
  if (priority !== 'high' && priority !== 'medium' && priority !== 'low') errors.priority = 'Choose a priority.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const status = (raw.status as TaskStatus) ?? 'todo';
  return {
    ok: true,
    errors: {},
    data: {
      title,
      description: typeof raw.description === 'string' ? raw.description.slice(0, 1000) : '',
      category,
      dueDate: dueDate as string,
      leadDays: typeof raw.leadDays === 'number' ? Math.round(raw.leadDays) : 0,
      priority,
      status: status === 'in-progress' || status === 'done' ? status : 'todo',
      estimatedCostMinor: typeof raw.estimatedCostMinor === 'number' && raw.estimatedCostMinor >= 0 ? Math.round(raw.estimatedCostMinor) : undefined,
    },
  };
}
