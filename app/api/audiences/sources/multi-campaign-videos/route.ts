import { type NextRequest } from "next/server";

import {
  audienceSourceRateLimitBody,
  isMetaAdAccountRateLimitError,
} from "@/lib/audiences/meta-rate-limit";
import { getCachedAudienceSource } from "@/lib/audiences/source-cache";
import {
  fetchAudienceMultiCampaignVideos,
  resolveAudienceSourceContext,
} from "@/lib/audiences/sources";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { createClient } from "@/lib/supabase/server";

const MAX_CAMPAIGN_IDS = 20;

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorised" }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get("clientId")?.trim();
  const campaignIdsRaw = req.nextUrl.searchParams.get("campaignIds")?.trim();
  if (!clientId || !campaignIdsRaw) {
    return Response.json(
      { error: "clientId and campaignIds are required" },
      { status: 400 },
    );
  }

  const campaignIds = campaignIdsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (campaignIds.length === 0) {
    return Response.json(
      { error: "campaignIds must contain at least one ID" },
      { status: 400 },
    );
  }
  if (campaignIds.length > MAX_CAMPAIGN_IDS) {
    return Response.json(
      { error: `campaignIds must contain at most ${MAX_CAMPAIGN_IDS} IDs` },
      { status: 400 },
    );
  }

  try {
    const context = await resolveAudienceSourceContext(
      supabase,
      user.id,
      clientId,
    );
    if (!context) return Response.json({ error: "Forbidden" }, { status: 403 });

    const { token, source } = await resolveServerMetaToken(supabase, user.id);

    // Cache key includes all campaign IDs sorted so order doesn't matter.
    const sortedIds = [...campaignIds].sort();
    const result = await getCachedAudienceSource(
      [user.id, clientId, "multi-campaign-videos", sortedIds.join(",")],
      () =>
        fetchAudienceMultiCampaignVideos(
          context.metaAdAccountId,
          campaignIds,
          token,
        ),
    );

    return Response.json({ ok: true, ...result, tokenSource: source });
  } catch (err) {
    if (isMetaAdAccountRateLimitError(err)) {
      return Response.json(audienceSourceRateLimitBody(err), { status: 429 });
    }
    const message =
      err instanceof Error ? err.message : "Failed to load videos";
    return Response.json({ error: message }, { status: 502 });
  }
}
