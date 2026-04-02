/**
 * GET /api/meta/location-search?q=London&types=city
 *
 * Searches Meta's ad geolocation database for targetable locations.
 * Returns the exact Meta location objects needed for ad set geo_locations.
 *
 * Meta endpoint: GET /search?type=adgeolocation&q={query}
 * Docs: https://developers.facebook.com/docs/marketing-api/audiences/reference/targeting-search#location
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

  // location_types: city, region, country, zip, geo_market, electoral_district
  const types = req.nextUrl.searchParams.get("types") ?? "city,region,country";

  const url = new URL(`${BASE}/search`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("type", "adgeolocation");
  url.searchParams.set("q", query.trim());
  url.searchParams.set("location_types", JSON.stringify(types.split(",")));
  url.searchParams.set("limit", "15");

  let res: Response;
  try {
    res = await fetch(url.toString(), { cache: "no-store" });
  } catch (err) {
    console.error("[/api/meta/location-search] Network error:", err);
    return NextResponse.json({ error: "Network error contacting Meta API" }, { status: 502 });
  }

  let json: Record<string, unknown>;
  try {
    const text = await res.text();
    if (!text || text.trim().length === 0) {
      return NextResponse.json({ error: "Meta returned an empty response", data: [] }, { status: 502 });
    }
    json = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Meta returned invalid JSON", data: [] }, { status: 502 });
  }

  if (!res.ok || json.error) {
    const e = (json.error ?? {}) as Record<string, unknown>;
    console.error("[/api/meta/location-search] Meta error:", JSON.stringify(json));
    return NextResponse.json(
      { error: (e.message as string) ?? `HTTP ${res.status}`, code: e.code, data: [] },
      { status: 502 },
    );
  }

  const raw = (json.data as Array<{
    key: string;
    name: string;
    type: string;
    country_code: string;
    country_name: string;
    region: string;
    region_id?: number;
    supports_region?: boolean;
    supports_city?: boolean;
  }>) ?? [];

  const data = raw.map((item) => ({
    key: item.key,
    name: item.name,
    type: item.type,
    country_code: item.country_code,
    country_name: item.country_name,
    region: item.region,
    region_id: item.region_id,
    supports_region: item.supports_region,
    supports_city: item.supports_city,
  }));

  return NextResponse.json({ data, count: data.length });
}
