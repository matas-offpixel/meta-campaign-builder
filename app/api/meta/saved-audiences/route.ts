/**
 * GET /api/meta/saved-audiences?adAccountId=act_xxx
 *
 * Fetches the "Saved Audiences" library for a given ad account.
 * These are pre-configured targeting bundles users save in Ads Manager —
 * distinct from Custom Audiences (pixel/upload-based lists).
 *
 * Token policy
 *   Uses resolveServerMetaToken (DB-first, env fallback) so reconnected user
 *   tokens are preferred over the static env token. On Meta OAuth failures
 *   the response is 401 with `code: 190` so the client can surface a
 *   reconnect prompt instead of a generic 502.
 *
 * Meta endpoint: GET /{adAccountId}/saved_audiences
 * Requires: ads_read permission.
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { normalizeAdAccountId } from "@/lib/meta/ad-account";

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

export interface SavedAudienceItem {
  id: string;
  name: string;
  approximateCount?: number;
  description?: string;
}

/** Detect Meta OAuth/session-expiry errors so we can return 401 (matches the
 *  detection used in custom-audiences and interest-suggestions). */
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

  const adAccountRaw = req.nextUrl.searchParams.get("adAccountId");

  if (!adAccountRaw) {
    return NextResponse.json(
      { error: "adAccountId query param is required" },
      { status: 400 },
    );
  }

  const adAccountId = normalizeAdAccountId(adAccountRaw);
  if (!adAccountId) {
    return NextResponse.json(
      { error: 'adAccountId must be numeric (optionally prefixed "act_")' },
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
      `[/api/meta/saved-audiences] token resolved: source=${tokenSource} ` +
      `len=${token.length} prefix=${token.slice(0, 12)}…`,
    );
  } catch (err) {
    console.error("[/api/meta/saved-audiences] no Meta access token available:", err);
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

  const url = new URL(`${BASE}/${adAccountId}/saved_audiences`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("fields", "id,name,approximate_count,description");
  url.searchParams.set("limit", "200");

  const urlSafe = url
    .toString()
    .replace(/access_token=[^&]+/, "access_token=…REDACTED");

  console.log(
    `[/api/meta/saved-audiences] Fetching for ${adAccountId} ` +
    `(tokenSource=${tokenSource}) → ${urlSafe}`,
  );

  let res: Response;
  try {
    res = await fetch(url.toString(), { cache: "no-store" });
  } catch (err) {
    console.error("[/api/meta/saved-audiences] Network error:", err);
    return NextResponse.json(
      { error: "Network error contacting Meta API. Try again in a moment.", data: [] },
      { status: 502 },
    );
  }

  const json = (await res.json()) as Record<string, unknown>;

  if (!res.ok || json.error) {
    const e = (json.error ?? {}) as Record<string, unknown>;
    const errMsg = (e.message as string) ?? `HTTP ${res.status}`;
    const errCode = e.code;
    const errType = e.type;

    if (isTokenError(errMsg, errCode, errType)) {
      console.error(
        `[/api/meta/saved-audiences] ⛔ TOKEN ERROR (tokenSource=${tokenSource}) ` +
        `code=${errCode} type=${errType} msg="${errMsg}"`,
      );
      return NextResponse.json(
        {
          error:
            "Facebook session expired. Reconnect Facebook in Account Setup, " +
            "then reload saved audiences.",
          code: 190,
          data: [],
        },
        { status: 401 },
      );
    }

    console.error(
      `[/api/meta/saved-audiences] Meta error (tokenSource=${tokenSource}) ` +
      `code=${errCode} type=${errType}: ${errMsg}`,
    );
    return NextResponse.json(
      {
        error: errMsg,
        code: errCode,
        error_subcode: e.error_subcode,
        error_user_msg: e.error_user_msg ?? e.error_user_title,
        data: [],
      },
      { status: 502 },
    );
  }

  const raw = (
    json.data as Array<{
      id: string;
      name: string;
      approximate_count?: number;
      description?: string;
    }>
  ) ?? [];

  const data: SavedAudienceItem[] = raw.map((a) => ({
    id: a.id,
    name: a.name,
    approximateCount: a.approximate_count,
    description: a.description,
  }));

  console.log(
    `[/api/meta/saved-audiences] Returning ${data.length} audiences ` +
    `(tokenSource=${tokenSource})`,
  );

  return NextResponse.json({ data, count: data.length });
}
