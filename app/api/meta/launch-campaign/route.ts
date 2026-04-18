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
  fetchAdAccountTosStatus,
  fetchAdAccountIgActors,
  fetchCampaignById,
  fetchAdSetById,
  checkAudienceReadiness,
  rankSeedsByPreference,
  MetaApiError,
} from "@/lib/meta/client";
import {
  resolvePageIdentity,
  resolvePageIgActor,
  resolveIgActorForAdAccount,
} from "@/lib/meta/page-token";
import type { EngagementAudienceType, TypedSeed } from "@/lib/meta/client";
import {
  mapMetaObjectiveToInternal,
  validateCampaignPayload,
} from "@/lib/meta/campaign";
import {
  buildAdSetPayload,
  extractDeprecatedReplacements,
  applyInterestReplacements,
  sanitiseInterests,
  sanitizeTargetingInterestsBeforeLaunch,
  hasAudienceTargeting,
  buildEmptyTargetingReason,
} from "@/lib/meta/adset";
import {
  buildCreativePayload,
  buildAdPayload,
  invertAssignments,
  validateCreativePayload,
  sanitizeCreativeForStrictMode,
} from "@/lib/meta/creative";
import {
  resolveAdSetPlacementTargeting,
  validatePlacementSelection,
  summarisePlacements,
  resolveExistingPostPlacements,
} from "@/lib/meta/placements";
import type {
  CampaignDraft,
  LaunchSummary,
  AdSetSuggestion,
  AdSetLaunchResult,
  AdCreativeDraft,
  EngagementType,
  WizardMode,
} from "@/lib/types";
import { attachedAdSetKey } from "@/lib/types";

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

// ─── Instagram actor helpers ──────────────────────────────────────────────────

/**
 * Parse "Valid actor IDs: [12345, 67890]" from a Meta (#100) error message.
 * Meta sometimes embeds valid actor IDs in the error text or user message to
 * help callers retry with the correct id without an extra API round-trip.
 */
function parseValidActorIdsFromError(err: MetaApiError): string[] {
  const haystack = `${err.message ?? ""} ${err.userMsg ?? ""}`;
  // Meta formats this as "Valid actor IDs: [12345]" or "valid account id: [12345, 6789]"
  const match =
    haystack.match(/Valid actor IDs?:\s*\[([^\]]+)\]/i) ??
    haystack.match(/valid (?:Instagram )?account (?:id|IDs?):\s*\[([^\]]+)\]/i);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Whether a MetaApiError indicates that `instagram_actor_id` was invalid.
 * Code 100 with the parameter name in the message is the canonical signal.
 */
