import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchPixels, MetaApiError } from "@/lib/meta/client";

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

  try {
    const pixels = await fetchPixels(adAccountId);
    return Response.json({ data: pixels, count: pixels.length });
  } catch (err) {
    if (err instanceof MetaApiError) {
      return Response.json(err.toJSON(), { status: 502 });
    }
    console.error("[/api/meta/pixels] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
