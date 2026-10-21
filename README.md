# UtsavAI

A GenAI-powered celebration and event planner. UtsavAI turns a short event brief into a
complete, honest plan: a budget that actually adds up, a dated task timeline, a vendor
checklist, personalised ideas, risks with mitigations, and an adaptive copilot you can
talk to in plain language.

It covers weddings, birthdays and community gatherings (plus anniversaries, college
events, festivals and corporate celebrations) and works in two explicit modes:

- **Demo mode** - deterministic, built-in planning rules. Works with zero setup and no
  network access.
- **AI mode** - calls an OpenAI-compatible model for the creative parts, while all
  arithmetic stays deterministic and validated.

The app is deliberately honest: no invented vendors, no fake testimonials or statistics,
and every number is traceable to its source.

## Why it is built this way

**Money is exact.** All amounts are stored as integer minor units (paise/cents). The
budget engine uses a largest-remainder allocation so the sum of every category always
equals the total budget exactly - the contingency reserve is a category, counted once.

**The AI never does arithmetic or executes code.** In AI mode the model supplies
shares, cost estimates, lead times and prose. The client then recomputes every
allocation, due date and total deterministically. Copilot requests must resolve to a
whitelisted, validated operation (`PlanOp`) that is shown to you as a preview and only
applied after you confirm it.

**Dates are driven by offsets.** Each task stores the number of days before the event
(`leadDays`). Moving the event date re-derives every open deadline from that offset;
completed tasks keep their original dates.

## Requirements

- Node.js 20 or newer (developed on Node 24)
- npm (on Windows, the `npm.cmd` shim works even where `npm.ps1` is blocked by
  execution policy)

## Getting started

```bash
npm install
npm run dev
```

`npm run dev` starts both the API server (http://localhost:8787) and the Vite dev
server (http://localhost:5173). Open the Vite URL. The dev server proxies `/api` to the
API server, so the two talk to each other automatically.

Without any AI configuration the app runs in demo mode. To enable real AI mode, copy
`.env.example` to `.env` and set a key:

```bash
cp .env.example .env
# then edit .env: AI_API_KEY=your-key
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Runs the API server and Vite dev server together |
| `npm run build` | Type-checks and builds the client into `dist/` |
| `npm start` / `npm run serve` | Runs the production server (serves `dist/` and the API) |
| `npm run preview` | Vite preview of the built client |
| `npm run typecheck` | TypeScript project build with no emit |
| `npm test` | Runs the test suite once |
| `npm run test:watch` | Runs tests in watch mode |

### Production run

```bash
npm run build
npm start
# open http://localhost:8787
```

The server serves the compiled client and the API from one port.

## Configuration

All configuration is server-side; keys are never exposed to the browser.

| Variable | Purpose | Default |
| --- | --- | --- |
| `AI_API_KEY` or `OPENAI_API_KEY` | Provider API key. Without it, demo mode. | _(none)_ |
| `AI_BASE_URL` | OpenAI-compatible base URL | `https://api.openai.com/v1` |
| `AI_MODEL` | Model name | `gpt-4o-mini` |
| `PORT` | Port for the production server | `8787` |

## The two modes

The header shows the active mode at all times.

- **Demo mode** - The copilot parses your request with built-in rules
  (`src/planner/intent.ts`) into the same validated operations the AI path uses. Every
  reply is labelled as having been produced by built-in rules.
- **AI mode** - `/api/plan` and `/api/copilot` call the configured model. The server
  validates the model's output structurally; the client re-validates it and rebuilds the
  plan deterministically. If a draft fails validation the app falls back to the
  deterministic plan and tells you.

## Project layout

```
src/
  domain/        Types, money, events catalog, validation, budget engine, timeline
  planner/       Deterministic demo planner, copilot operations, intent parser, AI client
  persistence/   Local-storage save/load with validation
  lib/           JSON/CSV/print export
  ui/            Shared UI atoms, formatting helpers, storage hook, plan wizard
  views/         Budget, timeline, vendors, ideas and copilot screens
  App.tsx        Application shell and state wiring
server/          Zero-dependency Node HTTP server and AI provider bridge
tests/           Vitest suite for the domain and planner
scripts/dev.mjs  Dev runner that starts both servers
```

## What a plan contains

- **Overview** - concept, objectives, theme and the assumptions the plan rests on.
- **Budget** - per-category allocations, estimates, actuals, savings ideas and risks.
- **Timeline** - dated tasks grouped around milestones, with overdue/due-soon flags and
  progress tracking. Tasks can be added, edited, completed and deleted.
- **Vendors** - requirements (services, questions to ask, comparison criteria and a
  planning guide figure) plus your own vendor list with quotes and booking status.
- **Ideas** - themes, decoration, catering, entertainment and guest-experience ideas.
- **Risks & actions** - risks with mitigations, plus what to do next and which decisions
  to make.
- **Copilot** - natural-language changes, previewed and confirmed, with a change history.

Plans are saved in your browser's local storage and can be exported as JSON, exported as
CSV checklists (tasks, vendors, budget) or printed.

## Tests

```bash
npm test
```

The suite covers the budget invariants, timeline logic and date shifts, input
validation, the deterministic planner, copilot operation validation and application,
intent parsing and storage round-tripping.

## Privacy

Plan data stays on your device. In AI mode only the event brief and the copilot request
are sent to your configured provider; the API key lives on the server and is never sent
to the browser.
