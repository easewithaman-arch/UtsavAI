import { useEffect, useMemo, useState } from 'react';
import type { ChangeRecord, EventInput, EventPlan, PlanTask, Vendor } from './domain/types';
import { generateDemoPlan } from './planner/demo';
import { applyPlanOps, makeChangeRecord, type ApplyResult, type PlanOp } from './planner/ops';
import { buildPlanFromDraft, fetchStatus, requestAiPlan } from './planner/ai';
import { validatePlanShape } from './domain/validate';
import { exportChecklistCsv, exportPlanJson, printPlan } from './lib/export';
import { restorePlan } from './persistence/storage';
import { useDomain } from './ui/useDomain';
import { Wizard } from './ui/Wizard';
import { BudgetView } from './views/BudgetView';
import { TimelineView } from './views/TimelineView';
import { VendorsView } from './views/VendorsView';
import { IdeasView } from './views/IdeasView';
import { CopilotView, type CopilotMode } from './views/CopilotView';
import { AboutView } from './views/AboutView';
import { Segmented } from './ui/atoms';
import { Logo, LogoMark, LogoWordmark } from './ui/Logo';
import { formatDate, money, titleCase } from './ui/format';
import { PLAN_SOURCE_LABELS } from './domain/labels';
import { EVENT_TYPE_MAP } from './domain/events';

type Tab = 'plan' | 'budget' | 'timeline' | 'vendors' | 'copilot';

