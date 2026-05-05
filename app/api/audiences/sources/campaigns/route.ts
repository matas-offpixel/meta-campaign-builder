import { type NextRequest } from "next/server";

import { getCachedAudienceSource } from "@/lib/audiences/source-cache";
import {
  fetchAudienceCampaigns,
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
  const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), 50)
    : 50;
  if (!clientId) {
    return Response.json({ error: "clientId is required" }, { status: 400 });
  }

  try {
    const context = await resolveAudienceSourceContext(supabase, user.id, clientId);
    if (!context) return Response.json({ error: "Forbidden" }, { status: 403 });
    const { token, source } = await resolveServerMetaToken(supabase, user.id);
    const campaigns = await getCachedAudienceSource(
      [user.id, clientId, "campaigns", String(limit)],
      () => fetchAudienceCampaigns(context.metaAdAccountId, token, limit),
    );
    return Response.json({ ok: true, campaigns, tokenSource: source });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load campaigns";
    return Response.json({ error: message }, { status: 502 });
  }
}
