import { useMemo, useState } from 'react';
import type { EventPlan } from '../domain/types';
import { budgetTotals, budgetWarnings, costPerGuest } from '../domain/budget';
import { CATEGORY_NAMES } from '../domain/events';
import { money, titleCase } from '../ui/format';
import { parseMoneyInput, percentOf } from '../domain/money';
import { RiskList } from '../ui/atoms';

export function BudgetView({
  plan,
  onAllocations,
  onActuals,
}: {
  plan: EventPlan;
  onAllocations: (categories: EventPlan['budget']['categories']) => void;
  onActuals: (categories: EventPlan['budget']['categories']) => void;
}) {
  const currency = plan.input.budget.currency;
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  const totals = useMemo(
    () => budgetTotals(plan.budget.categories, plan.input.budget.totalMinor),
    [plan.budget.categories, plan.input.budget.totalMinor],
  );
  const warnings = useMemo(
    () => budgetWarnings(plan.budget.categories, plan.input.budget.totalMinor, currency, totals),
    [plan.budget.categories, plan.input.budget.totalMinor, currency, totals],
  );

  const maxAlloc = useMemo(
    () => Math.max(...plan.budget.categories.map((c) => Math.max(c.allocatedMinor, c.estimatedMinor)), 1),
    [plan.budget.categories],
  );
  const perGuest = useMemo(
    () => costPerGuest(plan.input.budget.totalMinor, plan.input.guestCount),
    [plan.input.budget.totalMinor, plan.input.guestCount],
  );

  const startEdit = (id: string, valueMinor: number) => {
    setEditId(id);
    setDraft((valueMinor / 100).toFixed(2));
    setError('');
  };

  const commitEdit = (id: string) => {
    const parsed = parseMoneyInput(draft, currency);
    if (parsed === null) {
      setError('Enter a non-negative amount.');
      return;
    }
    const next = plan.budget.categories.map((c) =>
      c.id === id ? { ...c, allocatedMinor: parsed, manual: true } : c,
    );
    const sum = next.reduce((s, c) => s + c.allocatedMinor, 0);
    if (sum > plan.input.budget.totalMinor) {
      setError(
        `That pushes the total to ${money(sum, currency)} - ${money(sum - plan.input.budget.totalMinor, currency)} over budget. Reduce another category first, or ask the assistant to raise the budget.`,
      );
      return;
    }
    setEditId(null);
    setError('');
    onAllocations(next);
  };

  const setActual = (id: string, raw: string, input: HTMLInputElement) => {
    const parsed = parseMoneyInput(raw, currency);
    if (parsed === null) {
      const previous = plan.budget.categories.find((c) => c.id === id)?.actualMinor ?? 0;
      input.value = (previous / 100).toFixed(2);
      return;
    }
    const next = plan.budget.categories.map((c) => (c.id === id ? { ...c, actualMinor: parsed } : c));
    onActuals(next);
  };

  return (
    <div className="budget-view">
      <h2 className="sr-only">Budget</h2>
      <div className="stat-row">
        <Stat label="Total budget" value={money(plan.input.budget.totalMinor, currency)} />
        <Stat label="Allocated" value={money(totals.allocatedMinor, currency)} tone={totals.overAllocated ? 'bad' : 'ok'} />
        <Stat label="Estimated need" value={money(totals.estimatedMinor, currency)} tone={totals.estimatedOverBudget ? 'warn' : 'ok'} />
        <Stat label="Actual spend" value={money(totals.actualMinor, currency)} tone={totals.overSpent ? 'bad' : 'ok'} />
        <Stat
          label="Unallocated"
          value={money(totals.unallocatedMinor, currency)}
          tone={totals.unallocatedMinor < 0 ? 'bad' : 'ok'}
        />
        <Stat label="Per guest" value={money(perGuest, currency)} />
      </div>

      {totals.overAllocated ? (
        <p className="banner bad">
          The amounts assigned to categories add up to {money(totals.allocatedMinor - plan.input.budget.totalMinor, currency)}{' '}
          more than your total budget. A manual edit has pushed it over.
        </p>
      ) : null}
      {plan.budget.insufficient || totals.estimatedOverBudget ? (
        <p className="banner warn">
          Estimated costs exceed the budget. The categories below show where the gap is - cut scope, raise the budget, or
          reduce the guest count with the assistant.
        </p>
      ) : null}
      {error ? <p className="field-error">{error}</p> : null}

      <div className="table-wrap">
        <table className="data-table">
          <caption className="sr-only">Budget by category, with allocated, estimated, actual and priority</caption>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Allocated</th>
              <th scope="col">Estimated need</th>
              <th scope="col">Actual</th>
              <th scope="col">Priority</th>
              <th scope="col" className="pct-cell">Share</th>
            </tr>
          </thead>
          <tbody>
            {plan.budget.categories.map((c) => (
              <tr key={c.id} className={c.manual ? 'manual' : ''}>
                <td>
                  <span className="cat-name">{CATEGORY_NAMES[c.id]}</span>
                  {c.isContingency ? <span className="tag">reserve</span> : null}
                  {c.manual ? <span className="tag manual-tag">manual</span> : null}
                  <div className="bar">
                    <span className="bar-alloc" style={{ width: `${(c.allocatedMinor / maxAlloc) * 100}%` }} />
                    <span className="bar-est" style={{ width: `${(c.estimatedMinor / maxAlloc) * 100}%` }} />
                  </div>
                </td>
                <td>
                  {editId === c.id ? (
                    <input
                      className="inline-input"
                      value={draft}
                      autoFocus
                      inputMode="decimal"
                      aria-label={`Allocated amount for ${CATEGORY_NAMES[c.id]}`}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commitEdit(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit(c.id);
                        if (e.key === 'Escape') setEditId(null);
                      }}
                    />
                  ) : (
                    <button type="button" className="linklike" onClick={() => startEdit(c.id, c.allocatedMinor)}>
                      {money(c.allocatedMinor, currency)}
                    </button>
                  )}
                </td>
                <td className={c.estimatedMinor > c.allocatedMinor ? 'over' : ''}>{money(c.estimatedMinor, currency)}</td>
                <td>
                  <input
                    className="inline-input small"
                    defaultValue={(c.actualMinor / 100).toFixed(2)}
                    inputMode="decimal"
                    onBlur={(e) => setActual(c.id, e.target.value, e.target)}
                    aria-label={`Actual spend for ${CATEGORY_NAMES[c.id]}`}
                  />
                </td>
                <td>
                  <span className={`pill ${c.priority}`}>{titleCase(c.priority)}</span>
                </td>
                <td className="pct-cell">{Math.round(percentOf(c.allocatedMinor, plan.input.budget.totalMinor))}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel-grid">
        <div className="panel">
          <h3>Savings ideas</h3>
          <RiskList items={plan.budget.savings} tone="save" />
        </div>
        <div className="panel">
          <h3>Budget risks</h3>
          <RiskList items={plan.budget.risks} tone="risk" />
        </div>
        {warnings.length > 0 ? (
          <div className="panel">
            <h3>Live warnings</h3>
            <RiskList items={warnings} tone="warn" />
          </div>
        ) : null}
      </div>

      <section className="numbers-note" aria-labelledby="budget-numbers-heading">
        <h3 id="budget-numbers-heading">How to read these numbers</h3>
        <p className="muted">
          Allocated is what the plan sets aside; estimated need is a planning figure worked out from your guests, location
          and preferences; actual is what you have really spent. Every amount is shown to the paisa, so the categories
          always add up to your total exactly.
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}
