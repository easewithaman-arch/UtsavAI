import type {
  CategoryId,
  CurrencyCode,
  EventInput,
  EventTypeId,
  Priority,
  RequirementKey,
  TaskCategory,
} from './types';

export interface EventTypeInfo {
  id: EventTypeId;
  label: string;
  blurb: string;
  /** Relative cost floor per guest in INR (rough planning heuristic, not a quote). */
  minPerGuestInr: number;
  categories: CategoryId[];
  taskCategoryLabel: TaskCategory;
}

export const EVENT_TYPES: EventTypeInfo[] = [
  { id: 'wedding', label: 'Wedding', blurb: 'Multi-function celebrations with extended guest lists', minPerGuestInr: 1400, categories: ['venue', 'catering', 'decoration', 'photography', 'entertainment', 'invitations', 'transportation', 'accommodation', 'misc'], taskCategoryLabel: 'planning' },
  { id: 'birthday', label: 'Birthday', blurb: 'Intimate or lively gatherings around a person', minPerGuestInr: 450, categories: ['venue', 'catering', 'decoration', 'photography', 'entertainment', 'invitations', 'transportation', 'misc'], taskCategoryLabel: 'planning' },
  { id: 'anniversary', label: 'Anniversary', blurb: 'Milestone celebrations for couples or families', minPerGuestInr: 700, categories: ['venue', 'catering', 'decoration', 'photography', 'entertainment', 'invitations', 'misc'], taskCategoryLabel: 'planning' },
  { id: 'community', label: 'Community gathering', blurb: 'Neighbourhood, cultural or social get-togethers', minPerGuestInr: 350, categories: ['venue', 'catering', 'decoration', 'entertainment', 'invitations', 'transportation', 'misc'], taskCategoryLabel: 'planning' },
  { id: 'college', label: 'College event', blurb: 'Fests, farewells, tech and cultural symposiums', minPerGuestInr: 250, categories: ['venue', 'catering', 'decoration', 'photography', 'entertainment', 'invitations', 'transportation', 'misc'], taskCategoryLabel: 'planning' },
  { id: 'festival', label: 'Festival', blurb: 'Regional and seasonal celebrations', minPerGuestInr: 300, categories: ['venue', 'catering', 'decoration', 'photography', 'entertainment', 'transportation', 'misc'], taskCategoryLabel: 'planning' },
  { id: 'corporate', label: 'Corporate celebration', blurb: 'Offsites, award nights and team milestones', minPerGuestInr: 1100, categories: ['venue', 'catering', 'decoration', 'photography', 'entertainment', 'invitations', 'transportation', 'accommodation', 'misc'], taskCategoryLabel: 'planning' },
  { id: 'custom', label: 'Custom event', blurb: 'Anything that does not fit the templates', minPerGuestInr: 400, categories: ['venue', 'catering', 'decoration', 'photography', 'entertainment', 'invitations', 'transportation', 'misc'], taskCategoryLabel: 'planning' },
];

export const EVENT_TYPE_MAP: Record<EventTypeId, EventTypeInfo> = EVENT_TYPES.reduce(
  (acc, t) => ((acc[t.id] = t), acc),
  {} as Record<EventTypeId, EventTypeInfo>,
);

export const CATEGORY_NAMES: Record<CategoryId, string> = {
  venue: 'Venue',
  catering: 'Catering',
  decoration: 'Decoration',
  photography: 'Photography',
  entertainment: 'Entertainment',
  invitations: 'Invitations',
  transportation: 'Transportation',
  accommodation: 'Accommodation',
  misc: 'Miscellaneous',
  contingency: 'Contingency reserve',
};

export const REQUIREMENT_LABELS: Record<RequirementKey, string> = {
  venue: 'Venue',
  catering: 'Catering',
  decoration: 'Decoration',
  photography: 'Photography',
  entertainment: 'Entertainment',
  invitations: 'Invitations',
  transportation: 'Transportation',
  accommodation: 'Accommodation',
};

