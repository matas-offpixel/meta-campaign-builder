/**
 * GET /api/meta/interest-search?q=electronic+music
 *
 * Searches Meta's ad interest database for targetable interests.
 * Returns real Meta interest IDs that can be used in ad set targeting.
 *
 * Meta endpoint: GET /search?type=adinterest&q={query}&limit=25
 * Requires: ads_read permission.
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const query = req.nextUrl.searchParams.get("q");
  if (!query || query.trim().length < 2) {
    return NextResponse.json(
      { error: "Query parameter 'q' must be at least 2 characters" },
      { status: 400 },
    );
  }

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "META_ACCESS_TOKEN is not configured on the server" },
      { status: 500 },
    );
  }

  const url = new URL(`${BASE}/search`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("type", "adinterest");
  url.searchParams.set("q", query.trim());
  url.searchParams.set("limit", "25");

  let res: Response;
  try {
    res = await fetch(url.toString(), { cache: "no-store" });
  } catch (err) {
    console.error("[/api/meta/interest-search] Network error:", err);
    return NextResponse.json({ error: "Network error contacting Meta API" }, { status: 502 });
  }

  const json = (await res.json()) as Record<string, unknown>;

  if (!res.ok || json.error) {
    const e = (json.error ?? {}) as Record<string, unknown>;
    console.error("[/api/meta/interest-search] Meta error:", JSON.stringify(json));
    return NextResponse.json(
      {
        error: (e.message as string) ?? `HTTP ${res.status}`,
        code: e.code,
      },
      { status: 502 },
    );
  }

  const raw = (json.data as Array<{
    id: string;
    name: string;
    audience_size?: number;
    path?: string[];
    topic?: string;
  }>) ?? [];

  const data = raw.map((item) => ({
    id: item.id,
    name: item.name,
    audienceSize: item.audience_size,
    path: item.path,
  }));

  return NextResponse.json({ data, count: data.length });
}
