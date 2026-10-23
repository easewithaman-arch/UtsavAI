import { useMemo, useState } from 'react';
import type {
  CurrencyCode,
  EventInput,
  EventTypeId,
  FoodPreference,
  Priority,
  RequirementKey,
  Setting,
} from '../domain/types';
import {
  CATEGORY_NAMES,
  EVENT_TYPE_MAP,
  EVENT_TYPES,
  REQUIREMENT_LABELS,
  SAMPLE_EVENTS,
  defaultRequirements,
  emptyEventInput,
  newId,
} from '../domain/events';
import { CURRENCY_SYMBOL, parseMoneyInput } from '../domain/money';
import { validateEventInput } from '../domain/validate';
import { ChipPicker, Field, Segmented } from './atoms';
import { formatDate, titleCase } from './format';

const CURRENCIES: CurrencyCode[] = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'];
const FOODS: FoodPreference[] = ['vegetarian', 'vegan', 'non-vegetarian', 'mixed', 'unspecified'];
const PRIORITIES: Priority[] = ['high', 'medium', 'low'];
const PRIORITY_CATEGORIES = (Object.keys(CATEGORY_NAMES) as (keyof typeof CATEGORY_NAMES)[]).filter(
  (id) => id !== 'contingency',
);
const FIELD_ERROR_KEYS = new Set([
  'name', 'date', 'location', 'guestCount', 'durationHours', 'setting',
  'budget.totalMinor', 'budget.contingencyPct', 'budget.currency', 'budget.flexibility',
]);

export interface WizardProps {
  onGenerate: (input: EventInput) => void;
  busy: boolean;
}

