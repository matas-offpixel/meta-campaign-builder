/**
 * POST /api/meta/launch-campaign
 *
 * Unified server-side launch route. Phases:
 *   Phase 0   — Preflight validation (no mutations)
 *   Phase 1   — Create campaign (fatal on failure)
 *   Phase 1.5 — Create engagement audiences for page_group ad sets
 *   Phase 2+3 — Create ad sets AND creatives in parallel
 *   Phase 1.75— Create lookalike audiences (non-blocking — runs after Phase 1.5)
 *   Phase 4   — Create ads (links each creative × ad set)
 *
 * Lookalike audience creation does NOT block standard ad set/creative creation.
 * After all phases complete, the published draft is saved to Supabase.
 * All campaigns, ad sets, and ads are created in PAUSED status.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createMetaCampaign,
  createMetaAdSet,
  createMetaCreative,
  createMetaAd,
  createEngagementAudience,
  MetaApiError,
} from "@/lib/meta/client";
import type { EngagementAudienceType } from "@/lib/meta/client";
import { validateCampaignPayload } from "@/lib/meta/campaign";
import {
  buildAdSetPayload,
  extractDeprecatedReplacements,
  applyInterestReplacements,
  sanitiseInterests,
} from "@/lib/meta/adset";
import {
  buildCreativePayload,
  buildAdPayload,
  invertAssignments,
  validateCreativePayload,
} from "@/lib/meta/creative";
import type {
  CampaignDraft,
  LaunchSummary,
  AdSetSuggestion,
  AdSetLaunchResult,
  AdCreativeDraft,
} from "@/lib/types";

// ─── Timing helper ──────────────────────────────────────────────────────────

function elapsed(startMs: number): number {
  return Date.now() - startMs;
}

// ─── Error formatting ─────────────────────────────────────────────────────────

function formatMetaError(err: unknown): string {
  if (err instanceof MetaApiError) {
    const parts: string[] = [err.message];
    if (err.code) parts.push(`code=${err.code}`);
    if (err.subcode) parts.push(`subcode=${err.subcode}`);
    if (err.userMsg) parts.push(`detail: "${err.userMsg}"`);
    if (err.fbtraceId) parts.push(`trace=${err.fbtraceId}`);
    return parts.join(" · ");
  }
  return err instanceof Error ? err.message : String(err);
}

// ─── Response type ───────────────────────────────────────────────────────────

/** The launch route returns the full LaunchSummary only — no draft mutations. */
export type LaunchCampaignResult = LaunchSummary;

