import { useMemo, useState } from 'react';
import type { EventPlan, PlanTask, Priority, TaskStatus } from '../domain/types';
import {
  addTask,
  deleteTask,
  overdueTasks,
  progressInfo,
  setTaskStatus,
  sortTasks,
  taskFlags,
  updateTask,
} from '../domain/timeline';
import { EVENT_TYPE_MAP } from '../domain/events';
import { EmptyState, Segmented } from '../ui/atoms';
import { formatDate, titleCase } from '../ui/format';

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
  const overdue = useMemo(() => overdueTasks(plan.timeline.tasks), [plan.timeline.tasks]);
  const tasks = useMemo(() => {
    const sorted = sortTasks(plan.timeline.tasks);
    if (filter === 'overdue') return sorted.filter((t) => taskFlags(t).overdue);
    if (filter === 'soon') return sorted.filter((t) => taskFlags(t).dueSoon);
    if (filter === 'done') return sorted.filter((t) => t.status === 'done');
    return sorted;
  }, [plan.timeline.tasks, filter]);

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
      <div className="timeline-head">
        <div className="progress-block">
          <span className="progress-label">
            {progress.done} of {progress.total} tasks done
          </span>
          <div className="progress-bar">
            <span style={{ width: `${progress.pct}%` }} />
          </div>
        </div>
        <div className="timeline-actions">
          <Segmented
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
            <span className="milestone-dot" />
            <span className="milestone-label">{m.label}</span>
            <span className="milestone-date">{formatDate(m.date)}</span>
          </div>
        ))}
        <p className="muted milestone-note">
          {EVENT_TYPE_MAP[plan.input.type].label} on {formatDate(plan.input.date)} · deadlines are calculated from their
          offset before the event, so moving the date re-drives them.
        </p>
      </div>

      {tasks.length === 0 ? (
        <EmptyState title="Nothing here" body="No tasks match this filter." />
      ) : (
        <ul className="task-list">
          {tasks.map((task) => {
            const flags = taskFlags(task);
            const isEditing = editing === task.id;
            return (
              <li key={task.id} className={`task ${flags.completed ? 'done' : ''} ${flags.overdue ? 'overdue' : ''}`}>
                <button
                  type="button"
                  className={`status-dot ${task.status}`}
                  onClick={() => toggleStatus(task)}
                  aria-label={`Cycle status for ${task.title}`}
                  title="Click to change status"
                />
                {isEditing ? (
                  <div className="task-edit">
                    <input
                      value={draft.title ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                      placeholder="Task title"
                    />
                    <input
                      type="date"
                      value={draft.dueDate ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, dueDate: e.target.value }))}
                    />
                    <select
                      value={draft.priority ?? 'medium'}
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
                      <span className={`due ${flags.overdue ? 'bad' : flags.dueSoon ? 'warn' : ''}`}>
                        Due {formatDate(task.dueDate)}
                        {flags.overdue ? ' · overdue' : flags.dueSoon ? ' · due soon' : ''}
                      </span>
                      <span className="muted">{task.leadDays >= 0 ? `T-${task.leadDays} days` : `T+${Math.abs(task.leadDays)} days`}</span>
                    </div>
                  </div>
                )}
                <div className="task-tools">
                  <button type="button" className="icon-btn" onClick={() => beginEdit(task)} aria-label="Edit task">
                    Edit
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    onClick={() => apply(deleteTask(plan.timeline.tasks, task.id))}
                    aria-label="Delete task"
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
