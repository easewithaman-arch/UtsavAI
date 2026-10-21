/**
 * AI provider integration (server-side only).
 * Provider is isolated behind callLLM(); swap base URL/model via env vars.
 * Every response is structurally validated before it leaves this module.
 */

const CATEGORY_IDS = ['venue', 'catering', 'decoration', 'photography', 'entertainment', 'invitations', 'transportation', 'accommodation', 'misc'];
const TASK_CATEGORIES = ['planning', 'venue', 'catering', 'decoration', 'photography', 'entertainment', 'invitations', 'guests', 'logistics', 'finance'];
const VENDOR_CATEGORIES = ['venue', 'catering', 'photography', 'decoration', 'entertainment', 'transportation', 'accommodation', 'other'];
const PRIORITIES = ['high', 'medium', 'low'];
const EVENT_TYPES = ['wedding', 'birthday', 'anniversary', 'community', 'college', 'festival', 'corporate', 'custom'];

export function getProviderConfig() {
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '';
  const baseUrl = (process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.AI_MODEL || 'gpt-4o-mini';
  return { apiKey, baseUrl, model, configured: apiKey.length > 0 };
}

export function getStatus() {
  const { baseUrl, model, configured } = getProviderConfig();
  let providerHost = 'unknown';
  try {
    providerHost = new URL(baseUrl).host;
  } catch {
    /* keep default */
  }
  return {
    ok: true,
    mode: configured ? 'ai' : 'demo',
    configured,
    model: configured ? model : null,
    provider: configured ? providerHost : null,
  };
}

function fail(code, message, status = 400) {
  return { ok: false, status, error: { code, message } };
}

async function callLLM(system, user, { maxTokens = 4000 } = {}) {
  const { apiKey, baseUrl, model } = getProviderConfig();
  if (!apiKey) {
    const err = new Error('No AI credentials configured.');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error('The AI provider timed out after 90s.');
      err.code = 'PROVIDER_TIMEOUT';
      throw err;
    }
    const err = new Error('Could not reach the AI provider. Check AI_BASE_URL and your network.');
    err.code = 'PROVIDER_UNREACHABLE';
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const err = new Error(`AI provider returned ${response.status}.`);
    err.code = response.status === 401 ? 'PROVIDER_AUTH' : response.status === 429 ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_ERROR';
    err.status = response.status;
    throw err;
  }

  let data;
  try {
    data = await response.json();
  } catch {
    const err = new Error('AI provider returned a non-JSON response.');
    err.code = 'PROVIDER_BAD_RESPONSE';
    throw err;
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    const err = new Error('AI provider returned an empty message.');
    err.code = 'PROVIDER_BAD_RESPONSE';
    throw err;
  }
  return content;
}

function extractJson(text) {
  let cleaned = text.trim();
  const fence = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) cleaned = fence[1];
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function isStr(v, max = 800) {
  return typeof v === 'string' && v.length <= max;
}
function strList(v, maxItems = 12, maxLen = 400) {
  if (!Array.isArray(v)) return null;
  const out = v.filter((x) => isStr(x, maxLen) && x.trim()).slice(0, maxItems).map((x) => x.trim());
  return out;
}
function intAmt(v, max = 1_000_000_000_000) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n >= 0 && n <= max ? n : null;
}

