import { Logo } from '../ui/Logo';

export function AboutView() {
  return (
    <div className="about-view">
      <section className="panel about-hero">
        <div className="about-hero-inner">
          <Logo height={56} />
          <div>
            <h2>About UtsavAI</h2>
            <p className="about-lede">
              A GenAI-powered celebration and event planner that turns a short event brief into a complete, honest plan
              with exact budgets, dated timelines, vendor checklists, ideas, risks with mitigations, and an adaptive
              assistant you can talk to in plain language.
            </p>
          </div>
        </div>
      </section>

      <section className="panel">
        <h3>What it does</h3>
        <p>
          UtsavAI helps you plan weddings, birthdays, anniversaries, community gatherings, college events, festivals
          and corporate celebrations. Every number adds up, every deadline is traceable, and nothing is made up.
        </p>
        <ul className="about-list">
          <li><strong>Budgets that actually add up</strong> — amounts stored as integer minor units with largest-remainder allocation.</li>
          <li><strong>Timelines that stay in sync</strong> — tasks use lead-days offsets; moving the event date re-derives deadlines.</li>
          <li><strong>Pragmatic ideas</strong> — themes, decor, catering, entertainment and guest experience tailored to your brief.</li>
          <li><strong>Vendors &amp; checklists</strong> — clear requirements, questions to ask, and your own vendor list with status.</li>
          <li><strong>Risks &amp; actions</strong> — honest risks with mitigations plus what to do next and decisions to make.</li>
          <li><strong>Save &amp; export</strong> — plans live in your browser, export as JSON/CSV or print.</li>
        </ul>
      </section>

      <section className="panel">
        <h3>AI with guardrails</h3>
        <p>
          UtsavAI uses AI where it helps (ideas, suggestions, natural language changes) but keeps the math deterministic.
        </p>
        <div className="about-grid">
          <article className="about-card">
            <h4>Suggest, don't calculate</h4>
            <p>The AI provides shares, estimates and prose. The app recomputes allocations, totals and dates deterministically.</p>
          </article>
          <article className="about-card">
            <h4>Validate everything</h4>
            <p>All AI outputs are schema-validated on the server and client. If validation fails, it falls back to the built-in planner.</p>
          </article>
          <article className="about-card">
            <h4>Preview before applying</h4>
            <p>Assistant changes go through a whitelisted set of operations, shown as a preview with summary and tradeoffs before you confirm.</p>
          </article>
          <article className="about-card">
            <h4>Works offline</h4>
            <p>Demo mode runs with built-in rules with zero setup and no network. AI mode is optional and keys stay server-side.</p>
          </article>
        </div>
      </section>

      <section className="panel">
        <h3>Tech &amp; privacy</h3>
        <div className="about-grid">
          <article className="about-card">
            <h4>Stack</h4>
            <p>React 18 + TypeScript + Vite 5, Node HTTP server, Vitest. No UI framework, hand-rolled components.</p>
          </article>
          <article className="about-card">
            <h4>Privacy first</h4>
            <p>Plans stay on your device in localStorage. In AI mode only the event brief and copilot request go to your configured provider. API keys never hit the browser.</p>
          </article>
          <article className="about-card">
            <h4>Open approach</h4>
            <p>Clear about modes, honest about estimates, no invented vendors or fake stats.</p>
          </article>
        </div>
      </section>

      <section className="panel about-cta">
        <h3>Learn more</h3>
        <p>See the full README for setup, architecture, and how the AI prompting approach works.</p>
        <div className="about-actions">
          <a className="primary" href="https://github.com/easewithaman-arch/UtsavAI" target="_blank" rel="noreferrer">
            View on GitHub
          </a>
        </div>
      </section>
    </div>
  );
}
