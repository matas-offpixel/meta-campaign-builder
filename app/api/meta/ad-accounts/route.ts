import { createClient } from "@/lib/supabase/server";
import { fetchAdAccounts, MetaApiError } from "@/lib/meta/client";
import { resolveServerMetaToken } from "@/lib/meta/server-token";

export async function GET() {
  // ── 1. Verify Supabase session ────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  // ── 2. Resolve freshest available token ───────────────────────────────────
  let token: string;
  let tokenSource: string;
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    token = resolved.token;
    tokenSource = resolved.source;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No Meta token available";
    console.error("[/api/meta/ad-accounts] token resolution failed:", msg);
    return Response.json({ error: msg }, { status: 502 });
  }

  console.info(`[/api/meta/ad-accounts] token source=${tokenSource}`);

  // ── 3. Fetch from Meta Graph API ──────────────────────────────────────────
  try {
    const accounts = await fetchAdAccounts(token);

    return Response.json({
      data: accounts,
      count: accounts.length,
      tokenSource,
    });
  } catch (err) {
    if (err instanceof MetaApiError) {
      return Response.json(err.toJSON(), { status: 502 });
    }

    console.error("[/api/meta/ad-accounts] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