function validatePlanDraft(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['Draft is not an object.'] };

  const overview = raw.overview && typeof raw.overview === 'object' ? raw.overview : null;
  if (!overview || !isStr(overview.concept, 2000)) errors.push('overview.concept missing');

  const budget = raw.budget && typeof raw.budget === 'object' ? raw.budget : null;
  let shares = null;
  if (budget && budget.shares && typeof budget.shares === 'object') {
    shares = {};
    for (const [k, v] of Object.entries(budget.shares)) {
      if (!CATEGORY_IDS.includes(k)) continue;
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100) shares[k] = v;
    }
    if (Object.keys(shares).length === 0) shares = null;
  }

  const estimates = {};
  if (budget && budget.estimatedMinor && typeof budget.estimatedMinor === 'object') {
    for (const [k, v] of Object.entries(budget.estimatedMinor)) {
      if (!CATEGORY_IDS.includes(k)) continue;
      const n = intAmt(v, 100_000_000_000_00);
      if (n !== null) estimates[k] = n;
    }
  }

  const timeline = raw.timeline && typeof raw.timeline === 'object' ? raw.timeline : null;
  let tasks = [];
  if (timeline && Array.isArray(timeline.tasks)) {
    for (const t of timeline.tasks.slice(0, 60)) {
      if (!t || typeof t !== 'object') continue;
      if (!isStr(t.title, 200) || !t.title.trim()) continue;
      const leadDays = typeof t.leadDays === 'number' && Number.isFinite(t.leadDays) ? Math.round(t.leadDays) : null;
      if (leadDays === null || leadDays < -60 || leadDays > 730) continue;
      const priority = PRIORITIES.includes(t.priority) ? t.priority : 'medium';
      const category = TASK_CATEGORIES.includes(t.category) ? t.category : 'planning';
      tasks.push({
        key: isStr(t.key, 40) ? t.key : `t${tasks.length}`,
        title: t.title.trim().slice(0, 200),
        description: isStr(t.description, 1000) ? t.description : '',
        category,
        leadDays,
        priority,
        dependsOn: isStr(t.dependsOn, 40) ? t.dependsOn : undefined,
        estimatedCostMinor: intAmt(t.estimatedCostMinor),
      });
    }
  }

  let vendorRequirements = [];
  if (Array.isArray(raw.vendorRequirements)) {
    for (const v of raw.vendorRequirements.slice(0, 12)) {
      if (!v || typeof v !== 'object') continue;
      if (!VENDOR_CATEGORIES.includes(v.category)) continue;
      const services = strList(v.services, 8, 300);
      const questions = strList(v.questions, 8, 300);
      const criteria = strList(v.comparisonCriteria, 6, 200);
      vendorRequirements.push({
        category: v.category,
        services: services && services.length ? services : [],
        questions: questions && questions.length ? questions : [],
        comparisonCriteria: criteria && criteria.length ? criteria : [],
        bookingPriority: PRIORITIES.includes(v.bookingPriority) ? v.bookingPriority : 'medium',
      });
    }
  }

  const ideas = raw.ideas && typeof raw.ideas === 'object' ? raw.ideas : null;
  const risks = Array.isArray(raw.risks)
    ? raw.risks
        .filter((r) => r && typeof r === 'object' && isStr(r.area, 60) && isStr(r.description, 600) && isStr(r.mitigation, 600))
        .slice(0, 12)
        .map((r) => ({ area: r.area.trim(), description: r.description.trim(), mitigation: r.mitigation.trim() }))
    : [];

  const actions = raw.actions && typeof raw.actions === 'object' ? raw.actions : null;

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
    draft: {
      overview: {
        concept: overview.concept.trim(),
        objectives: strList(overview.objectives, 6, 400) || [],
        theme: isStr(overview.theme, 200) ? overview.theme.trim() : '',
        assumptions: strList(overview.assumptions, 8, 400) || [],
      },
      budget: {
        shares,
        estimates,
        risks: budget ? strList(budget.risks, 8, 500) || [] : [],
        savings: budget ? strList(budget.savings, 8, 500) || [] : [],
      },
      timeline: { tasks },
      vendorRequirements,
      ideas: ideas
        ? {
            themes: strList(ideas.themes, 5, 300) || [],
            decoration: strList(ideas.decoration, 6, 400) || [],
            catering: strList(ideas.catering, 6, 400) || [],
            entertainment: strList(ideas.entertainment, 6, 400) || [],
            guestExperience: strList(ideas.guestExperience, 6, 400) || [],
          }
        : { themes: [], decoration: [], catering: [], entertainment: [], guestExperience: [] },
      risks,
      actions: actions
        ? {
            immediate: strList(actions.immediate, 6, 400) || [],
            upcoming: strList(actions.upcoming, 6, 400) || [],
            decisions: strList(actions.decisions, 6, 400) || [],
          }
        : { immediate: [], upcoming: [], decisions: [] },
    },
  };
}