export const METRO_CITIES = [
  'mumbai', 'delhi', 'new delhi', 'bengaluru', 'bangalore', 'hyderabad', 'chennai',
  'kolkata', 'pune', 'ahmedabad', 'jaipur', 'surat', 'lucknow', 'chandigarh',
  'kochi', 'cochin', 'indore', 'bhopal', 'nagpur', 'guwahati', 'goa', 'noida',
  'gurugram', 'gurgaon', 'faridabad', 'thane', 'visakhapatnam', 'coimbatore',
];

export function cityFactorInr(location: string): number {
  const l = location.toLowerCase();
  if (METRO_CITIES.some((c) => l.includes(c))) return 1.25;
  if (!l.trim()) return 1;
  return 1;
}

export interface TaskTemplate {
  key: string;
  title: string;
  description: string;
  category: TaskCategory;
  leadDays: number;
  priority: Priority;
  dependsOnKey?: string;
}

/** Lead days are relative to the event date; negative = after the event. */
const COMMON_TASKS: TaskTemplate[] = [
  { key: 'budget', title: 'Finalise budget and guest list', description: 'Confirm the total spend, the guest count and who is paying for what.', category: 'finance', leadDays: 120, priority: 'high' },
  { key: 'venue', title: 'Shortlist and book venue', description: 'Visit shortlisted venues, confirm availability for the event date and lock the booking with an advance.', category: 'venue', leadDays: 90, priority: 'high', dependsOnKey: 'budget' },
  { key: 'caterer', title: 'Select caterer and lock menu', description: 'Compare caterer quotes, run a tasting, and confirm menu against food preferences and dietary needs.', category: 'catering', leadDays: 60, priority: 'high', dependsOnKey: 'venue' },
  { key: 'invites', title: 'Send invitations', description: 'Finalise the guest list, design invitations and send them out.', category: 'invitations', leadDays: 30, priority: 'medium' },
  { key: 'decor', title: 'Confirm decoration plan', description: 'Approve the decoration theme, colour palette and layout with the decorator.', category: 'decoration', leadDays: 21, priority: 'medium', dependsOnKey: 'venue' },
  { key: 'photo', title: 'Confirm photography/videography', description: 'Agree shot list, coverage hours and deliverables with the photographer.', category: 'photography', leadDays: 21, priority: 'medium' },
  { key: 'entertainment', title: 'Confirm entertainment and run-of-show', description: 'Lock music, hosts, performances and the sequence of the programme.', category: 'entertainment', leadDays: 14, priority: 'medium' },
  { key: 'logistics', title: 'Transport and logistics', description: 'Plan guest transport, vendor arrivals, parking and on-site signage.', category: 'logistics', leadDays: 10, priority: 'medium' },
  { key: 'payments', title: 'Settle outstanding vendor payments', description: 'Clear pending balances and confirm final headcount with paid vendors.', category: 'finance', leadDays: 5, priority: 'high', dependsOnKey: 'caterer' },
  { key: 'rehearsal', title: 'Final walkthrough', description: 'Walk through the schedule with family/organisers and confirm arrival times.', category: 'planning', leadDays: 2, priority: 'high' },
  { key: 'eventday', title: 'Event day coordination', description: 'On-site point person manages vendors, timeline and guest flow.', category: 'planning', leadDays: 0, priority: 'high' },
  { key: 'thankyou', title: 'Thank-you notes and settle final dues', description: 'Thank guests and vendors, collect photos/videos and close payments.', category: 'planning', leadDays: -5, priority: 'low' },
];

