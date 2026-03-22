import { createClient } from "@/lib/supabase/server";
import { fetchAdAccounts, MetaApiError } from "@/lib/meta/client";

export async function GET() {
  // ── 1. Verify Supabase session ────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  // ── 2. Fetch from Meta Graph API ──────────────────────────────────────────
  try {
    const accounts = await fetchAdAccounts();

    return Response.json({
      data: accounts,
      count: accounts.length,
    });
  } catch (err) {
    if (err instanceof MetaApiError) {
      // Surface Meta's own error message to the caller so it is easy to debug
      return Response.json(err.toJSON(), { status: 502 });
    }

    console.error("[/api/meta/ad-accounts] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
