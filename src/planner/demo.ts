import type {
  ActionSection,
  BudgetCategory,
  CategoryId,
  EventInput,
  EventPlan,
  IdeasSection,
  Priority,
  RequirementKey,
  RiskItem,
  VendorRequirement,
} from '../domain/types';
import { EVENT_TYPE_MAP, CATEGORY_NAMES, cityFactorInr, newId } from '../domain/events';
import { allocateBudget, budgetTotals, contingencyMinor, type AllocationEntry } from '../domain/budget';
import { generateTasks } from '../domain/timeline';
import { CURRENCY_TO_INR } from '../domain/money';
import { daysBetween, todayIso } from '../domain/validate';

/**
 * Deterministic, input-sensitive planning logic for demo mode.
 * All figures are rough planning estimates derived from the user's own inputs.
 * They are NOT quotes, and nothing here implies vendor availability.
 */

interface TypeCost {
  cateringPerHead: number;
  venueFlat: number;
  venuePerHead: number;
  decorFlat: number;
  decorPerHead: number;
  photoFlat: number;
  entertainmentFlat: number;
  invitePerHead: number;
  transportPerHead: number;
}

/** All values are approximate INR planning baselines. */
const TYPE_COSTS: Record<string, TypeCost> = {
  wedding: { cateringPerHead: 950, venueFlat: 65000, venuePerHead: 250, decorFlat: 55000, decorPerHead: 120, photoFlat: 45000, entertainmentFlat: 40000, invitePerHead: 30, transportPerHead: 60 },
  birthday: { cateringPerHead: 450, venueFlat: 12000, venuePerHead: 70, decorFlat: 8000, decorPerHead: 60, photoFlat: 7000, entertainmentFlat: 9000, invitePerHead: 20, transportPerHead: 40 },
  anniversary: { cateringPerHead: 650, venueFlat: 20000, venuePerHead: 120, decorFlat: 14000, decorPerHead: 80, photoFlat: 15000, entertainmentFlat: 12000, invitePerHead: 20, transportPerHead: 40 },
  community: { cateringPerHead: 320, venueFlat: 25000, venuePerHead: 90, decorFlat: 20000, decorPerHead: 50, photoFlat: 8000, entertainmentFlat: 25000, invitePerHead: 15, transportPerHead: 35 },
  college: { cateringPerHead: 260, venueFlat: 20000, venuePerHead: 60, decorFlat: 15000, decorPerHead: 40, photoFlat: 7000, entertainmentFlat: 35000, invitePerHead: 10, transportPerHead: 30 },
  festival: { cateringPerHead: 300, venueFlat: 22000, venuePerHead: 70, decorFlat: 35000, decorPerHead: 60, photoFlat: 6000, entertainmentFlat: 30000, invitePerHead: 10, transportPerHead: 30 },
  corporate: { cateringPerHead: 850, venueFlat: 50000, venuePerHead: 220, decorFlat: 25000, decorPerHead: 90, photoFlat: 15000, entertainmentFlat: 30000, invitePerHead: 25, transportPerHead: 55 },
  custom: { cateringPerHead: 500, venueFlat: 25000, venuePerHead: 120, decorFlat: 18000, decorPerHead: 70, photoFlat: 12000, entertainmentFlat: 15000, invitePerHead: 20, transportPerHead: 45 },
};

const BASE_SHARES: Record<string, Partial<Record<CategoryId, number>>> = {
  wedding: { venue: 1.0, catering: 1.8, decoration: 1.0, photography: 0.7, entertainment: 0.7, invitations: 0.15, transportation: 0.3, accommodation: 0.5, misc: 0.35 },
  birthday: { venue: 0.9, catering: 1.5, decoration: 0.8, photography: 0.25, entertainment: 0.6, invitations: 0.1, transportation: 0.15, misc: 0.3 },
  anniversary: { venue: 1.0, catering: 1.5, decoration: 0.7, photography: 0.5, entertainment: 0.3, invitations: 0.1, misc: 0.3 },
  community: { venue: 1.2, catering: 1.5, decoration: 0.5, entertainment: 0.7, invitations: 0.2, transportation: 0.3, misc: 0.4 },
  college: { venue: 1.0, catering: 1.2, decoration: 0.4, photography: 0.3, entertainment: 1.2, invitations: 0.2, transportation: 0.2, misc: 0.4 },
  festival: { venue: 1.0, catering: 1.4, decoration: 1.2, entertainment: 1.2, invitations: 0.1, transportation: 0.2, misc: 0.4 },
  corporate: { venue: 1.2, catering: 1.5, decoration: 0.5, photography: 0.3, entertainment: 0.5, invitations: 0.15, transportation: 0.25, accommodation: 0.4, misc: 0.3 },
  custom: { venue: 1.0, catering: 1.4, decoration: 0.7, photography: 0.4, entertainment: 0.6, invitations: 0.15, transportation: 0.25, misc: 0.4 },
};