const TYPE_TASKS: Partial<Record<EventTypeId, TaskTemplate[]>> = {
  wedding: [
    { key: 'functions', title: 'Plan pre-wedding functions', description: 'Schedule haldi, mehndi, sangeet or equivalent functions and their vendors.', category: 'planning', leadDays: 45, priority: 'high', dependsOnKey: 'venue' },
    { key: 'outfit', title: 'Finalise outfits and trial', description: 'Order or tailor outfits for the couple and key family, with trials.', category: 'logistics', leadDays: 30, priority: 'medium' },
    { key: 'pandit', title: 'Confirm priest/officiant and rituals', description: 'Confirm the ceremony requirements, timings and any religious officiant.', category: 'planning', leadDays: 30, priority: 'high' },
    { key: 'stay', title: 'Block guest accommodation', description: 'Reserve room blocks for outstation guests and confirm check-in support.', category: 'logistics', leadDays: 21, priority: 'medium', dependsOnKey: 'venue' },
    { key: 'registry', title: 'Wedding registry / return gifts', description: 'Decide on return gifts or a registry and procure them.', category: 'guests', leadDays: 14, priority: 'low' },
  ],
  birthday: [
    { key: 'cake', title: 'Order cake', description: 'Finalise flavour, design, dietary needs and delivery time with the baker.', category: 'catering', leadDays: 7, priority: 'high' },
    { key: 'theme', title: 'Lock theme and decor', description: 'Pick the party theme, balloons, backdrop and table setup.', category: 'decoration', leadDays: 14, priority: 'medium' },
    { key: 'activities', title: 'Plan activities or entertainment', description: 'Games, magician, DJ or playlist - match it to the age group.', category: 'entertainment', leadDays: 10, priority: 'medium' },
    { key: 'returngifts', title: 'Return gifts / goodie bags', description: 'Buy and pack return gifts for guests, especially for children.', category: 'guests', leadDays: 7, priority: 'low' },
  ],
  anniversary: [
    { key: 'theme', title: 'Decide celebration format', description: 'Dinner, surprise party or intimate gathering - confirm with key guests.', category: 'planning', leadDays: 30, priority: 'high' },
    { key: 'photo', title: 'Arrange memory display', description: 'Collect photos/videos for a slideshow or memory wall.', category: 'decoration', leadDays: 14, priority: 'medium' },
    { key: 'cake', title: 'Order cake', description: 'Confirm cake design and delivery time.', category: 'catering', leadDays: 7, priority: 'medium' },
  ],
  community: [
    { key: 'permits', title: 'Check permissions and local requirements', description: 'Confirm what approvals or NOCs the venue or locality requires; verify with local authorities.', category: 'logistics', leadDays: 30, priority: 'high' },
    { key: 'volunteers', title: 'Recruit and brief volunteers', description: 'Assign roles: registration, seating, food, cleanup.', category: 'guests', leadDays: 14, priority: 'medium' },
    { key: 'pa', title: 'Arrange PA system and stage', description: 'Confirm sound, mics, stage and power backup.', category: 'entertainment', leadDays: 10, priority: 'medium' },
    { key: 'donations', title: 'Handle contributions or entry passes', description: 'If collecting contributions, set up a transparent process.', category: 'finance', leadDays: 10, priority: 'low' },
  ],
  college: [
    { key: 'committee', title: 'Form organising committee', description: 'Assign leads for sponsorship, publicity, events and logistics.', category: 'planning', leadDays: 60, priority: 'high' },
    { key: 'sponsors', title: 'Approach sponsors', description: 'Prepare sponsorship decks and pitch to potential sponsors.', category: 'finance', leadDays: 45, priority: 'high' },
    { key: 'publicity', title: 'Publicity and registrations', description: 'Posters, social media, registrations and announcements.', category: 'invitations', leadDays: 21, priority: 'medium' },
    { key: 'judges', title: 'Confirm judges, speakers or performers', description: 'Invite and confirm participants, with travel and stay if needed.', category: 'guests', leadDays: 21, priority: 'medium' },
  ],
  festival: [
    { key: 'rituals', title: 'Confirm rituals and programme', description: 'List the ceremonies, timings and who leads them - confirm with the community.', category: 'planning', leadDays: 30, priority: 'high' },
    { key: 'prasad', title: 'Arrange food and prasad', description: 'Plan the menu, quantity and hygiene arrangements.', category: 'catering', leadDays: 14, priority: 'high' },
    { key: 'decorsetup', title: 'Decor and lighting setup', description: 'Pandal, lighting, rangoli or equivalent setup schedule.', category: 'decoration', leadDays: 7, priority: 'medium' },
  ],
  corporate: [
    { key: 'agenda', title: 'Finalise agenda and invites', description: 'Confirm the run-of-show, speakers and formal invitations.', category: 'planning', leadDays: 30, priority: 'high' },
    { key: 'approval', title: 'Internal approvals and PO', description: 'Get budget approvals and raise purchase orders for vendors.', category: 'finance', leadDays: 30, priority: 'high' },
    { key: 'branding', title: 'Branding and collateral', description: 'Banners, badges, screens and giveaways.', category: 'decoration', leadDays: 14, priority: 'medium' },
  ],
};