function isIgActorError(err: MetaApiError): boolean {
  return (
    err.code === 100 &&
    (err.message.toLowerCase().includes("instagram_actor_id") ||
      err.message.toLowerCase().includes("instagram account id"))
  );
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
  let clientIgMap: Record<string, string> = {};
  try {
    const body = (await req.json()) as {
      draft?: CampaignDraft;
      /** Page ID → IG account ID, built client-side from enriched pages cache */
      igAccountMap?: Record<string, string>;
    };
    if (!body?.draft) throw new Error("Missing required field: draft");
    draft = body.draft;
    clientIgMap = body.igAccountMap ?? {};
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid request body: ${err instanceof Error ? err.message : "bad JSON"}` },
      { status: 400 },
    );
  }

  // ── Fetch user's Facebook OAuth token ─────────────────────────────────────
  // The provider_token is the user's Facebook access token stored after OAuth.
  // It runs in the same permission context as Ads Manager and is preferred over
  // META_ACCESS_TOKEN (which is a static system/app token with weaker permissions)
  // for engagement audience creation on user-managed pages.
  let userFbToken: string | null = null;
  try {
    const { data: fbTokenRow, error: fbTokenError } = await supabase
      .from("user_facebook_tokens")
      .select("provider_token")
      .eq("user_id", user.id)
      .maybeSingle();
    if (fbTokenError) {
      console.warn("[launch-campaign] Could not read user_facebook_tokens:", fbTokenError.message);
    } else {
      userFbToken = fbTokenRow?.provider_token ?? null;
    }
  } catch (err) {
    console.warn("[launch-campaign] Exception fetching user Facebook token:", err);
  }
  console.log(
    "[launch-campaign] User Facebook token:",
    userFbToken
      ? `PRESENT (len=${userFbToken.length}, prefix=${userFbToken.slice(0, 10)}…)`
      : "MISSING — engagement audiences will use META_ACCESS_TOKEN (system token)",
  );

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
  const interestsSkippedNotTargetable: NonNullable<LaunchSummary["interestsSkippedNotTargetable"]>["items"] = [];

  // ── Launch-time interest sanitisation telemetry ───────────────────────────
  // Populated by the last-line-of-defence sanitiser that runs immediately
  // before each `createMetaAdSet`, and by any deprecated-interest retry that
  // fires after a Meta create failure (e.g. subcode 1870247).
  const launchRemovedDeprecatedInterests: Array<{ adSetName: string; name: string; reason: string }> = [];
  const launchReplacedDeprecatedInterests: Array<{ adSetName: string; deprecated: string; replacementSearchName: string }> = [];
  let launchRetryAttempted = 0;
  let launchRetrySucceeded = 0;
  let finalLaunchInterestSanitizationApplied = false;

  // 0a. Validate campaign / attach target.
  //
  // Three wizard modes — branching here decides *what* needs validating up
  // front (we re-validate the live Meta resource later in Phase 1 / 1b):
  //   - "new"             → run the standard NEW campaign payload validator.
  //   - "attach_campaign" → only ensure the picker recorded a campaign id.
  //   - "attach_adset"    → ensure both picker selections (campaign + ad set)
  //                         are present and that they're consistent.
  const wizardMode: WizardMode = draft.settings.wizardMode ?? "new";
  // Creative Integrity Mode — defaults to ON for any draft that pre-dates
  // the flag (also enforced in `migrateDraft`). Read once and reused inside
  // the Phase 3 creative loop and in the launch summary.
  const strictMode: boolean =
    draft.settings.creativeIntegrityMode !== false;
  console.log(
    `[launch-campaign] creativeIntegrityMode=${strictMode ? "ON" : "OFF"}`,
  );
  const attachTargetId = draft.settings.existingMetaCampaign?.id;
  // Multi-select: prefer `existingMetaAdSets` (array). Fall back to the
  // legacy singular field for drafts that pre-date the multi-select rollout
  // (also handled in `migrateDraft`).
  const attachAdSetSnapshots =
    draft.settings.existingMetaAdSets ??
    (draft.settings.existingMetaAdSet ? [draft.settings.existingMetaAdSet] : []);
  const attachAdSetIds = attachAdSetSnapshots.map((a) => a.id);
  console.log(
    `[launch-campaign] wizardMode=${wizardMode}` +
      (wizardMode === "attach_campaign"
        ? ` attachTargetId=${attachTargetId ?? "?"}`
        : "") +
      (wizardMode === "attach_adset"
        ? ` attachTargetId=${attachTargetId ?? "?"}` +
          ` attachAdSetIds=[${attachAdSetIds.join(",") || "?"}]` +
          ` count=${attachAdSetIds.length}`
        : ""),
  );

  if (wizardMode === "attach_campaign") {
    if (!attachTargetId) {
      return NextResponse.json(
        { error: "Attach mode requires an existing campaign id" },
        { status: 400 },
      );
    }
  } else if (wizardMode === "attach_adset") {
    if (!attachTargetId) {
      return NextResponse.json(
        { error: "Attach-to-ad-set mode requires the parent campaign id" },
        { status: 400 },
      );
    }
    if (attachAdSetIds.length === 0) {
      return NextResponse.json(
        { error: "Attach-to-ad-set mode requires at least one existing ad set id" },
        { status: 400 },
      );
    }
    const orphan = attachAdSetSnapshots.find(
      (s) => s.campaignId && s.campaignId !== attachTargetId,
    );
    if (orphan) {
      return NextResponse.json(
        {
          error: `Selected ad set "${orphan.name}" does not belong to the selected campaign — re-open Step 1 and re-pick.`,
        },
        { status: 400 },
      );
    }
  } else {
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
  }

  // 0b. Pre-sanitise interests for interest_group ad sets
  const interestGroupSets = enabledSets.filter((s) => s.sourceType === "interest_group");
  for (const adSet of interestGroupSets) {
    const group = draft.audiences.interestGroups.find((g) => g.id === adSet.sourceId);
    if (!group || group.interests.length === 0) continue;

    // Partition by `targetabilityStatus`: anything not `valid` (or unset, for
    // back-compat with older drafts) is excluded from the targeting payload but
    // kept on the chip so the user still sees their discovery context.
    // - "valid"          → goes through to sanitiseInterests + Meta targeting
    // - undefined        → treated as "valid" (older drafts predate this field)
    // - other statuses   → skipped, recorded for the launch summary
    const targetableForLaunch = group.interests.filter(
      (i) => i.targetabilityStatus === undefined || i.targetabilityStatus === "valid",
    );
    const nonTargetable = group.interests.filter(
      (i) => i.targetabilityStatus !== undefined && i.targetabilityStatus !== "valid",
    );
    for (const i of nonTargetable) {
      interestsSkippedNotTargetable.push({
        adSetName: adSet.name,
        groupId: group.id,
        name: i.name,
        status: i.targetabilityStatus!,
      });
      preflightWarnings.push({
        stage: "interests",
        message: `"${i.name}" in "${adSet.name}" not currently available in Meta targeting (${i.targetabilityStatus}) — skipped at launch.`,
      });
    }
    if (nonTargetable.length > 0) {
      console.log(
        `[launch-campaign] Preflight — skipping ${nonTargetable.length} non-targetable interest(s) for "${adSet.name}":`,
        nonTargetable.map((i) => `${i.name} (${i.targetabilityStatus})`).join(", "),
      );
    }

    const raw = targetableForLaunch
      .filter((i) => /^\d{5,}$/.test(i.id))
      .map((i) => ({ id: i.id, name: i.name }));

    if (raw.length === 0) continue;

    console.log(`[launch-campaign] Preflight — sanitising ${raw.length} interests for "${adSet.name}"…`);
    const { valid, removed } = await sanitiseInterests(raw);

    // Always update group.interests to the sanitised list, even when only
    // IDs changed (e.g. hardcoded replacement swapped ID without removal count).
    // Non-targetable items are preserved on the chip so the user still sees
    // them in the wizard after launch.
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
      const sanitisedTargetable = valid.map((v) => ({
        ...v,
        audienceSize: origMap.get(v.id)?.audienceSize,
        path: origMap.get(v.id)?.path,
        targetabilityStatus: "valid" as const,
      }));
      group.interests = [...sanitisedTargetable, ...nonTargetable];
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

  // 0e. Pre-resolve Instagram actor IDs for IG existing-post creatives.
  //
  // ROOT CAUSE (confirmed via logs):
  //   /{pageId}/instagram_accounts returns the PAGE-LINKED content account id,
  //   but Meta Ads requires the id from /{adAccountId}/instagram_accounts — these
  //   can be DIFFERENT IDs (e.g. content=17841403774937858, actor=17841447022816929).
  //
  // Strategy:
  //   1. Call resolvePageIdentity to get the Page token + IG content account id.
  //   2. Call resolveIgActorForAdAccount (uses /{adAccountId}/instagram_accounts
  //      as PRIMARY, page-level as fallback) to get the ads-valid actor id.
  //   3. Patch instagramActorId on each IG existing-post creative so Phase 3
  //      uses the correct id. Log any mismatch between content and actor ids.
  //   4. Block launch if any IG existing-post creative still has no actor id.
  //
  // `launchCreatives` shadows `draft.creatives` for all downstream phases.
  let launchCreatives: AdCreativeDraft[] = draft.creatives.map((c) => ({ ...c }));

  const igExistingPostCreatives = launchCreatives.filter(
    (c) => c.sourceType === "existing_post" && c.existingPost?.source === "instagram",
  );

  if (igExistingPostCreatives.length > 0) {
    // Collect unique page IDs so we only resolve each page once.
    const uniquePageIds = [
      ...new Set(
        igExistingPostCreatives
          .map((c) => c.identity.pageId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    // pageId → { actorId, contentAccountId, source }
    const pageActorMap = new Map<string, { actorId: string; contentAccountId: string | undefined; source: string }>();

    for (const pageId of uniquePageIds) {
      console.log(
        `[launch-campaign] Preflight 0e — resolving IG actor for page=${pageId}` +
          ` adAccount=${adAccountId}` +
          ` userToken=${userFbToken ? "present" : "missing"}`,
      );

      // Step A: resolve page identity to get content account id + page token.
      const pageIdentity = await resolvePageIdentity(pageId, userFbToken);

      const contentAccountId =
        pageIdentity.ig.state === "linked" ? pageIdentity.ig.account.id : undefined;

      // Step B: resolve the ads-valid actor via ad-account-aware lookup.
      const resolved = await resolveIgActorForAdAccount(
        contentAccountId,
        adAccountId,
        userFbToken,
        pageId,
        pageIdentity.pageAccessToken ?? undefined,
      );

      if (resolved.actorId) {
        pageActorMap.set(pageId, {
          actorId: resolved.actorId,
          contentAccountId: resolved.contentAccountId,
          source: resolved.actorSource,
        });

        if (!resolved.actorMatchesContent) {
          console.warn(
            `[launch-campaign] Preflight 0e ⚠ ACTOR MISMATCH for page ${pageId}:` +
              `\n  contentAccountId = ${resolved.contentAccountId} (used for post loading)` +
              `\n  instagramActorId = ${resolved.actorId}           (will be sent in creative payload)` +
              `\n  actorSource      = ${resolved.actorSource}` +
              `\n  adAccountId      = ${adAccountId}`,
          );
        } else {
          console.log(
            `[launch-campaign] Preflight 0e ✓ page ${pageId}:` +
              ` actorId=${resolved.actorId} source=${resolved.actorSource}`,
          );
        }
      } else {
        console.warn(
          `[launch-campaign] Preflight 0e ⚠ page ${pageId}: all actor resolution paths failed` +
            ` — Phase 3 retry will handle any (#100) error`,
        );
      }
    }

    // Patch launchCreatives with the resolved actor ids.
    launchCreatives = launchCreatives.map((creative) => {
      if (
        creative.sourceType !== "existing_post" ||
        creative.existingPost?.source !== "instagram"
      ) {
        return creative;
      }
      const entry = pageActorMap.get(creative.identity.pageId ?? "");
      if (entry) {
        const wasActorId = creative.identity.instagramActorId ?? "unset";
        const wasAccountId = creative.identity.instagramAccountId ?? "unset";
        console.log(
          `[launch-campaign] Preflight 0e — patching "${creative.name}":` +
            `\n  instagramActorId  : ${wasActorId} → ${entry.actorId}` +
            `\n  instagramAccountId: ${wasAccountId} (content, unchanged)` +
            `\n  actorSource       : ${entry.source}` +
            `\n  actorMatchesContent: ${entry.actorId === entry.contentAccountId}`,
        );
        return {
          ...creative,
          identity: {
            ...creative.identity,
            instagramActorId: entry.actorId,
            // Preserve content account id as instagramAccountId (for post loading).
          },
        };
      }
      return creative;
    });

    // ── Post-patch audit: validate instagram_user_id availability ────────────
    //
    // IG existing-post creatives use:
    //   { source_instagram_media_id: <mediaId>, instagram_user_id: <contentAccountId> }
    //   NOT instagram_actor_id (that was wrong — caused (#100) rejections).
    //
    // The required `instagram_user_id` comes from `identity.instagramAccountId`
    // (the page-linked IG content account).  Block launch if it is missing — the
    // creative builder will throw anyway, but blocking here gives a clearer error
    // before any Phase 1/2/3 Meta API calls are made.
    const igUserIdErrors: string[] = [];

    for (const c of launchCreatives) {
      if (
        c.sourceType !== "existing_post" ||
        c.existingPost?.source !== "instagram"
      ) {
        continue;
      }

      const contentId = c.identity.instagramAccountId ?? "(unset)";
      const postOwner = c.existingPost?.instagramAccountId ?? "(unset)";
      const mediaId   = c.existingPost?.postId ?? "(unset)";
      // instagram_user_id = content account (primary) or post-picker account (fallback)
      const igUserId  = c.identity.instagramAccountId || c.existingPost?.instagramAccountId;

      console.log(
        `[launch-campaign] Preflight 0e audit — "${c.name}" (ig_existing_post):` +
          `\n  pageId                     = ${c.identity.pageId ?? "(unset)"}` +
          `\n  identity.instagramAccountId = ${contentId}  ← instagram_user_id source` +
          `\n  existingPost.instagramAccountId = ${postOwner}  ← fallback` +
          `\n  instagram_user_id to send  = ${igUserId ?? "(MISSING — will block)"}` +
          `\n  instagram_actor_id         = OMITTED (not used for this creative type)` +
          `\n  source_instagram_media_id  = ${mediaId}`,
      );

      if (!igUserId) {
        igUserIdErrors.push(
          `"${c.name}": no instagram_user_id — ` +
            (c.identity.pageId
              ? `Page ${c.identity.pageId} has no linked Instagram account. ` +
                `Re-select the Page in the Creatives step to re-resolve the IG link.`
              : `Creative has no pageId set.`),
        );
      }
    }

    if (igUserIdErrors.length > 0) {
      return NextResponse.json(
        {
          error:
            "Instagram existing-post preflight failed — no instagram_user_id available",
          details: igUserIdErrors,
          hint:
            "The selected Facebook Page must have a linked Instagram Business or Creator account. " +
            "In the Creatives step, re-select the Page and confirm the Instagram account is shown " +
            "as linked. Check that the Page is connected to an Instagram account in Facebook settings.",
        },
        { status: 400 },
      );
    }
  } else {
    console.log(
      "[launch-campaign] Preflight 0e — no IG existing-post creatives; skipping actor resolution",
    );
  }

  phaseDurations["preflight"] = elapsed(preflightStart);
  console.log(`[launch-campaign] Preflight done in ${phaseDurations["preflight"]}ms — ${preflightWarnings.length} warning(s)`);

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1 — Resolve `metaCampaignId`
  //   - "new"             → POST a fresh campaign (fatal on failure)
  //   - "attach_campaign" → re-fetch the picker's selection, validate
  //                         compatibility, and reuse its id.
  //   - "attach_adset"    → re-fetch BOTH the picker's campaign AND ad set,
  //                         verify the ad set still belongs to that campaign
  //                         and is usable, and reuse the campaign id. The
  //                         ad set id will be reused as `metaAdSetId` later
  //                         (see Phase 2 attach_adset branch).
  // ═══════════════════════════════════════════════════════════════════════════

  const phase1Start = Date.now();
  let metaCampaignId: string;
  // Captured in attach_adset so Phase 2 can seed adSetMetaIds without
  // re-fetching, and so logging can include the verified live names.
  // One entry per selected live ad set. Only successfully-verified ad
  // sets are added — orphans / archived / not-found short-circuit the
  // launch with a 4xx response below.
  type VerifiedLiveAdSet = {
    id: string;
    name: string;
    campaign_id?: string;
    optimization_goal?: string;
    billing_event?: string;
    status?: string;
    effective_status?: string;
  };
  const attachedLiveAdSets: VerifiedLiveAdSet[] = [];

  if (wizardMode === "attach_campaign" || wizardMode === "attach_adset") {
    try {
      console.log(
        `[launch-campaign] Phase 1 (${wizardMode}) — re-fetching live campaign ${attachTargetId}`,
      );
      const live = await fetchCampaignById(attachTargetId!);
      if (!live) {
        return NextResponse.json(
          {
            error:
              "Selected existing campaign not found in Meta. It may have been deleted, archived, or moved out of this ad account.",
            metaError: { error: "campaign_not_found", campaignId: attachTargetId },
          },
          { status: 404 },
        );
      }

      const internal = mapMetaObjectiveToInternal(live.objective);
      if (!internal) {
        return NextResponse.json(
          {
            error: `Selected campaign has an unsupported objective "${live.objective ?? "unknown"}". This wizard can only add ad sets to campaigns whose objective maps to one of: purchase, registration, traffic, awareness, engagement.`,
          },
          { status: 400 },
        );
      }
      if (live.buying_type && live.buying_type !== "AUCTION") {
        return NextResponse.json(
          {
            error: `Selected campaign uses buying type "${live.buying_type}" — this wizard only creates AUCTION ad sets.`,
          },
          { status: 400 },
        );
      }
      const blocked = new Set(["ARCHIVED", "DELETED"]);
      if (live.effective_status && blocked.has(live.effective_status)) {
        return NextResponse.json(
          {
            error: `Selected campaign is ${live.effective_status.toLowerCase()} — can't add new ad sets to it.`,
          },
          { status: 400 },
        );
      }

      // Cross-check against the snapshot mirrored onto draft.settings.objective
      // by the picker (only for attach_campaign — attach_adset doesn't mirror
      // the campaign objective into settings.objective because the launch path
      // never builds an ad-set payload from it).
      if (
        wizardMode === "attach_campaign" &&
        internal !== draft.settings.objective
      ) {
        return NextResponse.json(
          {
            error: `Selected campaign's objective changed since you picked it (was "${draft.settings.objective}", now "${internal}"). Re-open Step 1 and re-select.`,
          },
          { status: 409 },
        );
      }

      metaCampaignId = live.id;

      // ── attach_adset: verify each picker-selected ad set ──────────────────
      if (wizardMode === "attach_adset") {
        console.log(
          `[launch-campaign] Phase 1 (attach_adset) — re-fetching ${attachAdSetIds.length} live ad set(s)` +
            ` [${attachAdSetIds.join(",")}]`,
        );
        // Re-fetch all selected ad sets in parallel — fail the launch on
        // any orphan/missing/archived to keep the matrix consistent with
        // what the user picked.
        const results = await Promise.all(
          attachAdSetIds.map(async (id) => ({
            id,
            live: await fetchAdSetById(id),
          })),
        );

        const missing = results.filter((r) => !r.live).map((r) => r.id);
        if (missing.length > 0) {
          return NextResponse.json(
            {
              error: `Selected ad set${missing.length > 1 ? "s" : ""} not found in Meta — may have been deleted, archived, or moved: ${missing.join(", ")}`,
              metaError: { error: "adset_not_found", adSetIds: missing },
            },
            { status: 404 },
          );
        }

        const orphan = results.find(
          (r) => r.live!.campaign_id && r.live!.campaign_id !== metaCampaignId,
        );
        if (orphan) {
          return NextResponse.json(
            {
              error: `Selected ad set "${orphan.live!.name}" no longer belongs to the selected campaign — re-open Step 1 and re-pick.`,
            },
            { status: 409 },
          );
        }

        const archived = results.find(
          (r) =>
            r.live!.effective_status && blocked.has(r.live!.effective_status!),
        );
        if (archived) {
          return NextResponse.json(
            {
              error: `Selected ad set "${archived.live!.name}" is ${archived.live!.effective_status!.toLowerCase()} — can't add new ads to it.`,
            },
            { status: 400 },
          );
        }

        for (const r of results) attachedLiveAdSets.push(r.live!);

        const summary = attachedLiveAdSets
          .map((a) => `"${a.name}" (${a.id})`)
          .join(", ");
        preflightWarnings.push({
          stage: "adset",
          message: `Adding new ads to ${attachedLiveAdSets.length} existing ad set${attachedLiveAdSets.length > 1 ? "s" : ""} under "${live.name}": ${summary}.`,
        });
        for (const liveAdSet of attachedLiveAdSets) {
          console.log(
            `[launch-campaign] Phase 1 (attach_adset) ✓  adSetId: ${liveAdSet.id}` +
              ` name="${liveAdSet.name}" status=${liveAdSet.status ?? "?"}` +
              ` effective_status=${liveAdSet.effective_status ?? "?"}`,
          );
        }
      } else {
        preflightWarnings.push({
          stage: "campaign",
          message: `Adding ad set + ads to existing campaign "${live.name}" (${live.id}).`,
        });
      }

      phaseDurations["campaign"] = elapsed(phase1Start);
      console.log(
        `[launch-campaign] Phase 1 (${wizardMode}) ✓  campaignId: ${metaCampaignId}` +
          ` name="${live.name}" objective=${live.objective} (${phaseDurations["campaign"]}ms)`,
      );
    } catch (err) {
      const message = err instanceof MetaApiError ? err.message : String(err);
      console.error(
        `[launch-campaign] Phase 1 (${wizardMode}) ✗  could not re-fetch live campaign/ad set:`,
        message,
        err instanceof MetaApiError ? err.toJSON() : "",
      );
      return NextResponse.json(
        {
          error: `Failed to verify the existing campaign: ${message}`,
          metaError: err instanceof MetaApiError ? err.toJSON() : undefined,
        },
        { status: 502 },
      );
    }
  } else {
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
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1.5 — Create engagement custom audiences for page_group ad sets
  // ═══════════════════════════════════════════════════════════════════════════

  const phase15Start = Date.now();

  // ── Ad account ToS preflight ──────────────────────────────────────────────
  // Custom Audience Terms of Service must be accepted before engagement audiences
  // can be created. Check now and log — does not block execution.
  {
    const tosStatus = await fetchAdAccountTosStatus(adAccountId, userFbToken ?? undefined);
    if (tosStatus.fetched) {
      const tosFlag = tosStatus.customAudienceTos;
      console.log(
        `[launch-campaign] Phase 1.5 — ToS check for ${adAccountId}:` +
        ` custom_audience_tos=${tosFlag === true ? "ACCEPTED" : tosFlag === false ? "NOT ACCEPTED ⚠" : "unknown"}` +
        ` | raw: ${JSON.stringify(tosStatus.rawTosAccepted)}`,
      );
      if (tosFlag === false) {
        console.warn(
          "[launch-campaign] Phase 1.5 ⚠ Custom Audience ToS NOT accepted for this ad account." +
          " Engagement audience creation will likely fail with a terms-related error." +
          " Accept the Custom Audience TOS at business.facebook.com/ads/manage/customaudiences/tos/",
        );
      }
    } else {
      console.warn(
        `[launch-campaign] Phase 1.5 — ToS check failed (non-fatal): ${tosStatus.error ?? "unknown error"}`,
      );
    }
  }

  // ── Build page→IG map ─────────────────────────────────────────────────────
  // Source 1 (preferred): client-provided map derived from the enriched pages
  // cache. This was fetched using the user's Facebook OAuth token and correctly
  // resolves both instagram_business_account AND connected_instagram_account.
  const pageToIg: Map<string, string> = new Map();

  for (const [pageId, igId] of Object.entries(clientIgMap)) {
    if (pageId && igId) pageToIg.set(pageId, igId);
  }
  console.log(
    `[launch-campaign] Phase 1.5 — client-provided IG map: ${pageToIg.size} entries` +
    (pageToIg.size > 0
      ? ": " + Array.from(pageToIg).map(([pid, igId]) => `${pid}→${igId}`).join(", ")
      : " (no entries — server-side fetch will be attempted)"),
  );

  // Source 2 (fallback): server-side fetch using META_ACCESS_TOKEN.
  // This uses a system/app token that may not see user-level page→IG
  // connections, but can supplement the client map for any pages not covered.
  try {
    const { fetchInstagramAccounts } = await import("@/lib/meta/client");
    const igAccounts = await fetchInstagramAccounts();
    let serverAdded = 0;
    for (const ig of igAccounts) {
      if (ig.linkedPageId && ig.id && !pageToIg.has(ig.linkedPageId)) {
        pageToIg.set(ig.linkedPageId, ig.id);
        serverAdded++;
      }
    }
    console.log(
      `[launch-campaign] Phase 1.5 — server-side IG fetch: ${igAccounts.length} accounts found,` +
      ` ${serverAdded} added to map (client entries took priority). Total: ${pageToIg.size}`,
    );
  } catch (err) {
    console.warn("[launch-campaign] Phase 1.5 — server-side IG fetch failed (non-fatal):", err);
  }

  // Log final resolved IG IDs for all pages that will be processed.
  const allGroupPageIds = new Set(
    draft.audiences.pageGroups.flatMap((g) => g.pageIds),
  );
  for (const pid of allGroupPageIds) {
    const igId = pageToIg.get(pid);
    console.log(
      `[launch-campaign] Phase 1.5 — page ${pid}:` +
      ` resolvedIgId=${igId ?? "NOT FOUND"}` +
      (clientIgMap[pid] ? ` (source: client-cache)` :
       igId ? ` (source: server-fetch)` : ` (no IG account available)`),
    );
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
  // Typed seeds for Phase 1.75 — same data as pageGroupAudienceIds but with
  // engagement type attached so we can rank by preference before trying lookalikes.
  const pageGroupTypedSeeds = new Map<string, TypedSeed[]>();

  const enabledPageGroupSets = draft.adSetSuggestions.filter(
    (s) => s.enabled && s.sourceType === "page_group",
  );
  const processedGroups = new Set<string>();

  for (const adSet of enabledPageGroupSets) {
    if (processedGroups.has(adSet.sourceId)) continue;
    processedGroups.add(adSet.sourceId);

    const group = draft.audiences.pageGroups.find((g) => g.id === adSet.sourceId);
    if (!group || group.pageIds.length === 0) continue;

    // Skip if no engagement types are selected — group is effectively standard-only.
    if (!group.engagementTypes || group.engagementTypes.length === 0) {
      console.log(
        `[launch-campaign] Phase 1.5 — skipping engagement audiences for "${group.name}":`,
        "no engagement types selected",
      );
      continue;
    }

    const createdIds: string[] = [];
    if (!group.engagementAudienceStatuses) group.engagementAudienceStatuses = [];

    for (const pageId of group.pageIds) {
      for (const et of group.engagementTypes) {
        const isIgType = et === "ig_followers" || et === "ig_engagement_365d";
        const igId = isIgType ? pageToIg.get(pageId) : undefined;
        const pageName = pageNameMap.get(pageId) || group.name || "Page Group";

        // ── Reuse existing audience if we have one from a prior run ─────────
        const existingStatus = group.engagementAudienceStatuses!.find(
          (s) => s.pageId === pageId && s.type === et,
        );
        if (existingStatus?.id) {
          // Audience already exists in Meta — check its current readiness
          const readiness = await checkAudienceReadiness(existingStatus.id, userFbToken ?? undefined);
          const now = new Date().toISOString();
          if (readiness) {
            existingStatus.lastCheckedAt = now;
            existingStatus.lastReadinessCode = readiness.code;
            existingStatus.lastReadinessDescription = readiness.description;
            existingStatus.readyForLookalike = readiness.ready;
            existingStatus.populating = readiness.populating;
          }
          console.log(
            `[launch-campaign] Phase 1.5 — reusing existing ${et} audience ${existingStatus.id}` +
            ` for page ${pageId} (${pageName})` +
            ` | readiness: ${readiness?.code ?? "unchecked"} (${readiness?.description ?? "?"})` +
            ` | ready: ${readiness?.ready ?? "?"} | populating: ${readiness?.populating ?? "?"}`,
          );
          createdIds.push(existingStatus.id);
          engagementAudiencesCreated.push({
            name: existingStatus.pageName
              ? `${existingStatus.pageName} — ${ENGAGEMENT_LABELS[et] ?? et}`
              : existingStatus.id,
            id: existingStatus.id,
            type: et,
            durationMs: 0,
          });
          continue;
        }

        if (isIgType && !igId) {
          const clientHadPage = pageId in clientIgMap;
          const noIgMsg = clientHadPage
            ? `Instagram account found in client cache for page ${pageId} but ID was empty — ` +
              `page may not have been enriched yet. Try reloading pages with enrichment.`
            : `No Instagram account linked to page ${pageId}. ` +
              `Neither instagram_business_account nor connected_instagram_account ` +
              `returned an IG account ID during page enrichment. ` +
              `Run the IG Diagnostic in the Audiences step to inspect the raw API response.`;
          console.warn(
            `[launch-campaign] Phase 1.5 ✗ page ${pageId} (${pageNameMap.get(pageId) ?? "?"}) — ${et}:`,
            noIgMsg,
          );
          engagementAudiencesFailed.push({
            name: `${pageName} — ${ENGAGEMENT_LABELS[et] ?? et}`,
            type: et,
            error: clientHadPage
              ? "Instagram account ID is empty in the pages cache — try reloading and re-enriching pages."
              : "No linked Instagram account found for this page. Run the IG Diagnostic in Audiences to investigate.",
            pageId,
            isPermissionFailure: false,
          });
          continue;
        }

        const sourceId = isIgType ? igId! : pageId;
        const sourceType = isIgType ? ("ig_business" as const) : ("page" as const);
        const audienceName = `${pageName} — ${ENGAGEMENT_LABELS[et] ?? et}`;

        console.log(
          `[launch-campaign] Phase 1.5 → creating new ${et}` +
          `\n  page:         ${pageId} (${pageName})` +
          `\n  sourceType:   ${sourceType}` +
          `\n  sourceId:     ${sourceId}` +
          (isIgType ? `\n  igId:         ${igId}` +
            `\n  igSource:     ${pageId in clientIgMap ? "client-cache (user OAuth)" : "server-fetch (system token)"}` : "") +
          `\n  tokenPath:    ${userFbToken ? "user-oauth-token" : "META_ACCESS_TOKEN (system)"}` +
          `\n  adAccount:    ${adAccountId}`,
        );

        const eaStart = Date.now();
        try {
          const result = await createEngagementAudience(adAccountId, {
            type: et as EngagementAudienceType,
            name: audienceName,
            sourceId,
            sourceType,
            userToken: userFbToken ?? undefined,
            pageId,
            pageName,
          });
          createdIds.push(result.id);
          engagementAudiencesCreated.push({ name: audienceName, id: result.id, type: et, durationMs: elapsed(eaStart) });

          // Record new status for future runs
          group.engagementAudienceStatuses!.push({
            id: result.id,
            type: et as EngagementType,
            pageId,
            pageName,
            createdAt: new Date().toISOString(),
            readyForLookalike: false,
            populating: false,
          });
        } catch (err) {
          const message = formatMetaError(err);
          const isPermission =
            message.toLowerCase().includes("permission") ||
            message.toLowerCase().includes("event source") ||
            message.includes("(#100)") ||
            message.includes("OAuthException");
          const rawErrData = err instanceof Error && "rawErrorData" in err
            ? (err as { rawErrorData?: unknown }).rawErrorData : undefined;
          console.error(
            `[launch-campaign] Phase 1.5 ✗ Failed to create ${et} for page ${pageId}` +
            `\n  message:    ${message}` +
            `\n  igId used:  ${isIgType ? (igId ?? "n/a") : "n/a (FB type)"}` +
            `\n  sourceId:   ${sourceId}` +
            `\n  isPermission: ${isPermission}` +
            (rawErrData ? `\n  rawError:   ${JSON.stringify(rawErrData)}` : ""),
          );
          const userFacingError = isPermission
            ? `${message} — Page can be used for standard targeting, but not for engagement audience generation with current permissions. Deselect the failing engagement type(s) for this group to suppress future attempts.`
            : message;
          engagementAudiencesFailed.push({
            name: audienceName,
            type: et,
            error: userFacingError,
            pageId,
            isPermissionFailure: isPermission,
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

  // Build typed seeds from engagementAudiencesCreated for preference-ranked lookalike creation.
  // Seed = one typed entry per successfully created engagement audience.
  for (const group of draft.audiences.pageGroups) {
    const freshSeeds: TypedSeed[] = engagementAudiencesCreated
      .filter((ea) => {
        // Match by checking if this group's pages produced this audience
        const pageName = group.pageIds
          .map((pid) => pageNameMap.get(pid) || pid)
          .find((n) => ea.name.startsWith(n));
        return !!pageName && group.engagementTypes.includes(ea.type as EngagementAudienceType);
      })
      .map((ea) => ({ id: ea.id, type: ea.type as EngagementAudienceType }));

    // Also include persisted seeds from a prior run (stored in engagementAudiencesByType).
    // These are tried AFTER fresh ones but are useful if no fresh audiences were created.
    const stored = group.engagementAudiencesByType ?? {};
    const cachedSeeds: TypedSeed[] = (Object.entries(stored) as [EngagementAudienceType, string][])
      .filter(([, id]) => !!id && !freshSeeds.some((s) => s.id === id))
      .map(([type, id]) => ({ id, type, fromCache: true }));

    const allSeeds = [...freshSeeds, ...cachedSeeds];
    if (allSeeds.length > 0) {
      pageGroupTypedSeeds.set(group.id, allSeeds);
    }

    // Persist best ID per type for future runs
    if (freshSeeds.length > 0) {
      const byType: Partial<Record<EngagementAudienceType, string>> = { ...(group.engagementAudiencesByType ?? {}) };
      for (const seed of freshSeeds) byType[seed.type] = seed.id;
      group.engagementAudiencesByType = byType;
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
          const clientHadPage = pageId in clientIgMap;
          console.warn(
            `[launch-campaign] Phase 1.5b ✗ SPLAL page ${pageId} — ${et}: no IG ID` +
            ` | clientHadPage=${clientHadPage}`,
          );
          engagementAudiencesFailed.push({
            name: `${pageNameMap.get(pageId) || pageId} — ${ENGAGEMENT_LABELS[et] ?? et} (SPLAL)`,
            type: et,
            error: clientHadPage
              ? "Instagram account ID is empty in the pages cache — try reloading and re-enriching pages."
              : "No linked Instagram account found for this page. Run the IG Diagnostic in Audiences to investigate.",
            pageId,
            isPermissionFailure: false,
          });
          continue;
        }

        const sourceId = isIgType ? igId! : pageId;
        const sourceType = isIgType ? ("ig_business" as const) : ("page" as const);
        const pageName = pageNameMap.get(pageId) || pageId;
        const audienceName = `${pageName} — ${ENGAGEMENT_LABELS[et] ?? et} [SPLAL]`;

        console.log(
          `[launch-campaign] Phase 1.5b → SPLAL attempting ${et}` +
          `\n  page:         ${pageId} (${pageName})` +
          `\n  sourceType:   ${sourceType}` +
          `\n  sourceId:     ${sourceId}` +
          (isIgType ? `\n  igId:         ${igId}` +
            `\n  igSource:     ${pageId in clientIgMap ? "client-cache (user OAuth)" : "server-fetch (system token)"}` : "") +
          `\n  tokenPath:    ${userFbToken ? "user-oauth-token" : "META_ACCESS_TOKEN (system)"}`,
        );

        const eaStart = Date.now();
        try {
          const result = await createEngagementAudience(adAccountId, {
            type: et as EngagementAudienceType,
            name: audienceName,
            sourceId,
            sourceType,
            userToken: userFbToken ?? undefined,
            pageId,
            pageName,
          });
          pageEngIds.push(result.id);
          createdIds.push(result.id);
          engagementAudiencesCreated.push({ name: audienceName, id: result.id, type: et, durationMs: elapsed(eaStart) });
        } catch (err) {
          const message = formatMetaError(err);
          const isPermission =
            message.toLowerCase().includes("permission") ||
            message.toLowerCase().includes("event source") ||
            message.includes("(#100)") ||
            message.includes("OAuthException");
          console.error(`[launch-campaign] Phase 1.5b ✗ SPLAL engagement failed for ${pageId} ${et}:`, message);
          engagementAudiencesFailed.push({
            name: audienceName, type: et, error: message,
            pageId, isPermissionFailure: isPermission,
          });
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

  // ── Side-by-side engagement result summary ────────────────────────────────
  {
    const allGroupsToLog = draft.audiences.pageGroups.filter((g) => g.pageIds.length > 0);
    const allTypes: EngagementAudienceType[] = ["fb_likes", "fb_engagement_365d", "ig_followers", "ig_engagement_365d"];
    const lines: string[] = [
      "[launch-campaign] ══ Engagement Audience Results (per page group) ══",
      `  Token context: ${userFbToken ? "user-oauth-token" : "META_ACCESS_TOKEN (system — weaker permissions)"}`,
    ];
    for (const g of allGroupsToLog) {
      lines.push(`\n  Group: "${g.name}" (${g.pageIds.length} page${g.pageIds.length !== 1 ? "s" : ""})`);
      lines.push(`    Standard targeting capable: YES (always)`);
      for (const et of allTypes) {
        if (!g.engagementTypes.includes(et)) {
          lines.push(`    ${et.padEnd(22)} NOT SELECTED`);
          continue;
        }
        for (const pageId of g.pageIds) {
          const pname = pageNameMap.get(pageId) || pageId;
          const successEntry = engagementAudiencesCreated.find(
            (e) => e.name.startsWith(pname) && e.type === et,
          );
          const failEntry = engagementAudiencesFailed.find(
            (e) => e.pageId === pageId && e.type === et,
          );
          if (successEntry) {
            lines.push(`    ${et.padEnd(22)} ✓ SUCCESS → id=${successEntry.id} | page=${pageId} (${pname})`);
          } else if (failEntry) {
            lines.push(`    ${et.padEnd(22)} ✗ FAILED  → page=${pageId} (${pname}) | ${failEntry.error}`);
          } else {
            lines.push(`    ${et.padEnd(22)} — (not attempted for page=${pageId})`);
          }
        }
      }
    }
    console.log(lines.join("\n"));
  }

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
      (g) => g.lookalike && (pageGroupTypedSeeds.get(g.id)?.length ?? 0) > 0,
    ) ||
    splalGroups.some((g) => enabledSplalGroupIds.has(g.id) && (splalEngagementIds.get(g.id)?.length ?? 0) > 0);

  let lookalikeCountry = "GB";
  for (const adSet of draft.adSetSuggestions) {
    if (adSet.geoLocations?.countries?.[0]) {
      lookalikeCountry = adSet.geoLocations.countries[0];
      break;
    }
  }

  // Phase 1.75 has a generous timeout — lookalikes run non-blocking alongside
  // ad-set/creative creation but the response waits for the promise to settle.
  // With poll/retry (5s + 10s + 15s per seed), 120s gives enough headroom for
  // 2–3 groups with a couple of retries each.
  const LAL_PHASE_TIMEOUT_MS = 120_000;

  // ── Inner helper: poll one audience until ready (or deadline) ────────────
  // Code 441 = "populating" — stop immediately without retry. Meta is actively
  // building this audience and it will not be ready for minutes/hours.
  // Code 400 = "processing" — short-term; retry with backoff (may become ready quickly).
  async function pollUntilReady(
    audienceId: string,
    deadline: number,
  ): Promise<{ ready: boolean; populating: boolean; retriesUsed: number; code: number; description: string }> {
    const RETRY_DELAYS = [5_000, 10_000, 15_000];
    let retriesUsed = 0;
    let lastCode = 400;
    let lastDescription = "not checked";
    let lastPopulating = false;

    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      if (Date.now() >= deadline) break;

      const status = await checkAudienceReadiness(audienceId, userFbToken ?? undefined);
      if (status) {
        lastCode = status.code;
        lastDescription = status.description;
        lastPopulating = status.populating;
        console.log(
          `[launch-campaign] Phase 1.75 readiness — ${audienceId} attempt ${attempt + 1}:` +
          ` code=${status.code} (${status.description}) | populating=${status.populating}`,
        );
        if (status.ready) return { ready: true, populating: false, retriesUsed, code: status.code, description: status.description };
        // Code 441 = audience is being populated by Meta — will not be ready in
        // this launch window. Defer immediately, no retries.
        if (status.populating) {
          console.log(
            `[launch-campaign] Phase 1.75 — ${audienceId} is populating (code 441).` +
            " Deferring lookalike — will be retryable once Meta finishes populating.",
          );
          return { ready: false, populating: true, retriesUsed, code: status.code, description: status.description };
        }
      }

      if (attempt < RETRY_DELAYS.length) {
        const waitMs = Math.min(RETRY_DELAYS[attempt], deadline - Date.now());
        if (waitMs <= 0) break;
        console.log(
          `[launch-campaign] Phase 1.75 — ${audienceId} not ready (code=${lastCode}),` +
          ` waiting ${waitMs}ms before retry ${attempt + 2}…`,
        );
        await new Promise((r) => setTimeout(r, waitMs));
        retriesUsed++;
      }
    }

    return { ready: false, populating: lastPopulating, retriesUsed, code: lastCode, description: lastDescription };
  }

  const lookalikesDeferred: NonNullable<LaunchSummary["lookalikesDeferred"]> = [];

  // ── Inner helper: attempt one lookalike with readiness check + retry ──────
  async function tryLookalikeWithReadiness(
    seed: TypedSeed,
    lalName: string,
    startingRatio: number,
    endingRatio: number,
    range: string,
    deadline: number,
    context: string,
    pageGroupId?: string,
  ): Promise<{ success: boolean; deferred?: boolean; lookalikId?: string; error?: string; skippedReason?: string }> {
    if (Date.now() >= deadline) {
      return { success: false, error: "Phase timeout reached before attempt", skippedReason: "phase timeout" };
    }

    console.log(
      `[launch-campaign] ${context} ▶ lookalike attempt` +
      `\n  seedId:    ${seed.id}` +
      `\n  seedType:  ${seed.type}${seed.fromCache ? " (persisted from prior run)" : " (created this run)"}` +
      `\n  lalName:   ${lalName}` +
      `\n  range:     ${range}` +
      `\n  country:   ${lookalikeCountry}`,
    );

    // Check source readiness before creating the lookalike.
    const readiness = await pollUntilReady(seed.id, deadline);
    console.log(
      `[launch-campaign] ${context} readiness result — ${seed.id}:` +
      ` ready=${readiness.ready} | populating=${readiness.populating}` +
      ` | code=${readiness.code} (${readiness.description}) | retries=${readiness.retriesUsed}`,
    );

    // Update persisted status
    for (const g of draft.audiences.pageGroups) {
      const st = g.engagementAudienceStatuses?.find((s) => s.id === seed.id);
      if (st) {
        st.lastCheckedAt = new Date().toISOString();
        st.lastReadinessCode = readiness.code;
        st.lastReadinessDescription = readiness.description;
        st.readyForLookalike = readiness.ready;
        st.populating = readiness.populating;
      }
    }

    if (!readiness.ready) {
      if (readiness.populating) {
        // Code 441 — audience is being populated. Defer without retrying.
        const deferMsg = `Lookalike deferred — source audience is still populating (code 441). Use "Retry lookalikes" once Meta finishes building the audience.`;
        lookalikesDeferred.push({
          name: lalName,
          range,
          seedAudienceId: seed.id,
          seedType: seed.type,
          pageGroupId: pageGroupId ?? "",
          reason: readiness.description,
        });
        return { success: false, deferred: true, error: deferMsg, skippedReason: "source audience populating" };
      }
      const error = `Lookalike skipped — source audience not ready (code=${readiness.code}: ${readiness.description})${
        readiness.retriesUsed > 0 ? ` after ${readiness.retriesUsed} retry check(s)` : ""
      }`;
      return { success: false, error, skippedReason: "source audience not ready" };
    }

    const lalStart = Date.now();
    try {
      const result = await createLookalikeAudience(adAccountId, {
        name: lalName,
        originAudienceId: seed.id,
        startingRatio,
        endingRatio,
        country: lookalikeCountry,
      });
      lookalikeAudiencesCreated.push({ name: lalName, id: result.id, range, durationMs: elapsed(lalStart) });
      // Mark source as having produced a lookalike
      for (const g of draft.audiences.pageGroups) {
        const st = g.engagementAudienceStatuses?.find((s) => s.id === seed.id);
        if (st) st.lookalikeId = result.id;
      }
      console.log(`[launch-campaign] ${context} ✓ Lookalike created → ${result.id}`);
      return { success: true, lookalikId: result.id };
    } catch (err) {
      const message = formatMetaError(err);
      const is2654 = message.includes("2654");
      const isPopulating = message.includes("441");
      console.error(`[launch-campaign] ${context} ✗ Lookalike creation failed:`, message);
      if (isPopulating || is2654) {
        lookalikesDeferred.push({
          name: lalName,
          range,
          seedAudienceId: seed.id,
          seedType: seed.type,
          pageGroupId: pageGroupId ?? "",
          reason: message,
        });
        return {
          success: false,
          deferred: true,
          error: `Lookalike deferred — source audience created but not yet ready: ${message}`,
          skippedReason: "source audience populating",
        };
      }
      return { success: false, error: message };
    }
  }

  const lookalikePromise = (async () => {
    if (!needsLookalikes) return;

    const lalPhaseDeadline = Date.now() + LAL_PHASE_TIMEOUT_MS;

    // One-time global wait after fresh engagement-audience creation to give
    // Meta a head start before the first readiness check.
    if (engagementAudiencesCreated.length > 0) {
      const initialWait = Math.min(20_000, lalPhaseDeadline - Date.now());
      if (initialWait > 0) {
        console.log(
          `[launch-campaign] Phase 1.75 — waiting ${initialWait}ms for newly created` +
          ` engagement audiences to propagate before readiness checks…`,
        );
        await new Promise((resolve) => setTimeout(resolve, initialWait));
      }
    }

    // ── Page group lookalikes ─────────────────────────────────────────────
    for (const group of draft.audiences.pageGroups) {
      if (Date.now() >= lalPhaseDeadline) {
        if (group.lookalike) {
          const ranges = group.lookalikeRanges?.length ? group.lookalikeRanges : ["0-1%"];
          for (const range of ranges) {
            lookalikeAudiencesFailed.push({
              name: `${group.name || "Page Group"} — Lookalike`,
              range,
              error: "Lookalike phase timeout reached (120s limit)",
              skippedReason: "phase timeout",
            });
          }
          console.log("[launch-campaign] Phase 1.75 — hard timeout, skipping", group.name);
        }
        continue;
      }

      if (!group.lookalike) continue;

      const ranges = group.lookalikeRanges?.length ? group.lookalikeRanges : ["0-1%"];
      const allSeeds = pageGroupTypedSeeds.get(group.id) ?? [];

      if (allSeeds.length === 0) {
        const noTypes = !group.engagementTypes || group.engagementTypes.length === 0;
        for (const range of ranges) {
          lookalikeAudiencesFailed.push({
            name: `${group.name || "Page Group"} — Lookalike`,
            range,
            error: noTypes
              ? "Lookalike skipped — no engagement types selected for this group."
              : "Lookalike skipped — no source audiences available (all engagement audience creation failed).",
            skippedReason: noTypes ? "no types selected" : "no source audiences",
          });
        }
        continue;
      }

      // Rank seeds: highest-quality engagement types first
      const rankedSeeds = rankSeedsByPreference(allSeeds);
      const groupName = pageNameMap.get(group.pageIds[0]) || group.name || "Page Group";
      const lookalikeIds: string[] = [];

      console.log(
        `[launch-campaign] Phase 1.75 — "${group.name}" | ${rankedSeeds.length} seed(s) ranked:`,
        rankedSeeds.map((s) => `${s.type}=${s.id}${s.fromCache ? "(cached)" : "(fresh)"}`).join(", "),
      );

      for (const range of ranges) {
        if (Date.now() >= lalPhaseDeadline) break;

        const { startingRatio, endingRatio } = parseLookalikeRange(range);
        const pctLabel = `${Math.round(endingRatio * 100)}%`;
        const lalName = `${groupName} — ${pctLabel} Lookalike`;

        // Try seeds in preference order — stop once one succeeds per range
        let succeeded = false;
        for (const seed of rankedSeeds) {
          if (Date.now() >= lalPhaseDeadline) break;
          if (succeeded) break;

          const result = await tryLookalikeWithReadiness(
            seed, lalName, startingRatio, endingRatio, range, lalPhaseDeadline,
            `Phase 1.75 "${group.name}"`,
            group.id,
          );

          if (result.success && result.lookalikId) {
            lookalikeIds.push(result.lookalikId);
            succeeded = true;
          } else if (result.deferred) {
            // Deferred (441) — already recorded in lookalikesDeferred. Do not
            // try lower-quality seeds — all will hit the same 441 state.
            succeeded = false;
            break;
          } else if (!succeeded) {
            lookalikeAudiencesFailed.push({
              name: lalName,
              range,
              error: result.error ?? "Unknown error",
              skippedReason: result.skippedReason,
            });
          }
        }
      }

      group.lookalikeAudienceIds = lookalikeIds;
    }

    // ── Phase 1.75b — Lookalikes for SelectedPagesLookalikeGroups ──────────
    for (const splalGroup of splalGroups) {
      if (Date.now() >= lalPhaseDeadline) {
        if (enabledSplalGroupIds.has(splalGroup.id)) {
          console.log(`[launch-campaign] Phase 1.75b — timeout; skipping SPLAL group "${splalGroup.name}"`);
          for (const range of (splalGroup.lookalikeRanges ?? ["0-1%"])) {
            lookalikeAudiencesFailed.push({
              name: `${splalGroup.name} — Lookalike (${range})`,
              range,
              error: "Lookalike phase timeout reached (120s limit)",
              skippedReason: "phase timeout",
            });
          }
        }
        continue;
      }

      if (!enabledSplalGroupIds.has(splalGroup.id)) continue;

      const flatSeedIds = splalEngagementIds.get(splalGroup.id) ?? [];
      if (flatSeedIds.length === 0) {
        console.log(`[launch-campaign] Phase 1.75b — no seeds for SPLAL group "${splalGroup.name}"`);
        for (const range of (splalGroup.lookalikeRanges ?? ["0-1%"])) {
          lookalikeAudiencesFailed.push({
            name: `${splalGroup.name} — Lookalike (${range})`,
            range,
            error: "No source audiences available (all pages skipped or engagement creation failed)",
            skippedReason: "no source audiences",
          });
        }
        continue;
      }

      // Build typed seeds for SPLAL from engagementAudiencesCreated
      const splalTypedSeeds: TypedSeed[] = engagementAudiencesCreated
        .filter((ea) => flatSeedIds.includes(ea.id))
        .map((ea) => ({ id: ea.id, type: ea.type as EngagementAudienceType }));
      const splalRankedSeeds = rankSeedsByPreference(
        splalTypedSeeds.length > 0
          ? splalTypedSeeds
          : flatSeedIds.map((id) => ({ id, type: "fb_engagement_365d" as EngagementAudienceType })),
      );

      console.log(
        `[launch-campaign] Phase 1.75b SPLAL "${splalGroup.name}" | ${splalRankedSeeds.length} seed(s):`,
        splalRankedSeeds.map((s) => `${s.type}=${s.id}`).join(", "),
      );

      const lookalikesPerRange: Record<string, string[]> = {};
      const ranges = splalGroup.lookalikeRanges?.length ? splalGroup.lookalikeRanges : (["0-1%"] as const);

      for (const range of ranges) {
        if (Date.now() >= lalPhaseDeadline) break;

        const { startingRatio, endingRatio } = parseLookalikeRange(range);
        const pctLabel = `${Math.round(endingRatio * 100)}%`;
        const rangeIds: string[] = [];

        for (const seed of splalRankedSeeds) {
          if (Date.now() >= lalPhaseDeadline) break;

          const lalName = `${splalGroup.name || "Selected Pages"} — ${pctLabel} Lookalike`;
          const result = await tryLookalikeWithReadiness(
            seed, lalName, startingRatio, endingRatio, range, lalPhaseDeadline,
            `Phase 1.75b SPLAL "${splalGroup.name}"`,
            splalGroup.id,
          );
          if (result.success && result.lookalikId) {
            rangeIds.push(result.lookalikId);
          } else if (!result.deferred) {
            lookalikeAudiencesFailed.push({
              name: lalName, range,
              error: result.error ?? "Unknown error",
              skippedReason: result.skippedReason,
            });
          }
          // Deferred entries are already in lookalikesDeferred via tryLookalikeWithReadiness
        }

        if (rangeIds.length > 0) lookalikesPerRange[range] = rangeIds;
      }

      splalGroup.lookalikeAudienceIdsByRange = lookalikesPerRange;
      console.log(
        `[launch-campaign] Phase 1.75b SPLAL "${splalGroup.name}" — ranges with lookalikes:`,
        Object.entries(lookalikesPerRange).map(([r, ids]) => `${r}: ${ids.length} IDs`).join(", ") || "none",
      );
    }

    // ── Phase 1.75d — Lookalikes from Custom Audience Groups ─────────────────
    // Uses pre-existing audiences from the ad account as sources, so no
    // readiness polling needed — these audiences are already in Meta.
    for (const caGroup of draft.audiences.customAudienceGroups) {
      if (!caGroup.lookalike || !caGroup.lookalikeRanges?.length || caGroup.audienceIds.length === 0) continue;
      if (Date.now() >= lalPhaseDeadline) {
        console.log(`[launch-campaign] Phase 1.75d — timeout, skipping custom group "${caGroup.name}"`);
        break;
      }

      caGroup.lookalikeAudienceIdsByRange = {};

      for (const range of caGroup.lookalikeRanges) {
        if (Date.now() >= lalPhaseDeadline) break;

        const { startingRatio, endingRatio } = parseLookalikeRange(range);
        const pctLabel = `${Math.round(endingRatio * 100)}%`;
        const lalName = `${caGroup.name || "Custom Audiences"} — ${pctLabel} Lookalike`;
        let succeeded = false;

        for (const audienceId of caGroup.audienceIds) {
          if (succeeded || Date.now() >= lalPhaseDeadline) break;
          const lalStart = Date.now();
          console.log(
            `[launch-campaign] Phase 1.75d ▶ "${lalName}" (source=${audienceId})`,
          );
          try {
            const result = await createLookalikeAudience(adAccountId, {
              name: lalName,
              originAudienceId: audienceId,
              startingRatio,
              endingRatio,
              country: lookalikeCountry,
            });
            caGroup.lookalikeAudienceIdsByRange[range] = [result.id];
            lookalikeAudiencesCreated.push({ name: lalName, id: result.id, range, durationMs: elapsed(lalStart) });
            succeeded = true;
            console.log(`[launch-campaign] Phase 1.75d ✓ "${lalName}" → ${result.id}`);
          } catch (err) {
            const message = formatMetaError(err);
            console.error(`[launch-campaign] Phase 1.75d ✗ "${lalName}" (source=${audienceId}):`, message);
            if (!succeeded) {
              lookalikeAudiencesFailed.push({ name: lalName, range, error: message });
            }
          }
        }
      }
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

  // ── attach_adset short-circuit ──────────────────────────────────────────
  // In attach_adset mode there's nothing to create here: the user picked
  // one or more live ad sets in Step 1 and we already verified them in
  // Phase 1. Seed adSetMetaIds with one synthetic key per selected ad set
  // so Phase 4 can route ads to each of the existing live ad sets, and
  // record one synthetic launch result per ad set so the UI can surface
  // the reuse.
  if (wizardMode === "attach_adset") {
    const liveAdSets =
      attachedLiveAdSets.length > 0
        ? attachedLiveAdSets
        : attachAdSetSnapshots.map((s) => ({ id: s.id, name: s.name } as VerifiedLiveAdSet));
    for (const liveAdSet of liveAdSets) {
      const synthKey = attachedAdSetKey(liveAdSet.id);
      adSetMetaIds.set(synthKey, liveAdSet.id);
      adSetLaunchResults[synthKey] = {
        launchStatus: "created",
        metaAdSetId: liveAdSet.id,
      };
      console.log(
        `[launch-campaign] Phase 2 (attach_adset) — skipping ad set creation;` +
          ` reusing live ad set ${liveAdSet.id}` +
          (liveAdSet.name ? ` ("${liveAdSet.name}")` : "") +
          ` for synthetic key ${synthKey}`,
      );
    }
  }

  // Split ad sets: standard ones can proceed now, lookalike ones must wait
  const LOOKALIKE_TYPES = new Set(["lookalike_group", "selected_pages_lookalike", "custom_group_lookalike"]);
  const standardSets = enabledSets.filter((s) => !LOOKALIKE_TYPES.has(s.sourceType));
  const lookalikeSets = enabledSets.filter((s) => LOOKALIKE_TYPES.has(s.sourceType));

  const adSetCreationPromise = (async () => {
    console.log("[launch-campaign] Phase 2 — creating", standardSets.length, "standard ad sets");

    // Build adSetId → first existing-post creative so placement overrides can
    // be applied to the ad set targeting before creating it.
    // (draft.creativeAssignments is creative-id → ad-set-id[]; invert it here)
    const adSetToCreativeMap = new Map<string, AdCreativeDraft>();
    for (const [creativeId, adSetIds] of Object.entries(draft.creativeAssignments ?? {})) {
      const creative = launchCreatives.find((c) => c.id === creativeId);
      if (!creative || creative.sourceType !== "existing_post") continue;
      for (const asId of adSetIds ?? []) {
        if (!adSetToCreativeMap.has(asId)) {
          adSetToCreativeMap.set(asId, creative);
        }
      }
    }

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

          // ── Manual placement override for existing-post ad sets ─────────────
          // If an existing-post creative is assigned to this ad set, apply the
          // placement toggles from that creative (falling back to smart defaults).
          // This sets publisher_platforms + positions and switches Meta from
          // automatic placements to manual placements.
          const assignedCreative = adSetToCreativeMap.get(adSet.id);
          if (assignedCreative?.existingPost) {
            const placementTargeting = resolveAdSetPlacementTargeting(assignedCreative.existingPost);
            if (placementTargeting) {
              adSetPayload.targeting.publisher_platforms = placementTargeting.publisher_platforms;
              if (placementTargeting.instagram_positions) {
                adSetPayload.targeting.instagram_positions = placementTargeting.instagram_positions;
              }
              if (placementTargeting.facebook_positions) {
                adSetPayload.targeting.facebook_positions = placementTargeting.facebook_positions;
              }
              const placements = resolveExistingPostPlacements(assignedCreative.existingPost);
              const placementValidation = validatePlacementSelection(
                placements,
                assignedCreative.existingPost.source,
              );
              if (!placementValidation.valid) {
                throw new Error(
                  `Placement validation failed for ad set "${adSet.name}": ` +
                  placementValidation.errors.join("; "),
                );
              }
              console.log(
                `[launch-campaign] Phase 2 — placements for "${adSet.name}":` +
                ` ${summarisePlacements(placements)}` +
                ` → ${JSON.stringify(placementTargeting)}`,
              );
            } else {
              console.warn(
                `[launch-campaign] Phase 2 ⚠ no valid placements for "${adSet.name}" (assigned creative: "${assignedCreative.name}") — falling back to Meta automatic placements`,
              );
            }
          }

          // ── Final pre-create sanitisation ──────────────────────────────────
          // Runs the hardcoded override table one last time against the exact
          // interest list we are about to send to Meta. This catches cases
          // where preflight's async fuzzy-match path didn't strip a deprecated
          // interest (e.g. "Heavy Metal (magazine)", "Avant-garde") even
          // though it exists in HARDCODED_DEPRECATED_INTERESTS.
          if (adSet.sourceType === "interest_group" && (adSetPayload.targeting.interests ?? []).length > 0) {
            const before = adSetPayload.targeting.interests ?? [];
            const { cleaned, removed, replaced } = sanitizeTargetingInterestsBeforeLaunch(before);
            if (removed.length > 0 || replaced.length > 0) {
              finalLaunchInterestSanitizationApplied = true;
              adSetPayload.targeting.interests = cleaned;
              for (const r of removed) {
                launchRemovedDeprecatedInterests.push({ adSetName: adSet.name, name: r.name, reason: r.reason });
                interestReplacements.push({
                  deprecated: r.name,
                  replacement: null,
                  adSetName: adSet.name,
                });
              }
              for (const r of replaced) {
                launchReplacedDeprecatedInterests.push({
                  adSetName: adSet.name,
                  deprecated: r.deprecated,
                  replacementSearchName: r.replacementSearchName,
                });
              }
              console.log(
                `[launch-campaign] Phase 2 — pre-create sanitiser stripped ${removed.length} interest(s) from "${adSet.name}":\n` +
                removed.map((r) => `    - ${r.name}: ${r.reason}`).join("\n"),
              );
            }
          }

          // ── Targeting trace log ──────────────────────────────────────────────
          const tgt = adSetPayload.targeting;
          const customAudIds = (tgt.custom_audiences ?? []).map((a) => a.id);
          const interestIds = (tgt.interests ?? []).map((i) => `${i.name}(${i.id})`);
          console.log(
            `[launch-campaign] Phase 2 — FINAL TARGETING for "${adSet.name}" (${adSet.sourceType}):` +
            `\n  custom_audiences: [${customAudIds.join(", ") || "EMPTY"}]` +
            `\n  interests:        [${interestIds.join(", ") || "EMPTY"}]` +
            `\n  geo_locations:    ${JSON.stringify(tgt.geo_locations)}` +
            `\n  age:              ${tgt.age_min ?? "?"}–${tgt.age_max ?? "?"}` +
            `\n  full_targeting:   ${JSON.stringify(tgt)}`,
          );

          // ── Hard targeting validation ─────────────────────────────────────────
          // Do NOT create ad sets with empty targeting — this would result in
          // untargeted broad-audience spend across the entire country.
          if (!hasAudienceTargeting(tgt)) {
            const reason = buildEmptyTargetingReason(adSet, draft.audiences);
            console.error(
              `[launch-campaign] Phase 2 ✗ ABORTED "${adSet.name}" — empty targeting.` +
              `\n  sourceType: ${adSet.sourceType}` +
              `\n  reason:     ${reason}` +
              `\n  custom_audiences in group at this point: ` +
              (adSet.sourceType === "page_group"
                ? JSON.stringify(
                    draft.audiences.pageGroups.find((g) => g.id === adSet.sourceId)?.engagementAudienceIds ?? []
                  )
                : "n/a"),
            );
            throw { adSet, err: new Error(
              `No valid targeting — ad set creation aborted. ${reason}`
            )};
          }

          try {
            const adSetRes = await createMetaAdSet(adAccountId, adSetPayload);
            const dur = elapsed(asStart);
            console.log(`[launch-campaign] Phase 2 ✓  ad set: ${adSet.name} → ${adSetRes.id} (${dur}ms)`);
            return { adSet, metaAdSetId: adSetRes.id, durationMs: dur };
          } catch (err) {
            // Auto-retry ONCE for deprecated-interest failures. Covers Meta
            // error subcode 1870247 ("interest is deprecated") plus any other
            // error payload that `extractDeprecatedReplacements` can parse.
            if (adSet.sourceType === "interest_group" && err instanceof MetaApiError) {
              const replacements = extractDeprecatedReplacements(err.rawErrorData, err.message);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const subcode = (err.rawErrorData as any)?.error_subcode;
              if (subcode === 1870247) {
                console.log(
                  `[launch-campaign] Phase 2 ✗  "${adSet.name}" — Meta subcode 1870247 (deprecated interest) — attempting sanitised retry`,
                );
              }
              if (replacements.length > 0) {
                launchRetryAttempted += 1;
                finalLaunchInterestSanitizationApplied = true;
                for (const r of replacements) {
                  interestReplacements.push({
                    deprecated: r.deprecatedName || r.deprecatedId,
                    replacement: r.alternativeName || r.alternativeId,
                    adSetName: adSet.name,
                  });
                  if (r.alternativeName || r.alternativeId) {
                    launchReplacedDeprecatedInterests.push({
                      adSetName: adSet.name,
                      deprecated: r.deprecatedName || r.deprecatedId,
                      replacementSearchName: r.alternativeName || r.alternativeId || "",
                    });
                  } else {
                    launchRemovedDeprecatedInterests.push({
                      adSetName: adSet.name,
                      name: r.deprecatedName || r.deprecatedId,
                      reason: "Removed after Meta returned deprecated-interest error with no alternative",
                    });
                  }
                }

                const rebuiltPayload = buildAdSetPayload(
                  adSet, metaCampaignId, draft.audiences, draft.budgetSchedule,
                  draft.settings.optimisationGoal, draft.settings.objective,
                  draft.settings.metaPixelId || draft.settings.pixelId || undefined,
                );
                // Apply Meta's alternatives (or remove entirely when none) and
                // run the local sync sanitiser one more time so any other
                // deprecated names can't slip through on retry.
                let retryPayload = applyInterestReplacements(rebuiltPayload, replacements);
                if ((retryPayload.targeting.interests ?? []).length > 0) {
                  const { cleaned } = sanitizeTargetingInterestsBeforeLaunch(
                    retryPayload.targeting.interests ?? [],
                  );
                  retryPayload = { ...retryPayload, targeting: { ...retryPayload.targeting, interests: cleaned } };
                }
                const retryRes = await createMetaAdSet(adAccountId, retryPayload);
                launchRetrySucceeded += 1;
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
  // Use launchCreatives (patched with verified instagramActorId in Phase 0e).
  const updatedCreatives: AdCreativeDraft[] = launchCreatives.map((c) => ({ ...c }));

  const creativeCreationPromise = (async () => {
    console.log("[launch-campaign] Phase 3 — creating", launchCreatives.length, "creatives");

    for (const creative of launchCreatives) {
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

        // ── Creative Integrity Mode (strict sanitizer) ─────────────────────
        // Default ON; settable per-draft via `creativeIntegrityMode`. The
        // sanitizer mutates the payload in place to opt out of every
        // Advantage+ enhancement and to strip any auto-added asset fields
        // before we POST to Meta. We log strict-mode = false explicitly so
        // launches that disable the safeguard are auditable.
        if (strictMode) {
          const report = sanitizeCreativeForStrictMode(creativePayload);
          console.log(
            `[launch-campaign] Phase 3 — strict mode applied for "${creative.name}":` +
              ` strippedTopLevel=${report.strippedTopLevel.join(",") || "(none)"}` +
              ` strippedLinkData=${report.strippedLinkData.join(",") || "(none)"}` +
              ` optedOutFeatures=${report.optedOutFeatures.length}`,
          );
        } else {
          console.warn(
            `[launch-campaign] Phase 3 — strict mode DISABLED for "${creative.name}"` +
              ` — Meta may apply Advantage+ enhancements automatically.`,
          );
        }

        // ── Structured pre-POST summary (Part 1 audit log) ────────────────
        const creativeBranch: string = (() => {
          if (creative.sourceType !== "existing_post") return "new_ad";
          return creative.existingPost?.source === "instagram"
            ? "ig_existing_post"
            : "fb_existing_post";
        })();

        // Branch-specific identity fields:
        //   ig_existing_post  → instagram_user_id (content account id that owns the post)
        //   fb_existing_post  → object_story_id only; no IG field needed
        //   new_ad            → page_id only; instagram_actor_id intentionally omitted
        const isIgExistingPost = creativeBranch === "ig_existing_post";
        const isFbExistingPost = creativeBranch === "fb_existing_post";
        const igUserIdFinal = creativePayload.instagram_user_id ?? "(NOT SET)";

        // launchReady: only ig_existing_post has a required IG-specific field.
        // new_ad and fb_existing_post are ready as long as validation passed.
        const launchReady = isIgExistingPost
          ? igUserIdFinal !== "(NOT SET)"
          : true;

        // Find placement payload that will be/was applied to the ad set for this creative.
        const placementSummary =
          creative.sourceType === "existing_post" && creative.existingPost
            ? JSON.stringify(resolveAdSetPlacementTargeting(creative.existingPost))
            : "automatic (not an existing-post creative)";

        const igIdentityLine = (() => {
          if (isIgExistingPost) {
            return (
              `\n  [instagram_user_id sent]  ${igUserIdFinal}` +
              `\n  [instagram_actor_id]      OMITTED ✓ (not used for source_instagram_media_id)`
            );
          }
          if (isFbExistingPost) {
            return `\n  [instagram_actor_id]      OMITTED ✓ (fb_existing_post uses object_story_id)`;
          }
          // new_ad: page_id only, no IG actor needed
          return `\n  [instagram_actor_id]      OMITTED ✓ (page-only identity for new_ad)`;
        })();

        console.log(
          `\n[launch-campaign] Phase 3 ─── CREATIVE PRE-POST SUMMARY ───────────────────` +
          `\n  [Creative Branch]         ${creativeBranch}` +
          `\n  [Ad Name]                 ${creative.name}` +
          `\n  [Page ID]                 ${creative.identity?.pageId ?? "(none)"}` +
          `\n  [contentAccountId]        ${creative.identity?.instagramAccountId ?? "(unset)"}` +
          igIdentityLine +
          `\n  [post.instagramAcctId]    ${creative.existingPost?.instagramAccountId ?? "n/a"}` +
          `\n  [post/media id]           ${creative.existingPost?.postId ?? "n/a"}` +
          `\n  [Placement Payload]       ${placementSummary}` +
          `\n  [Creative Payload]        ${JSON.stringify(creativePayload)}` +
          `\n  [Launch Ready]            ${launchReady ? "YES ✓" : "NO — instagram_user_id missing for ig_existing_post"}` +
          `\n────────────────────────────────────────────────────────────────────────────`,
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
        console.log(
          `[launch-campaign] Phase 3 ✓  creative: ${creative.name} → ${metaCreativeId}` +
            ` (${dur}ms) strictMode=${strictMode}`,
        );

        const cIdx = updatedCreatives.findIndex((c) => c.id === creative.id);
        if (cIdx !== -1) updatedCreatives[cIdx] = { ...updatedCreatives[cIdx], metaCreativeId };

        const igId = creative.identity?.instagramActorId || creative.identity?.instagramAccountId;
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

        // NOTE: the instagram_actor_id retry block has been removed.
        // new_ad link/video creatives no longer send instagram_actor_id, so the
        // (#100) actor rejection can no longer be triggered by those branches.
        // ig_existing_post uses instagram_user_id — also no actor field.
        // If a future branch re-introduces instagram_actor_id, add targeted
        // retry logic here (not a blanket actor-swap loop).

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

        // Targeting trace log
        const tgt2b = adSetPayload.targeting;
        const customAudIds2b = (tgt2b.custom_audiences ?? []).map((a) => a.id);
        console.log(
          `[launch-campaign] Phase 2b — FINAL TARGETING for "${adSet.name}" (${adSet.sourceType}):` +
          `\n  custom_audiences: [${customAudIds2b.join(", ") || "EMPTY"}]` +
          `\n  geo_locations:    ${JSON.stringify(tgt2b.geo_locations)}` +
          `\n  full_targeting:   ${JSON.stringify(tgt2b)}`,
        );

        // Hard targeting validation
        if (!hasAudienceTargeting(tgt2b)) {
          const reason = buildEmptyTargetingReason(adSet, draft.audiences);
          throw new Error(`No valid targeting — ad set creation aborted. ${reason}`);
        }

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
  // attach_adset mode: include each synthetic key so Phase 4 logs the live
  // ad set's name instead of the synthetic projection id.
  if (wizardMode === "attach_adset") {
    const snapshotById = new Map(
      attachAdSetSnapshots.map((s) => [s.id, s.name] as const),
    );
    for (const liveAdSet of attachedLiveAdSets) {
      adSetNameById.set(
        attachedAdSetKey(liveAdSet.id),
        liveAdSet.name || snapshotById.get(liveAdSet.id) || "Existing ad set",
      );
    }
    // Fallback: if Phase 1 had to short-circuit before populating
    // attachedLiveAdSets, still register names from snapshots.
    for (const s of attachAdSetSnapshots) {
      const key = attachedAdSetKey(s.id);
      if (!adSetNameById.has(key)) {
        adSetNameById.set(key, s.name);
      }
    }
  }

  console.log(
    `[launch-campaign] Phase 4 — linking ads` +
      (wizardMode === "attach_adset"
        ? ` (attach_adset: routing ads to ${attachAdSetIds.length} existing ad set(s)` +
          ` [${attachAdSetIds.join(",")}])`
        : ""),
  );

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
    lookalikesDeferred: lookalikesDeferred.length > 0 ? lookalikesDeferred : undefined,
    updatedEngagementStatuses: draft.audiences.pageGroups
      .filter((g) => (g.engagementAudienceStatuses?.length ?? 0) > 0)
      .map((g) => ({ groupId: g.id, statuses: g.engagementAudienceStatuses! })),
    updatedCustomGroupLookalikes: draft.audiences.customAudienceGroups
      .filter((g) => g.lookalikeAudienceIdsByRange && Object.keys(g.lookalikeAudienceIdsByRange).length > 0)
      .map((g) => ({ groupId: g.id, lookalikeAudienceIdsByRange: g.lookalikeAudienceIdsByRange! })),
    interestReplacements: interestReplacements.length > 0 ? interestReplacements : undefined,
    interestsSkippedNotTargetable: interestsSkippedNotTargetable.length > 0
      ? { count: interestsSkippedNotTargetable.length, items: interestsSkippedNotTargetable }
      : undefined,
    launchInterestSanitization:
      finalLaunchInterestSanitizationApplied ||
      launchRemovedDeprecatedInterests.length > 0 ||
      launchReplacedDeprecatedInterests.length > 0 ||
      launchRetryAttempted > 0
        ? {
            finalLaunchInterestSanitizationApplied,
            launchRemovedDeprecatedInterests,
            launchReplacedDeprecatedInterests,
            launchRetryAttempted,
            launchRetrySucceeded,
          }
        : undefined,
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
