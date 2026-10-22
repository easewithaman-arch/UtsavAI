import { describe, it, expect } from 'vitest';
import { buildPlanExport, tasksCsv, slugify } from '../src/lib/export';
import { restorePlan } from '../src/persistence/storage';
import { generateDemoPlan } from '../src/planner/demo';
import { SAMPLE_EVENTS } from '../src/domain/events';

const wedding = SAMPLE_EVENTS.find((s) => s.key === 'wedding')!.build();

describe('downloads a plan and uploads it again', () => {
  it('re-imports a downloaded plan file unchanged', () => {
    const plan = generateDemoPlan(wedding);
    const file = buildPlanExport(plan);

    const restored = restorePlan(file);
    expect(restored).not.toBeNull();
    expect(restored!.input.name).toBe(plan.input.name);
    expect(restored!.budget.categories).toEqual(plan.budget.categories);
    expect(restored!.timeline.tasks).toEqual(plan.timeline.tasks);
    expect(restored!.source).toBe(plan.source);
  });

  it('writes plain-language column names into the task list', () => {
    const plan = generateDemoPlan(wedding);
    const csv = tasksCsv(plan);
    const header = csv.split('\r\n')[0];

    expect(header).toContain('Days before the event');
    expect(header).not.toMatch(/lead days/i);
    expect(header.split(',')).toHaveLength(9);
  });

  it('gives downloaded files a readable name', () => {
    expect(slugify("Aarav's 10th Birthday")).toBe('aarav-s-10th-birthday');
  });
});