const PRIORITY_MULT: Record<Priority, number> = { high: 1.5, medium: 1, low: 0.7 };

function inrMajorToMinor(inrMajor: number, currency: EventInput['budget']['currency']): number {
  if (currency === 'INR') return Math.round(inrMajor * 100);
  const converted = (inrMajor * 100) / CURRENCY_TO_INR[currency];
  return Math.round(converted);
}

export function estimateCategoryCosts(input: EventInput): Record<CategoryId, number> {
  const costs = TYPE_COSTS[input.type] ?? TYPE_COSTS.custom;
  const guests = Math.max(1, input.guestCount);
  const city = cityFactorInr(input.location);
  const reqs = input.requirements;

  const veg = input.preferences.food === 'vegetarian' || input.preferences.food === 'vegan';
  const nonVeg = input.preferences.food === 'non-vegetarian';
  let cateringPerHead = costs.cateringPerHead;
  if (veg) cateringPerHead *= 0.88;
  if (nonVeg) cateringPerHead *= 1.05;
  if (guests >= 250) cateringPerHead *= 0.9;
  else if (guests <= 25) cateringPerHead *= 1.15;

  const durationFactor = Math.min(2, Math.max(0.5, input.durationHours / 4));
  let venue = costs.venueFlat * Math.min(1.6, durationFactor) + costs.venuePerHead * guests;
  venue *= city;
  if (input.setting === 'outdoor') venue *= 1.1;

  let decor = costs.decorFlat + costs.decorPerHead * guests;
  decor *= city;
  if (input.setting === 'outdoor') decor *= 1.2;

  let accommodation = 0;
  if (reqs.accommodation) {
    const rooms = Math.ceil(guests * 0.2);
    accommodation = rooms * 2400 * city;
  }

  const sum = {
    venue,
    catering: cateringPerHead * guests,
    decoration: decor,
    photography: reqs.photography ? costs.photoFlat * city + (costs.photoFlat > 30000 ? guests * 40 : 0) : 0,
    entertainment: reqs.entertainment ? costs.entertainmentFlat * (input.setting === 'outdoor' ? 1.15 : 1) : 0,
    invitations: reqs.invitations ? costs.invitePerHead * guests + 1500 : 0,
    transportation: reqs.transportation ? costs.transportPerHead * guests : 0,
    accommodation,
  } as const;

  const coreTotal = Object.values(sum).reduce((a, b) => a + b, 0);
  const misc = reqs.photography || reqs.transportation || reqs.accommodation ? coreTotal * 0.06 : coreTotal * 0.05;

  const out = {} as Record<CategoryId, number>;
  (Object.keys(sum) as CategoryId[]).forEach((k) => {
    out[k] = inrMajorToMinor(sum[k as keyof typeof sum], input.budget.currency);
  });
  out.misc = inrMajorToMinor(misc, input.budget.currency);
  out.contingency = contingencyMinor(input.budget.totalMinor, input.budget.contingencyPct);

  // Budget anchoring: when raw planning costs exceed what is actually available,
  // scale the discretionary categories down to fit (catering is protected as the
  // guest-facing floor). If even the floor exceeds the budget, the plan is
  // flagged insufficient rather than quietly pretending the money exists.
  const availableMinor = input.budget.totalMinor - out.contingency;
  const othersIds = (Object.keys(out) as CategoryId[]).filter((k) => k !== 'contingency' && k !== 'catering');
  const othersSum = othersIds.reduce((s, k) => s + out[k], 0);
  const totalBefore = out.catering + othersSum;
  if (totalBefore > availableMinor && othersSum > 0) {
    const room = Math.max(0, Math.floor(availableMinor * 0.98) - out.catering);
    const factor = Math.max(0.05, room / othersSum);
    for (const k of othersIds) {
      out[k] = Math.round(out[k] * factor);
    }
  }
  return out;
}

