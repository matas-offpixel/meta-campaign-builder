import { type NextRequest } from "next/server";

import { getCachedAudienceSource } from "@/lib/audiences/source-cache";
import {
  fetchAudiencePageSources,
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
    const pages = await getCachedAudienceSource(
      [user.id, clientId, "pages"],
      () => fetchAudiencePageSources(context.metaAdAccountId, token),
    );
    return Response.json({ ok: true, pages, tokenSource: source });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load pages";
    return Response.json({ error: message }, { status: 502 });
  }
}
