/**
 * POST /api/bulk-attach-templates/[id]/apply
 *
 * Matches a saved template's `match_pattern` against a caller-supplied list
 * of live campaigns (and optionally ad sets), returns the suggested selection,
 * and increments the template's `use_count`.
 *
 * The caller (client page) is responsible for fetching the campaign list from
 * the Meta API — this keeps the apply route fast and avoids a server-side
 * Meta API call for every preview.
 *
 * Body:
 *   campaigns  — array of { id, name } for all live campaigns in the ad account
 *   adSets     — optional: { [campaignId]: { id, name }[] }
 *                if provided, ad set matching is also performed
 *
 * Response:
 *   matchedCampaignIds         — campaign IDs that match the pattern
 *   unmatchedCampaignPatterns  — pattern terms that matched no campaign
 *   suggestionConfidence       — "high" | "low"
 *   adSetMatchPattern          — the template's ad_set_name_contains (passed
 *                                through so AdSetPicker can use it on step 1)
 *   adSetPreview               — if adSets was provided: per-campaign match preview
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getBulkAttachTemplate, incrementTemplateUseCount } from "@/lib/db/bulk-attach-templates";
import { matchCampaigns, matchAdSets } from "@/lib/bulk-attach/template-matcher";
import type { CampaignRef, AdSetRef } from "@/lib/bulk-attach/template-matcher";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface AdSetPreviewEntry {
  campaignId: string;
  matchedAdSetIds: string[];
  unmatchedAdSetPatterns: string[];
}

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { id } = await ctx.params;

  let body: {
    campaigns: CampaignRef[];
    adSets?: Record<string, AdSetRef[]>;
  };
  try {
    body = await req.json();
    if (!Array.isArray(body?.campaigns)) throw new Error("Missing required field: campaigns");
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid body: ${err instanceof Error ? err.message : "bad JSON"}` },
      { status: 400 },
    );
  }

  let template;
  try {
    template = await getBulkAttachTemplate(supabase, { id, userId: user.id });
    if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch template" },
      { status: 500 },
    );
  }

  // ── Campaign matching ──────────────────────────────────────────────────────
  const campaignResult = matchCampaigns(template.match_pattern, body.campaigns);

  // ── Ad set preview (optional) ──────────────────────────────────────────────
  let adSetPreview: AdSetPreviewEntry[] | undefined;
  if (body.adSets && Object.keys(body.adSets).length > 0) {
    adSetPreview = Object.entries(body.adSets).map(([campaignId, adSets]) => {
      const result = matchAdSets(template.match_pattern, adSets);
      return {
        campaignId,
        matchedAdSetIds: result.matchedAdSetIds,
        unmatchedAdSetPatterns: result.unmatchedAdSetPatterns,
      };
    });
  }

  // ── Increment use_count (fire-and-forget, non-critical) ───────────────────
  incrementTemplateUseCount(supabase, { id, userId: user.id }).catch((err) =>
    console.warn("[apply] use_count increment failed:", err instanceof Error ? err.message : err),
  );

  return NextResponse.json({
    matchedCampaignIds: campaignResult.matchedCampaignIds,
    unmatchedCampaignPatterns: campaignResult.unmatchedCampaignPatterns,
    suggestionConfidence: campaignResult.suggestionConfidence,
    adSetMatchPattern: template.match_pattern.ad_set_name_contains ?? [],
    adSetPreview,
  });
}