export function buildAllocationEntries(input: EventInput): AllocationEntry[] {
  const info = EVENT_TYPE_MAP[input.type];
  const base = BASE_SHARES[input.type] ?? BASE_SHARES.custom;
  const guests = input.guestCount;
  const metro = cityFactorInr(input.location) > 1;
  const veg = input.preferences.food === 'vegetarian' || input.preferences.food === 'vegan';

  const entries: AllocationEntry[] = [];
  for (const categoryId of info.categories) {
    if (!isEnabledFor(input, categoryId)) continue;
    let share = base[categoryId] ?? 0.5;
    const priority = input.budget.priorities[categoryId] ?? 'medium';
    share *= PRIORITY_MULT[priority];
    if (categoryId === 'catering') {
      if (guests >= 200) share *= 1.25;
      if (guests <= 25) share *= 0.9;
      if (veg) share *= 0.9;
    }
    if ((categoryId === 'venue' || categoryId === 'decoration') && metro) share *= 1.15;
    if ((categoryId === 'venue' || categoryId === 'decoration') && input.setting === 'outdoor') share *= 1.1;
    if (categoryId === 'entertainment' && (input.type === 'college' || input.type === 'birthday')) share *= 1.2;
    entries.push({ id: categoryId, priority, share: Math.max(0.01, share) });
  }
  return entries;
}

function isEnabledFor(input: EventInput, categoryId: CategoryId): boolean {
  const map: Partial<Record<CategoryId, RequirementKey>> = {
    venue: 'venue',
    catering: 'catering',
    decoration: 'decoration',
    photography: 'photography',
    entertainment: 'entertainment',
    invitations: 'invitations',
    transportation: 'transportation',
    accommodation: 'accommodation',
  };
  const key = map[categoryId];
  if (!key) return true;
  return Boolean(input.requirements[key]);
}

export function buildBudgetCategories(input: EventInput): BudgetCategory[] {
  const entries = buildAllocationEntries(input);
  const { categories } = allocateBudget(input.budget.totalMinor, entries, input.budget.contingencyPct);
  const estimates = estimateCategoryCosts(input);
  const info = EVENT_TYPE_MAP[input.type];
  const out: BudgetCategory[] = categories.map((c) =>
    c.isContingency ? { ...c, estimatedMinor: 0 } : { ...c, estimatedMinor: estimates[c.id] ?? 0 },
  );
  for (const categoryId of info.categories) {
    if (out.some((c) => c.id === categoryId)) continue;
    out.push({
      id: categoryId,
      name: CATEGORY_NAMES[categoryId],
      allocatedMinor: 0,
      estimatedMinor: 0,
      actualMinor: 0,
      priority: input.budget.priorities[categoryId] ?? 'medium',
      isContingency: false,
      manual: false,
    });
  }
  return out;
}

const THEME_SUGGESTIONS: Record<string, string[]> = {
  wedding: ['Marigold & ivory garden ceremony', 'Royal palace evening with deep plum and gold', 'Minimal daytime vows with pastel florals'],
  birthday: ['Playful colour-block party', 'Cozy candle-lit dinner', 'Adventure and hobby themed celebration'],
  anniversary: ['Classic black-tile elegance', 'Memory wall and photo journey', 'Garden brunch under string lights'],
  community: ['Regional folk and food festival', 'Open-air cultural evening', 'Heritage and crafts mela'],
  college: ['Neon retro fest night', 'Daytime campus carnival', 'Formal awards and showcase evening'],
  festival: ['Traditional lamps and rangoli', 'Floral canopy celebration', 'Folk-performance night'],
  corporate: ['Understated brand-neutral elegance', 'Awards night with stage reveal', 'Daytime offsite with breakout zones'],
  custom: ['Warm minimalist gathering', 'Bold and colourful social evening', 'Elegant formal reception'],
};

