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
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'];
const FLEXIBILITIES = ['strict', 'moderate', 'flexible'];
const SETTINGS = ['indoor', 'outdoor', 'either'];
const FOODS = ['vegetarian', 'vegan', 'non-vegetarian', 'mixed', 'unspecified'];
const REQUIREMENT_KEYS = ['venue', 'catering', 'decoration', 'photography', 'entertainment', 'invitations', 'transportation', 'accommodation'];
const MAX_MINOR = 100_000_000_000_00;

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
    const err = new Error('The AI is not set up on this server.');
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
      const err = new Error('The AI took too long to answer.');
      err.code = 'PROVIDER_TIMEOUT';
      throw err;
    }
    const err = new Error('We could not reach the AI. Please check your connection and try again.');
    err.code = 'PROVIDER_UNREACHABLE';
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const err = new Error(`The AI returned an error (${response.status}).`);
    err.code = response.status === 401 ? 'PROVIDER_AUTH' : response.status === 429 ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_ERROR';
    err.status = response.status;
    throw err;
  }

  let data;
  try {
    data = await response.json();
  } catch {
    const err = new Error('The AI sent back a reply we could not read.');
    err.code = 'PROVIDER_BAD_RESPONSE';
    throw err;
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    const err = new Error('The AI sent back an empty reply.');
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

function boundedString(value, max, { required = false } = {}) {
  if (typeof value !== 'string') return required ? null : '';
  const text = value.trim();
  if (required && !text) return null;
  return text.slice(0, max);
}

function isIsoDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function boundedStringList(value, maxItems, maxLen) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

/**
 * Narrows the untrusted client payload to exactly the fields the model needs.
 * This keeps prompts bounded even though the HTTP body itself may be larger.
 */
function sanitizePlanInput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!EVENT_TYPES.includes(raw.type)) return null;
  const budget = raw.budget && typeof raw.budget === 'object' && !Array.isArray(raw.budget) ? raw.budget : null;
  const preferences = raw.preferences && typeof raw.preferences === 'object' && !Array.isArray(raw.preferences) ? raw.preferences : null;
  const requirements = raw.requirements && typeof raw.requirements === 'object' && !Array.isArray(raw.requirements) ? raw.requirements : {};

  const name = boundedString(raw.name, 80);
  const location = boundedString(raw.location, 120, { required: true });
  if (location === null || !isIsoDay(raw.date)) return null;
  if (!Number.isInteger(raw.guestCount) || raw.guestCount < 1 || raw.guestCount > 100_000) return null;
  if (!SETTINGS.includes(raw.setting)) return null;
  if (typeof raw.durationHours !== 'number' || !Number.isFinite(raw.durationHours) || raw.durationHours < 1 || raw.durationHours > 72) return null;
  if (!budget) return null;
  if (!Number.isSafeInteger(budget.totalMinor) || budget.totalMinor < 100 || budget.totalMinor > MAX_MINOR) return null;
  if (!CURRENCIES.includes(budget.currency)) return null;
  if (!FLEXIBILITIES.includes(budget.flexibility)) return null;
  if (typeof budget.contingencyPct !== 'number' || !Number.isFinite(budget.contingencyPct) || budget.contingencyPct < 0 || budget.contingencyPct > 30) return null;

  const priorities = {};
  if (budget.priorities && typeof budget.priorities === 'object' && !Array.isArray(budget.priorities)) {
    for (const [key, value] of Object.entries(budget.priorities)) {
      if (CATEGORY_IDS.includes(key) && PRIORITIES.includes(value)) priorities[key] = value;
    }
  }

  const safePreferences = {
    theme: boundedString(preferences?.theme, 200),
    colors: boundedStringList(preferences?.colors, 8, 40),
    food: FOODS.includes(preferences?.food) ? preferences.food : 'unspecified',
    cultural: boundedString(preferences?.cultural, 400),
    accessibility: boundedString(preferences?.accessibility, 400),
    special: boundedString(preferences?.special, 400),
  };

  const safeRequirements = {};
  for (const key of REQUIREMENT_KEYS) safeRequirements[key] = requirements[key] === true;

  return {
    event: {
      name,
      type: raw.type,
      date: raw.date,
      location,
      guestCount: raw.guestCount,
      setting: raw.setting,
      durationHours: Math.round(raw.durationHours),
    },
    budget: {
      totalMinor: budget.totalMinor,
      currency: budget.currency,
      flexibility: budget.flexibility,
      contingencyPct: budget.contingencyPct,
      priorities,
    },
    preferences: safePreferences,
    planningRequirements: safeRequirements,
  };
}

