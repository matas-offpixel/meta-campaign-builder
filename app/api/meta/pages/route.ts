import { createClient } from "@/lib/supabase/server";
import { fetchPages, MetaApiError } from "@/lib/meta/client";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const pages = await fetchPages();
    return Response.json({ data: pages, count: pages.length });
  } catch (err) {
    if (err instanceof MetaApiError) {
      return Response.json(err.toJSON(), { status: 502 });
    }
    console.error("[/api/meta/pages] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