function pick<T>(list: T[], seed: number, count: number): T[] {
  if (list.length <= count) return [...list];
  const out: T[] = [];
  const start = Math.abs(seed) % list.length;
  for (let i = 0; i < count; i++) out.push(list[(start + i) % list.length]);
  return out;
}

function hashInput(input: EventInput): number {
  const s = `${input.type}|${input.guestCount}|${input.budget.totalMinor}|${input.location}|${input.date}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function budgetLevel(input: EventInput): 'tight' | 'comfortable' | 'premium' {
  const info = EVENT_TYPE_MAP[input.type];
  const perGuestInr = Math.round(
    (input.budget.totalMinor / Math.max(1, input.guestCount)) / 100 * CURRENCY_TO_INR[input.budget.currency],
  );
  if (perGuestInr < info.minPerGuestInr) return 'tight';
  if (perGuestInr > info.minPerGuestInr * 3) return 'premium';
  return 'comfortable';
}

export function generateDemoPlan(input: EventInput): EventPlan {
  const now = new Date().toISOString();
  const categories = buildBudgetCategories(input);
  const totals = budgetTotals(categories, input.budget.totalMinor);
  const daysOut = daysBetween(todayIso(), input.date);
  const level = budgetLevel(input);
  const info = EVENT_TYPE_MAP[input.type];
  const theme = input.preferences.theme.trim() || pick(THEME_SUGGESTIONS[input.type] ?? THEME_SUGGESTIONS.custom, hashInput(input), 1)[0];
  const city = input.location.trim() || 'your city';

  const overview = {
    concept: `${input.name} is a ${info.label.toLowerCase()} for ${input.guestCount} guests in ${city} on ${input.date}, run as ${input.setting === 'either' ? 'an indoor or outdoor gathering' : `an ${input.setting} event`} over ${input.durationHours} hours. The plan centres on "${theme}" and is built around a ${level} ${input.budget.currency} budget of ${Math.round(input.budget.totalMinor / 100)} (approximate, user-provided).`,
    objectives: [
      `Deliver the celebration within the stated ${input.budget.currency} budget while keeping a ${input.budget.contingencyPct}% contingency reserve.`,
      `Give roughly ${input.guestCount} guests a smooth experience: clear invitations, comfortable seating/flow and timely food.`,
      `Lock critical vendors (venue, catering) early enough for ${city}, given ${daysOut} days until the event.`,
      input.preferences.accessibility ? `Meet the stated accessibility requirement: ${input.preferences.accessibility}.` : 'Keep the schedule realistic so organisers are not overwhelmed on the day.',
    ],
    theme,
    assumptions: [
      'All cost figures are planning estimates generated from your inputs - they are not quotes and no vendor has been contacted or verified.',
      `Guest count of ${input.guestCount} is treated as final for catering and seating estimates.`,
      'Vendor availability on the event date is unverified until you confirm it directly.',
      input.setting === 'outdoor'
        ? 'An outdoor setup is assumed; weather contingency is tracked in the risk section.'
        : 'An indoor setup is assumed per your preference.',
    ],
  };

  const budget = buildBudgetSection(input, categories, totals.estimatedMinor, totals.totalMinor);

  const tasks = generateTasks(input);
  const milestones = [
    { id: 'ms1', label: 'Venue booking target', date: dueFor(input.date, 90) },
    { id: 'ms2', label: 'Caterer and menu locked', date: dueFor(input.date, 60) },
    { id: 'ms3', label: 'Invitations sent', date: dueFor(input.date, 30) },
    { id: 'ms4', label: 'All vendor balances due', date: dueFor(input.date, 5) },
    { id: 'ms5', label: 'Event day', date: input.date },
  ].filter((m) => daysBetween(todayIso(), m.date) >= -1 || m.date === input.date);

  const vendorRequirements = buildVendorRequirements(input, categories);
  const ideas = buildIdeas(input, theme);
  const risks = buildRisks(input, categories, daysOut);
  const actions = buildActions(input, tasks, daysOut, budget);

  return {
    id: newId('plan'),
    input,
    overview,
    budget,
    timeline: { tasks, milestones },
    vendorRequirements,
    vendors: [],
    ideas,
    risks,
    actions,
    source: 'demo',
    createdAt: now,
    updatedAt: now,
  };
}

function dueFor(eventDate: string, leadDays: number): string {
  const d = new Date(`${eventDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - leadDays);
  return d.toISOString().slice(0, 10);
}

