import { describe, it, expect } from 'vitest';
import {
  addTask,
  deleteTask,
  generateTasks,
  moveTask,
  overdueTasks,
  progressInfo,
  rescheduleForNewEventDate,
  sortTasks,
  taskFlags,
  updateTask,
  upcomingTasks,
  dueDateForLead,
} from '../src/domain/timeline';
import { SAMPLE_EVENTS } from '../src/domain/events';
import { daysBetween, todayIso } from '../src/domain/validate';
import type { PlanTask } from '../src/domain/types';

const wedding = SAMPLE_EVENTS.find((s) => s.key === 'wedding')!.build();
const birthday = SAMPLE_EVENTS.find((s) => s.key === 'birthday')!.build();

function task(overrides: Partial<PlanTask> & { id: string }): PlanTask {
  return {
    title: 'Task',
    description: '',
    category: 'planning',
    dueDate: '2027-01-01',
    leadDays: 10,
    priority: 'medium',
    status: 'todo',
    ...overrides,
  };
}

describe('generateTasks', () => {
  it('derives every deadline from the actual event date', () => {
    const tasks = generateTasks(wedding);
    expect(tasks.length).toBeGreaterThan(8);
    for (const t of tasks) {
      expect(t.dueDate).toBe(dueDateForLead(wedding.date, t.leadDays));
      expect(daysBetween(t.dueDate, wedding.date)).toBe(t.leadDays);
    }
  });

  it('produces different timelines for different event types', () => {
    const w = generateTasks(wedding).map((t) => t.title);
    const b = generateTasks(birthday).map((t) => t.title);
    expect(w.some((t) => /priest|outfit|functions/i.test(t))).toBe(true);
    expect(b.some((t) => /cake/i.test(t))).toBe(true);
    expect(w).not.toEqual(b);
  });

  it('keeps dependency references valid', () => {
    const tasks = generateTasks(wedding);
    const ids = new Set(tasks.map((t) => t.id));
    for (const t of tasks) {
      if (t.dependsOn) expect(ids.has(t.dependsOn)).toBe(true);
    }
  });

  it('applies flexibility scaling: strict plans start earlier than flexible ones', () => {
    const strict = generateTasks({ ...wedding, budget: { ...wedding.budget, flexibility: 'strict' } });
    const flexible = generateTasks({ ...wedding, budget: { ...wedding.budget, flexibility: 'flexible' } });
    const strictVenue = strict.find((t) => /venue/i.test(t.title))!;
    const flexibleVenue = flexible.find((t) => /venue/i.test(t.title))!;
    expect(strictVenue.leadDays).toBeGreaterThan(flexibleVenue.leadDays);
  });
});

describe('task flags and progress', () => {
  it('marks overdue tasks when the date has passed and not when done', () => {
    const overdue = task({ id: 'a', dueDate: '2020-01-01' });
    const done = task({ id: 'b', dueDate: '2020-01-01', status: 'done' });
    const future = task({ id: 'c', dueDate: '2999-01-01' });
    expect(taskFlags(overdue).overdue).toBe(true);
    expect(taskFlags(done).overdue).toBe(false);
    expect(taskFlags(future).overdue).toBe(false);
    expect(taskFlags(future).dueSoon).toBe(false);
  });

  it('handles events with dates in the past by listing overdue work', () => {
    const past = { ...wedding, date: '2020-01-01' };
    const tasks = generateTasks(past);
    const overdue = overdueTasks(tasks);
    expect(overdue.length).toBe(tasks.filter((t) => t.status !== 'done').length);
  });

  it('computes progress percentages', () => {
    const tasks = [task({ id: '1', status: 'done' }), task({ id: '2' }), task({ id: '3' })];
    expect(progressInfo(tasks)).toEqual({ done: 1, total: 3, pct: 33 });
    expect(progressInfo([])).toEqual({ done: 0, total: 0, pct: 0 });
  });

  it('lists upcoming tasks within the window only', () => {
    const today = todayIso();
    const soon = dueDateForLead(today, -3); // 3 days in the future
    const far = dueDateForLead(today, -60);
    const list = upcomingTasks([task({ id: 'a', dueDate: soon }), task({ id: 'b', dueDate: far })], today, 14);
    expect(list.map((t) => t.id)).toEqual(['a']);
  });
});

