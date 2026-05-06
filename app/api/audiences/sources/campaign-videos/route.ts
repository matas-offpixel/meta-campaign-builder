import { type NextRequest } from "next/server";

import {
  audienceSourceRateLimitBody,
  isMetaAdAccountRateLimitError,
} from "@/lib/audiences/meta-rate-limit";
import { getCachedAudienceSource } from "@/lib/audiences/source-cache";
import {
  fetchAudienceCampaignVideos,
  resolveAudienceSourceContext,
} from "@/lib/audiences/sources";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorised" }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get("clientId")?.trim();
  const campaignId = req.nextUrl.searchParams.get("campaignId")?.trim();
  if (!clientId || !campaignId) {
    return Response.json(
      { error: "clientId and campaignId are required" },
      { status: 400 },
    );
  }

  try {
    const context = await resolveAudienceSourceContext(supabase, user.id, clientId);
    if (!context) return Response.json({ error: "Forbidden" }, { status: 403 });
    const { token, source } = await resolveServerMetaToken(supabase, user.id);
    const result = await getCachedAudienceSource(
      [user.id, clientId, "campaign-videos", campaignId],
      () =>
        fetchAudienceCampaignVideos(
          context.metaAdAccountId,
          campaignId,
          token,
        ),
    );
    return Response.json({ ok: true, ...result, tokenSource: source });
  } catch (err) {
    if (isMetaAdAccountRateLimitError(err)) {
      return Response.json(audienceSourceRateLimitBody(), { status: 429 });
    }
    const message = err instanceof Error ? err.message : "Failed to load videos";
    return Response.json({ error: message }, { status: 502 });
  }
}
