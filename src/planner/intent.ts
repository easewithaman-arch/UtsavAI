import type { EventPlan } from '../domain/types';
import type { PlanOp } from './ops';
import { parseMoneyInput, formatMoney } from '../domain/money';
import { ISO_DATE_RE, daysBetween, todayIso } from '../domain/validate';

export interface IntentResult {
  ops: PlanOp[];
  summary: string;
  tradeoffs: string[];
  /** Set when the request is ambiguous - the assistant asks instead of guessing. */
  clarify?: string;
}

export const DEMO_MODE_NOTE =
  'Demo mode: this reply was produced by built-in planning rules, not an AI provider.';

function normalizeDate(raw: string): string | null {
  const iso = raw.match(/\d{4}-\d{2}-\d{2}/);
  if (iso && ISO_DATE_RE.test(iso[0])) return iso[0];
  const slashed = raw.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (slashed) {
    const [, d, m, y] = slashed;
    const dd = d.padStart(2, '0');
    const mm = m.padStart(2, '0');
    const candidate = `${y}-${mm}-${dd}`;
    return ISO_DATE_RE.test(candidate) ? candidate : null;
  }
  const longForm = raw.match(/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{4})/i);
  if (longForm) {
    const months: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const mm = months[longForm[2].slice(0, 3).toLowerCase()];
    if (mm) return `${longForm[3]}-${mm}-${longForm[1].padStart(2, '0')}`;
  }
  return null;
}

