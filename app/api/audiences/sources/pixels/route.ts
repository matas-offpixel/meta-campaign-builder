import { type NextRequest } from "next/server";

import {
  audienceSourceRateLimitBody,
  isMetaAdAccountRateLimitError,
} from "@/lib/audiences/meta-rate-limit";
import { getCachedAudienceSource } from "@/lib/audiences/source-cache";
import {
  fetchAudiencePixels,
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
  if (!clientId) {
    return Response.json({ error: "clientId is required" }, { status: 400 });
  }

  try {
    const context = await resolveAudienceSourceContext(supabase, user.id, clientId);
    if (!context) return Response.json({ error: "Forbidden" }, { status: 403 });
    const { token, source } = await resolveServerMetaToken(supabase, user.id);
    const pixels = await getCachedAudienceSource(
      [user.id, clientId, "pixels"],
      () => fetchAudiencePixels(context.metaAdAccountId, token),
    );
    return Response.json({ ok: true, pixels, tokenSource: source });
  } catch (err) {
    if (isMetaAdAccountRateLimitError(err)) {
      return Response.json(audienceSourceRateLimitBody(err), { status: 429 });
    }
    const message = err instanceof Error ? err.message : "Failed to load pixels";
    return Response.json({ error: message }, { status: 502 });
  }
}
