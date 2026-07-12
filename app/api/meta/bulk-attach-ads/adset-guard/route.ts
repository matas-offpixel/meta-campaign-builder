/**
 * GET /api/meta/bulk-attach-ads/adset-guard
 *
 * Fetches live Dynamic-Creative + current ad-count state for a specific set
 * of Meta ad set IDs. Backs the "Launch another variation to these ad sets"
 * relaunch flow (bulk-attach Review & launch → back to Configure creatives):
 *
 *   - HARD BLOCK: an ad set that has gone Dynamic Creative and already
 *     contains ≥1 ad cannot receive another ad — Meta allows only ONE ad
 *     per Dynamic Creative ad set (see PR #666, creativeTriggersVariationRotation,
 *     and the create-time equivalent in launch-campaign/route.ts).
 *   - SOFT WARNING: an ad set already carrying a lot of ads (default
 *     threshold 6) — not a Meta rule, just an operator sanity check.
 *
 * POST /api/meta/bulk-attach-ads re-runs the same hard-block check
 * server-side right before creating ads — this endpoint exists so the
 * wizard can surface the block BEFORE the user re-configures creatives,
 * instead of only failing after a full relaunch attempt.
 *
 * Query params:
 *   adSetIds — comma-separated Meta ad set IDs
 *
 * Response: 200 { adSets: AdSetGuardInfo[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAdSetGuardInfo, type AdSetGuardInfo } from "@/lib/meta/client";

export interface AdSetGuardResponse {
  adSets: AdSetGuardInfo[];
  /** True when the Meta fetch failed entirely — guard data below is a fallback default, not verified. */
  degraded?: boolean;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  // ── Parse query params ───────────────────────────────────────────────────
  const { searchParams } = req.nextUrl;
  const adSetIdsRaw = searchParams.get("adSetIds") ?? "";
  const adSetIds = adSetIdsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (adSetIds.length === 0) {
    return NextResponse.json(
      { error: "adSetIds query param is required (comma-separated ad set IDs)" },
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

  const guardInfoMap = await fetchAdSetGuardInfo(adSetIds, token);
  const adSets: AdSetGuardInfo[] = adSetIds.map(
    (id) => guardInfoMap.get(id) ?? { id, isDynamicCreative: false, adCount: 0 },
  );

  const body: AdSetGuardResponse = {
    adSets,
    ...(guardInfoMap.size === 0 && { degraded: true }),
  };
  return NextResponse.json(body);
}
