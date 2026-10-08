import { NextResponse, type NextRequest } from "next/server";

import { listTikTokAttachAdGroups, listTikTokAttachCampaigns } from "@/lib/tiktok/attach/read";
import {
  draftObjectiveForTikTokObjectiveType,
  isSmartPlusTikTokTarget,
} from "@/lib/tiktok/attach/targets";
import { credentialsForImportAdvertiser } from "@/lib/tiktok/import/account";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/tiktok/attach-targets?advertiserId=…
 *   → active + paused campaigns with their ad-group counts.
 * GET /api/tiktok/attach-targets?advertiserId=…&campaignIds=a,b
 *   → active + paused ad groups of those campaigns.
 *
 * Read-only. Feeds the Launch into pickers; launch re-reads live.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const advertiserId = req.nextUrl.searchParams.get("advertiserId");
  if (!advertiserId) {
    return NextResponse.json(
      { ok: false, error: "Missing advertiserId query param" },
      { status: 400 },
    );
  }
  const campaignIds = (req.nextUrl.searchParams.get("campaignIds") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const credentials = await credentialsForImportAdvertiser(supabase, {
    userId: user.id,
    advertiserId,
  });
  if ("error" in credentials) {
    return NextResponse.json(
      { ok: false, error: credentials.error },
      { status: credentials.status },
    );
  }

  try {
    if (campaignIds.length > 0) {
      const adGroups = await listTikTokAttachAdGroups({
        advertiserId,
        token: credentials.token,
        campaignIds,
      });
      return NextResponse.json({
        ok: true,
        adGroups: adGroups.map((group) => ({
          ...group,
          smartPlus: isSmartPlusTikTokTarget(group),
        })),
      });
    }

    const campaigns = await listTikTokAttachCampaigns({
      advertiserId,
      token: credentials.token,
    });
    const counts = new Map<string, number>();
    let countsKnown = true;
    try {
      const adGroups = await listTikTokAttachAdGroups({
        advertiserId,
        token: credentials.token,
        campaignIds: campaigns.map((c) => c.id),
      });
      for (const group of adGroups) {
        counts.set(group.campaignId, (counts.get(group.campaignId) ?? 0) + 1);
      }
    } catch (err) {
      countsKnown = false;
      console.error(
        "[tiktok/attach-targets] ad group count read failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
    return NextResponse.json({
      ok: true,
      campaigns: campaigns.map((campaign) => ({
        ...campaign,
        adGroupCount: countsKnown ? (counts.get(campaign.id) ?? 0) : null,
        smartPlus: isSmartPlusTikTokTarget(campaign),
        objectiveSupported: draftObjectiveForTikTokObjectiveType(campaign.objectiveType) != null,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[tiktok/attach-targets] read failed:", message);
    return NextResponse.json(
      { ok: false, error: message || "TikTok read failed" },
      { status: 502 },
    );
  }
}