function buildBudgetSection(
  input: EventInput,
  categories: BudgetCategory[],
  estimatedTotal: number,
  totalMinor: number,
): EventPlan['budget'] {
  const risks: string[] = [];
  const savings: string[] = [];
  const contingency = categories.find((c) => c.isContingency)?.allocatedMinor ?? 0;
  const availableMinor = totalMinor - contingency;
  const insufficient = estimatedTotal > availableMinor;
  const gaps = categories
    .filter((c) => !c.isContingency && c.estimatedMinor > c.allocatedMinor)
    .sort((a, b) => b.estimatedMinor - b.allocatedMinor - (a.estimatedMinor - a.allocatedMinor));

  if (insufficient) {
    risks.push(
      `Estimated costs (${Math.round(estimatedTotal / 100)}) exceed the money available for spending (${Math.round(availableMinor / 100)} after the contingency reserve) by ${Math.round((estimatedTotal - availableMinor) / 100)}. The plan needs scope cuts or renegotiated quotes.`,
    );
  } else {
    risks.push(
      `Estimated costs (${Math.round(estimatedTotal / 100)}) fit inside the spendable budget (${Math.round(availableMinor / 100)} after the contingency reserve) - treat the headroom as buffer, not permission to overspend.`,
    );
  }
  if (gaps.length > 0) {
    risks.push(`${gaps[0].name} is the largest gap between estimate and allocation - negotiate first here.`);
  }
  if (input.budget.contingencyPct < 5) {
    risks.push('Contingency reserve is under 5% - one surprise expense could push the event over budget.');
  }
  if (input.budget.flexibility === 'strict' && gaps.length > 0) {
    risks.push('Budget flexibility is "strict", so overruns cannot be absorbed - keep a written quote for every major vendor.');
  }

  const info = EVENT_TYPE_MAP[input.type];
  savings.push(`Compare at least three ${info.label.toLowerCase()} venue/catering options before committing an advance.`);
  if (input.requirements.invitations) savings.push('Digital invitations instead of printed ones free up budget for food or decor.');
  if (input.preferences.food === 'vegetarian' || input.preferences.food === 'vegan') {
    savings.push('A vegetarian menu typically costs less per head than a mixed menu - use the difference as buffer.');
  }
  if (daysBetween(todayIso(), input.date) > 90) {
    savings.push('Booking well ahead usually unlocks lower rates and better vendor choices.');
  } else {
    savings.push('With limited lead time, prioritise vendors who are already available on your date rather than chasing premium options.');
  }
  if (input.setting === 'outdoor') savings.push('An outdoor setting can reduce venue cost - invest the difference in weather backup.');
  if (input.guestCount > 150) savings.push('Per-head costs fall with volume; negotiate a package rate rather than per-plate pricing.');

  return {
    categories,
    risks,
    savings,
    insufficient,
  };
}

interface VendorSpec {
  category: VendorRequirement['category'];
  services: string[];
  questions: string[];
  criteria: string[];
  lead: number;
}

