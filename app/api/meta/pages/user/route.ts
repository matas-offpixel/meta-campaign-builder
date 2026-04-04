/**
 * GET /api/meta/pages/user
 * GET /api/meta/pages/user?after=<cursor>
 *
 * Returns ONE batch of up to 50 Facebook Pages the authenticated user manages,
 * using their Facebook OAuth provider_token (passed via Authorization header).
 *
 * Single-batch design: the client calls this endpoint repeatedly, passing the
 * `nextCursor` from each response as `?after=` in the next request, and
 * accumulates results locally. This lets the UI show live progress after
 * every batch instead of waiting for a single slow bulk response.
 *
 * Fields fetched: id, name only (minimal — avoids "reduce data" Graph API errors).
 * Safety cap: the client should stop after 500 total pages.
 */

import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;
const BATCH_SIZE = 50;
// Minimal fields only — heavy fields (picture, instagram_business_account, etc.)
// trigger "Please reduce the amount of data you're asking for" from the Graph API.
const PAGE_FIELDS = "id,name";

interface RawPage {
  id: string;
  name: string;
}

export interface UserPagesBatchResponse {
  data: RawPage[];
  /** Cursor to pass as `?after=` for the next batch. Null when there are no more pages. */
  nextCursor: string | null;
  /** How many pages were in this batch */
  batchSize: number;
}

export async function GET(req: NextRequest): Promise<Response> {
  // ── Auth ────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const providerToken = req.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!providerToken) {
    return Response.json(
      { error: "No Facebook access token provided.", code: "NO_PROVIDER_TOKEN" },
      { status: 401 },
    );
  }

  // ── Cursor from query string ─────────────────────────────────────────────
  const { searchParams } = new URL(req.url);
  const after = searchParams.get("after") ?? null;

  // ── Build Graph API URL ──────────────────────────────────────────────────
  const params = new URLSearchParams({
    fields: PAGE_FIELDS,
    limit: String(BATCH_SIZE),
    access_token: providerToken,
  });
  if (after) params.set("after", after);
  const graphUrl = `${BASE}/me/accounts?${params.toString()}`;

  const batchLabel = after ? `cursor=${after.slice(0, 20)}…` : "first";
  console.info(`[pages/user] batch=${batchLabel} limit=${BATCH_SIZE} fields=${PAGE_FIELDS}`);
  console.info(`[pages/user] Graph URL (redacted): ${graphUrl.replace(providerToken, "***")}`);

  // ── Fetch one batch ──────────────────────────────────────────────────────
  let res: Response;
  try {
    res = await fetch(graphUrl, { cache: "no-store" });
  } catch (fetchErr) {
    console.error("[pages/user] Network error fetching from Graph API:", fetchErr);
    return Response.json(
      { error: "Network error reaching Facebook Graph API." },
      { status: 502 },
    );
  }

  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    console.error("[pages/user] Non-JSON from Meta (first 300 chars):", text.slice(0, 300));
    return Response.json(
      { error: "Invalid response from Facebook — token may be expired." },
      { status: 502 },
    );
  }

  if (!res.ok || json.error) {
    const err = (json.error ?? {}) as Record<string, unknown>;
    console.error("[pages/user] Meta API error:", JSON.stringify(err));
    return Response.json(
      {
        error: (err.message as string) ?? "Failed to fetch pages from Facebook",
        metaCode: err.code,
        metaType: err.type,
        metaSubcode: err.error_subcode,
        rawError: err,
      },
      { status: 502 },
    );
  }

  const data = (json.data ?? []) as RawPage[];
  const paging = json.paging as { cursors?: { after?: string }; next?: string } | undefined;
  const nextCursor = paging?.next ? (paging.cursors?.after ?? null) : null;

  console.info(
    `[pages/user] batch OK — returned ${data.length} pages, nextCursor: ${nextCursor ? "yes" : "none"}`,
  );

  const body: UserPagesBatchResponse = {
    data,
    nextCursor,
    batchSize: data.length,
  };

  return Response.json(body);
}