export function buildTaskTemplates(type: EventTypeId): TaskTemplate[] {
  return [...(TYPE_TASKS[type] ?? []), ...COMMON_TASKS];
}

export function defaultRequirements(type: EventTypeId): Record<RequirementKey, boolean> {
  const info = EVENT_TYPE_MAP[type];
  const all: RequirementKey[] = ['venue', 'catering', 'decoration', 'photography', 'entertainment', 'invitations', 'transportation', 'accommodation'];
  const set = new Set<CategoryId>(info.categories);
  const result = {} as Record<RequirementKey, boolean>;
  for (const key of all) result[key] = set.has(key as CategoryId);
  if (type === 'birthday' || type === 'anniversary') result.photography = true;
  if (type === 'corporate' || type === 'wedding') result.accommodation = type === 'wedding';
  return result;
}

export function defaultPriorities(type: EventTypeId): Partial<Record<CategoryId, Priority>> {
  const base: Partial<Record<CategoryId, Priority>> = {
    misc: 'low',
    contingency: 'high',
  };
  switch (type) {
    case 'wedding':
      return { ...base, venue: 'high', catering: 'high', photography: 'medium', decoration: 'medium', entertainment: 'medium', invitations: 'low', transportation: 'low', accommodation: 'medium' };
    case 'birthday':
      return { ...base, venue: 'medium', catering: 'high', decoration: 'high', photography: 'low', entertainment: 'medium', invitations: 'low', transportation: 'low' };
    case 'community':
      return { ...base, venue: 'high', catering: 'high', decoration: 'low', entertainment: 'medium', invitations: 'medium', transportation: 'low' };
    case 'college':
      return { ...base, venue: 'medium', catering: 'medium', decoration: 'low', entertainment: 'high', photography: 'medium', invitations: 'medium', transportation: 'low' };
    case 'corporate':
      return { ...base, venue: 'high', catering: 'high', decoration: 'low', entertainment: 'medium', photography: 'low', invitations: 'low', transportation: 'low', accommodation: 'medium' };
    case 'festival':
      return { ...base, venue: 'medium', catering: 'high', decoration: 'high', entertainment: 'high', invitations: 'low', transportation: 'low' };
    case 'anniversary':
      return { ...base, venue: 'medium', catering: 'high', decoration: 'medium', photography: 'high', entertainment: 'low', invitations: 'low' };
    default:
      return { ...base, venue: 'medium', catering: 'high', decoration: 'medium', photography: 'medium', entertainment: 'medium', invitations: 'low', transportation: 'low' };
  }
}

export function newId(prefix = 'id'): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}

export interface SampleScenario {
  key: 'birthday' | 'wedding' | 'community';
  title: string;
  summary: string;
  build: () => EventInput;
}

