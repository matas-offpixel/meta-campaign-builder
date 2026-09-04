"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { GoogleSearchPlanTree } from "@/lib/google-search/types";

export type SaveStatus = "idle" | "saving" | "saved";

export type GoogleSearchTreeController = ReturnType<typeof useGoogleSearchTree>;

const AUTOSAVE_DEBOUNCE_MS = 1500;

/**
 * One Google Search plan tree, loaded once and persisted on every change.
 *
 * The debounce and the PUT body (`{ tree }`) are the same path the
 * wizard shell used — the server returns the canonical tree so tmp-ids
 * become real UUIDs. `flush` fires the pending save immediately.
 */
export function useGoogleSearchTree(
  planId: string,
  initial?: GoogleSearchPlanTree | null,
) {
  const [tree, setTree] = useState<GoogleSearchPlanTree | null>(initial ?? null);
  const [hydrated, setHydrated] = useState(Boolean(initial));
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const treeRef = useRef(tree);
  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/google-search/${encodeURIComponent(planId)}`);
      const json = (await res.json().catch(() => null)) as
        | { ok: true; tree: GoogleSearchPlanTree }
        | { ok: false }
        | null;
      if (cancelled) return;
      if (res.ok && json && json.ok) setTree(json.tree);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [planId, initial]);

  const performSave = useCallback(async (current: GoogleSearchPlanTree) => {
    setSaveStatus("saving");
    setSaveError(null);
    const res = await fetch(`/api/google-search/${encodeURIComponent(current.plan.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tree: current }),
    });
    const json = (await res.json().catch(() => null)) as
      | { ok: true; tree: GoogleSearchPlanTree }
      | { ok: false; error?: string }
      | null;
    if (!res.ok || !json?.ok) {
      const message = (json && !json.ok && json.error) || `Save failed (HTTP ${res.status}).`;
      setSaveStatus("idle");
      setSaveError(message);
      throw new Error(message);
    }
    setTree(json.tree);
    treeRef.current = json.tree;
    setSaveStatus("saved");
    window.setTimeout(() => setSaveStatus("idle"), 1500);
  }, []);

  const onChange = useCallback(
    (next: GoogleSearchPlanTree) => {
      setTree(next);
      treeRef.current = next;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        performSave(next).catch(() => undefined);
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [performSave],
  );

  const flush = useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const current = treeRef.current;
    if (current) await performSave(current).catch(() => undefined);
  }, [performSave]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return {
    tree,
    setTree,
    treeRef,
    hydrated,
    saveStatus,
    saveError,
    onChange,
    flush,
  };
}