const VENDOR_SPECS: VendorSpec[] = [
  {
    category: 'venue',
    services: ['Space rental for the event duration', 'Seating and basic furniture', 'Parking / access arrangements'],
    questions: ['Is the venue free on this date and for the full duration?', 'What is included in the rental - furniture, power, cleanup?', 'What is the advance, cancellation and refund policy?', 'Are there noise, timing or outside-catering restrictions?'],
    criteria: ['Total cost and what is bundled', 'Capacity and layout fit', 'Cancellation terms', 'Location and travel for guests'],
    lead: 90,
  },
  {
    category: 'catering',
    services: ['Menu planning and tasting', 'Food preparation and service staff', 'Live counters / sweets as required'],
    questions: ['Can you share a per-head quote for this guest count?', 'Do you handle dietary preferences (veg/vegan/jain)?', 'How many servers are included, and is crockery provided?', 'What happens if the final headcount changes?'],
    criteria: ['Price per head and minimum order', 'Tasting quality and menu flexibility', 'Staffing and hygiene practices', 'Flexibility on headcount changes'],
    lead: 60,
  },
  {
    category: 'photography',
    services: ['Event photography', 'Optional videography and edits', 'Delivery timeline for photos'],
    questions: ['What are package rates for this many hours?', 'When and in what format will photos be delivered?', 'Can we see a full album from a similar event?', 'Do you travel - is travel cost included?'],
    criteria: ['Portfolio match', 'Coverage hours and deliverables', 'Delivery time', 'Total price including travel'],
    lead: 45,
  },
  {
    category: 'decoration',
    services: ['Theme design and setup', 'Flowers / drapes / lighting', 'Teardown after the event'],
    questions: ['Can you work within this decoration budget?', 'Do you handle setup and teardown on the day?', 'What can be reused versus single-use?', 'How do you handle outdoor weather conditions?'],
    criteria: ['Design fit with theme', 'Cost and reuse of materials', 'Setup timing and crew', 'Weather resilience for outdoor venues'],
    lead: 30,
  },
  {
    category: 'entertainment',
    services: ['Music / DJ / sound', 'Host or performers as needed', 'Run-of-show coordination'],
    questions: ['What is included - equipment, performers, sound?', 'Can you share a demo or past performance?', 'What are overtime charges?', 'Do you coordinate with the event schedule?'],
    criteria: ['Relevant experience for this audience', 'All-in price including equipment', 'Reliability and backups', 'Fit with the programme'],
    lead: 30,
  },
  {
    category: 'transportation',
    services: ['Guest pick-and-drop', 'Vendor and material transport', 'Waiting-time policy'],
    questions: ['What is the rate per vehicle and per route?', 'Are drivers and fuel included?', 'What is the cancellation policy?', 'Can you cover multiple pickup points?'],
    criteria: ['Cost per route', 'Vehicle condition and capacity', 'Punctuality record', 'Cancellation terms'],
    lead: 21,
  },
  {
    category: 'accommodation',
    services: ['Room block for outstation guests', 'Group rate and check-in support', 'Late checkout if needed'],
    questions: ['What group rate can you offer for this many rooms?', 'What is the payment and cancellation policy?', 'Is breakfast included?', 'Can rooms be held before confirmation?'],
    criteria: ['Group rate and inclusions', 'Distance from the venue', 'Cancellation flexibility', 'Room quality'],
    lead: 30,
  },
  {
    category: 'other',
    services: ['Custom requirements as discussed'],
    questions: ['Can you quote against this exact scope?', 'What is included and excluded?', 'What are your timelines and payment terms?'],
    criteria: ['Fit to scope', 'Price', 'Timelines'],
    lead: 21,
  },
];

export function buildVendorRequirements(input: EventInput, categories: BudgetCategory[]): VendorRequirement[] {
  const enabled: VendorRequirement['category'][] = [];
  const reqMap: Record<string, RequirementKey> = {
    venue: 'venue',
    catering: 'catering',
    photography: 'photography',
    decoration: 'decoration',
    entertainment: 'entertainment',
    transportation: 'transportation',
    accommodation: 'accommodation',
  };
  for (const spec of VENDOR_SPECS) {
    const reqKey = reqMap[spec.category];
    if (reqKey && !input.requirements[reqKey]) continue;
    if (spec.category === 'other') continue;
    enabled.push(spec.category);
  }

  const daysOut = daysBetween(todayIso(), input.date);
  return enabled.map((category) => {
    const spec = VENDOR_SPECS.find((s) => s.category === category)!;
    const cat = categories.find((c) => c.id === (category as CategoryId));
    const urgency: Priority = daysOut <= spec.lead ? (daysOut <= Math.max(7, spec.lead / 3) ? 'high' : 'medium') : 'medium';
    const bookingPriority: Priority = spec.lead >= 60 ? 'high' : urgency;
    return {
      id: newId('vrq'),
      category,
      services: spec.services,
      questions: spec.questions,
      comparisonCriteria: spec.criteria,
      bookingPriority,
      budgetGuideMinor: cat?.allocatedMinor ?? 0,
      booked: false,
    };
  });
}

