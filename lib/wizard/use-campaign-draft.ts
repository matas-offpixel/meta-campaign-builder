"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { loadDraftFromStorage, saveDraftToStorage } from "@/lib/autosave";
import { createDefaultDraft } from "@/lib/campaign-defaults";
import { loadDraftById, saveDraftToDb } from "@/lib/db/drafts";
import { applyPageInstagramOverrideToCreative } from "@/lib/meta/apply-page-instagram-overrides";
import { createClient } from "@/lib/supabase/client";
import type {
  AdCreativeDraft,
  AdSetSuggestion,
  AudienceSettings,
  BudgetScheduleSettings,
  CampaignDraft,
  CampaignSettings,
  CreativeAssignmentMatrix,
  OptimisationStrategySettings,
} from "@/lib/types";

export type SaveStatus = "idle" | "saving" | "saved";

/** Everything a surface needs to read and write one draft. */
export type CampaignDraftController = ReturnType<typeof useCampaignDraft>;

/**
 * One draft, loaded once and persisted on every edit.
 *
 * Extracted verbatim from `wizard-shell.tsx` so the Meta drawer and the
 * wizard share one loader, one autosave and one set of field updaters.
 * The drawer is the Meta wizard from PR 4 on, and two copies of this
 * would be two ways for a draft to drift.
 *
 * Persistence is unchanged: `localStorage` always, Supabase when signed
 * in, debounced 1.5s on edit and flushed immediately by `flush()`.
 */
export function useCampaignDraft(draftId: string) {
  const [draft, setDraft] = useState<CampaignDraft>(createDefaultDraft);
  const [hydrated, setHydrated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  const userIdRef = useRef<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The latest draft, for the callbacks that fire outside render — the
   * debounced save and `flush`. Synced in an effect rather than during
   * render: nothing reads it while rendering, so being one commit behind
   * a render is unobservable, and writing a ref during render is not.
   */
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        if (cancelled) return;
        setUserId(user.id);
        userIdRef.current = user.id;
        const remoteDraft = await loadDraftById(draftId);
        if (cancelled) return;
        if (remoteDraft) {
          setDraft(remoteDraft);
          saveDraftToStorage(remoteDraft);
        } else {
          const fresh = createDefaultDraft();
          fresh.id = draftId;
          setDraft(fresh);
        }
      } else {
        const localDraft = loadDraftFromStorage();
        if (cancelled) return;
        if (localDraft) setDraft(localDraft);
      }
      if (!cancelled) setHydrated(true);
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  const autosave = useCallback((d: CampaignDraft) => {
    setSaveStatus("saving");
    saveDraftToStorage(d);
    if (userIdRef.current) {
      saveDraftToDb(d, userIdRef.current).catch(console.warn);
    }
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      setSaveStatus("saved");
      saveTimeoutRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
    }, 400);
  }, []);

  const scheduleAutosave = useCallback(() => {
    if (debounceSaveRef.current) clearTimeout(debounceSaveRef.current);
    debounceSaveRef.current = setTimeout(() => {
      autosave(draftRef.current);
    }, 1500);
  }, [autosave]);

  /** Persist now, cancelling any pending debounce. Used when a surface closes. */
  const flush = useCallback(() => {
    if (debounceSaveRef.current) {
      clearTimeout(debounceSaveRef.current);
      debounceSaveRef.current = null;
    }
    autosave(draftRef.current);
  }, [autosave]);

  const updateDraft = useCallback(
    (updater: (d: CampaignDraft) => CampaignDraft) => {
      setDraft((prev) => ({ ...updater(prev), updatedAt: new Date().toISOString() }));
      scheduleAutosave();
    },
    [scheduleAutosave],
  );

  const updateSettings = useCallback(
    (settings: CampaignSettings) => updateDraft((d) => ({ ...d, settings })),
    [updateDraft],
  );

  const updateAudiences = useCallback(
    (audiences: AudienceSettings) => updateDraft((d) => ({ ...d, audiences })),
    [updateDraft],
  );

  const updateCreatives = useCallback(
    (creatives: AdCreativeDraft[]) => updateDraft((d) => ({ ...d, creatives })),
    [updateDraft],
  );

  /** Sync settings.pageInstagramOverrides AND per-creative identity ids. */
  const handlePageInstagramOverride = useCallback(
    (pageId: string, igId: string) => {
      updateDraft((d) => {
        const overrides = { ...(d.settings.pageInstagramOverrides ?? {}) };
        if (igId) overrides[pageId] = igId;
        else delete overrides[pageId];

        const creatives = d.creatives.map((c) => {
          if (c.identity?.pageId !== pageId) return c;
          if (!igId) {
            return {
              ...c,
              identity: {
                ...(c.identity ?? { pageId, instagramAccountId: "" }),
                pageId,
                instagramAccountId: "",
                instagramActorId: "",
              },
            };
          }
          return applyPageInstagramOverrideToCreative(c, { [pageId]: igId });
        });

        return {
          ...d,
          settings: { ...d.settings, pageInstagramOverrides: overrides },
          creatives,
        };
      });
    },
    [updateDraft],
  );

  const updateBudgetSchedule = useCallback(
    (budgetSchedule: BudgetScheduleSettings) => updateDraft((d) => ({ ...d, budgetSchedule })),
    [updateDraft],
  );

  const updateAdSetSuggestions = useCallback(
    (adSetSuggestions: AdSetSuggestion[]) => updateDraft((d) => ({ ...d, adSetSuggestions })),
    [updateDraft],
  );

  const updateOptimisationStrategy = useCallback(
    (optimisationStrategy: OptimisationStrategySettings) =>
      updateDraft((d) => ({ ...d, optimisationStrategy })),
    [updateDraft],
  );

  const updateCreativeAssignments = useCallback(
    (creativeAssignments: CreativeAssignmentMatrix) =>
      updateDraft((d) => ({ ...d, creativeAssignments })),
    [updateDraft],
  );

  return {
    draft,
    setDraft,
    draftRef,
    hydrated,
    userId,
    setUserId,
    userIdRef,
    saveStatus,
    autosave,
    scheduleAutosave,
    flush,
    updateDraft,
    updateSettings,
    updateAudiences,
    updateCreatives,
    handlePageInstagramOverride,
    updateBudgetSchedule,
    updateAdSetSuggestions,
    updateOptimisationStrategy,
    updateCreativeAssignments,
  };
}
