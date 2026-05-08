import { type NextRequest } from "next/server";

import { getCachedAudienceSourceDb } from "@/lib/audiences/source-cache-db";
import {
  fetchAudienceCampaignVideos,
  resolveAudienceSourceContext,
} from "@/lib/audiences/sources";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/audiences/sources/prewarm
 *
 * Body: `{ clientId: string }`
 *
 * Fired by the Audience Builder client UI on mount. Looks up the
 * client's 3 most-recent Meta campaigns (sorted by max(date) across
 * `event_daily_rollups` so we get the actually-active ones, not the
 * historically-oldest), then fires a `fetchAudienceCampaignVideos`
 * call for each via the DB cache (mig 087). Returns 200 immediately
 * — the cache writes happen in the background using `waitUntil`
 * when available, fire-and-forget otherwise.
 *
 * Net effect: by the time the user clicks "Video Views (75%)" on
 * any of the recent campaigns, the cache is already warm and the
 * fetch returns in <500ms instead of 20–40s cold.
 *
 * Failure modes are deliberately silent — prewarm is opportunistic;
 * a 500 here would only spam the user's console for no UX benefit.
 */

const PREWARM_LIMIT = 3;
const TTL_MS = 30 * 60 * 1000;

// Vercel Edge `waitUntil` if exposed by the runtime. In Vercel
// serverless, `req.waitUntil` doesn't exist — falling through to
// fire-and-forget Promise is acceptable for a best-effort warm.
type WaitUntilCapable = { waitUntil(promise: Promise<unknown>): void };

function maybeWaitUntil(
  context: unknown,
  promise: Promise<unknown>,
): void {
  if (
    context &&
    typeof context === "object" &&
    typeof (context as Partial<WaitUntilCapable>).waitUntil === "function"
  ) {
    (context as WaitUntilCapable).waitUntil(promise);
  } else {
    void promise;
  }
}

interface PrewarmRequestBody {
  clientId?: string;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorised" }, { status: 401 });

  let body: PrewarmRequestBody;
  try {
    body = (await req.json()) as PrewarmRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const clientId = body.clientId?.trim();
  if (!clientId) {
    return Response.json({ error: "clientId is required" }, { status: 400 });
  }

  const context = await resolveAudienceSourceContext(supabase, user.id, clientId);
  if (!context) return Response.json({ error: "Forbidden" }, { status: 403 });

  // Resolve top-3 most-recent campaigns. `events.meta_campaign_id`
  // is venue-level (one campaign per venue, set per migration 023);
  // sort by event_date descending and dedupe to get the most-recent
  // distinct Meta campaigns the user might want video audiences for.
  // Cheaper than a Meta `act_X/campaigns` listing call (which itself
  // can rate-limit).
  const { data: eventRows, error: eventErr } = await supabase
    .from("events")
    .select("meta_campaign_id, event_date")
    .eq("client_id", clientId)
    .not("meta_campaign_id", "is", null)
    .order("event_date", { ascending: false, nullsFirst: false })
    .limit(50);

  if (eventErr) {
    console.warn("[audiences/prewarm] events lookup failed", {
      clientId,
      message: eventErr.message,
    });
    return Response.json({ ok: true, prewarmed: 0 });
  }

  const seen = new Set<string>();
  const recentCampaigns: string[] = [];
  for (const row of (eventRows ?? []) as Array<{
    meta_campaign_id: string | null;
    event_date: string | null;
  }>) {
    if (!row.meta_campaign_id) continue;
    if (seen.has(row.meta_campaign_id)) continue;
    seen.add(row.meta_campaign_id);
    recentCampaigns.push(row.meta_campaign_id);
    if (recentCampaigns.length >= PREWARM_LIMIT) break;
  }

  if (recentCampaigns.length === 0) {
    return Response.json({ ok: true, prewarmed: 0 });
  }

  // Token resolution can throw if the user has no Meta token — guard
  // so the prewarm fails silently rather than 500-ing the UI mount.
  let token: string;
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    token = resolved.token;
  } catch (err) {
    console.warn("[audiences/prewarm] token resolution failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ ok: true, prewarmed: 0 });
  }

  // Fire each warm in parallel. The DB cache helper handles dedupe
  // by (user_id, client_id, source_kind, cache_key) so racing the
  // same campaign twice is safe (last-write-wins on the upsert).
  const warm = Promise.allSettled(
    recentCampaigns.map((campaignId) =>
      getCachedAudienceSourceDb({
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
      }).catch((err) => {
        console.warn("[audiences/prewarm] warm failed", {
          clientId,
          campaignId,
          message: err instanceof Error ? err.message : String(err),
        });
      }),
    ),
  );

  // Best-effort background completion. `req.waitUntil` is Edge-only
  // in Vercel; serverless route handlers don't expose it, so the
  // fallback is a fire-and-forget Promise.
  maybeWaitUntil(req, warm);

  return Response.json({ ok: true, prewarmed: recentCampaigns.length });
}