function buildIdeas(input: EventInput, theme: string): IdeasSection {
  const seed = hashInput(input);
  const settingLine =
    input.setting === 'outdoor'
      ? 'Weather-friendly: use weighted stands, shaded seating and a covered food zone'
      : input.setting === 'indoor'
        ? 'Indoor: use vertical decor and warm lighting to make the room feel intentional'
        : 'Either setting: prepare layouts for both and decide once the forecast is clearer';

  const decoration = [
    `${theme} - anchor the palette on ${input.preferences.colors.length > 0 ? input.preferences.colors.join(', ') : 'two chosen colours'} and keep everything else neutral`,
    settingLine,
    input.guestCount > 150
      ? 'Zone the space (registration, seating, food, photo) so large crowds never bottleneck'
      : 'One strong focal point (stage or table centrepiece) beats many small decorations',
  ];

  const foodLines = [
    input.preferences.food === 'vegetarian'
      ? 'Pure vegetarian menu with clear labelling of Jain/no-onion-garlic options'
      : input.preferences.food === 'vegan'
        ? 'Fully plant-based menu with a few familiar crowd-pleasers'
        : input.preferences.food === 'non-vegetarian'
          ? 'Non-vegetarian menu with a balanced vegetarian counter for mixed guests'
          : 'Mixed menu with a substantial vegetarian section - decide the split once headcount is confirmed',
    `Serve in ${input.guestCount > 200 ? 'staggered batches to avoid queues' : 'a single well-timed service window'}`,
    input.preferences.cultural ? `Reflect the stated preference: ${input.preferences.cultural}` : 'Add one regional or personal signature dish that makes the menu memorable',
  ];

  const entertainment =
    input.type === 'birthday'
      ? ['Host-led games matched to the age group', 'Playlist with a short curated highlight segment', 'A photo booth corner with simple props']
      : input.type === 'wedding'
        ? ['Live music or DJ with a printed run-of-show', 'A short anchor-hosted programme to keep transitions smooth', 'A dedicated 20-30 minute highlight segment rather than continuous performances']
        : input.type === 'college'
          ? ['Student performances with a proper stage schedule', 'Interactive segment (polls/competitions) to hold attention', 'Professional sound check slotted before doors open']
          : ['Anchor or emcee to run the programme', 'Music and a short performance slot', 'One interactive moment that involves the audience'];

  const guestExperience = [
    input.preferences.accessibility
      ? `Accessibility: ${input.preferences.accessibility} - confirm it with the venue in writing`
      : 'Step-free entry and clearly marked seating for elderly guests',
    input.guestCount > 150 ? 'Printed signage and a WhatsApp/phone helpline for the day' : 'A single point of contact printed on the invitation',
    'A 10-minute buffer between programme items prevents the schedule from slipping',
    /kid|child|children|age \d/i.test(input.preferences.special) ? 'A supervised kids corner so parents can relax' : 'Welcome drinks or a small arrival touch sets the tone',
  ];

  return {
    themes: [theme, ...pick(THEME_SUGGESTIONS[input.type] ?? THEME_SUGGESTIONS.custom, seed, 2).filter((t) => t !== theme)],
    decoration,
    catering: foodLines,
    entertainment,
    guestExperience,
  };
}