const PLAN_SYSTEM = `You are UtsavAI, an event planning expert for Indian celebrations (weddings, birthdays, community events, college fests, corporate celebrations).
You convert event details into a structured planning draft as STRICT JSON - no markdown, no commentary outside JSON.

Rules:
- Use ONLY the facts supplied (type, date, location, guest count, budget, currency, setting, preferences, requirements). Never invent vendors, prices from external sources, regulations or religious rules.
- Every price is a rough planning ESTIMATE in the given currency's minor units (e.g. paise for INR, cents for USD), as an integer. Never claim availability or verified quotes.
- Budget arithmetic is NOT your job: give "shares" as relative weights per category (0-100 numbers) and "estimatedMinor" integer estimates; the app allocates exactly.
- Tasks: give leadDays (integer, days BEFORE the event; negative = after). Never give dates.
- The plan must differ meaningfully by budget size, guest count, type, location and setting. If the budget looks insufficient for the guest count, say so plainly in budget.risks and propose concrete scope cuts in budget.savings.
- Acknowledge uncertainty; assumptions go in overview.assumptions.

JSON shape (all keys required, empty arrays allowed):
{"overview":{"concept":"","objectives":[],"theme":"","assumptions":[]},
 "budget":{"shares":{"venue":0,"catering":0,"decoration":0,"photography":0,"entertainment":0,"invitations":0,"transportation":0,"accommodation":0,"misc":0},"estimatedMinor":{"venue":0,"catering":0},"risks":[],"savings":[]},
 "timeline":{"tasks":[{"key":"venue","title":"","description":"","category":"venue","leadDays":90,"priority":"high","dependsOn":""}]},
 "vendorRequirements":[{"category":"venue","services":[],"questions":[],"comparisonCriteria":[],"bookingPriority":"high"}],
 "ideas":{"themes":[],"decoration":[],"catering":[],"entertainment":[],"guestExperience":[]},
 "risks":[{"area":"","description":"","mitigation":""}],
 "actions":{"immediate":[],"upcoming":[],"decisions":[]}}
Only include share keys for categories that apply to this event. dependsOn must reference another task's key or be "".`;

const COPILOT_SYSTEM = `You are the UtsavAI copilot operating on ONE existing event plan.
Convert the user's request into VALIDATED STRUCTURED OPERATIONS as STRICT JSON. You never write code or SQL - only the whitelisted ops below.

Allowed ops:
{"op":"setBudgetTotal","totalMinor":int}
{"op":"setGuestCount","count":int}
{"op":"setEventDate","date":"YYYY-MM-DD"}
{"op":"setEventField","field":"name|location|setting|durationHours","value":stringOrNumber}
{"op":"setPreference","field":"theme|food|cultural|accessibility|special","value":string}  // food: vegetarian|vegan|non-vegetarian|mixed|unspecified
{"op":"setColors","value":[strings]}
{"op":"setCategoryAllocation","categoryId":"venue|catering|decoration|photography|entertainment|invitations|transportation|accommodation|misc","allocatedMinor":int>=0}
{"op":"setCategoryPriority","categoryId":"...same...","priority":"high|medium|low"}
{"op":"rebalanceBudget"}
{"op":"setRequirement","key":"venue|catering|decoration|photography|entertainment|invitations|transportation|accommodation","enabled":bool}
{"op":"addTask","task":{"title":"","description":"","category":"planning|venue|catering|decoration|photography|entertainment|invitations|guests|logistics|finance","dueDate":"YYYY-MM-DD","leadDays":int,"priority":"high|medium|low","status":"todo"}}
{"op":"updateTask","taskId":"...","patch":{"title|description|dueDate|priority|status|category":...}}
{"op":"deleteTask","taskId":"..."}
{"op":"setTaskStatus","taskId":"...","status":"todo|in-progress|done"}
{"op":"addVendor","vendor":{"name":"","category":"venue|catering|photography|decoration|entertainment|transportation|accommodation|other","contact":"","notes":""}}
{"op":"updateVendor","vendorId":"...","patch":{...}}
{"op":"deleteVendor","vendorId":"..."}

Money is in minor units. Never change unrelated fields. Prefer the smallest set of ops that fulfils the request.
If the request is ambiguous or high-consequence (date without a specific day, budget without a number, removing a booked vendor), return "clarify" with one focused question and an empty ops array.
"summary" is one short sentence; "tradeoffs" lists 1-3 honest consequences.
JSON shape: {"ops":[...],"summary":"","tradeoffs":[],"clarify":null}`;

