import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EventPlan } from '../domain/types';
import { loadCurrentId, loadPlans, persistCurrentId, persistPlans } from '../persistence/storage';

export interface DomainSnapshot {
  plans: EventPlan[];
  currentId: string | null;
  loaded: boolean;
  skipped: number;
  saveError: string | null;
}

const SAVE_DELAY_MS = 200;

export function useDomain() {
  const [snapshot, setSnapshot] = useState<DomainSnapshot>({
    plans: [],
    currentId: null,
    loaded: false,
    skipped: 0,
    saveError: null,
  });
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const pendingRef = useRef<{ plans: EventPlan[]; currentId: string | null } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback((report = true) => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    const result = persistPlans(pending.plans);
    persistCurrentId(pending.currentId);
    if (!report) return;
    setSnapshot((prev) => {
      const saveError = result.ok ? null : result.error ?? 'We could not save your plans on this device.';
      return prev.saveError === saveError ? prev : { ...prev, saveError };
    });
  }, []);

  useEffect(() => {
    const result = loadPlans();
    const currentId = loadCurrentId();
    const next: DomainSnapshot = {
      plans: result.plans,
      currentId: currentId && result.plans.some((p) => p.id === currentId) ? currentId : result.plans[0]?.id ?? null,
      loaded: true,
      skipped: result.skipped,
      saveError: null,
    };
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  useEffect(() => {
    const onPageHide = () => flush(false);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush(false);
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      flush(false);
    };
  }, [flush]);

  const current = useMemo(
    () => snapshot.plans.find((p) => p.id === snapshot.currentId) ?? null,
    [snapshot.plans, snapshot.currentId],
  );

  const commit = useCallback(
    (nextPlans: EventPlan[], nextId: string | null) => {
      const next: DomainSnapshot = {
        ...snapshotRef.current,
        plans: nextPlans,
        currentId: nextId,
        loaded: true,
      };
      snapshotRef.current = next;
      setSnapshot(next);
      pendingRef.current = { plans: nextPlans, currentId: nextId };
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

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
      const active = snapshotRef.current.currentId;
      const nextId = active && active !== id ? active : next[0]?.id ?? null;
      commit(next, nextId);
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
