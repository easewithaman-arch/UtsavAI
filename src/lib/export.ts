import type { EventPlan } from '../domain/types';
import { formatMoney, percentOf } from '../domain/money';
import { budgetTotals } from '../domain/budget';
import { progressInfo, taskFlags } from '../domain/timeline';

function csvEscape(value: string | number | undefined): string {
  if (value === undefined || value === null) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number | undefined)[][]): string {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
}

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'event'
  );
}

/** Builds the downloadable plan file. The same payload can be uploaded again. */
export function buildPlanExport(plan: EventPlan): string {
  const payload = {
    application: 'UtsavAI',
    version: 1,
    exportedAt: new Date().toISOString(),
    note:
      plan.source === 'demo'
        ? 'Built with our built-in planning rules. All prices are estimates, not quotes.'
        : 'Built with AI help. All prices are estimates, not quotes.',
    plan,
  };
  return JSON.stringify(payload, null, 2);
}

export function exportPlanJson(plan: EventPlan): void {
  downloadText(`${slugify(plan.input.name)}-plan.json`, buildPlanExport(plan), 'application/json');
}

export function tasksCsv(plan: EventPlan): string {
  const rows: (string | number)[][] = [
    ['Task', 'Category', 'Due date', 'Priority', 'Status', 'Overdue', 'Days before the event', 'Estimated cost', 'Notes'],
  ];
  for (const t of plan.timeline.tasks) {
    const flags = taskFlags(t);
    rows.push([
      t.title,
      t.category,
      t.dueDate,
      t.priority,
      t.status,
      flags.overdue ? 'yes' : 'no',
      t.leadDays,
      t.estimatedCostMinor !== undefined ? formatMoney(t.estimatedCostMinor, plan.input.budget.currency) : '',
      t.description.replace(/\s+/g, ' ').slice(0, 200),
    ]);
  }
  return toCsv(rows);
}

export function vendorsCsv(plan: EventPlan): string {
  const rows: (string | number)[][] = [
    ['Vendor', 'Category', 'Contact', 'Quoted price', 'Booking status', 'Payment status', 'Follow-up date', 'Source', 'Notes'],
  ];
  for (const v of plan.vendors) {
    rows.push([
      v.name,
      v.category,
      v.contact,
      v.quotedPriceMinor !== undefined ? formatMoney(v.quotedPriceMinor, plan.input.budget.currency) : '',
      v.bookingStatus,
      v.paymentStatus,
      v.followUpDate ?? '',
      v.source,
      v.notes.replace(/\s+/g, ' ').slice(0, 200),
    ]);
  }
  return toCsv(rows);
}

export function budgetCsv(plan: EventPlan): string {
  const totals = budgetTotals(plan.budget.categories, plan.input.budget.totalMinor);
  const rows: (string | number)[][] = [
    ['Category', 'Allocation', 'Allocation %', 'Estimate', 'Actual', 'Priority', 'Contingency?'],
  ];
  for (const c of plan.budget.categories) {
    rows.push([
      c.name,
      formatMoney(c.allocatedMinor, plan.input.budget.currency),
      percentOf(c.allocatedMinor, totals.totalMinor),
      formatMoney(c.estimatedMinor, plan.input.budget.currency),
      formatMoney(c.actualMinor, plan.input.budget.currency),
      c.priority,
      c.isContingency ? 'yes' : 'no',
    ]);
  }
  rows.push([]);
  rows.push(['Total budget', formatMoney(totals.totalMinor, plan.input.budget.currency)]);
  rows.push(['Allocated', formatMoney(totals.allocatedMinor, plan.input.budget.currency)]);
  rows.push(['Estimated', formatMoney(totals.estimatedMinor, plan.input.budget.currency)]);
  rows.push(['Actual spent', formatMoney(totals.actualMinor, plan.input.budget.currency)]);
  rows.push(['Remaining', formatMoney(totals.remainingMinor, plan.input.budget.currency)]);
  return toCsv(rows);
}

export function exportChecklistCsv(plan: EventPlan, which: 'tasks' | 'vendors' | 'budget'): void {
  const text = which === 'tasks' ? tasksCsv(plan) : which === 'vendors' ? vendorsCsv(plan) : budgetCsv(plan);
  const label = which === 'tasks' ? 'task-list' : which === 'vendors' ? 'vendor-list' : 'budget';
  downloadText(`${slugify(plan.input.name)}-${label}.csv`, text, 'text/csv');
}

export function printableSummary(plan: EventPlan): string {
  const totals = budgetTotals(plan.budget.categories, plan.input.budget.totalMinor);
  const progress = progressInfo(plan.timeline.tasks);
  const lines = [
    `UtsavAI plan: ${plan.input.name}`,
    `${plan.input.type} | ${plan.input.date} | ${plan.input.location} | ${plan.input.guestCount} guests`,
    `Budget: ${formatMoney(totals.totalMinor, plan.input.budget.currency)} | Estimated: ${formatMoney(totals.estimatedMinor, plan.input.budget.currency)} | Spent: ${formatMoney(totals.actualMinor, plan.input.budget.currency)} | Remaining: ${formatMoney(totals.remainingMinor, plan.input.budget.currency)}`,
    `Tasks: ${progress.done}/${progress.total} complete`,
    `Generated by: ${plan.source === 'demo' ? 'built-in planning rules' : 'AI assistance'} - all prices are estimates, not quotes.`,
  ];
  return lines.join('\n');
}

export function printPlan(): void {
  window.print();
}
