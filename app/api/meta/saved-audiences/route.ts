/**
 * GET /api/meta/saved-audiences?adAccountId=act_xxx
 *
 * Fetches the "Saved Audiences" library for a given ad account.
 * These are pre-configured targeting bundles users save in Ads Manager —
 * distinct from Custom Audiences (pixel/upload-based lists).
 *
 * Meta endpoint: GET /{adAccountId}/saved_audiences
 * Requires: ads_read permission.
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

export interface SavedAudienceItem {
  id: string;
  name: string;
  approximateCount?: number;
  description?: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const adAccountId = req.nextUrl.searchParams.get("adAccountId");

  if (!adAccountId) {
    return NextResponse.json(
      { error: "adAccountId query param is required" },
      { status: 400 },
    );
  }

  if (!adAccountId.startsWith("act_")) {
    return NextResponse.json(
      { error: 'adAccountId must start with "act_" (e.g. act_1234567890)' },
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

  const url = new URL(`${BASE}/${adAccountId}/saved_audiences`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("fields", "id,name,approximate_count,description");
  url.searchParams.set("limit", "200");

  let res: Response;
  try {
    res = await fetch(url.toString(), { cache: "no-store" });
  } catch (err) {
    console.error("[/api/meta/saved-audiences] Network error:", err);
    return NextResponse.json({ error: "Network error contacting Meta API" }, { status: 502 });
  }

  const json = (await res.json()) as Record<string, unknown>;

  if (!res.ok || json.error) {
    const e = (json.error ?? {}) as Record<string, unknown>;
    console.error("[/api/meta/saved-audiences] Meta error:", JSON.stringify(json));
    return NextResponse.json(
      {
        error: (e.message as string) ?? `HTTP ${res.status}`,
        code: e.code,
        error_subcode: e.error_subcode,
        error_user_msg: e.error_user_msg ?? e.error_user_title,
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

  return NextResponse.json({ data, count: data.length });
}