export default function App() {
  const domain = useDomain();
  const { current } = domain;
  const [mode, setMode] = useState<CopilotMode>({ mode: 'demo', model: null, provider: null });
  const [tab, setTab] = useState<Tab>('plan');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<ChangeRecord[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const [view, setView] = useState<'app' | 'about'>('app');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchStatus().then((status) => {
      if (!alive || !status) return;
      setMode({ mode: status.mode, model: status.model, provider: status.provider });
    });
    return () => {
      alive = false;
    };
  }, []);

  const generate = async (input: EventInput) => {
    setBusy(true);
    setNotice(null);

    let plan: EventPlan;
    if (mode.mode === 'ai') {
      const result = await requestAiPlan(input);
      if (result.ok) {
        try {
          const merged = buildPlanFromDraft(input, result.draft);
          plan = validatePlanShape(merged).ok ? merged : generateDemoPlan(input);
          if (plan !== merged) setNotice('The AI could not finish the plan, so we used our built-in template instead.');
        } catch {
          plan = generateDemoPlan(input);
          setNotice('The AI could not finish the plan, so we used our built-in template instead.');
        }
      } else {
        plan = generateDemoPlan(input);
        setNotice(`${result.error.message} We used our built-in template instead.`);
      }
    } else {
      plan = generateDemoPlan(input);
    }

    const saved = domain.savePlan(plan);
    setHistory([makeChangeRecord(`Created plan "${saved.input.name || 'Untitled event'}"`, [saved.overview.concept], 'user')]);
    setCreating(false);
    setView('app');
    setTab('plan');
    setBusy(false);
  };

  const applyOps = (ops: PlanOp[]): ApplyResult => {
    if (!current) throw new Error('Select a plan before applying changes.');
    const result = applyPlanOps(current, ops);
    const id = result.plan.id || current.id;
    const saved = domain.savePlan({ ...result.plan, id });
    setHistory((prev) => [
      ...prev,
      makeChangeRecord(result.changes.join('; ') || 'Assistant change', result.warnings, mode.mode === 'ai' ? 'copilot-ai' : 'copilot-demo'),
    ]);
    return { ...result, plan: saved };
  };

  const mutatePlan = (patch: (plan: EventPlan) => EventPlan) => {
    if (!current) return;
    domain.savePlan(patch(current));
  };

  const onTasks = (tasks: PlanTask[], milestones: EventPlan['timeline']['milestones']) => {
    mutatePlan((plan) => ({ ...plan, timeline: { tasks, milestones } }));
  };

  const onVendors = (vendors: Vendor[]) => {
    mutatePlan((plan) => ({ ...plan, vendors }));
  };

  const onAllocations = (categories: EventPlan['budget']['categories']) => {
    mutatePlan((plan) => ({ ...plan, budget: { ...plan.budget, categories } }));
  };

  const onActuals = (categories: EventPlan['budget']['categories']) => {
    mutatePlan((plan) => ({ ...plan, budget: { ...plan.budget, categories } }));
  };

  const importFromFile = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      setNotice('That file is too large. UtsavAI plan files are normally well under 5 MB.');
      return;
    }
    const text = await file.text();
    const plan = restorePlan(text);
    if (!plan) {
      setNotice('We could not open that file. Make sure it is a plan file you downloaded from UtsavAI.');
      return;
    }
    domain.importPlan(plan);
    setHistory([]);
    setCreating(false);
    setTab('plan');
    setView('app');
  };

  const openPlan = (id: string) => {
    domain.selectPlan(id);
    setHistory([]);
    setCreating(false);
    setShowLibrary(false);
    setTab('plan');
    setView('app');
  };

  const meta = useMemo(() => (current ? EVENT_TYPE_MAP[current.input.type] : null), [current]);

  if (!domain.snapshot.loaded) {
    return (
      <div className="app loading">
        <Logo className="loading-logo" height={44} />
        <p>Loading UtsavAI...</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <button
          type="button"
          className="brand"
          aria-label="UtsavAI home"
          onClick={() => { setShowLibrary(false); setCreating(false); setView('app'); }}
        >
          <LogoMark className="brand-mark" size={38} />
          <span className="brand-text">
            <LogoWordmark className="brand-wordmark" height={30} />
            <span className="brand-sub">Celebration &amp; event planner</span>
          </span>
        </button>
        <div className="header-right">
          <button type="button" className="ghost" onClick={() => { setView('about'); setShowLibrary(false); }}>About</button>
          <span className={`mode-badge ${mode.mode}`} title={mode.model ?? undefined}>
            {mode.mode === 'ai' ? 'AI mode' : 'Built-in mode'}
          </span>
          <button
            type="button"
            className="ghost"
            aria-expanded={showLibrary}
            aria-controls="saved-plans"
            onClick={() => setShowLibrary((v) => !v)}
          >
            My plans ({domain.snapshot.plans.length})
          </button>
        </div>
      </header>

      {showLibrary ? (
        <aside className="library" id="saved-plans" aria-label="Saved plans">
          <h3>Saved plans</h3>
          {domain.snapshot.plans.length === 0 ? (
            <p className="muted">No plans yet. Generate one from a worked example or build your own.</p>
          ) : (
            <ul className="library-list">
              {domain.snapshot.plans.map((p) => (
                <li key={p.id} className={p.id === current?.id ? 'active' : ''}>
                  <button
                    type="button"
                    className="library-item"
                    onClick={() => openPlan(p.id)}
                  >
                    <span className="library-name">{p.input.name || 'Untitled event'}</span>
                    <span className="muted">
                      {titleCase(p.input.type)} · {formatDate(p.input.date)} · {PLAN_SOURCE_LABELS[p.source]}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    onClick={() => domain.removePlan(p.id)}
                    aria-label={`Delete ${p.input.name || 'plan'}`}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="library-actions">
            <label className="ghost file-label">
              Upload a plan file
              <input
                type="file"
                accept="application/json,.json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) importFromFile(file);
                  e.target.value = '';
                }}
              />
            </label>
            <p className="muted">Bring back a plan you downloaded earlier, or move one from another device.</p>
          </div>
        </aside>
      ) : null}

      {notice ? (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button type="button" className="icon-btn" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {domain.snapshot.skipped > 0 ? (
        <div className="notice warn" role="status">
          {domain.snapshot.skipped} saved plan(s) could not be opened and were skipped.
        </div>
      ) : null}

      {domain.snapshot.saveError ? (
        <div className="notice warn" role="alert">
          {domain.snapshot.saveError}
        </div>
      ) : null}

      {view === 'about' ? (
        <main className="main">
          <AboutView />
        </main>
      ) : creating || !current ? (
        <main className="main">
          <Wizard onGenerate={generate} busy={busy} />
        </main>
      ) : (
        <main className="main">
          <div className="plan-bar">
            <div className="plan-heading">
              <h1 className="plan-title">{current.input.name || 'Untitled event'}</h1>
              <p className="plan-meta">
                {meta?.label} · {formatDate(current.input.date)} · {current.input.guestCount} guests ·{' '}
                {money(current.input.budget.totalMinor, current.input.budget.currency)} ·{' '}
                <span className={`tag ${current.source}`}>{current.source === 'ai' ? 'AI-assisted' : 'Built-in plan'}</span>
              </p>
            </div>
            <div className="plan-tools">
              <span className="save-state">Saved on this device</span>
              <button type="button" className="ghost" onClick={() => exportPlanJson(current)} title="Download a copy of the whole plan so you can keep it or move it to another device">
                Download plan
              </button>
              <button type="button" className="ghost" onClick={() => exportChecklistCsv(current, 'tasks')} title="Download the task list as a spreadsheet you can open in Excel, Google Sheets or Numbers">
                Download task list
              </button>
              <button type="button" className="ghost" onClick={() => printPlan()}>
                Print
              </button>
              <button type="button" className="ghost" onClick={() => { setCreating(true); setShowLibrary(false); setView('app'); }}>
                New plan
              </button>
            </div>
          </div>

          <nav className="tabs">
            <Segmented
              label="Plan sections"
              options={[
                { value: 'plan', label: 'Overview' },
                { value: 'budget', label: 'Budget' },
                { value: 'timeline', label: 'Timeline' },
                { value: 'vendors', label: 'Vendors' },
                { value: 'copilot', label: 'Assistant' },
              ]}
              value={tab}
              onChange={setTab}
            />
          </nav>

          <div className="view-container">
            {tab === 'plan' ? <IdeasView plan={current} /> : null}
            {tab === 'budget' ? <BudgetView plan={current} onAllocations={onAllocations} onActuals={onActuals} /> : null}
            {tab === 'timeline' ? <TimelineView plan={current} onTasks={onTasks} /> : null}
            {tab === 'vendors' ? <VendorsView plan={current} onVendors={onVendors} /> : null}
            {tab === 'copilot' ? <CopilotView plan={current} mode={mode} history={history} onApply={applyOps} /> : null}
          </div>
        </main>
      )}

      <footer className="app-footer">
        <div>
          <span>UtsavAI · your plans stay on this device</span>
        </div>
        <button type="button" className="linklike" onClick={() => setView('about')}>
          About
        </button>
      </footer>
    </div>
  );
}
