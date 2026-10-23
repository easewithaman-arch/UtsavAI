import { useMemo, useState } from 'react';
import type { EventPlan, PlanTask, Priority, TaskStatus } from '../domain/types';
import {
  addTask,
  deleteTask,
  progressInfo,
  setTaskStatus,
  sortTasks,
  taskFlagMap,
  updateTask,
} from '../domain/timeline';
import { EVENT_TYPE_MAP } from '../domain/events';
import { EmptyState, Segmented } from '../ui/atoms';
import { formatDate, titleCase } from '../ui/format';
import { leadTimeLabel } from '../domain/labels';

type Filter = 'all' | 'overdue' | 'soon' | 'done';

export function TimelineView({
  plan,
  onTasks,
}: {
  plan: EventPlan;
  onTasks: (tasks: PlanTask[], milestones: EventPlan['timeline']['milestones']) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<PlanTask>>({});

  const progress = useMemo(() => progressInfo(plan.timeline.tasks), [plan.timeline.tasks]);
  const flags = useMemo(() => taskFlagMap(plan.timeline.tasks), [plan.timeline.tasks]);
  const overdue = useMemo(
    () => plan.timeline.tasks.filter((task) => flags.get(task.id)?.overdue),
    [plan.timeline.tasks, flags],
  );
  const tasks = useMemo(() => {
    const sorted = sortTasks(plan.timeline.tasks, flags);
    if (filter === 'overdue') return sorted.filter((t) => flags.get(t.id)?.overdue);
    if (filter === 'soon') return sorted.filter((t) => flags.get(t.id)?.dueSoon);
    if (filter === 'done') return sorted.filter((t) => t.status === 'done');
    return sorted;
  }, [plan.timeline.tasks, filter, flags]);

  const apply = (next: PlanTask[]) => onTasks(next, plan.timeline.milestones);

  const toggleStatus = (task: PlanTask) => {
    const order: TaskStatus[] = ['todo', 'in-progress', 'done'];
    const next = order[(order.indexOf(task.status) + 1) % order.length];
    apply(setTaskStatus(plan.timeline.tasks, task.id, next));
  };

  const beginEdit = (task: PlanTask) => {
    setEditing(task.id);
    setDraft({ title: task.title, dueDate: task.dueDate, priority: task.priority, category: task.category });
  };

  const commitEdit = (task: PlanTask) => {
    const dueDate = draft.dueDate ?? task.dueDate;
    const leadDays = task.leadDays + (Date.parse(`${task.dueDate}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000;
    const next = updateTask(plan.timeline.tasks, task.id, {
      title: draft.title,
      dueDate,
      priority: draft.priority,
      category: draft.category,
    }).map((t) => (t.id === task.id ? { ...t, leadDays } : t));
    apply(next);
    setEditing(null);
    setDraft({});
  };

  const addQuick = () => {
    apply(
      addTask(plan.timeline.tasks, {
        title: 'New task',
        description: '',
        category: 'planning',
        dueDate: plan.input.date,
        leadDays: 14,
        priority: 'medium',
        status: 'todo',
      }),
    );
  };

  return (
    <div className="timeline-view">
      <h2 className="sr-only">Timeline</h2>
      <div className="timeline-head">
        <div className="progress-block">
          <span className="progress-label" id="timeline-progress-label">
            {progress.done} of {progress.total} tasks done
          </span>
          <div
            className="progress-bar"
            role="progressbar"
            aria-labelledby="timeline-progress-label"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress.pct)}
          >
            <span style={{ width: `${progress.pct}%` }} />
          </div>
        </div>
        <div className="timeline-actions">
          <Segmented
            label="Filter tasks"
            options={[
              { value: 'all', label: 'All' },
              { value: 'overdue', label: `Overdue (${overdue.length})` },
              { value: 'soon', label: 'Due soon' },
              { value: 'done', label: 'Done' },
            ]}
            value={filter}
            onChange={setFilter}
          />
          <button type="button" className="ghost" onClick={addQuick}>
            Add task
          </button>
        </div>
      </div>

      <div className="milestones">
        {plan.timeline.milestones.map((m) => (
          <div key={m.id} className={`milestone ${m.date === plan.input.date ? 'final' : ''}`}>
            <span className="milestone-dot" aria-hidden="true" />
            <span className="milestone-label">{m.label}</span>
            <span className="milestone-date">{formatDate(m.date)}</span>
          </div>
        ))}
        <p className="muted milestone-note">
          {EVENT_TYPE_MAP[plan.input.type].label} on {formatDate(plan.input.date)} · each deadline is worked out from how
          long before the event it is, so changing the date shifts all of them.
        </p>
      </div>

      {tasks.length === 0 ? (
        <EmptyState title="Nothing here" body="No tasks match this filter." />
      ) : (
        <ul className="task-list">
          {tasks.map((task) => {
            const flagsForTask = flags.get(task.id)!;
            const isEditing = editing === task.id;
            return (
              <li key={task.id} className={`task ${flagsForTask.completed ? 'done' : ''} ${flagsForTask.overdue ? 'overdue' : ''}`}>
                <button
                  type="button"
                  className={`status-dot ${task.status}`}
                  onClick={() => toggleStatus(task)}
                  aria-label={`Status: ${titleCase(task.status)} for ${task.title}. Change status`}
                  title={`Currently ${titleCase(task.status)} - click to change`}
                />
                {isEditing ? (
                  <div className="task-edit">
                    <input
                      value={draft.title ?? ''}
                      maxLength={200}
                      aria-label={`Task title for ${task.title}`}
                      onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                      placeholder="Task title"
                    />
                    <input
                      type="date"
                      value={draft.dueDate ?? ''}
                      aria-label={`Due date for ${task.title}`}
                      onChange={(e) => setDraft((d) => ({ ...d, dueDate: e.target.value }))}
                    />
                    <select
                      value={draft.priority ?? 'medium'}
                      aria-label={`Priority for ${task.title}`}
                      onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value as Priority }))}
                    >
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                    <button type="button" className="primary small" onClick={() => commitEdit(task)}>
                      Save
                    </button>
                    <button type="button" className="ghost small" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="task-body">
                    <div className="task-top">
                      <span className="task-title">{task.title}</span>
                      <span className={`pill ${task.priority}`}>{titleCase(task.priority)}</span>
                      <span className="task-cat">{titleCase(task.category)}</span>
                    </div>
                    {task.description ? <p className="task-desc">{task.description}</p> : null}
                    <div className="task-meta">
                      <span className={`due ${flagsForTask.overdue ? 'bad' : flagsForTask.dueSoon ? 'warn' : ''}`}>
                        Due {formatDate(task.dueDate)}
                        {flagsForTask.overdue ? ' · overdue' : flagsForTask.dueSoon ? ' · due soon' : ''}
                      </span>
                      <span className="muted">{leadTimeLabel(task.leadDays)}</span>
                    </div>
                  </div>
                )}
                <div className="task-tools">
                  <button type="button" className="icon-btn" onClick={() => beginEdit(task)} aria-label={`Edit task ${task.title}`}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    onClick={() => apply(deleteTask(plan.timeline.tasks, task.id))}
                    aria-label={`Delete task ${task.title}`}
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
