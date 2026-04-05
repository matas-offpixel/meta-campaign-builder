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
 * every batch.
 *
 * Fields fetched: id, name only (minimal — avoids "reduce data" Graph API errors).
 * Enrichment (picture, followers, Instagram) is a separate Phase 2 via
 * POST /api/meta/pages/enrich.
 *
 * Rate limits: captures X-App-Usage, X-Business-Use-Case-Usage, X-Page-Usage
 * headers from Meta responses and forwards them to the client. On error code
 * 4 / 17 / 32 / 613 (rate limits), returns rateLimitHit: true so the client
 * can apply exponential backoff without hammering the API.
 *
 * Safety limits (enforced client-side):
 *   - max 200 batches  (~10 000 pages)
 *   - max 90 seconds total runtime
 *   No hard page count cap — load all accessible pages.
 */

import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;
const DEFAULT_BATCH_SIZE = 50;
const PAGE_FIELDS = "id,name";

/** Error codes Meta uses to signal rate / request limits. */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

interface RawPage { id: string; name: string }

/** Parsed values from Meta rate-limit response headers. */
export interface RateLimitInfo {
  /** App-level call-count usage as a percentage (0–100), from X-App-Usage. */
  appCallCountPct: number | null;
  /** Business use-case call-count usage percentage (max across all types). */
  businessCallCountPct: number | null;
  /** Raw header strings for debugging */
  raw: {
    appUsage: string | null;
    pageUsage: string | null;
    businessUsage: string | null;
  };
}

export interface UserPagesBatchResponse {
  data: RawPage[];
  nextCursor: string | null;
  batchSize: number;
  rateLimit?: RateLimitInfo;
  /** True when Meta returned a rate-limit error (code 4/17/32/613 or HTTP 429). */
  rateLimitHit?: boolean;
  /** Suggested client wait before retrying, in milliseconds. */
  retryAfterMs?: number;
  metaCode?: number;
}

function parseRateLimitHeaders(headers: Headers): RateLimitInfo {
  const appUsage = headers.get("x-app-usage");
  const pageUsage = headers.get("x-page-usage");
  const businessUsage = headers.get("x-business-use-case-usage");

  let appCallCountPct: number | null = null;
  let businessCallCountPct: number | null = null;

  if (appUsage) {
    try {
      const parsed = JSON.parse(appUsage) as { call_count?: number };
      appCallCountPct = parsed.call_count ?? null;
    } catch { /* non-parseable — ignore */ }
  }

  if (businessUsage) {
    try {
      // Format: { "<business_id>": [{ type, call_count, total_cputime, total_time, ... }] }
      const parsed = JSON.parse(businessUsage) as Record<string, Array<{ call_count?: number }>>;
      const allEntries = Object.values(parsed).flat();
      if (allEntries.length > 0) {
        businessCallCountPct = Math.max(...allEntries.map((e) => e.call_count ?? 0));
      }
    } catch { /* non-parseable — ignore */ }
  }

  return {
    appCallCountPct,
    businessCallCountPct,
    raw: { appUsage, pageUsage, businessUsage },
  };
}

export async function GET(req: NextRequest): Promise<Response> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorised" }, { status: 401 });

  const providerToken = req.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!providerToken) {
    return Response.json(
      { error: "No Facebook access token provided.", code: "NO_PROVIDER_TOKEN" },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(req.url);
  const after = searchParams.get("after") ?? null;
  // batchSize lets callers request fewer pages per call (e.g. 10 for test mode).
  // Clamped to 1–50 so we never exceed Meta's safe field-request limit.
  const batchSizeParam = parseInt(searchParams.get("batchSize") ?? "", 10);
  const batchSize = Number.isFinite(batchSizeParam) && batchSizeParam > 0
    ? Math.min(batchSizeParam, DEFAULT_BATCH_SIZE)
    : DEFAULT_BATCH_SIZE;

  const batchLabel = after ? `cursor=${after.slice(0, 20)}…` : "first";

  const params = new URLSearchParams({
    fields: PAGE_FIELDS,
    limit: String(batchSize),
    access_token: providerToken,
  });
  if (after) params.set("after", after);

  const graphUrl = `${BASE}/me/accounts?${params.toString()}`;
  console.info(`[pages/user] batch=${batchLabel} limit=${batchSize}`);

  let res: Response;
  try {
    res = await fetch(graphUrl, { cache: "no-store" });
  } catch (fetchErr) {
    console.error("[pages/user] Network error:", fetchErr);
    return Response.json({ error: "Network error reaching Facebook Graph API." }, { status: 502 });
  }

  const rateLimit = parseRateLimitHeaders(res.headers);

  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    console.error("[pages/user] Non-JSON from Meta:", text.slice(0, 300));
    return Response.json(
      { error: "Invalid response from Facebook — token may be expired.", rateLimit },
      { status: 502 },
    );
  }

  if (!res.ok || json.error) {
    const err = (json.error ?? {}) as Record<string, unknown>;
    const metaCode = err.code as number | undefined;
    const isRateLimit = res.status === 429 || (metaCode !== undefined && RATE_LIMIT_CODES.has(metaCode));

    console.error(
      `[pages/user] Meta API error batch=${batchLabel} code=${metaCode} rateLimit=${isRateLimit}`,
      "app-usage:", rateLimit.appCallCountPct ?? "N/A", "%",
      "business-usage:", rateLimit.businessCallCountPct ?? "N/A", "%",
      JSON.stringify(err),
    );

    if (isRateLimit) {
      return Response.json(
        {
          error: "Meta API request limit reached. Please wait and retry.",
          rateLimitHit: true,
          retryAfterMs: 10_000,
          metaCode,
          rateLimit,
          data: [],
          nextCursor: null,
          batchSize: 0,
        },
        { status: 429 },
      );
    }

    return Response.json(
      {
        error: (err.message as string) ?? "Failed to fetch pages from Facebook",
        metaCode,
        metaType: err.type,
        rawError: err,
        rateLimit,
      },
      { status: 502 },
    );
  }

  const data = (json.data ?? []) as RawPage[];
  const paging = json.paging as { cursors?: { after?: string }; next?: string } | undefined;
  const nextCursor = paging?.next ? (paging.cursors?.after ?? null) : null;

  console.info(
    `[pages/user] batch OK — ${data.length}/${batchSize} pages, nextCursor: ${nextCursor ? "yes" : "none"},`,
    `app-usage: ${rateLimit.appCallCountPct ?? "N/A"}%,`,
    `business-usage: ${rateLimit.businessCallCountPct ?? "N/A"}%`,
  );

  return Response.json({
    data,
    nextCursor,
    batchSize: data.length,
    rateLimit,
  } satisfies UserPagesBatchResponse);
}
