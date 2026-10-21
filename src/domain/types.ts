export type EventTypeId =
  | 'wedding'
  | 'birthday'
  | 'anniversary'
  | 'community'
  | 'college'
  | 'festival'
  | 'corporate'
  | 'custom';

export type CurrencyCode = 'INR' | 'USD' | 'EUR' | 'GBP' | 'AED' | 'SGD';

export type Priority = 'high' | 'medium' | 'low';

export type CategoryId =
  | 'venue'
  | 'catering'
  | 'decoration'
  | 'photography'
  | 'entertainment'
  | 'invitations'
  | 'transportation'
  | 'accommodation'
  | 'misc'
  | 'contingency';

export type RequirementKey =
  | 'venue'
  | 'catering'
  | 'decoration'
  | 'photography'
  | 'entertainment'
  | 'invitations'
  | 'transportation'
  | 'accommodation';

export type FoodPreference = 'vegetarian' | 'vegan' | 'non-vegetarian' | 'mixed' | 'unspecified';

export type Setting = 'indoor' | 'outdoor' | 'either';

export interface BudgetInput {
  /** Total budget in integer minor units (e.g. paise). */
  totalMinor: number;
  currency: CurrencyCode;
  flexibility: 'strict' | 'moderate' | 'flexible';
  contingencyPct: number;
  priorities: Partial<Record<CategoryId, Priority>>;
}

export interface PreferencesInput {
  theme: string;
  colors: string[];
  food: FoodPreference;
  cultural: string;
  accessibility: string;
  special: string;
}

export interface EventInput {
  id: string;
  name: string;
  type: EventTypeId;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  location: string;
  guestCount: number;
  setting: Setting;
  durationHours: number;
  budget: BudgetInput;
  preferences: PreferencesInput;
  requirements: Record<RequirementKey, boolean>;
}

export interface BudgetCategory {
  id: CategoryId;
  name: string;
  allocatedMinor: number;
  estimatedMinor: number;
  actualMinor: number;
  priority: Priority;
  isContingency: boolean;
  /** True when the user manually overrode the engine's allocation. */
  manual: boolean;
}

export type TaskStatus = 'todo' | 'in-progress' | 'done';
export type TaskCategory =
  | 'planning'
  | 'venue'
  | 'catering'
  | 'decoration'
  | 'photography'
  | 'entertainment'
  | 'invitations'
  | 'guests'
  | 'logistics'
  | 'finance';

export interface PlanTask {
  id: string;
  title: string;
  description: string;
  category: TaskCategory;
  /** ISO date. */
  dueDate: string;
  /** Days before the event (negative = after the event). Source of truth for date shifts. */
  leadDays: number;
  priority: Priority;
  status: TaskStatus;
  dependsOn?: string;
  estimatedCostMinor?: number;
}

export type VendorCategory =
  | 'venue'
  | 'catering'
  | 'photography'
  | 'decoration'
  | 'entertainment'
  | 'transportation'
  | 'accommodation'
  | 'other';

export type VendorSource = 'user' | 'ai-suggestion';

export interface Vendor {
  id: string;
  name: string;
  category: VendorCategory;
  contact: string;
  quotedPriceMinor?: number;
  bookingStatus: 'not-contacted' | 'shortlist' | 'contacted' | 'quoted' | 'booked' | 'declined';
  paymentStatus: 'none' | 'advance-paid' | 'partial' | 'paid';
  notes: string;
  followUpDate?: string;
  source: VendorSource;
}

export interface VendorRequirement {
  id: string;
  category: VendorCategory;
  services: string[];
  questions: string[];
  comparisonCriteria: string[];
  bookingPriority: Priority;
  /** Rough planning figure derived from the plan - an estimate, not a quote. */
  budgetGuideMinor: number;
  booked: boolean;
}

export interface PlanOverview {
  concept: string;
  objectives: string[];
  theme: string;
  assumptions: string[];
}

export interface BudgetSection {
  categories: BudgetCategory[];
  risks: string[];
  savings: string[];
  /** True when the estimated total exceeds the total budget. */
  insufficient: boolean;
}

export interface TimelineSection {
  tasks: PlanTask[];
  milestones: { id: string; label: string; date: string }[];
}

export interface IdeasSection {
  themes: string[];
  decoration: string[];
  catering: string[];
  entertainment: string[];
  guestExperience: string[];
}

export interface RiskItem {
  id: string;
  area: string;
  description: string;
  mitigation: string;
}

export interface ActionSection {
  immediate: string[];
  upcoming: string[];
  decisions: string[];
}

export type PlanSource = 'demo' | 'ai';

export interface EventPlan {
  id: string;
  input: EventInput;
  overview: PlanOverview;
  budget: BudgetSection;
  timeline: TimelineSection;
  vendorRequirements: VendorRequirement[];
  vendors: Vendor[];
  ideas: IdeasSection;
  risks: RiskItem[];
  actions: ActionSection;
  source: PlanSource;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeRecord {
  id: string;
  at: string;
  summary: string;
  details: string[];
  source: 'user' | 'copilot-demo' | 'copilot-ai';
}

export interface SavedPlanMeta {
  id: string;
  name: string;
  type: EventTypeId;
  date: string;
  updatedAt: string;
  source: PlanSource;
}