function projectPlanForPrompt(raw) {
  const plan = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const input = plan.input && typeof plan.input === 'object' ? plan.input : {};
  const budget = plan.budget && typeof plan.budget === 'object' ? plan.budget : {};
  const timeline = plan.timeline && typeof plan.timeline === 'object' ? plan.timeline : {};
  const categories = Array.isArray(budget.categories) ? budget.categories.slice(0, 20) : [];
  const tasks = Array.isArray(timeline.tasks) ? timeline.tasks.slice(0, 100) : [];
  const vendors = Array.isArray(plan.vendors) ? plan.vendors.slice(0, 100) : [];
  const vendorRequirements = Array.isArray(plan.vendorRequirements) ? plan.vendorRequirements.slice(0, 30) : [];
  const risks = Array.isArray(plan.risks) ? plan.risks.slice(0, 30) : [];
  return {
    input: {
      name: boundedString(input.name, 80),
      type: EVENT_TYPES.includes(input.type) ? input.type : 'custom',
      date: isIsoDay(input.date) ? input.date : '',
      location: boundedString(input.location, 120),
      guestCount: Number.isInteger(input.guestCount) ? Math.max(0, Math.min(100_000, input.guestCount)) : 0,
      setting: SETTINGS.includes(input.setting) ? input.setting : 'either',
      durationHours: typeof input.durationHours === 'number' ? input.durationHours : 0,
      budget: {
        totalMinor: Number.isSafeInteger(input.budget?.totalMinor) ? input.budget.totalMinor : 0,
        currency: CURRENCIES.includes(input.budget?.currency) ? input.budget.currency : 'INR',
      },
      preferences: {
        theme: boundedString(input.preferences?.theme, 200),
        food: FOODS.includes(input.preferences?.food) ? input.preferences.food : 'unspecified',
        accessibility: boundedString(input.preferences?.accessibility, 400),
      },
    },
    budget: {
      categories: categories.map((c) => ({
        id: boundedString(c?.id, 30),
        allocatedMinor: Number.isSafeInteger(c?.allocatedMinor) ? c.allocatedMinor : 0,
        estimatedMinor: Number.isSafeInteger(c?.estimatedMinor) ? c.estimatedMinor : 0,
        priority: PRIORITIES.includes(c?.priority) ? c.priority : 'medium',
        isContingency: c?.isContingency === true,
      })),
      insufficient: budget.insufficient === true,
    },
    tasks: tasks.map((t) => ({
      id: boundedString(t?.id, 80),
      title: boundedString(t?.title, 200),
      dueDate: isIsoDay(t?.dueDate) ? t.dueDate : '',
      status: ['todo', 'in-progress', 'done'].includes(t?.status) ? t.status : 'todo',
      category: TASK_CATEGORIES.includes(t?.category) ? t.category : 'planning',
    })),
    vendorRequirements: vendorRequirements.map((v) => ({
      category: VENDOR_CATEGORIES.includes(v?.category) ? v.category : 'other',
      booked: v?.booked === true,
    })),
    vendors: vendors.map((v) => ({
      id: boundedString(v?.id, 80),
      name: boundedString(v?.name, 120),
      category: VENDOR_CATEGORIES.includes(v?.category) ? v.category : 'other',
      bookingStatus: typeof v?.bookingStatus === 'string' ? v.bookingStatus.slice(0, 30) : 'not-contacted',
    })),
    ideas: { themes: boundedStringList(plan.ideas?.themes, 8, 300) },
    risks: risks.map((r) => ({ area: boundedString(r?.area, 60) })),
    source: plan.source === 'ai' ? 'ai' : 'demo',
  };
}

export async function handlePlan(body) {
  const { configured } = getProviderConfig();
  if (!configured) {
    return fail('NOT_CONFIGURED', 'The AI is not set up on this server, so we used our built-in rules instead.', 503);
  }
  const input = sanitizePlanInput(body && body.input);
  if (!input) {
    return fail('BAD_REQUEST', 'Some event details are missing or out of range. Please check the form and try again.');
  }

  const user = JSON.stringify({
    event: input.event,
    budget: input.budget,
    preferences: input.preferences,
    planningRequirements: input.planningRequirements,
    today: new Date().toISOString().slice(0, 10),
  });

  try {
    const content = await callLLM(PLAN_SYSTEM, user);
    const parsed = extractJson(content);
    if (!parsed) return fail('INVALID_AI_OUTPUT', 'The AI sent back something we could not read. Please try again.', 502);
    const validated = validatePlanDraft(parsed);
    if (!validated.ok) {
      return fail('INVALID_AI_OUTPUT', 'The AI sent back a plan we could not use. Please try again.', 502);
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
    return fail('NOT_CONFIGURED', 'The AI is not set up on this server, so we used our built-in rules instead.', 503);
  }
  const { plan, request } = body || {};
  if (!plan || typeof plan !== 'object') return fail('BAD_REQUEST', 'We did not receive the plan.');
  if (typeof request !== 'string' || !request.trim() || request.length > 2000) {
    return fail('BAD_REQUEST', 'Please type what you would like to change.');
  }

  const snapshot = projectPlanForPrompt(plan);

  try {
    const content = await callLLM(COPILOT_SYSTEM, `PLAN SNAPSHOT:\n${JSON.stringify(snapshot)}\n\nUSER REQUEST:\n${request.trim()}`);
    const parsed = extractJson(content);
    if (!parsed) return fail('INVALID_AI_OUTPUT', 'The AI sent back something we could not read. Please try again.', 502);
    const ops = Array.isArray(parsed.ops) ? parsed.ops : null;
    if (!ops || ops.length > 40) return fail('INVALID_AI_OUTPUT', 'The AI sent back a list of changes we could not read. Please try again.', 502);
    if (ops.some((o) => !o || typeof o !== 'object' || typeof o.op !== 'string' || !OP_WHITELIST.has(o.op))) {
      return fail('INVALID_AI_OUTPUT', 'The AI asked for a change we cannot make, so nothing was applied.', 502);
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
  return fail(code, err && err.message ? err.message : 'The AI could not answer just now.', statusByCode[code] || 502);
}
