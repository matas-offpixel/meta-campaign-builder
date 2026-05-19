import { type NextRequest, NextResponse } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * app/api/track/meta-click/route.ts
 *
 * Server-side Meta-click capture endpoint. The dark-build companion
 * to a tiny on-page snippet (ships in a follow-on PR) that POSTs
 * here whenever a Meta ad lands on a client's site with an `fbclid`
 * query param. We persist the click into `meta_click_touchpoints`
 * (migration 094) so the matcher cron can join later purchases
 * back to a real ad touchpoint.
 *
 * The endpoint is intentionally permissive — public, no session
 * required — because it must accept clicks from arbitrary visitors
 * landing on third-party domains. The mitigations are:
 *
 *   1. Tight body schema. Anything not on the allow-list is dropped
 *      before insertion.
 *   2. In-memory token bucket per IP — 60 req/min cap. Burstable up
 *      to 30 calls in a 10-second window. The bucket is per-process
 *      memory which is acceptable for a Vercel Function: the rate
 *      limit's job is to stop a single visitor / scraper from
 *      flooding; cross-process abuse is captured by Vercel's edge
 *      WAF.
 *   3. UNIQUE constraint on `fbclid` — replays land as updates not
 *      new rows. We surface 200 OK regardless so the snippet
 *      doesn't have to retry on conflict.
 *   4. The endpoint never reads the `_fbc` cookie — it accepts
 *      `fbclid` and constructs the canonical `_fbc` server-side
 *      using Meta's documented format (`fb.1.<unix-ms>.<fbclid>`).
 *      The browser-side snippet is responsible for setting the
 *      cookie locally; we don't need it for the join.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RequestBody {
  fbclid?: unknown;
  client_id?: unknown;
  event_id?: unknown;
  landing_url?: unknown;
  ad_id?: unknown;
  adset_id?: unknown;
  campaign_id?: unknown;
}

const BUCKET_WINDOW_MS = 60 * 1000;
const BUCKET_MAX_PER_WINDOW = 60;

interface BucketState {
  windowStart: number;
  count: number;
}

const ipBuckets = new Map<string, BucketState>();

function takeRateLimitToken(ip: string): boolean {
  const now = Date.now();
  const cur = ipBuckets.get(ip);
  if (!cur || now - cur.windowStart > BUCKET_WINDOW_MS) {
    ipBuckets.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  if (cur.count >= BUCKET_MAX_PER_WINDOW) return false;
  cur.count += 1;
  return true;
}

/**
 * Periodic GC of stale buckets so the map doesn't grow forever in
 * a long-running serverless instance. Runs at most once per call
 * and only when the map exceeds a soft cap.
 */
function maybeGcBuckets() {
  if (ipBuckets.size < 4096) return;
  const now = Date.now();
  for (const [ip, state] of ipBuckets) {
    if (now - state.windowStart > BUCKET_WINDOW_MS * 2) {
      ipBuckets.delete(ip);
    }
  }
}

/** `fb.1.<unix-ms>.<fbclid>` — the Meta-documented `_fbc` cookie format. */
function buildFbc(fbclid: string, clickedAtMs: number): string {
  return `fb.1.${clickedAtMs}.${fbclid}`;
}

function clientIp(req: NextRequest): string {
  // Prefer `x-forwarded-for` (Vercel sets it for every request);
  // fall back to a synthetic key so the bucket doesn't collide on
  // every request from the same private deploy.
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!takeRateLimitToken(ip)) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited" },
      { status: 429 },
    );
  }
  maybeGcBuckets();

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, reason: "invalid_json" },
      { status: 400 },
    );
  }

  const fbclid = stringOrNull(body.fbclid);
  const clientId = stringOrNull(body.client_id);
  if (!fbclid || !clientId) {
    return NextResponse.json(
      {
        ok: false,
        reason: "missing_required_field",
        required: ["fbclid", "client_id"],
      },
      { status: 400 },
    );
  }

  const clickedAt = new Date();
  const fbc = buildFbc(fbclid, clickedAt.getTime());

  const supabase = createServiceRoleClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const { error } = await sb
    .from("meta_click_touchpoints")
    .upsert(
      {
        client_id: clientId,
        event_id: stringOrNull(body.event_id),
        fbclid,
        fbc,
        ad_id: stringOrNull(body.ad_id),
        adset_id: stringOrNull(body.adset_id),
        campaign_id: stringOrNull(body.campaign_id),
        landing_url: stringOrNull(body.landing_url),
        clicked_at: clickedAt.toISOString(),
      },
      { onConflict: "fbclid" },
    );

  if (error) {
    console.error("[track/meta-click] upsert failed", error.message);
    return NextResponse.json(
      { ok: false, reason: "upsert_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, fbc }, { status: 200 });
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
