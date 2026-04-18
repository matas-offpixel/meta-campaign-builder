import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchPixels, MetaApiError } from "@/lib/meta/client";
import { resolveServerMetaToken } from "@/lib/meta/server-token";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const adAccountId = request.nextUrl.searchParams.get("adAccountId");
  if (!adAccountId) {
    return Response.json(
      { error: "adAccountId query param is required" },
      { status: 400 },
    );
  }

  // ── Resolve freshest available token ─────────────────────────────────────
  let token: string;
  let tokenSource: string;
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    token = resolved.token;
    tokenSource = resolved.source;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No Meta token available";
    console.error("[/api/meta/pixels] token resolution failed:", msg);
    return Response.json({ error: msg }, { status: 502 });
  }

  console.info(`[/api/meta/pixels] token source=${tokenSource} adAccount=${adAccountId}`);

  try {
    const pixels = await fetchPixels(adAccountId, token);
    return Response.json({ data: pixels, count: pixels.length, tokenSource });
  } catch (err) {
    if (err instanceof MetaApiError) {
      return Response.json(err.toJSON(), { status: 502 });
    }
    console.error("[/api/meta/pixels] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
