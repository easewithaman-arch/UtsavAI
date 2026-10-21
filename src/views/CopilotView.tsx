import { useState } from 'react';
import type { ChangeRecord, EventPlan } from '../domain/types';
import type { PlanOp, ApplyResult } from '../planner/ops';
import { validateOp } from '../planner/ops';
import { DEMO_MODE_NOTE, parseIntent } from '../planner/intent';
import { requestAiCopilot } from '../planner/ai';
import { formatDateTime } from '../ui/format';
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
        setError(`${result.error.message} Falling back to the built-in rules.`);
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
      <section className="panel copilot-panel">
        <header className="copilot-head">
          <h3>Planning copilot</h3>
          <span className={`mode-badge ${mode.mode}`}>
            {mode.mode === 'ai' ? `AI mode · ${mode.model ?? 'model'}` : 'Demo mode · built-in rules'}
          </span>
        </header>
        <p className="muted">
          Ask for changes in plain language. Nothing is applied until you confirm, and every reply returns exact numbers.
          The copilot works in validated operations - model output is never executed as code.
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
          <textarea
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            placeholder='e.g. "Reduce the budget by 20% and add vegetarian catering"'
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask();
            }}
          />
          <button type="button" className="primary" onClick={ask} disabled={busy || !request.trim()}>
            {busy ? 'Thinking...' : 'Ask'}
          </button>
        </div>
        {error ? <p className="field-error">{error}</p> : null}

        {pending ? (
          <div className="proposal">
            <div className="proposal-head">
              <span className={`tag ${pending.origin}`}>{pending.origin === 'ai' ? 'AI proposal' : 'Built-in rules'}</span>
              <p className="proposal-summary">{pending.summary}</p>
            </div>
            {pending.clarify ? <p className="clarify">{pending.clarify}</p> : null}
            {pending.ops.length > 0 ? (
              <>
                <span className="proposal-label">{pending.ops.length} change(s) ready to apply:</span>
                <ul className="op-list">
                  {pending.ops.map((op, i) => (
                    <li key={i}>
                      <code>{describeOp(op)}</code>
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
                Apply {pending.ops.length} change(s)
              </button>
            </div>
          </div>
        ) : null}

        {lastChanges.length > 0 ? (
          <div className="applied">
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
          <EmptyState title="Nothing yet" body="Every confirmed copilot or manual change is recorded here." />
        ) : (
          <ul className="history-list">
            {[...history].reverse().map((rec) => (
              <li key={rec.id}>
                <div className="history-top">
                  <span className="history-summary">{rec.summary}</span>
                  <span className="muted">{formatDateTime(rec.at)}</span>
                </div>
                <span className={`tag ${rec.source === 'user' ? '' : rec.source === 'copilot-ai' ? 'ai' : 'demo'}`}>{rec.source}</span>
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

function describeOp(op: PlanOp): string {
  switch (op.op) {
    case 'setBudgetTotal':
      return `Set total budget to ${(op.totalMinor / 100).toLocaleString()}`;
    case 'setGuestCount':
      return `Set guest count to ${op.count}`;
    case 'setEventDate':
      return `Move event to ${op.date}`;
    case 'setEventField':
      return `Set ${op.field} to "${op.value}"`;
    case 'setPreference':
      return `Set ${op.field} preference to "${op.value}"`;
    case 'setColors':
      return `Set colours to ${op.value.join(', ')}`;
    case 'setCategoryAllocation':
      return `Allocate ${(op.allocatedMinor / 100).toLocaleString()} to ${op.categoryId}`;
    case 'setCategoryPriority':
      return `Set ${op.categoryId} priority to ${op.priority}`;
    case 'rebalanceBudget':
      return 'Rebalance budget across categories';
    case 'setRequirement':
      return `${op.enabled ? 'Enable' : 'Disable'} ${op.key}`;
    case 'addTask':
      return `Add task "${op.task.title}"`;
    case 'updateTask':
      return `Update task ${op.taskId}`;
    case 'deleteTask':
      return `Delete task ${op.taskId}`;
    case 'setTaskStatus':
      return `Set task ${op.taskId} to ${op.status}`;
    case 'addVendor':
      return `Add vendor "${op.vendor.name}"`;
    case 'updateVendor':
      return `Update vendor ${op.vendorId}`;
    case 'deleteVendor':
      return `Delete vendor ${op.vendorId}`;
    default:
      return 'Unknown operation';
  }
}

function validateOne(raw: unknown): { op: PlanOp } | { error: string } {
  return validateOp(raw);
}