describe('moveTask', () => {
  const eventDate = '2027-06-01';
  const prerequisite = task({ id: 'p', dueDate: '2027-03-01', leadDays: 92 });
  const dependent = task({ id: 'd', dueDate: '2027-04-01', leadDays: 61, dependsOn: 'p' });

  it('updates lead days and reports conflicting dependents', () => {
    const result = moveTask([prerequisite, dependent], 'p', '2027-05-01', eventDate);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.moved.dueDate).toBe('2027-05-01');
    expect(result.moved.leadDays).toBe(daysBetween('2027-05-01', eventDate));
    expect(result.affected.map((t) => t.id)).toEqual(['d']);
    expect(result.conflicts.map((t) => t.id)).toEqual(['d']); // dependent now before prerequisite
  });

  it('refuses to move completed tasks', () => {
    const doneTask = task({ id: 'x', status: 'done', dueDate: '2027-01-01' });
    const result = moveTask([doneTask], 'x', '2027-02-01', eventDate);
    expect('error' in result && result.error).toMatch(/Completed/);
  });

  it('rejects invalid dates', () => {
    const result = moveTask([prerequisite], 'p', 'not-a-date', eventDate);
    expect('error' in result).toBe(true);
  });
});

describe('rescheduleForNewEventDate', () => {
  const tasks = [
    task({ id: 'open', dueDate: '2027-03-01', leadDays: 90 }),
    task({ id: 'finished', dueDate: '2027-02-01', leadDays: 120, status: 'done' }),
    task({ id: 'after', dueDate: '2027-06-10', leadDays: -5 }),
  ];

  it('recomputes open tasks by lead days and never touches completed ones', () => {
    const result = rescheduleForNewEventDate(tasks, '2027-09-01');
    const open = result.tasks.find((t) => t.id === 'open')!;
    const finished = result.tasks.find((t) => t.id === 'finished')!;
    const after = result.tasks.find((t) => t.id === 'after')!;
    expect(open.dueDate).toBe('2027-06-03');
    expect(open.leadDays).toBe(90);
    expect(finished.dueDate).toBe('2027-02-01');
    expect(after.dueDate).toBe('2027-09-06');
    expect(result.skippedCompleted).toEqual(['finished']);
    expect(result.updated).toContain('open');
  });

  it('detects dependency order violations after the move', () => {
    const linked = [
      task({ id: 'p', dueDate: '2027-03-01', leadDays: 90 }),
      task({ id: 'd', dueDate: '2027-04-01', leadDays: 60, dependsOn: 'p' }),
    ];
    // Move the prerequisite later than the dependent by editing lead days directly.
    linked[0].leadDays = 10;
    const result = rescheduleForNewEventDate(linked, '2027-06-01');
    expect(result.conflicts.map((t) => t.id)).toEqual(['d']);
  });
});

describe('task CRUD', () => {
  it('adds, updates and deletes tasks; deleting clears references', () => {
    let tasks = generateTasks(birthday);
    const first = tasks[0];
    tasks = addTask(tasks, { ...task({ id: 'custom' }), id: undefined as unknown as string });
    expect(tasks.length).toBe(generateTasks(birthday).length + 1);

    tasks = updateTask(tasks, first.id, { status: 'done' });
    expect(tasks.find((t) => t.id === first.id)!.status).toBe('done');

    tasks = deleteTask(tasks, first.id);
    expect(tasks.find((t) => t.id === first.id)).toBeUndefined();
    for (const t of tasks) if (t.dependsOn) expect(t.dependsOn).not.toBe(first.id);
  });

  it('does not rewrite due dates of completed tasks', () => {
    const doneTask = task({ id: 'done1', status: 'done', dueDate: '2027-01-01' });
    const next = updateTask([doneTask], 'done1', { dueDate: '2027-05-05', title: 'Renamed' });
    expect(next[0].dueDate).toBe('2027-01-01');
    expect(next[0].title).toBe('Renamed');
  });

  it('sorts overdue tasks first, then by date', () => {
    const list = [
      task({ id: 'later', dueDate: '2099-01-01' }),
      task({ id: 'overdue', dueDate: '2020-01-01' }),
      task({ id: 'soon', dueDate: '2098-01-01' }),
    ];
    expect(sortTasks(list).map((t) => t.id)).toEqual(['overdue', 'soon', 'later']);
  });
});
