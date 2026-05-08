import { type NextRequest } from "next/server";

import {
  audienceSourceRateLimitBody,
  isMetaAdAccountRateLimitError,
} from "@/lib/audiences/meta-rate-limit";
import { getCachedAudienceSourceDb } from "@/lib/audiences/source-cache-db";
import {
  fetchAudienceCampaignVideos,
  resolveAudienceSourceContext,
} from "@/lib/audiences/sources";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { createClient } from "@/lib/supabase/server";

// Vercel function timeout. Default is 10s; J2-scale campaigns
// (~200 videos) push `fetchAudienceCampaignVideos` to 20–40s on cold
// cache. Bumped to 60s with the DB cache (mig 087) so the second hit
// always lands in cache and never burns a Vercel function-second
// budget. Pro plan ceiling is 800s — 60s is comfortably under.
export const maxDuration = 60;

const TTL_MS = 30 * 60 * 1000;

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
    const result = await getCachedAudienceSourceDb({
      userId: user.id,
      clientId,
      sourceKind: "campaign-videos",
      cacheKey: campaignId,
      ttlMs: TTL_MS,
      load: () =>
        fetchAudienceCampaignVideos(
          context.metaAdAccountId,
          campaignId,
          token,
        ),
    });
    return Response.json({ ok: true, ...result, tokenSource: source });
  } catch (err) {
    if (isMetaAdAccountRateLimitError(err)) {
      return Response.json(audienceSourceRateLimitBody(err), { status: 429 });
    }
    const message = err instanceof Error ? err.message : "Failed to load videos";
    return Response.json({ error: message }, { status: 502 });
  }
}
