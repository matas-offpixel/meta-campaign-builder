/**
 * GET /api/meta/location-search?q=London&types=city
 *
 * Searches Meta's ad geolocation database for targetable locations.
 * Returns the exact Meta location objects needed for ad set geo_locations.
 *
 * Token policy
 *   Uses resolveServerMetaToken (DB-first, env fallback) so reconnected user
 *   tokens are preferred over the static env token. On Meta OAuth failures
 *   the response is 401 with `code: 190` so the client can flip the global
 *   token-expired flag and surface a reconnect prompt instead of a generic
 *   502 with raw Meta error text.
 *
 * Meta endpoint: GET /search?type=adgeolocation&q={query}
 * Docs: https://developers.facebook.com/docs/marketing-api/audiences/reference/targeting-search#location
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveServerMetaToken } from "@/lib/meta/server-token";

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

/** Detect Meta OAuth/session-expiry errors so we can return 401 (matches the
 *  detection used in custom-audiences and saved-audiences). */
function isTokenError(errMsg: string, errCode: unknown, errType: unknown): boolean {
  if (typeof errCode === "number" && (errCode === 190 || errCode === 102)) return true;
  if (typeof errType === "string" && errType === "OAuthException") return true;
  const m = errMsg.toLowerCase();
  return (
    m.includes("session has expired") ||
    m.includes("session expired") ||
    (m.includes("access token") && (m.includes("expired") || m.includes("invalid")))
  );
}

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

  // ── DB-first token resolution ──────────────────────────────────────────────
  let token: string;
  let tokenSource: "db" | "env" = "env";
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    token = resolved.token;
    tokenSource = resolved.source;
    console.info(
      `[/api/meta/location-search] token resolved: source=${tokenSource} ` +
      `len=${token.length} prefix=${token.slice(0, 12)}…`,
    );
  } catch (err) {
    console.error("[/api/meta/location-search] no Meta access token available:", err);
    return NextResponse.json(
      {
        error:
          "Facebook session expired or not connected. " +
          "Reconnect Facebook in Account Setup, then try again.",
        code: 190,
        data: [],
      },
      { status: 401 },
    );
  }

  const types = req.nextUrl.searchParams.get("types") ?? "city,region,country";

  const url = new URL(`${BASE}/search`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("type", "adgeolocation");
  url.searchParams.set("q", query.trim());
  url.searchParams.set("location_types", JSON.stringify(types.split(",")));
  url.searchParams.set("limit", "15");

  // Safe URL for logging — strips access_token so we never log the user's
  // bearer credential.
  const urlSafe = url
    .toString()
    .replace(/access_token=[^&]+/, "access_token=…REDACTED");

  console.log(
    `[/api/meta/location-search] Searching "${query.trim()}" types=${types} ` +
    `(tokenSource=${tokenSource}) → ${urlSafe}`,
  );

  let res: Response;
  try {
    res = await fetch(url.toString(), { cache: "no-store" });
  } catch (err) {
    console.error("[/api/meta/location-search] Network error:", err);
    return NextResponse.json(
      { error: "Network error contacting Meta API. Try again in a moment.", data: [] },
      { status: 502 },
    );
  }

  let json: Record<string, unknown>;
  try {
    const text = await res.text();
    if (!text || text.trim().length === 0) {
      console.error(
        `[/api/meta/location-search] Empty response body from Meta, status: ${res.status}`,
      );
      return NextResponse.json(
        { error: `Meta returned an empty response (HTTP ${res.status})`, data: [] },
        { status: 502 },
      );
    }
    json = JSON.parse(text);
  } catch (parseErr) {
    console.error("[/api/meta/location-search] Failed to parse Meta response:", parseErr);
    return NextResponse.json(
      { error: `Meta returned invalid JSON (HTTP ${res.status})`, data: [] },
      { status: 502 },
    );
  }

  if (!res.ok || json.error) {
    const e = (json.error ?? {}) as Record<string, unknown>;
    const errMsg = (e.message as string) ?? `HTTP ${res.status}`;
    const errCode = e.code;
    const errType = e.type;

    if (isTokenError(errMsg, errCode, errType)) {
      console.error(
        `[/api/meta/location-search] ⛔ TOKEN ERROR (tokenSource=${tokenSource}) ` +
        `code=${errCode} type=${errType} msg="${errMsg}"`,
      );
      return NextResponse.json(
        {
          error:
            "Facebook session expired. Reconnect Facebook in Account Setup, " +
            "then try the search again.",
          code: 190,
          data: [],
        },
        { status: 401 },
      );
    }

    console.error(
      `[/api/meta/location-search] Meta error (tokenSource=${tokenSource}) ` +
      `code=${errCode} type=${errType}: ${errMsg}`,
    );
    return NextResponse.json(
      { error: errMsg, code: errCode, data: [] },
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

  console.log(
    `[/api/meta/location-search] Returning ${data.length} results ` +
    `(tokenSource=${tokenSource})`,
  );

  return NextResponse.json({ data, count: data.length });
}
