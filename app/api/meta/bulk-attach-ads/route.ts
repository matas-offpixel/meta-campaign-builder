/**
 * POST /api/meta/bulk-attach-ads
 *
 * Bulk-attaches new creatives to explicitly-selected ad sets across N existing
 * live Meta campaigns. The user picks which ad sets to target in Step 1 of the
 * UI (via GET /api/meta/bulk-attach-ads/list-adsets); this route receives the
 * final explicit selection and executes the launch.
 *
 * Body shape:
 *   {
 *     adAccountId: string;
 *     campaignAdSets: Record<string, string[]>; // campaignId → adSetId[]
 *     newCreatives: AdCreativeDraft[];
 *   }
 *
 * Architecture:
 *   1. Auth + token resolve
 *   2. Hard-cap guard: refuse if Object.keys(campaignAdSets).length > 8
 *   3. Validate: each campaign's adSetIds array must be non-empty
 *   4. Validate: total ads (sum of all adSetIds × creatives) must be ≤ 200
 *   5. For each campaign (SERIAL, 1s sleep between):
 *      a. For each creative:
 *         - Build Meta creative payload
 *         - POST ONE creative per campaign (reused across all ad sets in campaign)
 *         - For each pre-selected ad set: POST one ad
 *   6. Return per-campaign success/fail summary (partial success acceptable)
 *
 * Rate-limit safety:
 *   - Serial campaigns + 1s sleep guards against #80004 ad-account bucket
 *   - classifyLaunchMetaCode / mapLaunchTokenError surface #4/#17/#80004 as
 *     429s with rateLimited:true — NOT a tokenExpired prompt
 *   - 8-campaign hard cap + 200-total-ad cap prevent runaway API debt
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createMetaCreative,
  createMetaAd,
  fetchAdSetGuardInfo,
  MetaApiError,
} from "@/lib/meta/client";
import {
  buildCreativePayload,
  buildAdPayload,
  validateCreativePayload,
} from "@/lib/meta/creative";
import { createIgActorValidator } from "@/lib/meta/ig-actor-validator";
import { resolvePageIdentity } from "@/lib/meta/page-token";
import {
  classifyLaunchMetaCode,
  mapLaunchTokenError,
} from "@/lib/meta/launch-error-classify";
import { summariseRelaunchGuard } from "@/lib/bulk-attach/launch-validation";
import type { AdCreativeDraft } from "@/lib/types";

export const maxDuration = 600;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BulkAttachRequest {
  adAccountId: string;
  /** When launching from the asset queue wizard — enables richer payload diagnostics. */
  launchContext?: { source: "asset_queue"; queueId: string };
  /**
   * Explicit per-campaign ad set selection from the ad-set picker (Step 1).
   * Key = Meta campaign ID, value = array of Meta ad set IDs to target.
   * Each array must be non-empty (validated before launch).
   * Max 8 campaigns (keys).
   */
  campaignAdSets: Record<string, string[]>;
  /** Standard wizard creative shape — assets already uploaded to Meta. */
  newCreatives: AdCreativeDraft[];
}

export interface CampaignAttachResult {
  campaignId: string;
  /** How many ad sets were targeted (equals the pre-selected count). */
  adSetsFound: number;
  /** Ad set IDs that were targeted — surfaces in the result summary. */
  adSetIds: string[];
  adsCreated: number;
  adsFailed: number;
  creativesCreated: { name: string; metaCreativeId: string }[];
  creativesFailed: { name: string; error: string }[];
  /** Meta ad IDs created for this campaign — used by queue launched_meta_ad_ids. */
  adIds: string[];
  /** Set when the entire campaign batch failed before any ad creation. */
  error?: string;
}

