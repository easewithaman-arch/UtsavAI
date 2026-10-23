import { useState } from 'react';
import type { ChangeRecord, EventPlan } from '../domain/types';
import type { PlanOp, ApplyResult } from '../planner/ops';
import { validateOp } from '../planner/ops';
import { DEMO_MODE_NOTE, parseIntent } from '../planner/intent';
import { requestAiCopilot } from '../planner/ai';
import { formatDate, formatDateTime } from '../domain/labels';
import { CHANGE_SOURCE_LABELS, fieldLabel, foodLabel, plural, priorityLabel, settingLabel, taskStatusLabel } from '../domain/labels';
import { CATEGORY_NAMES, REQUIREMENT_LABELS } from '../domain/events';
import { formatMoney } from '../domain/money';
import { EmptyState } from '../ui/atoms';

export interface CopilotMode {
  mode: 'ai' | 'demo';
  model: string | null;
  provider: string | null;
}

interface PendingProposal {
  ops: PlanOp[];
  summary: string;
  tradeoffs: string[];
  clarify?: string;
  origin: 'demo' | 'ai';
}

const SUGGESTIONS = [
  'Reduce the budget by 15%',
  'Reduce the guest count to 80',
  'Move the ceremony indoors',
  'Suggest lower-cost decoration options',
  'Add vegetarian catering',
  'Move the event to the next season',
];

