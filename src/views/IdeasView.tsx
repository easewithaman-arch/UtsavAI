import type { EventPlan } from '../domain/types';
import { EmptyState, RiskList } from '../ui/atoms';

const IDEA_LABELS: { key: keyof EventPlan['ideas']; title: string; blurb: string }[] = [
  { key: 'themes', title: 'Themes', blurb: 'Directions that fit your type, budget and setting.' },
  { key: 'decoration', title: 'Decoration', blurb: 'Practical decoration moves at your price point.' },
  { key: 'catering', title: 'Catering', blurb: 'Menu and service ideas matched to your food preference.' },
  { key: 'entertainment', title: 'Entertainment', blurb: 'Ways to keep the room engaged.' },
  { key: 'guestExperience', title: 'Guest experience', blurb: 'Details guests actually notice.' },
];

export function IdeasView({ plan }: { plan: EventPlan }) {
  return (
    <div className="ideas-view">
      <section className="panel overview-panel">
        <h3>Concept</h3>
        <p className="concept">{plan.overview.concept}</p>
        <p className="muted">Theme: {plan.overview.theme || '—'}</p>
        <div className="two-col">
          <div>
            <h4>Objectives</h4>
            <ul className="plain-list">
              {plan.overview.objectives.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4>Assumptions</h4>
            <ul className="plain-list">
              {plan.overview.assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <div className="idea-grid">
        {IDEA_LABELS.map(({ key, title, blurb }) => {
          const items = plan.ideas[key];
          return (
            <section key={key} className="panel idea-panel">
              <h3>{title}</h3>
              <p className="muted">{blurb}</p>
              {items.length === 0 ? (
                <EmptyState title="No ideas yet" body="Generate a plan to fill this section." />
              ) : (
                <ul className="plain-list">
                  {items.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <section className="panel">
        <h3>Risks &amp; mitigations</h3>
        <div className="risk-cards">
          {plan.risks.map((r) => (
            <article key={r.id} className="risk-card">
              <span className="risk-area">{r.area}</span>
              <p className="risk-desc">{r.description}</p>
              <p className="risk-mit">
                <strong>Mitigation:</strong> {r.mitigation}
              </p>
            </article>
          ))}
        </div>
      </section>

      <div className="panel-grid">
        <div className="panel">
          <h3>Do next</h3>
          <RiskList items={plan.actions.immediate} tone="warn" />
        </div>
        <div className="panel">
          <h3>On the horizon</h3>
          <RiskList items={plan.actions.upcoming} tone="save" />
        </div>
        <div className="panel">
          <h3>Decisions to make</h3>
          <RiskList items={plan.actions.decisions} tone="risk" />
        </div>
      </div>
    </div>
  );
}
