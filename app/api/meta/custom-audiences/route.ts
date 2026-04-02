/**
 * GET /api/meta/custom-audiences?adAccountId=act_...
 *
 * Fetches all custom audiences for the given ad account using the server-side
 * Meta access token. Returns a simplified, UI-ready list.
 *
 * Meta endpoint: GET /{adAccountId}/customaudiences
 * Docs: https://developers.facebook.com/docs/marketing-api/reference/custom-audience/
 *
 * Required permission: ads_read (or ads_management)
 */

import { createClient } from "@/lib/supabase/server";
import { MetaApiError } from "@/lib/meta/client";
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

  // Infer from name when subtype is generic
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

export async function GET(req: Request) {
  // ── Auth ───────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  // ── Parse query params ─────────────────────────────────────────────────────
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

  // ── Fetch from Meta ────────────────────────────────────────────────────────
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return Response.json(
      { error: "META_ACCESS_TOKEN is not configured" },
      { status: 500 },
    );
  }

  const url = new URL(`${BASE}/${adAccountId}/customaudiences`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("fields", "id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound");
  url.searchParams.set("limit", "200");

  console.log("[/api/meta/custom-audiences] Fetching for", adAccountId);

  let response: Response;
  try {
    response = await fetch(url.toString(), { cache: "no-store" });
  } catch (err) {
    return Response.json(
      { error: `Network error: ${String(err)}` },
      { status: 502 },
    );
  }

  // Safe JSON parsing — guards against empty body, 204, and non-JSON responses
  let json: {
    data?: {
      id: string;
      name: string;
      subtype?: string;
      approximate_count_lower_bound?: number;
      approximate_count_upper_bound?: number;
    }[];
    error?: { message: string; code?: number; type?: string };
  };

  try {
    const text = await response.text();
    if (!text || text.trim().length === 0) {
      console.error("[/api/meta/custom-audiences] Empty response body from Meta, status:", response.status);
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
    console.error("[/api/meta/custom-audiences] Meta error:", JSON.stringify(json, null, 2));
    return Response.json(
      { error: e.message, code: e.code, data: [] },
      { status: 502 },
    );
  }

  // ── Map to internal type ───────────────────────────────────────────────────
  const audiences: CustomAudience[] = (json.data ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    type: mapSubtype(item.subtype, item.name),
    approximateSize: item.approximate_count_lower_bound,
  }));

  console.log("[/api/meta/custom-audiences] Returning", audiences.length, "audiences");

  return Response.json({ data: audiences });
}