/** Deterministic intent parsing used when no AI credentials are configured. */
export function parseIntent(request: string, plan: EventPlan): IntentResult {
  const text = request.toLowerCase().trim();
  const ops: PlanOp[] = [];
  const tradeoffs: string[] = [];
  const summaries: string[] = [];
  const currency = plan.input.budget.currency;
  const currentTotal = plan.input.budget.totalMinor;
  let clarify: string | undefined;

  const wantsBudget =
    /\bbudget\b/.test(text) &&
    /(reduce|cut|lower|decrease|trim|shrink|increase|raise|raise|up|save|less|more|to\b|=)/.test(text);

  if (wantsBudget) {
    const pct = text.match(/(\d{1,2})\s*%|(\d{1,2})\s*percent/);
    const toMatch = text.match(/(?:to|of|at)\s*[^0-9]{0,6}(?:₹|rs\.?|inr|\$|usd|€|eur|£|gbp)?\s*([\d,]+(?:\.\d+)?)/);
    const byMatch = text.match(/by\s*[^0-9]{0,6}(?:₹|rs\.?|inr|\$|usd|€|eur|£|gbp)?\s*([\d,]+(?:\.\d+)?)/);
    const isIncrease = /(increase|raise|add|up)\s+(?:the\s+)?budget|budget\s+(?:up\s+)?(?:to|by)/.test(text) && !/reduce|cut|lower|decrease|trim/.test(text);
    let newTotal: number | null = null;

    if (pct) {
      const p = Number(pct[1] ?? pct[2]);
      newTotal = isIncrease
        ? Math.round(currentTotal * (1 + p / 100))
        : Math.round(currentTotal * (1 - p / 100));
      summaries.push(`Budget ${isIncrease ? 'increased' : 'reduced'} by ${p}%`);
    } else if (toMatch && !/guest|people|attendee/.test(toMatch[0])) {
      const parsed = parseMoneyInput(toMatch[1], currency);
      if (parsed !== null && parsed > 0) newTotal = parsed;
      if (newTotal !== null) summaries.push(`Budget set to ${formatMoney(newTotal, currency)}`);
    } else if (byMatch) {
      const parsed = parseMoneyInput(byMatch[1], currency);
      if (parsed !== null && parsed > 0) {
        newTotal = isIncrease ? currentTotal + parsed : currentTotal - parsed;
        summaries.push(`Budget ${isIncrease ? 'increased' : 'reduced'} by ${formatMoney(parsed, currency)}`);
      }
    }

    if (newTotal !== null && newTotal >= 100) {
      ops.push({ op: 'setBudgetTotal', totalMinor: newTotal });
      const direction = newTotal < currentTotal ? 'cut' : 'increase';
      tradeoffs.push(
        direction === 'cut'
          ? 'High-priority categories are protected first; decoration, entertainment and invitations usually absorb the cut.'
          : 'Extra budget is spread by priority - decide whether it should go to food, comfort or aesthetics instead.',
      );
      if (plan.budget.insufficient) {
        tradeoffs.push('Note: current estimates already exceed the budget, so this change does not fix the gap by itself.');
      }
    } else if (ops.length === 0 && /(reduce|cut|lower|decrease|trim|increase)/.test(text)) {
      clarify = `How much should the budget change? For example: "reduce the budget by 20%" or "set the budget to ${formatMoney(Math.round(currentTotal * 0.8), currency)}".`;
    }
  }

  const guestMatch =
    text.match(/(?:to|is|of|=)?\s*(\d{1,5})\s*(?:guests|people|attendees|pax|invitees)/) ||
    text.match(/guest\s*count\s*(?:to|at)?\s*(\d{1,5})/);
  if (guestMatch) {
    const count = Number(guestMatch[1]);
    if (count >= 1 && count <= 100000 && count !== plan.input.guestCount) {
      ops.push({ op: 'setGuestCount', count });
      summaries.push(`Guest count set to ${count}`);
      const perGuestOld = Math.round(currentTotal / Math.max(1, plan.input.guestCount));
      const perGuestNew = Math.round(currentTotal / count);
      tradeoffs.push(
        count > plan.input.guestCount
          ? `Per-guest budget falls from ${formatMoney(perGuestOld, currency)} to ${formatMoney(perGuestNew, currency)} - catering quality or headcount needs a decision.`
          : `Per-guest budget rises from ${formatMoney(perGuestOld, currency)} to ${formatMoney(perGuestNew, currency)} - you may be able to upgrade the menu or decor.`,
      );
      if (count > plan.input.guestCount * 1.5) {
        tradeoffs.push('A jump this large can break venue capacity - re-check the venue before locking anything.');
      }
    } else if (count === plan.input.guestCount) {
      summaries.push('Guest count already matches - no change needed.');
    }
  }

  if (/(vegetarian|vegan|pure veg|no onion|jain)/.test(text) && !/non[- ]?veg/.test(text)) {
    const value = /vegan/.test(text) ? 'vegan' : 'vegetarian';
    ops.push({ op: 'setPreference', field: 'food', value });
    summaries.push(`Food preference set to ${value}`);
    tradeoffs.push('Catering estimates were recalculated; the allocation stays the same until you rebalance the budget.');
  } else if (/non[- ]?veg|chicken|meat/.test(text)) {
    ops.push({ op: 'setPreference', field: 'food', value: 'non-vegetarian' });
    summaries.push('Food preference set to non-vegetarian');
    tradeoffs.push('Non-vegetarian menus typically cost more per head - the catering estimate was raised.');
  } else if (/\bmixed\b.{0,15}(menu|food)|both veg/.test(text)) {
    ops.push({ op: 'setPreference', field: 'food', value: 'mixed' });
    summaries.push('Food preference set to mixed');
  }

  if (/(child|children|kids|kid-friendly|family-friendly|youngster)/.test(text)) {
    ops.push({ op: 'setPreference', field: 'special', value: 'Child-friendly event: games corner, softer sound levels and kid-safe food options' });
    if (!plan.timeline.tasks.some((t) => /kids|children|games/i.test(t.title))) {
      ops.push({
        op: 'addTask',
        task: {
          title: 'Plan a children-friendly zone',
          description: 'Set up supervised games or a quiet corner, adjust sound levels and confirm kid-safe food options.',
          category: 'entertainment',
          dueDate: plan.input.date,
          leadDays: 10,
          priority: 'medium',
          status: 'todo',
        },
      });
    }
    summaries.push('Plan adjusted for children');
    tradeoffs.push('A kids zone takes space and a supervisor - reserve an area in the layout and trim free-roaming decor there.');
  }

  if (/\bindoor/.test(text) && !/\bmove.{0,20}outdoor|outdoor.{0,10}instead/.test(text)) {
    ops.push({ op: 'setEventField', field: 'setting', value: 'indoor' });
    summaries.push('Setting changed to indoor');
    tradeoffs.push('Weather risk drops; venue layout and decor may need a rethink for an indoor room.');
  } else if (/\boutdoor/.test(text) && !/\bindoor.{0,10}instead/.test(text)) {
    ops.push({ op: 'setEventField', field: 'setting', value: 'outdoor' });
    summaries.push('Setting changed to outdoor');
    tradeoffs.push('Outdoor events need a rain backup, shaded seating and possibly a higher power budget.');
  }

  if (/(rain|weather|contingency|backup plan|monsoon)/.test(text)) {
    if (!plan.timeline.tasks.some((t) => /weather|rain|contingency/i.test(t.title))) {
      ops.push({
        op: 'addTask',
        task: {
          title: 'Lock weather contingency plan',
          description: 'Confirm indoor backup or canopy option, rain policy with the decorator, and a 48-hour forecast check.',
          category: 'logistics',
          dueDate: plan.input.date,
          leadDays: 5,
          priority: 'high',
          status: 'todo',
        },
      });
    }
    const hasRisk = plan.risks.some((r) => r.area === 'Weather');
    summaries.push('Rain/weather contingency added');
    tradeoffs.push(
      hasRisk
        ? 'A canopy or backup hall carries a cost - keep the contingency reserve available for it.'
        : 'The backup space should be held (even informally) well before the date, not 48 hours prior.',
    );
  }

  if (/(decor|decoration)/.test(text) && /(low|cheap|budget|save|cut|reduce|afford|econom)/.test(text)) {
    ops.push({ op: 'setCategoryPriority', categoryId: 'decoration', priority: 'low' });
    ops.push({ op: 'rebalanceBudget' });
    summaries.push('Decoration reprioritised as a cost-saving lever and the budget rebalanced');
    tradeoffs.push('Lower decoration spend: consider reusable drapes, seasonal flowers and DIY stations instead of fresh imported florals.');
  }

  if (/(rebalance|re-?allocate|balance the budget|redistribute)/.test(text)) {
    ops.push({ op: 'rebalanceBudget' });
    summaries.push('Budget rebalanced across categories by priority');
    tradeoffs.push('Manual allocation edits in each category were replaced by the priority-based split.');
  }

  const wantsDateChange = /(move|reschedule|change|shift|postpone|bring forward).{0,25}(date|event)|event.{0,10}(to|on)\s+\d/.test(text);
  if (wantsDateChange) {
    const dateStr = normalizeDate(request);
    if (dateStr) {
      const delta = daysBetween(todayIso(), dateStr);
      ops.push({ op: 'setEventDate', date: dateStr });
      summaries.push(`Event date moved to ${dateStr}`);
      tradeoffs.push('Open task deadlines were recalculated from their offset before the event; completed tasks keep their dates.');
      if (delta < 0) tradeoffs.push('That date is in the past - tasks will appear overdue.');
      else if (delta < 30) tradeoffs.push('Less than 30 days: vendor availability becomes the main risk.');
    } else {
      clarify = 'Which date should the event move to? Please give it as YYYY-MM-DD (for example 2027-02-14).';
    }
  }

  if (/reconfirm|headcount|final count/.test(text) && ops.length === 0) {
    ops.push({
      op: 'addTask',
      task: {
        title: 'Reconfirm final headcount with caterer and venue',
        description: 'Update every vendor whose quote depends on the final guest count.',
        category: 'catering',
        dueDate: plan.input.date,
        leadDays: 7,
        priority: 'high',
        status: 'todo',
      },
    });
    summaries.push('Headcount reconfirmation task added');
  }

  if (ops.length === 0 && !clarify) {
    if (/(venue|caterer|photographer|dj|decorator)/.test(text) && /(book|hire|find|contact|switch|replace)/.test(text)) {
      clarify =
        'I can record a vendor for you in the Vendors tab (name, quote, status) - what is the vendor name and category? I will not suggest specific vendors, since availability and contact details cannot be verified here.';
    } else {
      clarify =
        'I did not find a structured change I can safely apply. I can handle requests like: "reduce the budget by 20%", "reduce the guest count to 80", "add vegetarian catering", "move the ceremony indoors", "create a rain contingency plan", "move the event to 2027-02-14" or "suggest lower-cost decoration options".';
    }
  }

  return {
    ops,
    summary: summaries.join('. ') || (clarify ? 'Clarification needed' : 'No change'),
    tradeoffs,
    clarify,
  };
}