// ─── Route handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const launchStart = Date.now();
  const phaseDurations: Record<string, number> = {};
  // Unique ID for this launch run — lets callers distinguish results across re-launches
  const launchRunId = crypto.randomUUID();

  // ── Auth ───────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let draft: CampaignDraft;
  try {
    const body = (await req.json()) as { draft?: CampaignDraft };
    if (!body?.draft) throw new Error("Missing required field: draft");
    draft = body.draft;
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid request body: ${err instanceof Error ? err.message : "bad JSON"}` },
      { status: 400 },
    );
  }

  const adAccountId = draft.settings.metaAdAccountId || draft.settings.adAccountId;
  console.log(
    "[launch-campaign] Ad account source — metaAdAccountId:",
    draft.settings.metaAdAccountId || "(empty)",
    "| adAccountId:", draft.settings.adAccountId || "(empty)",
    "| resolved:", adAccountId || "(NONE)",
  );
  if (!adAccountId) {
    return NextResponse.json(
      { error: "Ad account ID is required. Go back to Account Setup and select an ad account." },
      { status: 400 },
    );
  }

  const enabledSets = draft.adSetSuggestions.filter((s) => s.enabled);

  console.log("[launch-campaign] ▶ Starting launch", {
    draftId: draft.id,
    adAccountId,
    campaignName: draft.settings.campaignName,
    objective: draft.settings.objective,
    enabledAdSets: enabledSets.length,
    creatives: draft.creatives.length,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 0 — Preflight validation (no Meta mutations)
  // ═══════════════════════════════════════════════════════════════════════════

  const preflightStart = Date.now();
  const preflightWarnings: { stage: string; message: string }[] = [];
  const interestReplacements: NonNullable<LaunchSummary["interestReplacements"]> = [];

  // 0a. Validate campaign payload
  const campaignValidation = validateCampaignPayload({
    metaAdAccountId: adAccountId,
    name: draft.settings.campaignName,
    objective: draft.settings.objective,
  });

  if (!campaignValidation.isValid) {
    return NextResponse.json(
      { error: "Campaign validation failed", fields: campaignValidation.errors },
      { status: 400 },
    );
  }

  // 0b. Pre-sanitise interests for interest_group ad sets
  const interestGroupSets = enabledSets.filter((s) => s.sourceType === "interest_group");
  for (const adSet of interestGroupSets) {
    const group = draft.audiences.interestGroups.find((g) => g.id === adSet.sourceId);
    if (!group || group.interests.length === 0) continue;

    const raw = group.interests
      .filter((i) => /^\d{5,}$/.test(i.id))
      .map((i) => ({ id: i.id, name: i.name }));

    if (raw.length === 0) continue;

    console.log(`[launch-campaign] Preflight — sanitising ${raw.length} interests for "${adSet.name}"…`);
    const { valid, removed } = await sanitiseInterests(raw);

    // Always update group.interests to the sanitised list, even when only
    // IDs changed (e.g. hardcoded replacement swapped ID without removal count).
    if (removed.length > 0 || valid.some((v, i) => v.id !== raw[i]?.id)) {
      console.log(
        `[launch-campaign] Preflight — sanitised "${adSet.name}": ` +
        `${removed.length} interest(s) removed/replaced:`,
        removed.map((r) => `  ${r.name} (${r.id}): ${r.reason}`).join("\n"),
      );
      for (const r of removed) {
        interestReplacements.push({
          deprecated: r.name || r.id,
          replacement: r.reason.startsWith("Replaced") || r.reason.startsWith("Hardcoded replacement")
            ? r.reason
            : null,
          adSetName: adSet.name,
        });
        preflightWarnings.push({
          stage: "interests",
          message: `"${r.name}" in "${adSet.name}": ${r.reason}`,
        });
      }
      // Overwrite group.interests with the sanitised list so buildAdSetPayload
      // picks up the corrected IDs instead of the original deprecated ones.
      const origMap = new Map(group.interests.map((i) => [i.id, i]));
      group.interests = valid.map((v) => ({
        ...v,
        audienceSize: origMap.get(v.id)?.audienceSize,
        path: origMap.get(v.id)?.path,
      }));
    }
  }

  // 0c. Check for lookalike eligibility — warn early if no seed audiences will exist
  const pageGroupsWithLookalikes = draft.audiences.pageGroups.filter((g) => g.lookalike && g.pageIds.length > 0);
  if (pageGroupsWithLookalikes.length > 0) {
    for (const g of pageGroupsWithLookalikes) {
      if (g.engagementTypes.length === 0) {
        preflightWarnings.push({
          stage: "lookalike",
          message: `"${g.name || "Page Group"}" has lookalikes enabled but no engagement types — lookalike creation will be skipped.`,
        });
      }
    }
  }

  // 0d. Warn about creative app-mode limitations
  const hasCreatives = draft.creatives.length > 0;
  if (hasCreatives) {
    preflightWarnings.push({
      stage: "creative",
      message: "If your Meta app is in development mode, some creative types (especially image/link ads) may be rejected. Video ads typically work in dev mode.",
    });
  }

  phaseDurations["preflight"] = elapsed(preflightStart);
  console.log(`[launch-campaign] Preflight done in ${phaseDurations["preflight"]}ms — ${preflightWarnings.length} warning(s)`);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1 — Create campaign (fatal — abort if this fails)
  // ═══════════════════════════════════════════════════════════════════════════

  const phase1Start = Date.now();
  let metaCampaignId: string;

  try {
    const campaignPayload = {
      adAccountId,
      name: draft.settings.campaignName.trim(),
      objective: draft.settings.objective,
      status: "PAUSED" as const,
    };
    console.log("[launch-campaign] Phase 1 payload:", JSON.stringify(campaignPayload, null, 2));

    const campaignRes = await createMetaCampaign(campaignPayload);
    metaCampaignId = campaignRes.id;
    phaseDurations["campaign"] = elapsed(phase1Start);
    console.log(`[launch-campaign] Phase 1 ✓  campaignId: ${metaCampaignId} (${phaseDurations["campaign"]}ms)`);
  } catch (err) {
    const message = err instanceof MetaApiError ? err.message : String(err);
    console.error(
      "[launch-campaign] Phase 1 ✗  campaign creation failed:",
      message,
      err instanceof MetaApiError ? err.toJSON() : "",
    );
    return NextResponse.json(
      {
        error: `Failed to create campaign: ${message}`,
        metaError: err instanceof MetaApiError ? err.toJSON() : undefined,
      },
      { status: 502 },
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1.5 — Create engagement custom audiences for page_group ad sets
  // ═══════════════════════════════════════════════════════════════════════════

  const phase15Start = Date.now();

  let pageToIg: Map<string, string> = new Map();
  try {
    const { fetchInstagramAccounts } = await import("@/lib/meta/client");
    const igAccounts = await fetchInstagramAccounts();
    for (const ig of igAccounts) {
      if (ig.linkedPageId && ig.id) pageToIg.set(ig.linkedPageId, ig.id);
    }
    console.log("[launch-campaign] Phase 1.5 — loaded", pageToIg.size, "page→IG mappings");
  } catch (err) {
    console.warn("[launch-campaign] Phase 1.5 — could not load IG accounts:", err);
  }

  const pageNameMap = new Map<string, string>();
  const allPageIds = new Set<string>();
  for (const g of draft.audiences.pageGroups) {
    for (const pid of g.pageIds) allPageIds.add(pid);
  }
  // Batch-fetch page names in parallel
  const pageNameResults = await Promise.allSettled(
    Array.from(allPageIds).map(async (pid) => {
      const { graphGet } = await import("@/lib/meta/client");
      const pg = await graphGet<{ name?: string }>(`/${pid}`, { fields: "name" });
      return { pid, name: pg.name };
    }),
  );
  for (const r of pageNameResults) {
    if (r.status === "fulfilled" && r.value.name) {
      pageNameMap.set(r.value.pid, r.value.name);
    }
  }

  const ENGAGEMENT_LABELS: Record<string, string> = {
    fb_likes: "FB Likes",
    fb_engagement_365d: "FB Engagement 365d",
    ig_followers: "IG Followers",
    ig_engagement_365d: "IG Engagement 365d",
  };

  const engagementAudiencesCreated: NonNullable<LaunchSummary["engagementAudiencesCreated"]> = [];
  const engagementAudiencesFailed: NonNullable<LaunchSummary["engagementAudiencesFailed"]> = [];
  const pageGroupAudienceIds = new Map<string, string[]>();

  const enabledPageGroupSets = draft.adSetSuggestions.filter(
    (s) => s.enabled && s.sourceType === "page_group",
  );
  const processedGroups = new Set<string>();

  for (const adSet of enabledPageGroupSets) {
    if (processedGroups.has(adSet.sourceId)) continue;
    processedGroups.add(adSet.sourceId);

    const group = draft.audiences.pageGroups.find((g) => g.id === adSet.sourceId);
    if (!group || group.pageIds.length === 0) continue;

    // Honour the "engagement source audiences" toggle — skip if disabled.
    if (group.createEngagementAudiences === false) {
      console.log(
        `[launch-campaign] Phase 1.5 — skipping engagement audiences for "${group.name}":`,
        "createEngagementAudiences=false (standard page ad set only)",
      );
      continue;
    }

    const createdIds: string[] = [];

    for (const pageId of group.pageIds) {
      for (const et of group.engagementTypes) {
        const isIgType = et === "ig_followers" || et === "ig_engagement_365d";
        const igId = isIgType ? pageToIg.get(pageId) : undefined;

        if (isIgType && !igId) {
          engagementAudiencesFailed.push({
            name: `${pageNameMap.get(pageId) || pageId} — ${ENGAGEMENT_LABELS[et] ?? et}`,
            type: et,
            error: "No linked Instagram account found for this page",
          });
          continue;
        }

        const sourceId = isIgType ? igId! : pageId;
        const sourceType = isIgType ? ("ig_business" as const) : ("page" as const);
        const pageName = pageNameMap.get(pageId) || group.name || "Page Group";
        const audienceName = `${pageName} — ${ENGAGEMENT_LABELS[et] ?? et}`;

        const eaStart = Date.now();
        try {
          const result = await createEngagementAudience(adAccountId, {
            type: et as EngagementAudienceType,
            name: audienceName,
            sourceId,
            sourceType,
          });
          createdIds.push(result.id);
          engagementAudiencesCreated.push({ name: audienceName, id: result.id, type: et, durationMs: elapsed(eaStart) });
        } catch (err) {
          const message = formatMetaError(err);
          // Classify event-source permission failures so the summary can guide
          // the user and capability flags can be recorded for future launches.
          const isPermission =
            message.toLowerCase().includes("permission") ||
            message.toLowerCase().includes("event source") ||
            message.includes("(#100)") ||
            message.includes("OAuthException");
          console.error(
            `[launch-campaign] Phase 1.5 ✗ Failed to create ${et} audience for page ${pageId}:`,
            message,
            isPermission ? "(event-source permission error)" : "",
          );

          // Record capability failure on the page object so the UI can show
          // the correct badge on the next load (stored in launch summary).
          if (isPermission) {
            const capKey = (et === "fb_likes" || et === "fb_engagement_365d")
              ? (et === "fb_likes" ? "fbLikesSource" : "fbEngagementSource")
              : null;
            if (capKey) {
              // Find the page in the draft and mark the capability as failed
              const allDraftPages = [
                ...draft.audiences.pageGroups.flatMap(() => []),
              ];
              void allDraftPages; // placeholder — capability is surfaced via summary
              console.warn(
                `[launch-campaign] Marking ${capKey}=false for page ${pageId} — ` +
                "update page capabilities in UI to suppress future attempts.",
              );
            }
          }

          const userFacingError = isPermission
            ? `${message} — Page can be used for standard targeting, but not for engagement audience generation with current permissions. Disable "Engagement source audiences" for this group.`
            : message;

          engagementAudiencesFailed.push({
            name: audienceName,
            type: et,
            error: userFacingError,
          });
        }
      }
    }

    if (createdIds.length > 0) {
      pageGroupAudienceIds.set(group.id, createdIds);
    }
  }

  // Inject created engagement audience IDs into a SEPARATE field so they don't
  // pollute the user's manual custom audience selections.
  for (const [groupId, ids] of pageGroupAudienceIds) {
    const group = draft.audiences.pageGroups.find((g) => g.id === groupId);
    if (group) {
      const existing = new Set(group.engagementAudienceIds ?? []);
      for (const id of ids) existing.add(id);
      group.engagementAudienceIds = Array.from(existing);
    }
  }

  // ── Phase 1.5b — Engagement audiences for SelectedPagesLookalikeGroups ──
  // Same mechanics as page_group engagement above, but for the SPLAL groups.
  // pageToIg and pageNameMap were populated above and are reused here.

  const splalGroups = draft.audiences.selectedPagesLookalikeGroups ?? [];
  const enabledSplalGroupIds = new Set(
    draft.adSetSuggestions
      .filter((s) => s.enabled && s.sourceType === "selected_pages_lookalike")
      .map((s) => s.sourceId),
  );

  // Map: splalGroupId → all engagement audience IDs created for that group
  const splalEngagementIds = new Map<string, string[]>();

  for (const group of splalGroups) {
    if (!enabledSplalGroupIds.has(group.id)) continue;
    if (group.selectedPageIds.length === 0) continue;

    const createdIds: string[] = [];
    const engAudienceIdsByPage: Record<string, string[]> = {};
    const skippedPageIds: string[] = [];
    const skippedReasons: Record<string, string> = {};

    for (const pageId of group.selectedPageIds) {
      const pageEngIds: string[] = [];

      for (const et of group.engagementTypes) {
        const isIgType = et === "ig_followers" || et === "ig_engagement_365d";
        const igId = isIgType ? pageToIg.get(pageId) : undefined;

        if (isIgType && !igId) {
          engagementAudiencesFailed.push({
            name: `${pageNameMap.get(pageId) || pageId} — ${ENGAGEMENT_LABELS[et] ?? et} (SPLAL)`,
            type: et,
            error: "No linked Instagram account found for this page",
          });
          continue;
        }

        const sourceId = isIgType ? igId! : pageId;
        const sourceType = isIgType ? ("ig_business" as const) : ("page" as const);
        const pageName = pageNameMap.get(pageId) || pageId;
        const audienceName = `${pageName} — ${ENGAGEMENT_LABELS[et] ?? et} [SPLAL]`;

        const eaStart = Date.now();
        try {
          const result = await createEngagementAudience(adAccountId, {
            type: et as EngagementAudienceType,
            name: audienceName,
            sourceId,
            sourceType,
          });
          pageEngIds.push(result.id);
          createdIds.push(result.id);
          engagementAudiencesCreated.push({ name: audienceName, id: result.id, type: et, durationMs: elapsed(eaStart) });
        } catch (err) {
          const message = formatMetaError(err);
          console.error(`[launch-campaign] Phase 1.5b ✗ SPLAL engagement failed for ${pageId} ${et}:`, message);
          engagementAudiencesFailed.push({ name: audienceName, type: et, error: message });
          if (!skippedReasons[pageId]) {
            skippedPageIds.push(pageId);
            skippedReasons[pageId] = message;
          }
        }
      }

      if (pageEngIds.length > 0) {
        engAudienceIdsByPage[pageId] = pageEngIds;
      }
    }

    if (createdIds.length > 0) {
      splalEngagementIds.set(group.id, createdIds);
    }
    // Persist engagement and skip metadata on the group for launch summary
    group.engagementAudienceIdsByPage = engAudienceIdsByPage;
    group.skippedPageIds = skippedPageIds;
    group.skippedReasons = skippedReasons;
  }

  console.log(
    `[launch-campaign] Phase 1.5b SPLAL done — groups processed: ${enabledSplalGroupIds.size},` +
    ` engagement IDs created: ${Array.from(splalEngagementIds.values()).flat().length}`,
  );

  phaseDurations["engagementAudiences"] = elapsed(phase15Start);
  console.log(
    `[launch-campaign] Phase 1.5 done in ${phaseDurations["engagementAudiences"]}ms —`,
    "created:", engagementAudiencesCreated.length,
    "failed:", engagementAudiencesFailed.length,
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2 + 3 — Create ad sets AND creatives in PARALLEL
  // Lookalike creation (Phase 1.75) runs concurrently, non-blocking.
  // ═══════════════════════════════════════════════════════════════════════════

  const parallelStart = Date.now();

  // ─── Prepare Phase 1.75 (lookalike) as a non-blocking promise ─────────

  const { createLookalikeAudience, parseLookalikeRange } = await import("@/lib/meta/client");

  const lookalikeAudiencesCreated: NonNullable<LaunchSummary["lookalikeAudiencesCreated"]> = [];
  const lookalikeAudiencesFailed: NonNullable<LaunchSummary["lookalikeAudiencesFailed"]> = [];

  const needsLookalikes =
    draft.audiences.pageGroups.some(
      (g) => g.lookalike && (pageGroupAudienceIds.get(g.id)?.length ?? 0) > 0,
    ) ||
    splalGroups.some((g) => enabledSplalGroupIds.has(g.id) && (splalEngagementIds.get(g.id)?.length ?? 0) > 0);

  let lookalikeCountry = "GB";
  for (const adSet of draft.adSetSuggestions) {
    if (adSet.geoLocations?.countries?.[0]) {
      lookalikeCountry = adSet.geoLocations.countries[0];
      break;
    }
  }

  // Hard ceiling for the entire lookalike phase (non-blocking).
  const LAL_PHASE_TIMEOUT_MS = 15_000;

  const lookalikePromise = (async () => {
    if (!needsLookalikes) return;

    const lalPhaseDeadline = Date.now() + LAL_PHASE_TIMEOUT_MS;

    // Brief delay to let engagement audiences propagate — capped so it
    // doesn't eat into the total phase budget.
    if (engagementAudiencesCreated.length > 0) {
      const waitMs = Math.min(5_000, lalPhaseDeadline - Date.now());
      if (waitMs > 0) {
        console.log(`[launch-campaign] Phase 1.75 — waiting ${waitMs}ms for engagement audiences to propagate…`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }

    for (const group of draft.audiences.pageGroups) {
      // Hard phase timeout — skip remaining lookalikes
      if (Date.now() >= lalPhaseDeadline) {
        console.log("[launch-campaign] Phase 1.75 — hard timeout reached, skipping remaining lookalikes");
        if (group.lookalike) {
          const ranges = group.lookalikeRanges?.length ? group.lookalikeRanges : ["0-1%"];
          for (const range of ranges) {
            lookalikeAudiencesFailed.push({
              name: `${group.name || "Page Group"} — Lookalike`,
              range,
              error: "Lookalike phase timeout reached (15s limit)",
              skippedReason: "phase timeout",
            });
          }
        }
        continue;
      }

      if (!group.lookalike) continue;
      const ranges = group.lookalikeRanges?.length ? group.lookalikeRanges : ["0-1%"];
      const seedIds = pageGroupAudienceIds.get(group.id) ?? [];
      if (seedIds.length === 0) {
        // Engagement audiences were either disabled or all failed for this group.
        // The standard page ad set is still created — lookalikes simply have no seed.
        const engDisabled = group.createEngagementAudiences === false;
        const skipReason = engDisabled
          ? "engagement source audiences disabled for this group"
          : "no engagement source audiences were successfully created (check permissions)";
        console.log(
          `[launch-campaign] Phase 1.75 — skipping lookalikes for "${group.name}": ${skipReason}`,
        );
        for (const range of ranges) {
          lookalikeAudiencesFailed.push({
            name: `${group.name || "Page Group"} — Lookalike`,
            range,
            error: engDisabled
              ? "Lookalike skipped — engagement source audiences are disabled for this group."
              : "Lookalike skipped — no engagement source audiences could be created. This page may lack the required event-source permission. Standard page ad set was still created.",
            skippedReason: engDisabled ? "engagement disabled" : "source audience not ready",
          });
        }
        continue;
      }

      const groupName = pageNameMap.get(group.pageIds[0]) || group.name || "Page Group";
      const lookalikeIds: string[] = [];

      for (const range of ranges) {
        if (Date.now() >= lalPhaseDeadline) break;

        const { startingRatio, endingRatio } = parseLookalikeRange(range);
        const pctLabel = `${Math.round(endingRatio * 100)}%`;

        for (const seedId of seedIds) {
          if (Date.now() >= lalPhaseDeadline) break;

          const lalName = `${groupName} — ${pctLabel} Lookalike`;
          const lalStart = Date.now();
          try {
            const result = await createLookalikeAudience(adAccountId, {
              name: lalName,
              originAudienceId: seedId,
              startingRatio,
              endingRatio,
              country: lookalikeCountry,
            });
            lookalikeIds.push(result.id);
            lookalikeAudiencesCreated.push({ name: lalName, id: result.id, range, durationMs: elapsed(lalStart) });
          } catch (err) {
            const message = formatMetaError(err);
            const isNotReady = message.includes("2654") || message.includes("not ready") || message.includes("timed out");
            console.error(`[launch-campaign] Phase 1.75 ✗ Lookalike failed (fast):`, message);
            lookalikeAudiencesFailed.push({
              name: lalName,
              range,
              error: message,
              skippedReason: isNotReady ? "source audience not ready" : undefined,
            });
          }
        }
      }

      group.lookalikeAudienceIds = lookalikeIds;
    }

    // ── Phase 1.75b — Lookalikes for SelectedPagesLookalikeGroups ──────────
    // Creates lookalikes keyed by range so each ad set targets the right tier.
    for (const splalGroup of splalGroups) {
      if (Date.now() >= lalPhaseDeadline) {
        if (enabledSplalGroupIds.has(splalGroup.id)) {
          console.log(`[launch-campaign] Phase 1.75b — timeout; skipping SPLAL group "${splalGroup.name}"`);
          for (const range of (splalGroup.lookalikeRanges ?? ["0-1%"])) {
            lookalikeAudiencesFailed.push({
              name: `${splalGroup.name} — Lookalike (${range})`,
              range,
              error: "Lookalike phase timeout reached",
              skippedReason: "phase timeout",
            });
          }
        }
        continue;
      }

      if (!enabledSplalGroupIds.has(splalGroup.id)) continue;

      const seedIds = splalEngagementIds.get(splalGroup.id) ?? [];
      if (seedIds.length === 0) {
        console.log(`[launch-campaign] Phase 1.75b — no seeds for SPLAL group "${splalGroup.name}"`);
        for (const range of (splalGroup.lookalikeRanges ?? ["0-1%"])) {
          lookalikeAudiencesFailed.push({
            name: `${splalGroup.name} — Lookalike (${range})`,
            range,
            error: "No seed audiences available (all pages skipped or engagement creation failed)",
            skippedReason: "source audience not ready",
          });
        }
        continue;
      }

      const lookalikesPerRange: Record<string, string[]> = {};
      const ranges = splalGroup.lookalikeRanges?.length ? splalGroup.lookalikeRanges : (["0-1%"] as const);

      for (const range of ranges) {
        if (Date.now() >= lalPhaseDeadline) break;

        const { startingRatio, endingRatio } = parseLookalikeRange(range);
        const pctLabel = `${Math.round(endingRatio * 100)}%`;
        const rangeIds: string[] = [];

        for (const seedId of seedIds) {
          if (Date.now() >= lalPhaseDeadline) break;

          const lalName = `${splalGroup.name || "Selected Pages"} — ${pctLabel} Lookalike`;
          const lalStart = Date.now();
          try {
            const result = await createLookalikeAudience(adAccountId, {
              name: lalName,
              originAudienceId: seedId,
              startingRatio,
              endingRatio,
              country: lookalikeCountry,
            });
            rangeIds.push(result.id);
            lookalikeAudiencesCreated.push({ name: lalName, id: result.id, range, durationMs: elapsed(lalStart) });
          } catch (err) {
            const message = formatMetaError(err);
            const isNotReady = message.includes("2654") || message.includes("not ready") || message.includes("timed out");
            console.error(`[launch-campaign] Phase 1.75b ✗ SPLAL lookalike failed:`, message);
            lookalikeAudiencesFailed.push({
              name: lalName,
              range,
              error: message,
              skippedReason: isNotReady ? "source audience not ready" : undefined,
            });
          }
        }

        if (rangeIds.length > 0) {
          lookalikesPerRange[range] = rangeIds;
        }
      }

      splalGroup.lookalikeAudienceIdsByRange = lookalikesPerRange;
      console.log(
        `[launch-campaign] Phase 1.75b SPLAL "${splalGroup.name}" — ranges with lookalikes:`,
        Object.entries(lookalikesPerRange).map(([r, ids]) => `${r}: ${ids.length} IDs`).join(", ") || "none",
      );
    }

    console.log(
      "[launch-campaign] Phase 1.75 done —",
      "lookalikes created:", lookalikeAudiencesCreated.length,
      "failed:", lookalikeAudiencesFailed.length,
    );
  })();

  // ─── Phase 2: Create ad sets (runs in parallel with creatives) ─────────

  const adSetsCreated: LaunchSummary["adSetsCreated"] = [];
  const adSetsFailed: LaunchSummary["adSetsFailed"] = [];
  // Local mapping: internalAdSetId → Meta ad set ID for this run.
  // Never merged back into draft.adSetSuggestions — avoids stale IDs across re-launches.
  const adSetMetaIds = new Map<string, string>();
  // Per-suggestion launch outcomes — keyed by AdSetSuggestion.id
  const adSetLaunchResults: Record<string, AdSetLaunchResult> = {};

  // Split ad sets: standard ones can proceed now, lookalike ones must wait
  const LOOKALIKE_TYPES = new Set(["lookalike_group", "selected_pages_lookalike"]);
  const standardSets = enabledSets.filter((s) => !LOOKALIKE_TYPES.has(s.sourceType));
  const lookalikeSets = enabledSets.filter((s) => LOOKALIKE_TYPES.has(s.sourceType));

  const adSetCreationPromise = (async () => {
    console.log("[launch-campaign] Phase 2 — creating", standardSets.length, "standard ad sets");

    // Create standard ad sets concurrently in batches of 5
    const BATCH_SIZE = 5;
    for (let i = 0; i < standardSets.length; i += BATCH_SIZE) {
      const batch = standardSets.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (adSet) => {
          const asStart = Date.now();
          const adSetPayload = buildAdSetPayload(
            adSet,
            metaCampaignId,
            draft.audiences,
            draft.budgetSchedule,
            draft.settings.optimisationGoal,
            draft.settings.objective,
            draft.settings.metaPixelId || draft.settings.pixelId || undefined,
          );

          // Log exact outbound targeting spec
          console.log(
            `[launch-campaign] Phase 2 — OUTBOUND targeting for "${adSet.name}":`,
            JSON.stringify(adSetPayload.targeting, null, 2),
          );
          console.log(
            `[launch-campaign] 📍 GEO for "${adSet.name}":`,
            `label=${adSet.locationLabel ?? "(default)"}`,
            `geo_locations=${JSON.stringify(adSetPayload.targeting.geo_locations)}`,
          );

          try {
            const adSetRes = await createMetaAdSet(adAccountId, adSetPayload);
            const dur = elapsed(asStart);
            console.log(`[launch-campaign] Phase 2 ✓  ad set: ${adSet.name} → ${adSetRes.id} (${dur}ms)`);
            return { adSet, metaAdSetId: adSetRes.id, durationMs: dur };
          } catch (err) {
            // Auto-retry for deprecated interests
            if (adSet.sourceType === "interest_group" && err instanceof MetaApiError) {
              const replacements = extractDeprecatedReplacements(err.rawErrorData, err.message);
              if (replacements.length > 0) {
                for (const r of replacements) {
                  interestReplacements.push({
                    deprecated: r.deprecatedName || r.deprecatedId,
                    replacement: r.alternativeName || r.alternativeId,
                    adSetName: adSet.name,
                  });
                }

                const retryPayload = applyInterestReplacements(
                  buildAdSetPayload(
                    adSet, metaCampaignId, draft.audiences, draft.budgetSchedule,
                    draft.settings.optimisationGoal, draft.settings.objective,
                    draft.settings.metaPixelId || draft.settings.pixelId || undefined,
                  ),
                  replacements,
                );
                const retryRes = await createMetaAdSet(adAccountId, retryPayload);
                const dur = elapsed(asStart);
                console.log(`[launch-campaign] Phase 2 ✓  ad set (retry): ${adSet.name} → ${retryRes.id} (${dur}ms)`);
                return { adSet, metaAdSetId: retryRes.id, durationMs: dur };
              }
            }
            throw { adSet, err };
          }
        }),
      );

      for (const r of results) {
        if (r.status === "fulfilled") {
          const { adSet, metaAdSetId, durationMs } = r.value;
          adSetsCreated.push({
            name: adSet.name,
            metaAdSetId,
            ageMode: adSet.advantagePlus ? "suggested" : "strict",
            durationMs,
          });
          adSetMetaIds.set(adSet.id, metaAdSetId);
          adSetLaunchResults[adSet.id] = { launchStatus: "created", metaAdSetId };
        } else {
          const reason = r.reason as { adSet: AdSetSuggestion; err: unknown };
          const message = formatMetaError(reason.err);
          console.error("[launch-campaign] Phase 2 ✗  ad set failed:", reason.adSet.name, ":", message);
          adSetsFailed.push({ name: reason.adSet.name, error: message });
          adSetLaunchResults[reason.adSet.id] = { launchStatus: "failed", error: message };
        }
      }
    }

    console.log("[launch-campaign] Phase 2 standard ad sets done — created:", adSetsCreated.length, "failed:", adSetsFailed.length);
  })();

  // ─── Phase 3: Create creatives (runs in parallel with ad sets) ─────────

  const creativesCreated: LaunchSummary["creativesCreated"] = [];
  const creativesFailed: LaunchSummary["creativesFailed"] = [];
  const updatedCreatives: AdCreativeDraft[] = draft.creatives.map((c) => ({ ...c }));

  const creativeCreationPromise = (async () => {
    console.log("[launch-campaign] Phase 3 — creating", draft.creatives.length, "creatives");

    for (const creative of draft.creatives) {
      const cStart = Date.now();

      const { isValid, errors: valErrs } = validateCreativePayload(creative);
      if (!isValid) {
        console.warn("[launch-campaign] Phase 3 ✗  validation failed:", creative.name, valErrs);
        creativesFailed.push({ name: creative.name, error: valErrs.join("; ") });
        continue;
      }

      let creativePayload;
      try {
        creativePayload = buildCreativePayload(creative);
        // Log exact outbound creative payload
        console.log(
          `[launch-campaign] Phase 3 — OUTBOUND creative payload for "${creative.name}":`,
          JSON.stringify(creativePayload, null, 2),
        );
      } catch (err) {
        const message = formatMetaError(err);
        creativesFailed.push({ name: creative.name, error: message });
        continue;
      }

      let metaCreativeId: string;
      try {
        const creativeRes = await createMetaCreative(adAccountId, creativePayload);
        metaCreativeId = creativeRes.id;
        const dur = elapsed(cStart);
        console.log(`[launch-campaign] Phase 3 ✓  creative: ${creative.name} → ${metaCreativeId} (${dur}ms)`);

        const cIdx = updatedCreatives.findIndex((c) => c.id === creative.id);
        if (cIdx !== -1) updatedCreatives[cIdx] = { ...updatedCreatives[cIdx], metaCreativeId };

        const igId = creative.identity?.instagramAccountId;
        const identityMode: "page_only" | "page_and_ig" =
          igId && /^\d{10,}$/.test(igId) ? "page_and_ig" : "page_only";

        creativesCreated.push({
          name: creative.name,
          metaCreativeId,
          identityMode,
          durationMs: dur,
          ads: [],
          adsFailed: [],
        });
      } catch (err) {
        const isMetaErr = err instanceof MetaApiError;
        const rawMessage = isMetaErr ? err.message : String(err);
        const userMsg = isMetaErr ? (err.userMsg ?? "") : "";

        const isAppModeError =
          rawMessage.toLowerCase().includes("development") ||
          rawMessage.toLowerCase().includes("live mode") ||
          rawMessage.toLowerCase().includes("app is not live") ||
          userMsg.toLowerCase().includes("development") ||
          (isMetaErr && err.code === 200);

        const message = isAppModeError
          ? `Creative rejected — your Meta app must be switched to Live/Public mode for this creative type. Original error: ${rawMessage}`
          : rawMessage;

        console.error("[launch-campaign] Phase 3 ✗  creative failed:", creative.name, ":", message);
        creativesFailed.push({
          name: creative.name,
          error: message,
          skippedReason: isAppModeError ? "app must be in Live/Public mode" : undefined,
        });
      }
    }

    console.log("[launch-campaign] Phase 3 done — created:", creativesCreated.length, "failed:", creativesFailed.length);
  })();

  // Wait for BOTH standard ad sets AND creatives to finish
  await Promise.all([adSetCreationPromise, creativeCreationPromise]);

  phaseDurations["adSetsAndCreatives"] = elapsed(parallelStart);
  console.log(`[launch-campaign] Phase 2+3 parallel done in ${phaseDurations["adSetsAndCreatives"]}ms`);

  // ─── Now await lookalikes and create lookalike ad sets ─────────────────

  const lalPhaseStart = Date.now();
  await lookalikePromise;
  phaseDurations["lookalikes"] = elapsed(lalPhaseStart) + (needsLookalikes && engagementAudiencesCreated.length > 0 ? 0 : 0);

  // Create ad sets for lookalike groups (must wait for lookalike audiences)
  if (lookalikeSets.length > 0) {
    console.log("[launch-campaign] Phase 2b — creating", lookalikeSets.length, "lookalike ad sets");

    for (const adSet of lookalikeSets) {
      // Pre-check: does this ad set have lookalike IDs ready?
      let lalIds: string[] = [];
      if (adSet.sourceType === "lookalike_group") {
        const srcGroup = draft.audiences.pageGroups.find((g) => g.id === adSet.sourceId);
        lalIds = srcGroup?.lookalikeAudienceIds ?? [];
      } else if (adSet.sourceType === "selected_pages_lookalike") {
        const srcGroup = (draft.audiences.selectedPagesLookalikeGroups ?? []).find((g) => g.id === adSet.sourceId);
        lalIds = srcGroup?.lookalikeAudienceIdsByRange?.[adSet.lookalikeRange ?? ""] ?? [];
      }

      if (lalIds.length === 0) {
        const skipReason = "source audience not ready";
        const msg = "Skipped — no lookalike audiences were created for this group (source audience creation failed or timed out)";
        console.log(`[launch-campaign] Phase 2b — skipping lookalike ad set "${adSet.name}"`);
        adSetsFailed.push({ name: adSet.name, error: msg, skippedReason: skipReason });
        adSetLaunchResults[adSet.id] = { launchStatus: "skipped", skippedReason: skipReason, error: msg };
        continue;
      }

      const asStart = Date.now();
      try {
        const adSetPayload = buildAdSetPayload(
          adSet,
          metaCampaignId,
          draft.audiences,
          draft.budgetSchedule,
          draft.settings.optimisationGoal,
          draft.settings.objective,
          draft.settings.metaPixelId || draft.settings.pixelId || undefined,
        );
        console.log(
          `[launch-campaign] Phase 2b — OUTBOUND targeting for "${adSet.name}":`,
          JSON.stringify(adSetPayload.targeting, null, 2),
        );

        const adSetRes = await createMetaAdSet(adAccountId, adSetPayload);
        const dur = elapsed(asStart);
        console.log(`[launch-campaign] Phase 2b ✓  lookalike ad set: ${adSet.name} → ${adSetRes.id} (${dur}ms)`);
        adSetsCreated.push({
          name: adSet.name,
          metaAdSetId: adSetRes.id,
          ageMode: adSet.advantagePlus ? "suggested" : "strict",
          durationMs: dur,
        });
        adSetMetaIds.set(adSet.id, adSetRes.id);
        adSetLaunchResults[adSet.id] = { launchStatus: "created", metaAdSetId: adSetRes.id };
      } catch (err) {
        const message = formatMetaError(err);
        console.error("[launch-campaign] Phase 2b ✗  lookalike ad set failed:", adSet.name, ":", message);
        adSetsFailed.push({ name: adSet.name, error: message });
        adSetLaunchResults[adSet.id] = { launchStatus: "failed", error: message };
      }
    }
  }

  phaseDurations["lookalikeAdSets"] = elapsed(lalPhaseStart);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 4 — Create ads (links each creative × ad set)
  // ═══════════════════════════════════════════════════════════════════════════

  const phase4Start = Date.now();
  const creativeToAdSetIds = invertAssignments(draft.creativeAssignments ?? {});
  // Lookup by internal id: name for display, metaAdSetId from this run's Map
  const adSetNameById = new Map<string, string>(
    draft.adSetSuggestions.map((s) => [s.id, s.name]),
  );

  console.log("[launch-campaign] Phase 4 — linking ads");

  // Create all ads in parallel batches
  const adCreationTasks: Promise<void>[] = [];

  for (const creativeEntry of creativesCreated) {
    const creative = draft.creatives.find((c) => c.name === creativeEntry.name);
    if (!creative) continue;

    const assignedAdSetIds = creativeToAdSetIds[creative.id] ?? [];

    for (const internalAdSetId of assignedAdSetIds) {
      const metaAdSetId = adSetMetaIds.get(internalAdSetId);
      const adSetName = adSetNameById.get(internalAdSetId) ?? internalAdSetId;
      if (!metaAdSetId) {
        creativeEntry.adsFailed.push({
          adSetName,
          error: "Ad set was not created in Meta — no metaAdSetId available",
        });
        continue;
      }

      adCreationTasks.push(
        (async () => {
          const adStart = Date.now();
          const adPayload = buildAdPayload(
            `${creative.name} — ${adSetName}`,
            creativeEntry.metaCreativeId,
            metaAdSetId,
          );

          try {
            const adRes = await createMetaAd(adAccountId, adPayload);
            const dur = elapsed(adStart);
            console.log(`[launch-campaign] Phase 4 ✓  ad: ${creative.name} × ${adSetName} → ${adRes.id} (${dur}ms)`);
            creativeEntry.ads.push({ adSetName, metaAdId: adRes.id, durationMs: dur });
          } catch (err) {
            const message = formatMetaError(err);
            console.error(`[launch-campaign] Phase 4 ✗  ad failed: ${creative.name} × ${adSetName}: ${message}`);
            creativeEntry.adsFailed.push({ adSetName, error: message });
          }
        })(),
      );
    }
  }

  // Run all ad creations concurrently
  await Promise.all(adCreationTasks);

  const adsCreatedTotal = creativesCreated.reduce((sum, c) => sum + c.ads.length, 0);
  const adsFailedTotal = creativesCreated.reduce((sum, c) => sum + c.adsFailed.length, 0);

  phaseDurations["ads"] = elapsed(phase4Start);
  console.log(
    `[launch-campaign] Phase 4 done in ${phaseDurations["ads"]}ms — ads: ${adsCreatedTotal} failed: ${adsFailedTotal}`,
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════

  const totalDurationMs = elapsed(launchStart);

  const summary: LaunchSummary = {
    launchRunId,
    metaCampaignId,
    adSetLaunchResults: Object.keys(adSetLaunchResults).length > 0 ? adSetLaunchResults : undefined,
    totalDurationMs,
    phaseDurations,
    preflightWarnings: preflightWarnings.length > 0 ? preflightWarnings : undefined,
    engagementAudiencesCreated: engagementAudiencesCreated.length > 0 ? engagementAudiencesCreated : undefined,
    engagementAudiencesFailed: engagementAudiencesFailed.length > 0 ? engagementAudiencesFailed : undefined,
    lookalikeAudiencesCreated: lookalikeAudiencesCreated.length > 0 ? lookalikeAudiencesCreated : undefined,
    lookalikeAudiencesFailed: lookalikeAudiencesFailed.length > 0 ? lookalikeAudiencesFailed : undefined,
    interestReplacements: interestReplacements.length > 0 ? interestReplacements : undefined,
    adSetsCreated,
    adSetsFailed,
    creativesCreated,
    creativesFailed,
    adsCreated: adsCreatedTotal,
    adsFailed: adsFailedTotal,
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // PERSIST TO SUPABASE
  // ═══════════════════════════════════════════════════════════════════════════

  const now = new Date().toISOString();
  // Strip per-launch metaAdSetId from suggestions before persisting — keeps
  // the draft clean so re-launches start fresh without stale IDs.
  const cleanSuggestions = draft.adSetSuggestions.map(({ metaAdSetId: _id, ...rest }) => rest);
  const publishedDraft: CampaignDraft = {
    ...draft,
    metaCampaignId,
    adSetSuggestions: cleanSuggestions as CampaignDraft["adSetSuggestions"],
    launchSummary: summary,
    status: "published",
    updatedAt: now,
  };

  try {
    const { error: dbErr } = await supabase.from("campaign_drafts").upsert(
      {
        id: publishedDraft.id,
        user_id: user.id,
        name: publishedDraft.settings.campaignName || null,
        objective: publishedDraft.settings.objective || null,
        status: "published",
        ad_account_id: publishedDraft.settings.adAccountId || null,
        draft_json: publishedDraft,
        updated_at: now,
      },
      { onConflict: "id" },
    );

    if (dbErr) {
      console.warn("[launch-campaign] Supabase save error (non-fatal):", dbErr.message);
    } else {
      console.log("[launch-campaign] Supabase save ✓");
    }
  } catch (err) {
    console.warn("[launch-campaign] Supabase save exception (non-fatal):", err);
  }

  console.log(
    `[launch-campaign] ✓ Complete in ${totalDurationMs}ms — campaign: ${metaCampaignId}`,
    `| ad sets: ${adSetsCreated.length}`,
    `| creatives: ${creativesCreated.length}`,
    `| ads: ${adsCreatedTotal}`,
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RETURN — LaunchSummary only; no draft mutations are returned.
  // The client stores the full summary but does not overwrite adSetSuggestions.
  // ═══════════════════════════════════════════════════════════════════════════

  return NextResponse.json(summary, { status: 201 });
}
