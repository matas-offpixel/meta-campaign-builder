"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { WizardFooter } from "./wizard-footer";
import { MetaDrawer } from "@/components/plan/meta-drawer";
import { ReviewLaunch } from "@/components/steps/review-launch";
import type { CampaignDraft, LaunchSummary } from "@/lib/types";
import { validateStep } from "@/lib/validation";
import { saveDraftToStorage } from "@/lib/autosave";
import { useLaunchCampaign } from "@/lib/hooks/useLaunchCampaign";
import { useBucCooldown } from "@/lib/hooks/useBucCooldown";
import { getCachedUserPages } from "@/lib/hooks/useMeta";
import { FacebookConnectionBanner } from "@/components/facebook-connection-banner";
import {
  WizardEventContextProvider,
  useWizardEventContext,
} from "@/lib/wizard/use-event-context";
import { derivePlanName } from "@/lib/plan/plan-name";
import { useCampaignDraft } from "@/lib/wizard/use-campaign-draft";
import type { LinkedPlanSummary } from "@/lib/plan/linked-plan";

interface WizardShellProps {
  draftId: string;
  /** Set when this draft belongs to a campaign plan. Ordinary drafts omit it. */
  linkedPlan?: LinkedPlanSummary | null;
}

export function WizardShell({ draftId, linkedPlan = null }: WizardShellProps) {
  const router = useRouter();
  /** One loader, one autosave, shared with the drawer on `/plan/[id]`. */
  const draftController = useCampaignDraft(draftId);
  const {
    draft,
    setDraft,
    draftRef,
    hydrated,
    userId,
    saveStatus,
    autosave,
    updateDraft,
    updateSettings,
    updateAudiences,
  } = draftController;

  // Launch state
  const { mutate: launchCampaign, loading: launching, error: launchError, rateLimit: launchRateLimit, resetError: dismissLaunchError } = useLaunchCampaign();
  const [launchSummary, setLaunchSummary] = useState<LaunchSummary | null>(null);
  const launchAccountId = draft.settings.metaAdAccountId || draft.settings.adAccountId || null;
  const launchCooldown = useBucCooldown(launchAccountId, launchRateLimit);

  // After a launch, auto-deselect engagement types that failed with permission errors
  // for every page in a group. This prevents repeated failed API calls on the next launch
  // without requiring manual intervention.
  useEffect(() => {
    if (!launchSummary?.engagementAudiencesFailed?.length) return;

    // Collect per-type permission failures — map: pageId → Set<engagementType>
    const permFailedByPage = new Map<string, Set<string>>();
    for (const f of launchSummary.engagementAudiencesFailed) {
      if (!f.isPermissionFailure || !f.pageId || !f.type) continue;
      if (!permFailedByPage.has(f.pageId)) permFailedByPage.set(f.pageId, new Set());
      permFailedByPage.get(f.pageId)!.add(f.type);
    }
    if (permFailedByPage.size === 0) return;

    const currentGroups = draftRef.current.audiences.pageGroups;
    const updated = currentGroups.map((g) => {
      if (g.pageIds.length === 0 || g.engagementTypes.length === 0) return g;

      // A type should be deselected only if ALL pages in the group failed it with a permission error
      const typesToRemove = g.engagementTypes.filter((et) =>
        g.pageIds.every((pageId) => permFailedByPage.get(pageId)?.has(et)),
      );
      if (typesToRemove.length === 0) return g;

      console.log(
        `[WizardShell] Auto-deselecting engagement types for group "${g.name}":`,
        typesToRemove,
        "— all pages in group had permission failures for these types",
      );
      return {
        ...g,
        engagementTypes: g.engagementTypes.filter((et) => !typesToRemove.includes(et)),
      };
    });

    const changed = updated.some(
      (g, i) => g.engagementTypes.length !== currentGroups[i].engagementTypes.length,
    );
    if (changed) {
      updateAudiences({ ...draftRef.current.audiences, pageGroups: updated });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchSummary]);

  // After launch, persist updatedEngagementStatuses back into the draft so
  // the next launch/retry knows which source audiences already exist in Meta.
  useEffect(() => {
    if (!launchSummary?.updatedEngagementStatuses?.length) return;
    const currentGroups = draftRef.current.audiences.pageGroups;
    let changed = false;
    const updatedGroups = currentGroups.map((g) => {
      const incoming = launchSummary.updatedEngagementStatuses!.find((u) => u.groupId === g.id);
      if (!incoming) return g;
      changed = true;
      return { ...g, engagementAudienceStatuses: incoming.statuses };
    });
    if (changed) {
      updateAudiences({ ...draftRef.current.audiences, pageGroups: updatedGroups });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchSummary]);

  // After launch, persist custom group lookalike IDs back into the draft.
  useEffect(() => {
    if (!launchSummary?.updatedCustomGroupLookalikes?.length) return;
    const currentCAGroups = draftRef.current.audiences.customAudienceGroups;
    let changed = false;
    const updated = currentCAGroups.map((g) => {
      const incoming = launchSummary.updatedCustomGroupLookalikes!.find((u) => u.groupId === g.id);
      if (!incoming) return g;
      changed = true;
      return { ...g, lookalikeAudienceIdsByRange: incoming.lookalikeAudienceIdsByRange };
    });
    if (changed) {
      updateAudiences({ ...draftRef.current.audiences, customAudienceGroups: updated });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchSummary]);

  // ─── Validation ─────────────────────────────────────────────────────────────
  /**
   * Step 7 aggregates every visible step, so with the stepper gone this one
   * call is the whole draft's readiness — the same value the old footer
   * showed on the last step, now shown always.
   */
  const currentValidation = useMemo(() => validateStep(7, draft), [draft]);

  const handleSaveDraft = () => autosave(draft);

  const handleLaunch = async () => {
    if (launchCooldown.blocked) return;
    const review = validateStep(7, draft);
    if (!review.valid) {
      alert(`Cannot launch:\n${review.errors.join("\n")}`);
      return;
    }

    const adAccountId = draft.settings.metaAdAccountId || draft.settings.adAccountId;
    console.log(
      "[WizardShell] handleLaunch — metaAdAccountId:", draft.settings.metaAdAccountId || "(empty)",
      "| adAccountId:", draft.settings.adAccountId || "(empty)",
      "| resolved:", adAccountId || "(NONE — will abort)",
    );
    if (!adAccountId) {
      alert("No ad account selected. Go back to Account Setup.");
      return;
    }

    try {
      // Build page → IG account ID map from the enriched pages cache.
      // The cache was populated using the user's Facebook OAuth token, which
      // correctly resolves both instagram_business_account AND
      // connected_instagram_account. The server-side token used by
      // fetchInstagramAccounts() is a system/app token that may not see these
      // user-level page→IG connections, so we send the map explicitly.
      const cachedPages = getCachedUserPages();
      const igAccountMap: Record<string, string> = {};

      // Highest priority: explicit operator picks (multi-IG pages).
      for (const [pageId, igId] of Object.entries(draft.settings.pageInstagramOverrides ?? {})) {
        if (pageId && igId) igAccountMap[pageId] = igId;
      }

      // Creative identity selections (per-ad IG dropdown).
      for (const c of draft.creatives) {
        const pageId = c.identity?.pageId;
        const igId = c.identity?.instagramAccountId;
        if (pageId && igId && !igAccountMap[pageId]) {
          igAccountMap[pageId] = igId;
        }
      }

      // Enriched pages cache fallback (one IG per page — may be wrong on multi-IG pages).
      for (const page of cachedPages) {
        const igId = page.instagramAccountId;
        if (page.id && igId && !igAccountMap[page.id]) {
          igAccountMap[page.id] = igId;
        }
      }
      console.log(
        "[WizardShell] handleLaunch — igAccountMap from cache:",
        Object.keys(igAccountMap).length, "entries",
        Object.entries(igAccountMap).map(([pid, igId]) => `${pid}→${igId}`).join(", ") || "(none)",
      );

      // Single server-side call — runs all 4 phases and saves to Supabase
      const result = await launchCampaign(draft, { igAccountMap });

      // Store launch summary on the draft without overwriting editable fields.
      // adSetSuggestions and creatives are left intact so re-launches start
      // from a clean state without stale metaAdSetId / metaCreativeId values.
      const published: CampaignDraft = {
        ...draft,
        metaCampaignId: result.metaCampaignId,
        launchSummary: result,
        status: "published",
        updatedAt: new Date().toISOString(),
      };

      setDraft(published);
      setLaunchSummary(result);
      saveDraftToStorage(published);
      // Supabase persistence is handled by the server route — no client-side save needed
    } catch {
      // Error is captured in launchError from the hook — ReviewLaunch renders the error modal
    }
  };

  const handleBackToLibrary = () => {
    autosave(draft);
    router.push("/");
  };

  /*
    The template loader moved into the drawer header (§3 build D) — one
    `⌁ template ▸`, reading the same `lib/db/templates.ts`. The wizard's
    own Load-Template modal, its footer button and the "Loaded from
    template" banner all stop rendering here rather than becoming a
    second way to do it.
  */

  // ─── Loading gate ────────────────────────────────────────────────────────────
  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading campaign…</p>
      </div>
    );
  }

  return (
    <WizardEventContextProvider draftId={draftId} enabled={hydrated}>
      <EventDefaultsApplier updateDraft={updateDraft} />
      <div className="flex min-h-screen flex-col">
      {/* Back to library link */}
      <div className="border-b border-border bg-card px-6 py-2">
        <div className="mx-auto max-w-5xl">
          <button
            type="button"
            onClick={handleBackToLibrary}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground
              hover:text-foreground hover:bg-muted transition-colors -ml-2"
          >
            <ArrowLeft className="h-3 w-3" />
            Campaign Library
          </button>
        </div>
      </div>

      <FacebookConnectionBanner onGoToAccountSetup={() => undefined} />

      <main className="mx-auto w-full max-w-5xl flex-1 overflow-y-auto px-6 py-6">
        {/*
          The drawer is the Meta wizard (§3a). Rendered `variant="page"`
          there is no canvas behind it, but it is the same shell, the same
          three tabs and the same `details` — `/plan/[id]` and
          `/campaign/[id]` do not fork.
        */}
        <MetaDrawer
          open
          variant="page"
          controller={draftController}
          planId={linkedPlan?.id ?? null}
          onClose={handleBackToLibrary}
          doneLabel="Campaign Library"
        />

        {/*
          Launch stays here for a standalone draft and only there: a
          plan-linked draft launches from the canvas with the other
          channels, so rendering Launch twice would be two ways to start
          the same campaign (§3a row 8, friction #6).
        */}
        {!linkedPlan && (
          <ReviewLaunch
            draft={draft}
            isLaunching={launching}
            launchError={launchError}
            launchRateLimit={launchRateLimit}
            onDismissLaunchError={dismissLaunchError}
            launchSummary={launchSummary}
            onGoToLibrary={() => router.push("/")}
            linkedPlan={linkedPlan}
            onUpdateSettings={updateSettings}
            onRetryFailedAds={handleLaunch}
            onRetryLaunch={handleLaunch}
          />
        )}
      </main>

      <WizardFooter
        canLaunch={currentValidation.valid}
        validationErrors={currentValidation.errors}
        saveStatus={saveStatus}
        launching={launching}
        launchCooldownLabel={launchCooldown.label}
        /* A plan-linked draft launches from the canvas, never from here. */
        showLaunch={!linkedPlan}
        planHref={linkedPlan ? `/plan/${linkedPlan.id}` : null}
        onSaveDraft={handleSaveDraft}
        onLaunch={handleLaunch}
      />

      </div>
    </WizardEventContextProvider>
  );
}

// ─── Event-context defaults applier ──────────────────────────────────────────
//
// Mounted inside the WizardEventContextProvider once the wizard is
// hydrated. On the first render where the context fetch completes, it
// soft-fills the draft with values derived from the linked event +
// client: ad account / pixel / pages from client defaults, campaign
// name + event_code from the event, schedule start/end from today +
// event_date. Only ever touches fields that are still empty — user
// edits always win.
//
// Guarded by a ref so navigating between steps (which re-renders
// everything but doesn't change the draft id) doesn't reapply the
// defaults and stomp on the user's edits.

interface DefaultsApplierProps {
  /**
   * Functional updater. We deliberately don't take the live draft as
   * a prop — the effect runs once after context loads and uses the
   * functional form so we always read the freshest settings, never
   * a stale snapshot.
   */
  updateDraft: (updater: (d: CampaignDraft) => CampaignDraft) => void;
}

function EventDefaultsApplier({ updateDraft }: DefaultsApplierProps) {
  const { event, client, loaded } = useWizardEventContext();
  const appliedRef = useRef(false);

  useEffect(() => {
    if (appliedRef.current) return;
    if (!loaded) return;
    if (!event && !client) {
      // Nothing to fill — still flip the flag so we don't keep waking
      // on every render.
      appliedRef.current = true;
      return;
    }

    // Snapshot once so the effect doesn't depend on the draft itself
    // (we want it to run exactly once after context loads, never after
    // a user edit). The applier reads through draftRef-style closure
    // capture but we deliberately call updateDraft with the latest
    // draft via the functional updater — see below.
    updateDraft((d) => {
      const next: CampaignDraft = { ...d, settings: { ...d.settings } };
      const s = next.settings;

      if (client) {
        const clientAdAccount = client.meta_ad_account_id ?? null;
        if (clientAdAccount && !s.adAccountId && !s.metaAdAccountId) {
          s.adAccountId = clientAdAccount;
          s.metaAdAccountId = clientAdAccount;
        }
        const clientPixel = client.meta_pixel_id ?? null;
        if (clientPixel && !s.pixelId && !s.metaPixelId) {
          s.pixelId = clientPixel;
          s.metaPixelId = clientPixel;
        }
        const clientPages = client.default_page_ids ?? [];
        if (clientPages.length > 0 && !s.metaPageId) {
          s.metaPageId = clientPages[0];
        }
        if (!s.clientId && client.id) {
          s.clientId = client.id;
        }
      }

      if (event) {
        if (!s.campaignName) {
          // Same rule as the plan canvas header — see lib/plan/plan-name.ts.
          s.campaignName = derivePlanName({
            name: event.name,
            announcementAt: event.announcement_at,
            presaleAt: event.presale_at,
            generalSaleAt: event.general_sale_at,
            eventDate: event.event_date,
            eventStartAt: event.event_start_at,
          });
        }
        if (!s.campaignCode && event.event_code) {
          s.campaignCode = event.event_code;
        }
      }

      // Schedule defaults: start = today (yyyy-mm-ddT00:00 in local
      // tz), end = event_date end-of-day. The Input is type
      // datetime-local so the value must be a 16-char local string
      // ("YYYY-MM-DDThh:mm"); UTC ISO breaks the picker.
      const bs = next.budgetSchedule
        ? { ...next.budgetSchedule }
        : null;
      if (bs) {
        if (!bs.startDate) {
          bs.startDate = formatLocalDateTime(new Date(), { hour: 0, minute: 0 });
        }
        if (!bs.endDate && event?.event_date) {
          bs.endDate = `${event.event_date}T23:59`;
        }
        next.budgetSchedule = bs;
      }

      appliedRef.current = true;
      return next;
    });
  }, [loaded, event, client, updateDraft]);

  return null;
}

/**
 * Format a Date as the local "YYYY-MM-DDThh:mm" string expected by
 * <input type="datetime-local"> — ISO is UTC and breaks the picker
 * across timezones.
 */
function formatLocalDateTime(
  date: Date,
  override?: { hour?: number; minute?: number },
): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(override?.hour ?? date.getHours()).padStart(2, "0");
  const mm = String(override?.minute ?? date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}