export interface BulkAttachResult {
  campaigns: CampaignAttachResult[];
  totalAdsCreated: number;
  totalAdsFailed: number;
  /** True when Meta returned a rate-limit code mid-run. */
  rateLimited?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const BULK_ATTACH_CAP = 8;
export const TOTAL_ADS_CAP = 200;
const CAMPAIGN_SLEEP_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function formatMetaError(err: unknown): string {
  if (err instanceof MetaApiError) {
    const parts: string[] = [err.message];
    if (err.code) parts.push(`code=${err.code}`);
    if (err.subcode) parts.push(`subcode=${err.subcode}`);
    if (err.userMsg) parts.push(`detail: "${err.userMsg}"`);
    return parts.join(" · ");
  }
  return err instanceof Error ? err.message : String(err);
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  // ── Parse body ───────────────────────────────────────────────────────────
  let body: BulkAttachRequest;
  try {
    body = await req.json();
    if (!body?.adAccountId) throw new Error("Missing adAccountId");
    if (!body.campaignAdSets || typeof body.campaignAdSets !== "object" || Array.isArray(body.campaignAdSets)) {
      throw new Error("Missing or invalid campaignAdSets (must be an object)");
    }
    if (Object.keys(body.campaignAdSets).length === 0) {
      throw new Error("campaignAdSets must have at least one campaign");
    }
    if (!Array.isArray(body.newCreatives) || body.newCreatives.length === 0) {
      throw new Error("Missing or empty newCreatives");
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid request body: ${err instanceof Error ? err.message : "bad JSON"}` },
      { status: 400 },
    );
  }

  const { adAccountId, campaignAdSets, newCreatives } = body;
  const campaignIds = Object.keys(campaignAdSets);

  // ── Hard cap on campaign count ────────────────────────────────────────────
  if (campaignIds.length > BULK_ATTACH_CAP) {
    return NextResponse.json(
      {
        error: `Bulk attach limited to ${BULK_ATTACH_CAP} campaigns per run to avoid Meta rate limits. Split into smaller batches.`,
        count: campaignIds.length,
        cap: BULK_ATTACH_CAP,
      },
      { status: 400 },
    );
  }

  // ── Validate: each campaign must have ≥1 ad set selected ─────────────────
  const emptyAdSetCampaigns = campaignIds.filter(
    (cid) => !Array.isArray(campaignAdSets[cid]) || campaignAdSets[cid].length === 0,
  );
  if (emptyAdSetCampaigns.length > 0) {
    return NextResponse.json(
      {
        error: `Each campaign must have at least one ad set selected. Empty: ${emptyAdSetCampaigns.join(", ")}`,
        emptyAdSetCampaigns,
      },
      { status: 400 },
    );
  }

  // ── Validate: total ads cap ───────────────────────────────────────────────
  const totalAdSets = campaignIds.reduce((sum, cid) => sum + campaignAdSets[cid].length, 0);
  const totalAds = totalAdSets * newCreatives.length;
  if (totalAds > TOTAL_ADS_CAP) {
    return NextResponse.json(
      {
        error: `Total ads to create (${totalAds}) exceeds the limit of ${TOTAL_ADS_CAP}. Reduce the number of campaigns, ad sets, or creatives.`,
        totalAds,
        cap: TOTAL_ADS_CAP,
      },
      { status: 400 },
    );
  }

  // ── Validate creatives ───────────────────────────────────────────────────
  const creativeErrors: string[] = [];
  for (const c of newCreatives) {
    const { isValid, errors } = validateCreativePayload(c);
    if (!isValid) creativeErrors.push(...errors);
  }
  if (creativeErrors.length > 0) {
    return NextResponse.json(
      { error: "Creative validation failed", details: creativeErrors },
      { status: 400 },
    );
  }

  // ── Resolve token ────────────────────────────────────────────────────────
  let token: string = process.env.META_ACCESS_TOKEN ?? "";
  try {
    const { data } = await supabase
      .from("user_facebook_tokens")
      .select("provider_token")
      .eq("user_id", user.id)
      .maybeSingle();
    if (data?.provider_token) token = data.provider_token;
  } catch {
    // fall through to env token
  }

  if (!token) {
    return NextResponse.json(
      { error: "No Facebook token available. Reconnect Facebook in Account Setup." },
      { status: 401 },
    );
  }

  console.error(
    `[bulk-attach-ads] start: adAccountId=${adAccountId} campaigns=${campaignIds.length} ` +
      `totalAdSets=${totalAdSets} creatives=${newCreatives.length} totalAds=${totalAds}`,
  );

  // ── Dynamic Creative guard (relaunch / "add to ad set" safety) ───────────
  // Ad sets targeted here already exist — bulk-attach never creates them —
  // so we read their LIVE is_dynamic_creative + ad-count state and refuse to
  // add more ads to any that already qualify as "one ad, Dynamic Creative"
  // (Meta hard constraint, see lib/bulk-attach/launch-validation.ts). This
  // is the server-side enforcement layer; the wizard's "Launch another
  // variation to these ad sets" flow pre-checks the same thing client-side
  // via GET /api/meta/bulk-attach-ads/adset-guard for faster feedback.
  const allTargetAdSetIds = [...new Set(campaignIds.flatMap((cid) => campaignAdSets[cid]))];
  const guardInfoMap = await fetchAdSetGuardInfo(allTargetAdSetIds, token);
  const { blockedMessage } = summariseRelaunchGuard(Array.from(guardInfoMap.values()), 0);
  if (blockedMessage) {
    console.error(`[bulk-attach-ads] ✗ Dynamic Creative guard blocked launch: ${blockedMessage}`);
    return NextResponse.json({ error: blockedMessage }, { status: 400 });
  }

  // One validator per launch — fetches /instagram_accounts at most once.
  const igValidator = createIgActorValidator(adAccountId, token);

  // Pre-resolve page access tokens for the page-level IG actor fallback.
  // Covers agency setups (e.g. 4thefans) where the IG is linked to the Page
  // but not registered as a BM asset on the ad account (PR #567).
  const pageTokenMap = new Map<string, string | null>();
  const uniquePageIds = [
    ...new Set(
      newCreatives
        .map((c) => c.identity.pageId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  for (const pid of uniquePageIds) {
    try {
      const ident = await resolvePageIdentity(pid, token);
      pageTokenMap.set(pid, ident.pageAccessToken ?? null);
    } catch {
      pageTokenMap.set(pid, null);
    }
  }

  // ── Per-campaign serial execution ────────────────────────────────────────
  const results: CampaignAttachResult[] = [];
  let totalAdsCreated = 0;
  let totalAdsFailed = 0;
  let rateLimited = false;

  for (let ci = 0; ci < campaignIds.length; ci++) {
    const campaignId = campaignIds[ci];
    const adSetIds = campaignAdSets[campaignId]; // pre-selected by the user

    if (ci > 0) await sleep(CAMPAIGN_SLEEP_MS);

    console.error(
      `[bulk-attach-ads] campaign ${ci + 1}/${campaignIds.length}: ${campaignId} ` +
        `(${adSetIds.length} ad set(s) selected)`,
    );

    const result: CampaignAttachResult = {
      campaignId,
      adSetsFound: adSetIds.length,
      adSetIds,
      adsCreated: 0,
      adsFailed: 0,
      creativesCreated: [],
      creativesFailed: [],
      adIds: [],
    };

    // ── For each creative: create ONE Meta creative, then one ad per ad set ─
    for (const creative of newCreatives) {
      // Validate IG actor — BM-asset first, page-level fallback second.
      const rawIgActorId = creative.identity.instagramActorId ?? "";
      const creativePageId = creative.identity.pageId ?? "";
      const creativePageToken = pageTokenMap.get(creativePageId) ?? null;
      const validatedIgActorId = rawIgActorId
        ? await igValidator.validate(rawIgActorId, {
            pageId: creativePageId || undefined,
            pageToken: creativePageToken,
          })
        : null;

      let metaPayload;
      try {
        metaPayload = buildCreativePayload(creative, {
          validatedIgActorId: validatedIgActorId ?? undefined,
        });
      } catch (err) {
        result.creativesFailed.push({
          name: creative.name,
          error: `Payload build failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }

      // One creative per campaign — reused across all selected ad sets.
      // Log payload shape (counts only — no raw IDs/hashes which are effectively secrets).
      const isMultiPlacement = !!metaPayload.asset_feed_spec?.asset_customization_rules?.length;
      const payloadShape = {
        path: isMultiPlacement ? "multi_placement" : "single_asset",
        hasObjectStorySpec: !!metaPayload.object_story_spec,
        hasVideoData: !!metaPayload.object_story_spec?.video_data,
        hasLinkData: !!metaPayload.object_story_spec?.link_data,
        hasAssetFeedSpec: !!metaPayload.asset_feed_spec,
        assetFeedVideoCount: metaPayload.asset_feed_spec?.videos?.length ?? 0,
        assetFeedImageCount: metaPayload.asset_feed_spec?.images?.length ?? 0,
        rulesCount: metaPayload.asset_feed_spec?.asset_customization_rules?.length ?? 0,
        adFormats: metaPayload.asset_feed_spec?.ad_formats,
        optimizationType: metaPayload.asset_feed_spec?.optimization_type,
      };
      console.error(
        `[bulk-attach-ads]   creative "${creative.name}" payload shape:`,
        JSON.stringify(payloadShape),
      );

      if (body.launchContext?.source === "asset_queue") {
        const afs = metaPayload.asset_feed_spec;
        console.error(
          `[bulk-attach-ads] asset_queue wire payload queueId=${body.launchContext.queueId}`,
          JSON.stringify({
            creativeName: creative.name,
            cta: creative.cta,
            assetMode: creative.assetMode,
            mediaType: creative.mediaType,
            aspects: creative.assetVariations?.[0]?.assets?.map((a) => ({
              ratio: a.aspectRatio,
              uploaded: a.uploadStatus === "uploaded",
              hasHash: !!a.assetHash,
              hasVideoId: !!a.videoId,
            })),
            ...payloadShape,
            afsImageAdLabels: afs?.images?.map((img) => img.adlabels),
            afsVideoAdLabels: afs?.videos?.map((vid) => vid.adlabels),
            afsCustomizationRules: afs?.asset_customization_rules,
            linkDataImageHash: metaPayload.object_story_spec?.link_data?.image_hash,
            videoDataVideoId: metaPayload.object_story_spec?.video_data?.video_id,
          }),
        );
      }

      let metaCreativeId: string;
      try {
        const { id } = await createMetaCreative(adAccountId, metaPayload, token);
        metaCreativeId = id;
        console.error(
          `[bulk-attach-ads]   creative "${creative.name}" → metaCreativeId=${metaCreativeId} path=${isMultiPlacement ? "multi_placement" : "single_asset"}`,
        );
        result.creativesCreated.push({ name: creative.name, metaCreativeId });
      } catch (err) {
        const metaErr = err instanceof MetaApiError ? err : null;
        const kind = classifyLaunchMetaCode(metaErr?.code);
        // Surface enough detail to diagnose asset_feed_spec rejections (code=100).
        console.error(
          `[bulk-attach-ads]   creative "${creative.name}" FAILED:`,
          JSON.stringify({
            path: isMultiPlacement ? "multi_placement" : "single_asset",
            code: metaErr?.code,
            subcode: metaErr?.subcode,
            userMsg: metaErr?.userMsg,
            message: metaErr?.message ?? String(err),
          }),
        );
        if (kind === "rate_limit") {
          rateLimited = true;
          const mapping = mapLaunchTokenError(metaErr?.code);
          result.creativesFailed.push({ name: creative.name, error: mapping.message });
        } else {
          result.creativesFailed.push({
            name: creative.name,
            error: formatMetaError(err),
          });
        }
        continue;
      }

      // One ad per selected ad set.
      for (const adSetId of adSetIds) {
        const adName = `${creative.name} — ${adSetId}`;
        const adPayload = buildAdPayload(adName, metaCreativeId, adSetId);
        try {
          const { id: adId } = await createMetaAd(adAccountId, adPayload, token);
          result.adsCreated++;
          result.adIds.push(adId);
          console.error(
            `[bulk-attach-ads]   ad created: "${adName}" → adSet ${adSetId} adId=${adId}`,
          );
        } catch (err) {
          const metaErr = err instanceof MetaApiError ? err : null;
          const kind = classifyLaunchMetaCode(metaErr?.code);
          if (kind === "rate_limit") rateLimited = true;
          result.adsFailed++;
          console.error(
            `[bulk-attach-ads]   ad FAILED: "${adName}": ${formatMetaError(err)}`,
          );
        }
      }
    }

    totalAdsCreated += result.adsCreated;
    totalAdsFailed += result.adsFailed;
    results.push(result);
  }

  console.error(
    `[bulk-attach-ads] done: totalAdsCreated=${totalAdsCreated} totalAdsFailed=${totalAdsFailed} ` +
      `rateLimited=${rateLimited}`,
  );

  const responseBody: BulkAttachResult = {
    campaigns: results,
    totalAdsCreated,
    totalAdsFailed,
    ...(rateLimited && { rateLimited: true }),
  };

  const allRateLimited =
    rateLimited && results.every((r) => r.error?.includes("rate limit"));
  if (allRateLimited) {
    return NextResponse.json(responseBody, { status: 429 });
  }

  const hasAnyFailure =
    totalAdsFailed > 0 || results.some((r) => r.creativesFailed.length > 0 || r.error);
  return NextResponse.json(responseBody, {
    status: hasAnyFailure ? 207 : 200,
  });
}
