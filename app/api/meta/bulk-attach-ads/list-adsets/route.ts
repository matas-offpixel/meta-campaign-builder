/**
 * GET /api/meta/bulk-attach-ads/list-adsets
 *
 * Fetches ad sets for a comma-separated list of Meta campaign IDs so the
 * bulk-attach ad-set picker (Step 1) can show which ad sets exist and let
 * the user pick a subset before launching.
 *
 * Query params:
 *   adAccountId  — Meta ad account (act_xxx), passed for context/logging
 *   campaignIds  — comma-separated campaign IDs, e.g. "123,456,789"
 *
 * Response:
 *   200 { campaigns: [{ campaignId, adSets: [{ id, name, status }] }] }
 *   207 { ..., partial: true, failedCampaignIds: [...] }   — some campaigns failed
 *   429 { error, rateLimited: true }                       — all rate-limited
 *
 * Rate-limit discipline (mirrors the POST launch path):
 *   - Serial fetch per campaign with 1s sleep between
 *   - classifyLaunchMetaCode on every Meta error: #4/#17/#80004 → partial
 *     response with failedCampaignIds; NOT a token-reconnect prompt
 *   - maxDuration = 60 (8 campaigns × ~3s each + buffer)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAdSetsForCampaign, MetaApiError } from "@/lib/meta/client";
import {
  classifyLaunchMetaCode,
  mapLaunchTokenError,
} from "@/lib/meta/launch-error-classify";

export const maxDuration = 60;

// ─── Response types ────────────────────────────────────────────────────────

export interface AdSetInfo {
  id: string;
  name: string;
  /** Meta effective_status string, e.g. "ACTIVE", "PAUSED", "ARCHIVED" */
  status: string;
}

export interface CampaignAdSetsResult {
  campaignId: string;
  adSets: AdSetInfo[];
}

export interface ListAdSetsResult {
  campaigns: CampaignAdSetsResult[];
  /** True when at least one campaign failed (rate-limited or API error). */
  partial?: boolean;
  /** Campaign IDs that could not be fetched. */
  failedCampaignIds?: string[];
}

// ─── Route handler ─────────────────────────────────────────────────────────

const SLEEP_MS = 1000;
function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  // ── Parse query params ──────────────────────────────────────────────────
  const { searchParams } = req.nextUrl;
  const adAccountId = searchParams.get("adAccountId") ?? "";
  const campaignIdsRaw = searchParams.get("campaignIds") ?? "";
  const campaignIds = campaignIdsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (campaignIds.length === 0) {
    return NextResponse.json(
      { error: "campaignIds query param is required (comma-separated campaign IDs)" },
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
    `[list-adsets] start: adAccountId=${adAccountId} campaigns=${campaignIds.length}`,
  );

  // ── Fetch ad sets per campaign serially ─────────────────────────────────
  const results: CampaignAdSetsResult[] = [];
  const failedCampaignIds: string[] = [];
  let anyRateLimited = false;

  for (let ci = 0; ci < campaignIds.length; ci++) {
    const campaignId = campaignIds[ci];
    if (ci > 0) await sleep(SLEEP_MS);

    try {
      // Fetch ALL ad sets (relevant = ACTIVE + PAUSED) with full pagination
      // via a single request capped at 50. For most campaigns 50 is ample;
      // a follow-up "load more" UX is out of scope for v1.
      const { data: rawAdSets } = await fetchAdSetsForCampaign({
        campaignId,
        filter: "all",
        limit: 50,
        token,
      });

      results.push({
        campaignId,
        adSets: rawAdSets.map((a) => ({
          id: a.id,
          name: a.name ?? a.id,
          status: a.effective_status ?? a.status ?? "UNKNOWN",
        })),
      });

      console.error(
        `[list-adsets]   campaign ${campaignId}: ${rawAdSets.length} ad set(s)`,
      );
    } catch (err) {
      const metaErr = err instanceof MetaApiError ? err : null;
      const kind = classifyLaunchMetaCode(metaErr?.code);

      console.error(
        `[list-adsets]   campaign ${campaignId} FAILED: ` +
          `code=${metaErr?.code ?? "?"} kind=${kind} msg=${metaErr?.message ?? String(err)}`,
      );

      failedCampaignIds.push(campaignId);
      if (kind === "rate_limit") anyRateLimited = true;
    }
  }

  // ── Build response ──────────────────────────────────────────────────────
  const partial = failedCampaignIds.length > 0;
  const allFailed = results.length === 0;

  if (allFailed && anyRateLimited) {
    const mapping = mapLaunchTokenError(4); // representative rate-limit code
    return NextResponse.json(
      { error: mapping.message, rateLimited: true, failedCampaignIds },
      { status: 429 },
    );
  }

  const body: ListAdSetsResult = {
    campaigns: results,
    ...(partial && { partial: true, failedCampaignIds }),
  };

  return NextResponse.json(body, { status: partial ? 207 : 200 });
}
