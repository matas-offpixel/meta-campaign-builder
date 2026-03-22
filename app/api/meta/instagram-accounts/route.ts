import { createClient } from "@/lib/supabase/server";
import { fetchInstagramAccounts, MetaApiError } from "@/lib/meta/client";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const accounts = await fetchInstagramAccounts();
    return Response.json({ data: accounts, count: accounts.length });
  } catch (err) {
    if (err instanceof MetaApiError) {
      return Response.json(err.toJSON(), { status: 502 });
    }
    console.error("[/api/meta/instagram-accounts] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