function futureDate(daysAhead: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

const ALL_TRUE = (keys: RequirementKey[]): Record<RequirementKey, boolean> => {
  const all: RequirementKey[] = ['venue', 'catering', 'decoration', 'photography', 'entertainment', 'invitations', 'transportation', 'accommodation'];
  const out = {} as Record<RequirementKey, boolean>;
  for (const k of all) out[k] = keys.includes(k);
  return out;
};

export const SAMPLE_EVENTS: SampleScenario[] = [
  {
    key: 'birthday',
    title: 'Birthday · 25 guests · ₹20,000',
    summary: 'A close-family birthday at home with a cake, simple decoration and snacks.',
    build: () => ({
      id: newId('evt'),
      name: "Aarav's 10th Birthday",
      type: 'birthday',
      date: futureDate(30),
      location: 'Pune',
      guestCount: 25,
      setting: 'indoor',
      durationHours: 4,
      budget: {
        totalMinor: 2000000,
        currency: 'INR',
        flexibility: 'strict',
        contingencyPct: 8,
        priorities: defaultPriorities('birthday'),
      },
      preferences: {
        theme: 'Space explorer',
        colors: ['Navy', 'Gold'],
        food: 'vegetarian',
        cultural: '',
        accessibility: '',
        special: 'Children aged 6-10; need a games corner',
      },
      requirements: ALL_TRUE(['venue', 'catering', 'decoration', 'entertainment', 'invitations']),
    }),
  },
  {
    key: 'wedding',
    title: 'Wedding · 150 guests · ₹3,00,000',
    summary: 'A single-day wedding with ceremony, reception and outstation guests.',
    build: () => ({
      id: newId('evt'),
      name: 'Meera & Rohan Wedding',
      type: 'wedding',
      date: futureDate(120),
      location: 'Jaipur',
      guestCount: 150,
      setting: 'outdoor',
      durationHours: 10,
      budget: {
        totalMinor: 30000000,
        currency: 'INR',
        flexibility: 'moderate',
        contingencyPct: 7,
        priorities: defaultPriorities('wedding'),
      },
      preferences: {
        theme: 'Marigold and mauve - daytime garden ceremony',
        colors: ['Marigold', 'Mauve', 'Ivory'],
        food: 'vegetarian',
        cultural: 'North Indian wedding traditions',
        accessibility: 'Wheelchair-accessible seating near the stage',
        special: '',
      },
      requirements: ALL_TRUE(['venue', 'catering', 'decoration', 'photography', 'entertainment', 'invitations', 'transportation', 'accommodation']),
    }),
  },
  {
    key: 'community',
    title: 'Community event · 300 attendees · ₹1,00,000',
    summary: 'A neighbourhood cultural evening with food stalls and a performance.',
    build: () => ({
      id: newId('evt'),
      name: 'Spring Cultural Evening',
      type: 'community',
      date: futureDate(45),
      location: 'Bengaluru',
      guestCount: 300,
      setting: 'outdoor',
      durationHours: 6,
      budget: {
        totalMinor: 10000000,
        currency: 'INR',
        flexibility: 'moderate',
        contingencyPct: 10,
        priorities: defaultPriorities('community'),
      },
      preferences: {
        theme: 'Regional folk and food festival',
        colors: ['Terracotta', 'Cream'],
        food: 'mixed',
        cultural: 'Open to all communities; include a mix of regional stalls',
        accessibility: 'Step-free access and seating for elderly attendees',
        special: '',
      },
      requirements: ALL_TRUE(['venue', 'catering', 'decoration', 'entertainment', 'invitations', 'transportation']),
    }),
  },
];

export function emptyEventInput(type: EventTypeId = 'wedding'): EventInput {
  return {
    id: newId('evt'),
    name: '',
    type,
    date: futureDate(60),
    location: '',
    guestCount: 50,
    setting: 'either',
    durationHours: type === 'wedding' ? 8 : type === 'community' || type === 'college' ? 6 : 4,
    budget: {
      totalMinor: 0,
      currency: 'INR' as CurrencyCode,
      flexibility: 'moderate',
      contingencyPct: 7,
      priorities: defaultPriorities(type),
    },
    preferences: {
      theme: '',
      colors: [],
      food: 'unspecified',
      cultural: '',
      accessibility: '',
      special: '',
    },
    requirements: defaultRequirements(type),
  };
}