export async function handlePlan(body) {
  const { configured } = getProviderConfig();
  if (!configured) {
    return fail('NOT_CONFIGURED', 'No AI credentials configured. Use demo mode or set AI_API_KEY.', 503);
  }
  const input = body && body.input;
  if (!input || typeof input !== 'object') {
    return fail('BAD_REQUEST', 'Missing "input".');
  }
  if (!EVENT_TYPES.includes(input.type)) {
    return fail('BAD_REQUEST', 'Unknown event type.');
  }

  const user = JSON.stringify({
    event: {
      name: input.name,
      type: input.type,
      date: input.date,
      location: input.location,
      guestCount: input.guestCount,
      setting: input.setting,
      durationHours: input.durationHours,
    },
    budget: {
      totalMinor: input.budget?.totalMinor,
      currency: input.budget?.currency,
      flexibility: input.budget?.flexibility,
      contingencyPct: input.budget?.contingencyPct,
      priorities: input.budget?.priorities,
    },
    preferences: input.preferences,
    planningRequirements: input.requirements,
    today: new Date().toISOString().slice(0, 10),
  });

  try {
    const content = await callLLM(PLAN_SYSTEM, user);
    const parsed = extractJson(content);
    if (!parsed) return fail('INVALID_AI_OUTPUT', 'The model response was not valid JSON. Retry or use demo mode.', 502);
    const validated = validatePlanDraft(parsed);
    if (!validated.ok) {
      return fail('INVALID_AI_OUTPUT', `The model response failed validation: ${validated.errors.slice(0, 4).join('; ')}`, 502);
    }
    return { ok: true, mode: 'ai', draft: validated.draft };
  } catch (err) {
    return mapProviderError(err);
  }
}

const OP_WHITELIST = new Set([
  'setBudgetTotal', 'setGuestCount', 'setEventDate', 'setEventField', 'setPreference', 'setColors',
  'setCategoryAllocation', 'setCategoryPriority', 'rebalanceBudget', 'setRequirement',
  'addTask', 'updateTask', 'deleteTask', 'setTaskStatus',
  'addVendor', 'updateVendor', 'deleteVendor',
]);

export async function handleCopilot(body) {
  const { configured } = getProviderConfig();
  if (!configured) {
    return fail('NOT_CONFIGURED', 'No AI credentials configured. Use demo mode or set AI_API_KEY.', 503);
  }
  const { plan, request } = body || {};
  if (!plan || typeof plan !== 'object') return fail('BAD_REQUEST', 'Missing "plan".');
  if (typeof request !== 'string' || !request.trim() || request.length > 2000) {
    return fail('BAD_REQUEST', 'Request must be a non-empty string under 2000 characters.');
  }

  const snapshot = {
    input: plan.input,
    budget: { categories: plan.budget?.categories, insufficient: plan.budget?.insufficient },
    tasks: (plan.timeline?.tasks || []).map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate, status: t.status, category: t.category })),
    vendorRequirements: (plan.vendorRequirements || []).map((v) => ({ category: v.category, booked: v.booked })),
    vendors: (plan.vendors || []).map((v) => ({ id: v.id, name: v.name, category: v.category, bookingStatus: v.bookingStatus })),
    ideas: { themes: plan.ideas?.themes },
    risks: (plan.risks || []).map((r) => ({ area: r.area })),
    source: plan.source,
  };

  try {
    const content = await callLLM(COPILOT_SYSTEM, `PLAN SNAPSHOT:\n${JSON.stringify(snapshot)}\n\nUSER REQUEST:\n${request.trim()}`);
    const parsed = extractJson(content);
    if (!parsed) return fail('INVALID_AI_OUTPUT', 'The model response was not valid JSON. Retry or use demo mode.', 502);
    const ops = Array.isArray(parsed.ops) ? parsed.ops : null;
    if (!ops || ops.length > 40) return fail('INVALID_AI_OUTPUT', 'Model returned an invalid ops list.', 502);
    if (ops.some((o) => !o || typeof o !== 'object' || typeof o.op !== 'string' || !OP_WHITELIST.has(o.op))) {
      return fail('INVALID_AI_OUTPUT', 'Model attempted an unsupported operation. Nothing was applied.', 502);
    }
    return {
      ok: true,
      mode: 'ai',
      proposal: {
        ops,
        summary: isStr(parsed.summary, 400) ? parsed.summary : 'Plan update',
        tradeoffs: strList(parsed.tradeoffs, 5, 400) || [],
        clarify: isStr(parsed.clarify, 400) ? parsed.clarify : null,
      },
    };
  } catch (err) {
    return mapProviderError(err);
  }
}

function mapProviderError(err) {
  const statusByCode = {
    NOT_CONFIGURED: 503,
    PROVIDER_AUTH: 502,
    PROVIDER_RATE_LIMIT: 429,
    PROVIDER_TIMEOUT: 504,
    PROVIDER_UNREACHABLE: 502,
    PROVIDER_ERROR: 502,
    PROVIDER_BAD_RESPONSE: 502,
  };
  const code = err && err.code ? err.code : 'PROVIDER_ERROR';
  return fail(code, err && err.message ? err.message : 'AI provider failed.', statusByCode[code] || 502);
}
