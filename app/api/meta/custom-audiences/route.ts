/**
 * GET /api/meta/custom-audiences?adAccountId=act_...
 *
 * Fetches all custom audiences for the given ad account using the user's
 * fresh DB-stored OAuth token (DB-first via resolveServerMetaToken, env-var
 * fallback). Returns a simplified, UI-ready list.
 *
 * Token policy
 *   Uses the same model as ad-accounts / pages / pixels / campaigns / adsets:
 *   the user's reconnected Facebook token is preferred over the static env
 *   token. On Meta OAuth failures (code 190 / 102 / OAuthException / "session
 *   expired") the response is 401 with `code: 190` so the client's apiFetch
 *   helper can flip the global token-expired flag and surface the reconnect
 *   banner.
 *
 * Meta endpoint: GET /{adAccountId}/customaudiences
 * Docs: https://developers.facebook.com/docs/marketing-api/reference/custom-audience/
 *
 * Required permission: ads_read (or ads_management)
 */

import { createClient } from "@/lib/supabase/server";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import type { CustomAudience } from "@/lib/types";

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

/** Map Meta subtype strings to our internal CustomAudience["type"] */
function mapSubtype(subtype: string | undefined, name: string): CustomAudience["type"] {
  const sub = (subtype ?? "").toUpperCase();
  const lowerName = name.toLowerCase();

  if (sub === "LOOKALIKE") return "lookalike";
  if (sub === "ENGAGEMENT") return "engagement";
  if (sub === "WEBSITE" || sub === "PIXEL") return "pixel";

  if (lowerName.includes("purchas") || lowerName.includes("buyer")) return "purchaser";
  if (
    lowerName.includes("registr") ||
    lowerName.includes("sign up") ||
    lowerName.includes("signup")
  )
    return "registration";
  if (lowerName.includes("engag")) return "engagement";
  if (lowerName.includes("lookalike") || lowerName.includes("lal")) return "lookalike";

  return "other";
}

/** Detect Meta OAuth/session-expiry errors so we can return 401 instead of 502
 *  and let the client surface a reconnect prompt. */
function isTokenError(errMsg: string, errCode: unknown, errType: unknown): boolean {
  if (typeof errCode === "number" && (errCode === 190 || errCode === 102)) return true;
  if (typeof errType === "string" && errType === "OAuthException") return true;
  const m = errMsg.toLowerCase();
  return (
    m.includes("session has expired") ||
    m.includes("session expired") ||
    m.includes("access token") && (m.includes("expired") || m.includes("invalid"))
  );
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const adAccountId = searchParams.get("adAccountId");

  if (!adAccountId) {
    return Response.json({ error: "adAccountId query param is required" }, { status: 400 });
  }

  if (!adAccountId.startsWith("act_")) {
    return Response.json(
      { error: "adAccountId must start with act_ (e.g. act_1234567890)" },
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
      `[/api/meta/custom-audiences] token resolved: source=${tokenSource} ` +
      `len=${token.length} prefix=${token.slice(0, 12)}…`,
    );
  } catch (err) {
    console.error("[/api/meta/custom-audiences] no Meta access token available:", err);
    return Response.json(
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

  const url = new URL(`${BASE}/${adAccountId}/customaudiences`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("fields", "id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound");
  url.searchParams.set("limit", "200");

  // Safe URL for logging — strips the access_token so we never write the
  // user's bearer credential into application logs.
  const urlSafe = url
    .toString()
    .replace(/access_token=[^&]+/, "access_token=…REDACTED");

  console.log(
    `[/api/meta/custom-audiences] Fetching for ${adAccountId} (tokenSource=${tokenSource}) → ${urlSafe}`,
  );

  let response: Response;
  try {
    response = await fetch(url.toString(), { cache: "no-store" });
  } catch (err) {
    console.error("[/api/meta/custom-audiences] Network error:", err);
    return Response.json(
      { error: "Network error contacting Meta API. Try again in a moment.", data: [] },
      { status: 502 },
    );
  }

  let json: {
    data?: {
      id: string;
      name: string;
      subtype?: string;
      approximate_count_lower_bound?: number;
      approximate_count_upper_bound?: number;
    }[];
    error?: { message: string; code?: number; type?: string; error_subcode?: number };
  };

  try {
    const text = await response.text();
    if (!text || text.trim().length === 0) {
      console.error(
        `[/api/meta/custom-audiences] Empty response body from Meta, status: ${response.status}`,
      );
      return Response.json(
        { error: `Meta returned an empty response (HTTP ${response.status})`, data: [] },
        { status: 502 },
      );
    }
    json = JSON.parse(text);
  } catch (parseErr) {
    console.error("[/api/meta/custom-audiences] Failed to parse Meta response:", parseErr);
    return Response.json(
      { error: `Meta returned invalid JSON (HTTP ${response.status})`, data: [] },
      { status: 502 },
    );
  }

  if (!response.ok || json.error) {
    const e = json.error ?? { message: `HTTP ${response.status}` };
    const errMsg = e.message ?? `HTTP ${response.status}`;
    const errCode = e.code;
    const errType = e.type;

    if (isTokenError(errMsg, errCode, errType)) {
      console.error(
        `[/api/meta/custom-audiences] ⛔ TOKEN ERROR (tokenSource=${tokenSource}) ` +
        `code=${errCode} type=${errType} msg="${errMsg}"`,
      );
      return Response.json(
        {
          error:
            "Facebook session expired. Reconnect Facebook in Account Setup, " +
            "then reload custom audiences.",
          code: 190,
          data: [],
        },
        { status: 401 },
      );
    }

    console.error(
      `[/api/meta/custom-audiences] Meta error (tokenSource=${tokenSource}) ` +
      `code=${errCode} type=${errType}: ${errMsg}`,
    );
    return Response.json(
      {
        error: errMsg,
        code: errCode,
        data: [],
      },
      { status: 502 },
    );
  }

  const audiences: CustomAudience[] = (json.data ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    type: mapSubtype(item.subtype, item.name),
    approximateSize: item.approximate_count_lower_bound,
  }));

  console.log(
    `[/api/meta/custom-audiences] Returning ${audiences.length} audiences ` +
    `(tokenSource=${tokenSource})`,
  );

  return Response.json({ data: audiences });
}
