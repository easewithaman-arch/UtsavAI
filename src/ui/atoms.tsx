import type { EventPlan, EventTypeId, CategoryId, RequirementKey, Priority } from '../domain/types';
import { EVENT_TYPES } from '../domain/events';

type BooleanInput = { value: boolean; onChange: (next: boolean) => void };

export function InlineToggle({ value, onChange }: BooleanInput) {
  return (
    <button
      type="button"
      className={`toggle ${value ? 'on' : 'off'}`}
      aria-pressed={value}
      onClick={() => onChange(!value)}
    >
      <span className="knob" />
    </button>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          className={o.value === value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <p className="empty-title">{title}</p>
      <p className="empty-body">{body}</p>
    </div>
  );
}

export interface ChipOption {
  key: string;
  label: string;
  sub?: string;
}

export function ChipPicker({
  title,
  options,
  value,
  onPick,
}: {
  title: string;
  options: ChipOption[];
  value: string;
  onPick: (key: string) => void;
}) {
  return (
    <div className="chip-picker" role="group" aria-label={title}>
      <span className="chip-label">{title}</span>
      <div className="chips">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            aria-pressed={o.key === value}
            className={o.key === value ? 'chip selected' : 'chip'}
            onClick={() => onPick(o.key)}
          >
            <span className="chip-title">{o.label}</span>
            {o.sub ? <span className="chip-sub">{o.sub}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`field ${error ? 'has-error' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && !error ? <span className="field-hint">{hint}</span> : null}
      {error ? <span className="field-error" role="alert">{error}</span> : null}
    </label>
  );
}

export function RiskList({ items, tone }: { items: string[]; tone: 'warn' | 'risk' | 'save' }) {
  if (items.length === 0) return <p className="muted">Nothing flagged.</p>;
  return (
    <ul className={`risk-list ${tone}`}>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export type PlanSortKey = 'date' | 'updated';

export interface EventTypeSelectOption {
  id: EventTypeId;
  label: string;
}

export function eventTypeOptions(): EventTypeSelectOption[] {
  return EVENT_TYPES.map((t) => ({ id: t.id, label: t.label }));
}

export type { CategoryId, RequirementKey, Priority, EventPlan };
