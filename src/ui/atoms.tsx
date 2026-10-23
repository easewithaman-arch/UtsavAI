import { Children, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';

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
  children: ReactNode;
}) {
  const baseId = useId();
  const hintId = hint && !error ? `${baseId}-hint` : undefined;
  const errorId = error ? `${baseId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  let content = children;
  if (describedBy && isValidElement(children) && Children.count(children) === 1) {
    const child = children as ReactElement<{ 'aria-describedby'?: string; 'aria-invalid'?: boolean }>;
    const existing = child.props['aria-describedby'];
    content = cloneElement(child, {
      'aria-describedby': [existing, describedBy].filter(Boolean).join(' '),
      'aria-invalid': error ? true : undefined,
    });
  }

  return (
    <label className={`field ${error ? 'has-error' : ''}`}>
      <span className="field-label">{label}</span>
      {content}
      {hintId ? <span className="field-hint" id={hintId}>{hint}</span> : null}
      {error ? <span className="field-error" id={errorId} role="alert">{error}</span> : null}
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