function buildRisks(input: EventInput, categories: BudgetCategory[], daysOut: number): RiskItem[] {
  const risks: RiskItem[] = [];
  if (input.setting === 'outdoor' || input.setting === 'either') {
    risks.push({
      id: 'risk_weather',
      area: 'Weather',
      description: 'An outdoor event is exposed to rain, heat or wind, which can affect guests, decor and power.',
      mitigation: 'Hold an indoor backup space or canopy option, confirm teardown/rain policy with the decorator, and check the forecast 48 hours before.',
    });
  }
  const totals = budgetTotals(categories, input.budget.totalMinor);
  const availableMinor = totals.totalMinor - totals.contingencyMinor;
  if (totals.estimatedMinor > availableMinor) {
    risks.push({
      id: 'risk_budget',
      area: 'Budget',
      description: 'Estimated costs currently exceed the spendable budget (after contingency), so the final invoices could exceed what you have set aside.',
      mitigation: 'Reduce scope in the categories with the biggest estimate-vs-allocation gap, or ask the assistant to propose a rebalanced budget.',
    });
  }
  if (daysOut < 30) {
    risks.push({
      id: 'risk_schedule',
      area: 'Schedule',
      description: `Only ${daysOut} days remain - key bookings normally need more lead time.`,
      mitigation: 'Prioritise vendors already free on your date and avoid custom-made items with long production times.',
    });
  }
  if (daysOut < 0) {
    risks.push({
      id: 'risk_past',
      area: 'Date',
      description: 'The event date is in the past. Tasks show as overdue by design.',
      mitigation: 'Update the event date if the plan is for a future celebration - timelines will recalculate.',
    });
  }
  risks.push({
    id: 'risk_vendor',
    area: 'Vendors',
    description: 'No vendor is confirmed yet. Unverified availability is the most common cause of last-minute scrambling.',
    mitigation: 'Use the vendor checklist to collect written quotes, keep one backup option per critical category, and record follow-up dates.',
  });
  if (input.guestCount > 200) {
    risks.push({
      id: 'risk_crowd',
      area: 'Guests',
      description: `A ${input.guestCount}-guest event needs crowd control - queues, seating and parking can break the experience.`,
      mitigation: 'Zone the venue, add registration desks and stagger food service.',
    });
  }
  if (input.budget.contingencyPct < 5) {
    risks.push({
      id: 'risk_reserve',
      area: 'Budget',
      description: 'The contingency reserve is small, leaving little room for surprises.',
      mitigation: 'Raise the reserve to 5-10% or identify a category you can cut if something unexpected appears.',
    });
  }
  return risks;
}

function buildActions(
  input: EventInput,
  tasks: ReturnType<typeof generateTasks>,
  daysOut: number,
  budget: EventPlan['budget'],
): ActionSection {
  const now = todayIso();
  const immediate: string[] = [];
  const decisions: string[] = [];

  if (daysOut < 0) {
    immediate.push('Update the event date - this plan is built around a date that has already passed.');
  } else if (daysOut <= 30) {
    immediate.push('With under a month to go, confirm venue and catering availability today and lock whatever is still open.');
  } else if (daysOut <= 90) {
    immediate.push('Book the venue this week - it anchors every other deadline in the timeline.');
  } else {
    immediate.push('Confirm the guest list headcount and budget - both drive nearly every other number in this plan.');
  }
  immediate.push(`Review the budget: ${budget.insufficient ? 'estimates exceed the budget - decide what to cut first.' : 'estimates fit the budget - keep allocations honest as quotes arrive.'}`);
  immediate.push('Add at least one real vendor quote per critical category so estimates can be replaced with actual numbers.');

  const upcoming = tasks
    .filter((t) => t.status !== 'done' && daysBetween(now, t.dueDate) >= 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 4)
    .map((t) => `${t.title} - due ${t.dueDate}`);

  if (!input.preferences.food || input.preferences.food === 'unspecified') {
    decisions.push('Confirm the food preference (veg / non-veg / mixed) - it changes catering estimates.');
  }
  if (!input.preferences.theme.trim()) {
    decisions.push('Pick a theme direction so decoration quotes can be requested against something concrete.');
  }
  if (input.setting === 'either') {
    decisions.push('Decide indoor vs outdoor - weather planning and decor approach depend on it.');
  }
  if (budget.insufficient) {
    decisions.push('Decide the priority order for cuts: decoration and entertainment usually give way before catering or venue.');
  }
  if (input.requirements.accommodation) {
    decisions.push('Confirm how many guests need stay arrangements before requesting hotel rates.');
  }
  decisions.push('Confirm whether printed invitations are needed or digital is enough.');

  return { immediate, upcoming, decisions };
}
