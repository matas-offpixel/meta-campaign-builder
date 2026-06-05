/**
 * POST /api/meta/bulk-attach-ads
 *
 * Bulk-attaches new creatives to ALL ad sets across N existing live Meta
 * campaigns in a single operation. Designed for the agency workflow "I just
 * made 3 new video variations — drop them across all 5 campaigns."
 *
 * Architecture:
 *   1. Auth + token resolve (same pattern as launch-campaign)
 *   2. Hard-cap guard: refuse if metaCampaignIds.length > 8
 *   3. For each campaign (SERIAL, 1s sleep between):
 *      a. Fetch all active/paused ad sets for that campaign
 *      b. For each creative:
 *         - Build the Meta creative payload from the AdCreativeDraft
 *         - POST ONE creative per campaign (Meta lets one creative attach to N
 *           ads in the same account — no need to re-create per ad set)
 *         - For each ad set: POST one ad linking that creative
 *   4. Return per-campaign success/fail summary (partial success acceptable)
 *
 * Rate-limit safety:
 *   - Serial campaigns + 1s sleep guards against #80004 ad-account bucket
 *   - classifyLaunchMetaCode / mapLaunchTokenError surface #4/#17/#80004 as
 *     429s with rateLimited:true — NOT a tokenExpired prompt
 *   - Hard cap of 8 campaigns per batch prevents runaway API debt
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  fetchAdSetsForCampaign,
  createMetaCreative,
  createMetaAd,
  MetaApiError,
} from "@/lib/meta/client";
import {
  buildCreativePayload,
  buildAdPayload,
  validateCreativePayload,
} from "@/lib/meta/creative";
import {
  classifyLaunchMetaCode,
  mapLaunchTokenError,
} from "@/lib/meta/launch-error-classify";
import type { AdCreativeDraft } from "@/lib/types";

export const maxDuration = 600;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BulkAttachRequest {
  adAccountId: string;
  /** Verified live Meta campaign IDs. Hard cap: max 8. */
  metaCampaignIds: string[];
  /** Standard wizard creative shape — assets already uploaded to Meta. */
  newCreatives: AdCreativeDraft[];
}

export interface CampaignAttachResult {
  campaignId: string;
  adSetsFound: number;
  adsCreated: number;
  adsFailed: number;
  creativesCreated: { name: string; metaCreativeId: string }[];
  creativesFailed: { name: string; error: string }[];
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
    if (!Array.isArray(body.metaCampaignIds) || body.metaCampaignIds.length === 0) {
      throw new Error("Missing or empty metaCampaignIds");
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

  const { adAccountId, metaCampaignIds, newCreatives } = body;

  // ── Hard cap ─────────────────────────────────────────────────────────────
  if (metaCampaignIds.length > BULK_ATTACH_CAP) {
    return NextResponse.json(
      {
        error: `Bulk attach limited to ${BULK_ATTACH_CAP} campaigns per run to avoid Meta rate limits. Split into smaller batches.`,
        count: metaCampaignIds.length,
        cap: BULK_ATTACH_CAP,
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
    `[bulk-attach-ads] start: adAccountId=${adAccountId} campaigns=${metaCampaignIds.length} creatives=${newCreatives.length}`,
  );

  // ── Per-campaign serial execution ────────────────────────────────────────
  const results: CampaignAttachResult[] = [];
  let totalAdsCreated = 0;
  let totalAdsFailed = 0;
  let rateLimited = false;

  for (let ci = 0; ci < metaCampaignIds.length; ci++) {
    const campaignId = metaCampaignIds[ci];
    if (ci > 0) {
      await sleep(CAMPAIGN_SLEEP_MS);
    }

    console.error(`[bulk-attach-ads] campaign ${ci + 1}/${metaCampaignIds.length}: ${campaignId}`);

    const result: CampaignAttachResult = {
      campaignId,
      adSetsFound: 0,
      adsCreated: 0,
      adsFailed: 0,
      creativesCreated: [],
      creativesFailed: [],
    };

    // ── Fetch ad sets for this campaign ──────────────────────────────────
    let adSetIds: { id: string; name: string }[];
    try {
      // "all" to include both ACTIVE and PAUSED (same as existing picker behaviour)
      const { data: rawAdSets } = await fetchAdSetsForCampaign({
        campaignId,
        filter: "relevant",
        token,
      });
      adSetIds = rawAdSets.map((a) => ({ id: a.id, name: a.name ?? a.id }));
      result.adSetsFound = adSetIds.length;
      console.error(
        `[bulk-attach-ads]   ${adSetIds.length} ad set(s) found for campaign ${campaignId}`,
      );
    } catch (err) {
      const metaErr = err instanceof MetaApiError ? err : null;
      const kind = classifyLaunchMetaCode(metaErr?.code);
      if (kind === "rate_limit") {
        rateLimited = true;
        const mapping = mapLaunchTokenError(metaErr?.code);
        result.error = mapping.message;
      } else {
        result.error = `Failed to fetch ad sets: ${formatMetaError(err)}`;
      }
      results.push(result);
      continue;
    }

    if (adSetIds.length === 0) {
      result.error = "No active or paused ad sets found in this campaign.";
      results.push(result);
      continue;
    }

    // ── For each creative: create ONE Meta creative, then one ad per ad set ─
    for (const creative of newCreatives) {
      // Build the Meta creative payload from the wizard draft.
      let metaPayload;
      try {
        metaPayload = buildCreativePayload(creative);
      } catch (err) {
        result.creativesFailed.push({
          name: creative.name,
          error: `Payload build failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }

      // Create ONE creative per campaign (reuse across all ad sets in this campaign).
      let metaCreativeId: string;
      try {
        const { id } = await createMetaCreative(adAccountId, metaPayload, token);
        metaCreativeId = id;
        console.error(
          `[bulk-attach-ads]   creative "${creative.name}" → metaCreativeId=${metaCreativeId}`,
        );
        result.creativesCreated.push({ name: creative.name, metaCreativeId });
      } catch (err) {
        const metaErr = err instanceof MetaApiError ? err : null;
        const kind = classifyLaunchMetaCode(metaErr?.code);
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

      // Create one ad per ad set, linking to the single creative.
      for (const adSet of adSetIds) {
        const adName = `${creative.name} — ${adSet.name}`;
        const adPayload = buildAdPayload(adName, metaCreativeId, adSet.id);
        try {
          await createMetaAd(adAccountId, adPayload, token);
          result.adsCreated++;
          console.error(`[bulk-attach-ads]   ad created: "${adName}" → adSet ${adSet.id}`);
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
    `[bulk-attach-ads] done: totalAdsCreated=${totalAdsCreated} totalAdsFailed=${totalAdsFailed} rateLimited=${rateLimited}`,
  );

  const responseBody: BulkAttachResult = {
    campaigns: results,
    totalAdsCreated,
    totalAdsFailed,
    ...(rateLimited && { rateLimited: true }),
  };

  // Return 429 if every campaign was rate-limited; 207 for partial success; 200 for full success.
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
