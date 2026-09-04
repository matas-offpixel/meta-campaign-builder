"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createDefaultTikTokDraft, type TikTokCampaignDraft } from "@/lib/types/tiktok-draft";

export type SaveStatus = "idle" | "saving" | "saved";

export type TikTokDraftController = ReturnType<typeof useTikTokDraft>;

/**
 * One TikTok draft, loaded once and persisted on every `onSave`.
 *
 * The save queue is the same serial PATCH the wizard shell used — two
 * in-flight writes would race the merge. `flush` waits for the queue so
 * Done never closes on a pending write.
 */
export function useTikTokDraft(
  draftId: string,
  initial?: TikTokCampaignDraft | null,
) {
  const [draft, setDraft] = useState<TikTokCampaignDraft>(
    () => initial ?? createDefaultTikTokDraft(draftId),
  );
  const [hydrated, setHydrated] = useState(Boolean(initial));
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const saveQueue = useRef(Promise.resolve());

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/tiktok/drafts/${encodeURIComponent(draftId)}`);
      const json = (await res.json().catch(() => null)) as
        | { ok: true; draft: TikTokCampaignDraft }
        | { ok: false }
        | null;
      if (cancelled) return;
      if (res.ok && json && json.ok) setDraft(json.draft);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [draftId, initial]);

  const saveDraftNow = useCallback(async (patch: Partial<TikTokCampaignDraft>) => {
    const current = draftRef.current;
    const optimistic = mergeTikTokDraft(current, patch);
    draftRef.current = optimistic;
    setDraft(optimistic);
    setSaveStatus("saving");
    setSaveError(null);
    const res = await fetch(`/api/tiktok/drafts/${encodeURIComponent(current.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = (await res.json().catch(() => null)) as
      | { ok: true; draft: TikTokCampaignDraft }
      | { ok: false; error: string }
      | null;
    if (!res.ok || !json?.ok) {
      draftRef.current = current;
      setDraft(current);
      const message = json && !json.ok ? json.error : "Failed to save draft";
      setSaveError(message);
      setSaveStatus("idle");
      throw new Error(message);
    }
    draftRef.current = json.draft;
    setDraft(json.draft);
    setSaveStatus("saved");
    window.setTimeout(() => setSaveStatus("idle"), 1500);
  }, []);

  const saveDraft = useCallback(
    (patch: Partial<TikTokCampaignDraft>) => {
      const run = saveQueue.current.then(() => saveDraftNow(patch));
      saveQueue.current = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    [saveDraftNow],
  );

  const flush = useCallback(async () => {
    await saveQueue.current;
  }, []);

  return {
    draft,
    setDraft,
    draftRef,
    hydrated,
    saveStatus,
    saveError,
    saveDraft,
    flush,
  };
}

function mergeTikTokDraft(
  current: TikTokCampaignDraft,
  patch: Partial<TikTokCampaignDraft>,
): TikTokCampaignDraft {
  return {
    ...current,
    ...patch,
    accountSetup: { ...current.accountSetup, ...(patch.accountSetup ?? {}) },
    campaignSetup: { ...current.campaignSetup, ...(patch.campaignSetup ?? {}) },
    optimisation: { ...current.optimisation, ...(patch.optimisation ?? {}) },
    audiences: { ...current.audiences, ...(patch.audiences ?? {}) },
    creatives: { ...current.creatives, ...(patch.creatives ?? {}) },
    budgetSchedule: { ...current.budgetSchedule, ...(patch.budgetSchedule ?? {}) },
    creativeAssignments: {
      ...current.creativeAssignments,
      ...(patch.creativeAssignments ?? {}),
    },
  };
}