export function CopilotView({
  plan,
  mode,
  history,
  onApply,
}: {
  plan: EventPlan;
  mode: CopilotMode;
  history: ChangeRecord[];
  onApply: (ops: PlanOp[]) => ApplyResult;
}) {
  const [request, setRequest] = useState('');
  const [pending, setPending] = useState<PendingProposal | null>(null);
  const [lastChanges, setLastChanges] = useState<string[]>([]);
  const [lastWarnings, setLastWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const ask = async () => {
    const text = request.trim();
    if (!text) return;
    setError('');
    setLastChanges([]);
    setLastWarnings([]);
    setPending(null);

    if (mode.mode === 'ai') {
      setBusy(true);
      const result = await requestAiCopilot(plan, text);
      setBusy(false);
      if (!result.ok) {
        setError(`${result.error.message} We used our built-in rules instead.`);
        const local = parseIntent(text, plan);
        setPending({ ...local, origin: 'demo' });
        return;
      }
      const proposal = result.proposal;
      const validated: PlanOp[] = [];
      const errs: string[] = [];
      for (const raw of proposal.ops) {
        const v = validateOne(raw);
        if ('error' in v) errs.push(v.error);
        else validated.push(v.op);
      }
      if (errs.length > 0) setError(`Some suggestions were discarded: ${errs.join(' ')}`);
      setPending({
        ops: validated,
        summary: proposal.summary,
        tradeoffs: proposal.tradeoffs,
        clarify: proposal.clarify ?? undefined,
        origin: 'ai',
      });
      return;
    }

    const local = parseIntent(text, plan);
    setPending({ ...local, origin: 'demo' });
  };

  const confirm = () => {
    if (!pending || pending.ops.length === 0) return;
    const result = onApply(pending.ops);
    setLastChanges(result.changes);
    setLastWarnings(result.warnings);
    setPending(null);
  };

  return (
    <div className="copilot-view">
      <h2 className="sr-only">Assistant</h2>
      <section className="panel copilot-panel">
        <header className="copilot-head">
          <h3>Planning assistant</h3>
          <span className={`mode-badge ${mode.mode}`} title={mode.model ?? undefined}>
            {mode.mode === 'ai' ? 'AI mode' : 'Built-in mode'}
          </span>
        </header>
        <p className="muted">
          Ask for changes in plain language. Nothing is applied until you confirm, and every reply comes with real
          numbers. Only the changes shown below can be made, so you always stay in control.
        </p>
        {mode.mode === 'demo' ? <p className="mode-note">{DEMO_MODE_NOTE}</p> : null}

        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => setRequest(s)}>
              {s}
            </button>
          ))}
        </div>

        <div className="ask-row">
          <label className="sr-only" htmlFor="copilot-request">
            Describe the change you want
          </label>
          <textarea
            id="copilot-request"
            value={request}
            maxLength={2000}
            aria-describedby={error ? 'copilot-error' : undefined}
            onChange={(e) => setRequest(e.target.value)}
            placeholder='e.g. "Reduce the budget by 20% and add vegetarian catering"'
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask();
            }}
          />
          <button type="button" className="primary" onClick={ask} disabled={busy || !request.trim()} aria-busy={busy}>
            {busy ? 'Thinking...' : 'Ask'}
          </button>
        </div>
        {error ? <p className="field-error" id="copilot-error" role="alert">{error}</p> : null}

        {pending ? (
          <div className="proposal" role="status">
            <div className="proposal-head">
              <span className={`tag ${pending.origin}`}>{pending.origin === 'ai' ? 'AI suggestion' : 'Built-in suggestion'}</span>
              <p className="proposal-summary">{pending.summary}</p>
            </div>
            {pending.clarify ? <p className="clarify">{pending.clarify}</p> : null}
            {pending.ops.length > 0 ? (
              <>
                <span className="proposal-label">{plural(pending.ops.length, 'change')} ready to apply:</span>
                <ul className="op-list">
                  {pending.ops.map((op, i) => (
                    <li key={i}>
                      <code>{describeOp(op, plan)}</code>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {pending.tradeoffs.length > 0 ? (
              <ul className="tradeoffs">
                {pending.tradeoffs.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            ) : null}
            <div className="wizard-actions">
              <button type="button" className="ghost" onClick={() => setPending(null)}>
                Discard
              </button>
              <button type="button" className="primary" onClick={confirm} disabled={pending.ops.length === 0}>
                Apply {plural(pending.ops.length, 'change')}
              </button>
            </div>
          </div>
        ) : null}

        {lastChanges.length > 0 ? (
          <div className="applied" role="status">
            <h4>Applied</h4>
            <ul className="plain-list">
              {lastChanges.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
            {lastWarnings.length > 0 ? (
              <ul className="tradeoffs">
                {lastWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="panel">
        <h3>Change history</h3>
        {history.length === 0 ? (
          <EmptyState title="Nothing yet" body="Every change you make - by hand or with the assistant - will show up here." />
        ) : (
          <ul className="history-list">
            {[...history].reverse().map((rec) => (
              <li key={rec.id}>
                <div className="history-top">
                  <span className="history-summary">{rec.summary}</span>
                  <span className="muted">{formatDateTime(rec.at)}</span>
                </div>
                <span className={`tag ${rec.source === 'user' ? '' : rec.source === 'copilot-ai' ? 'ai' : 'demo'}`}>
                  {CHANGE_SOURCE_LABELS[rec.source]}
                </span>
                {rec.details.length > 0 ? (
                  <ul className="plain-list small">
                    {rec.details.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function describeOp(op: PlanOp, plan: EventPlan): string {
  const currency = plan.input.budget.currency;
  const taskName = (id: string) => plan.timeline.tasks.find((t) => t.id === id)?.title ?? 'task';
  const vendorName = (id: string) => plan.vendors.find((v) => v.id === id)?.name ?? 'vendor';
  switch (op.op) {
    case 'setBudgetTotal':
      return `Set the total budget to ${formatMoney(op.totalMinor, currency)}`;
    case 'setGuestCount':
      return `Set the guest count to ${op.count}`;
    case 'setEventDate':
      return `Move the event to ${formatDate(op.date)}`;
    case 'setEventField': {
      const value = op.field === 'setting' ? settingLabel(String(op.value)) : String(op.value);
      return `Set ${fieldLabel(op.field).toLowerCase()} to "${value}"`;
    }
    case 'setPreference': {
      const value = op.field === 'food' ? foodLabel(op.value) : op.value;
      return `Set ${fieldLabel(op.field).toLowerCase()} to "${value}"`;
    }
    case 'setColors':
      return `Set the colours to ${op.value.join(', ')}`;
    case 'setCategoryAllocation':
      return `Set the ${CATEGORY_NAMES[op.categoryId].toLowerCase()} budget to ${formatMoney(op.allocatedMinor, currency)}`;
    case 'setCategoryPriority':
      return `Set ${CATEGORY_NAMES[op.categoryId].toLowerCase()} priority to ${priorityLabel(op.priority)}`;
    case 'rebalanceBudget':
      return 'Spread the budget across the categories again';
    case 'setRequirement':
      return `${op.enabled ? 'Include' : 'Remove'} ${REQUIREMENT_LABELS[op.key].toLowerCase()} in the plan`;
    case 'addTask':
      return `Add the task "${op.task.title}"`;
    case 'updateTask':
      return `Update the task "${taskName(op.taskId)}"`;
    case 'deleteTask':
      return `Delete the task "${taskName(op.taskId)}"`;
    case 'setTaskStatus':
      return `Mark "${taskName(op.taskId)}" as ${taskStatusLabel(op.status).toLowerCase()}`;
    case 'addVendor':
      return `Add the vendor "${op.vendor.name}"`;
    case 'updateVendor':
      return `Update the vendor "${vendorName(op.vendorId)}"`;
    case 'deleteVendor':
      return `Remove the vendor "${vendorName(op.vendorId)}"`;
    default:
      return 'Unknown change';
  }
}

function validateOne(raw: unknown): { op: PlanOp } | { error: string } {
  return validateOp(raw);
}