export function Wizard({ onGenerate, busy }: WizardProps) {
  const [tab, setTab] = useState<'sample' | 'custom'>('sample');
  const [input, setInput] = useState<EventInput>(() => emptyEventInput('wedding'));
  const [budgetDraft, setBudgetDraft] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const remainingErrors = Object.entries(errors).filter(([key]) => !FIELD_ERROR_KEYS.has(key));

  const update = (patch: Partial<EventInput>) => setInput((prev) => ({ ...prev, ...patch }));
  const updateBudget = (patch: Partial<EventInput['budget']>) =>
    setInput((prev) => ({ ...prev, budget: { ...prev.budget, ...patch } }));
  const updatePreferences = (patch: Partial<EventInput['preferences']>) =>
    setInput((prev) => ({ ...prev, preferences: { ...prev.preferences, ...patch } }));

  const typeOptions = useMemo(
    () => EVENT_TYPES.map((t) => ({ key: t.id, label: t.label, sub: t.blurb })),
    [],
  );

  const submit = () => {
    const result = validateEventInput(input);
    if (!result.ok || !result.data) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onGenerate(result.data);
  };

  const reset = () => {
    setInput(emptyEventInput(input.type));
    setBudgetDraft('');
    setErrors({});
  };

  return (
    <section className="wizard">
      <div className="wizard-intro">
        <p className="eyebrow">Plan a celebration</p>
        <h1>Everything a real event needs, decided honestly.</h1>
      <h2 className="sr-only">Plan your event</h2>
        <p className="lede">
          Budget, timeline, vendor checklist and a planning assistant that gives you real numbers. Start from a worked
          example or build your own event from scratch.
        </p>
      </div>

      <Segmented
        label="How to start"
        options={[
          { value: 'sample', label: 'Worked examples' },
          { value: 'custom', label: 'Build my own' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'sample' ? (
        <div className="sample-grid">
          {SAMPLE_EVENTS.map((s) => (
            <SampleCard key={s.key} scenario={s} busy={busy} onGenerate={onGenerate} />
          ))}
        </div>
      ) : (
        <div className="custom-form">
          <ChipPicker
            title="Event type"
            options={typeOptions}
            value={input.type}
            onPick={(key) => {
              const id = key as EventTypeId;
              setInput((prev) => ({
                ...prev,
                type: id,
                requirements: defaultRequirements(id),
                budget: { ...prev.budget, priorities: { ...prev.budget.priorities } },
              }));
            }}
          />

          <div className="form-grid">
            <Field label="Event name" error={errors.name}>
              <input
                value={input.name}
                maxLength={80}
                placeholder="e.g. Aarav's 10th birthday"
                onChange={(e) => update({ name: e.target.value })}
              />
            </Field>
            <Field label="Date" error={errors.date}>
              <input type="date" value={input.date} onChange={(e) => update({ date: e.target.value })} />
            </Field>
            <Field label="Location / city" hint="Bigger cities usually cost more." error={errors.location}>
              <input
                value={input.location}
                maxLength={120}
                placeholder="e.g. Pune"
                onChange={(e) => update({ location: e.target.value })}
              />
            </Field>
            <Field label="Guests" error={errors.guestCount}>
              <input
                type="number"
                min={1}
                max={100000}
                value={input.guestCount}
                onChange={(e) => update({ guestCount: Number(e.target.value) })}
              />
            </Field>
            <Field label="Duration (hours)" error={errors.durationHours}>
              <input
                type="number"
                min={1}
                max={72}
                value={input.durationHours}
                onChange={(e) => update({ durationHours: Number(e.target.value) })}
              />
            </Field>
            <Field label="Setting" error={errors.setting}>
              <select value={input.setting} onChange={(e) => update({ setting: e.target.value as Setting })}>
                <option value="indoor">Indoor</option>
                <option value="outdoor">Outdoor</option>
                <option value="either">Either</option>
              </select>
            </Field>
          </div>

          <div className="section-block">
            <h3>Budget</h3>
            <div className="form-grid">
              <Field label="Currency" error={errors['budget.currency']}>
                <select
                  value={input.budget.currency}
                  onChange={(e) => updateBudget({ currency: e.target.value as CurrencyCode })}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c} ({CURRENCY_SYMBOL[c]})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Total budget" hint="Round numbers are fine - no decimals needed." error={errors['budget.totalMinor']}>
                <input
                  value={budgetDraft}
                  inputMode="decimal"
                  onChange={(e) => {
                    const raw = e.target.value;
                    setBudgetDraft(raw);
                    const minor = parseMoneyInput(raw, input.budget.currency);
                    updateBudget({ totalMinor: minor ?? 0 });
                  }}
                />
              </Field>
              <Field label="Reserve %" hint="Money kept aside for surprises." error={errors['budget.contingencyPct']}>
                <input
                  type="number"
                  min={0}
                  max={30}
                  value={input.budget.contingencyPct}
                  onChange={(e) => updateBudget({ contingencyPct: Number(e.target.value) })}
                />
              </Field>
              <Field label="Flexibility" error={errors['budget.flexibility']}>
                <select
                  value={input.budget.flexibility}
                  onChange={(e) => updateBudget({ flexibility: e.target.value as EventInput['budget']['flexibility'] })}
                >
                  <option value="strict">Strict - hold the line</option>
                  <option value="moderate">Moderate - some give</option>
                  <option value="flexible">Flexible - can stretch</option>
                </select>
              </Field>
            </div>

            <details className="advanced">
              <summary>Category priorities</summary>
              <div className="priority-grid">
                {PRIORITY_CATEGORIES.map((id) => (
                  <label key={id} className="priority-row">
                    <span>{CATEGORY_NAMES[id]}</span>
                    <select
                      value={input.budget.priorities[id] ?? 'medium'}
                      onChange={(e) =>
                        updateBudget({ priorities: { ...input.budget.priorities, [id]: e.target.value as Priority } })
                      }
                    >
                      {PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {titleCase(p)}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </details>
          </div>

          <div className="section-block">
            <h3>Preferences &amp; requirements</h3>
            <div className="form-grid">
              <Field label="Theme">
                <input
                  value={input.preferences.theme}
                  placeholder="e.g. Space explorer"
                  onChange={(e) => updatePreferences({ theme: e.target.value })}
                />
              </Field>
              <Field label="Colours" hint="Comma-separated.">
                <input
                  value={input.preferences.colors.join(', ')}
                  placeholder="Navy, Gold"
                  onChange={(e) =>
                    updatePreferences({
                      colors: e.target.value.split(',').map((c) => c.trim()).filter(Boolean),
                    })
                  }
                />
              </Field>
              <Field label="Food preference">
                <select value={input.preferences.food} onChange={(e) => updatePreferences({ food: e.target.value as FoodPreference })}>
                  {FOODS.map((f) => (
                    <option key={f} value={f}>
                      {titleCase(f)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Cultural touches" hint="Rituals, traditions, language notes.">
                <input
                  value={input.preferences.cultural}
                  placeholder="e.g. Marathi naming ceremony"
                  onChange={(e) => updatePreferences({ cultural: e.target.value })}
                />
              </Field>
              <Field label="Accessibility needs">
                <input
                  value={input.preferences.accessibility}
                  placeholder="e.g. wheelchair access, quiet room"
                  onChange={(e) => updatePreferences({ accessibility: e.target.value })}
                />
              </Field>
              <Field label="Special requests">
                <input
                  value={input.preferences.special}
                  placeholder="Anything else that matters"
                  onChange={(e) => updatePreferences({ special: e.target.value })}
                />
              </Field>
            </div>

            <div className="requirements">
              {(Object.keys(REQUIREMENT_LABELS) as RequirementKey[]).map((key) => (
                <label key={key} className="requirement">
                  <input
                    type="checkbox"
                    checked={input.requirements[key]}
                    onChange={(e) => update({ requirements: { ...input.requirements, [key]: e.target.checked } })}
                  />
                  <span>{REQUIREMENT_LABELS[key]}</span>
                </label>
              ))}
            </div>
          </div>

          {remainingErrors.length > 0 ? (
            <div className="field-error" role="alert">
              <ul className="plain-list small">
                {remainingErrors.map(([key, message]) => (
                  <li key={key}>{message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="wizard-actions">
            <button type="button" className="ghost" onClick={reset}>
              Reset
            </button>
            <button type="button" className="primary" disabled={busy} onClick={submit}>
              {busy ? 'Building your plan...' : 'Generate plan'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function SampleCard({
  scenario,
  busy,
  onGenerate,
}: {
  scenario: (typeof SAMPLE_EVENTS)[number];
  busy: boolean;
  onGenerate: (input: EventInput) => void;
}) {
  const preview = useMemo(() => scenario.build(), [scenario]);
  const build = () => onGenerate({ ...preview, id: newId('evt') });
  return (
    <article className="sample-card">
      <p className="sample-title">{scenario.title}</p>
      <p className="sample-summary">{scenario.summary}</p>
      <dl className="sample-meta">
        <div>
          <dt>Date</dt>
          <dd>{formatDate(preview.date)}</dd>
        </div>
        <div>
          <dt>Guests</dt>
          <dd>{preview.guestCount}</dd>
        </div>
        <div>
          <dt>Where</dt>
          <dd>{preview.location}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{EVENT_TYPE_MAP[preview.type].label}</dd>
        </div>
      </dl>
      <button type="button" className="primary" disabled={busy} onClick={build}>
        {busy ? 'Building...' : 'Open this plan'}
      </button>
    </article>
  );
}
