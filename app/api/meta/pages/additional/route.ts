import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAdditionalPages, MetaApiError } from "@/lib/meta/client";

/**
 * GET /api/meta/pages/additional?after={cursor}&limit={n}
 *
 * Returns a batch of personal pages (via /me/accounts) with cursor-based
 * pagination. Use this for the "Load more pages" button in the Page Audiences
 * panel — keep calling with the returned `nextCursor` until `hasMore` is false.
 *
 * Query params:
 *   after  - Cursor from the previous response (omit for the first batch)
 *   limit  - Batch size; defaults to 50, max 100
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const after = req.nextUrl.searchParams.get("after") ?? undefined;
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 50, 100) : 50;

  try {
    const result = await fetchAdditionalPages(after, limit);
    return Response.json(result);
  } catch (err) {
    if (err instanceof MetaApiError) {
      console.error("[/api/meta/pages/additional] Meta error:", err.toJSON());
      return Response.json(err.toJSON(), { status: 502 });
    }
    console.error("[/api/meta/pages/additional] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
