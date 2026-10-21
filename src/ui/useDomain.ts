import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EventPlan } from '../domain/types';
import { loadCurrentId, loadPlans, persistCurrentId, persistPlans } from '../persistence/storage';

export interface DomainSnapshot {
  plans: EventPlan[];
  currentId: string | null;
  loaded: boolean;
  skipped: number;
}

export function useDomain() {
  const [snapshot, setSnapshot] = useState<DomainSnapshot>({
    plans: [],
    currentId: null,
    loaded: false,
    skipped: 0,
  });
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    const result = loadPlans();
    const currentId = loadCurrentId();
    setSnapshot({
      plans: result.plans,
      currentId: currentId && result.plans.some((p) => p.id === currentId) ? currentId : result.plans[0]?.id ?? null,
      loaded: true,
      skipped: result.skipped,
    });
  }, []);

  const current = useMemo(
    () => snapshot.plans.find((p) => p.id === snapshot.currentId) ?? null,
    [snapshot.plans, snapshot.currentId],
  );

  const commit = useCallback((nextPlans: EventPlan[], nextId: string | null) => {
    persistPlans(nextPlans);
    persistCurrentId(nextId);
    setSnapshot((prev) => ({
      ...prev,
      plans: nextPlans,
      currentId: nextId,
      loaded: true,
    }));
  }, []);

  const savePlan = useCallback(
    (plan: EventPlan) => {
      const existing = snapshotRef.current.plans;
      const index = existing.findIndex((p) => p.id === plan.id);
      const stamped = { ...plan, updatedAt: new Date().toISOString() };
      const next = index >= 0 ? existing.map((p, i) => (i === index ? stamped : p)) : [...existing, stamped];
      commit(next, stamped.id);
      return stamped;
    },
    [commit],
  );

  const removePlan = useCallback(
    (id: string) => {
      const existing = snapshotRef.current.plans;
      const next = existing.filter((p) => p.id !== id);
      commit(next, next[0]?.id ?? null);
    },
    [commit],
  );

  const selectPlan = useCallback(
    (id: string) => {
      if (snapshotRef.current.plans.some((p) => p.id === id)) commit(snapshotRef.current.plans, id);
    },
    [commit],
  );

  const importPlan = useCallback(
    (plan: EventPlan) => {
      const existing = snapshotRef.current.plans;
      const next = existing.some((p) => p.id === plan.id)
        ? existing.map((p) => (p.id === plan.id ? plan : p))
        : [...existing, plan];
      commit(next, plan.id);
    },
    [commit],
  );

  return { snapshot, current, savePlan, removePlan, selectPlan, importPlan };
}

export type DomainApi = ReturnType<typeof useDomain>;
