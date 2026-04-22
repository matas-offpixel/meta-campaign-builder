import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { listAllTagsForUser } from "@/lib/db/creative-tags";
import { fetchCreativeInsights } from "@/lib/meta/creative-insights";
import { MetaApiError } from "@/lib/meta/client";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import type { CreativeInsightRow } from "@/lib/types/intelligence";

/**
 * GET /api/intelligence/creatives?adAccountId=&since=&until=&campaignIds=
 *
 * Pulls every ad in the requested account with last-30d insights, then
 * left-joins the user's creative_tags rows in memory so each row carries
 * its annotated tags. Failure modes:
 *   - missing adAccountId    → 400
 *   - no Meta token          → 502
 *   - Meta API error         → 502 with the original error JSON shape
 *
 * Token comes from resolveServerMetaToken (DB user_facebook_tokens row,
 * or META_ACCESS_TOKEN fallback) — same path every other Meta route uses.
 */

function parseDateOrDefault(raw: string | null, daysAgo: number): string {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const adAccountId = req.nextUrl.searchParams.get("adAccountId")?.trim();
  if (!adAccountId) {
    return NextResponse.json(
      { ok: false, error: "Query parameter 'adAccountId' is required" },
      { status: 400 },
    );
  }
  if (!adAccountId.startsWith("act_")) {
    return NextResponse.json(
      { ok: false, error: 'Ad account id must start with "act_"' },
      { status: 400 },
    );
  }

  const since = parseDateOrDefault(req.nextUrl.searchParams.get("since"), 30);
  const until = parseDateOrDefault(req.nextUrl.searchParams.get("until"), 0);
  const campaignIdsParam = req.nextUrl.searchParams.get("campaignIds");
  const campaignIds = campaignIdsParam
    ? campaignIdsParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  // Resolve the freshest Meta token before fanning out — one round trip,
  // shared between the ad list and any future cursor pages.
  let token: string;
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    token = resolved.token;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No Meta token available";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }

  let rows: CreativeInsightRow[];
  try {
    rows = await fetchCreativeInsights(adAccountId, token, {
      since,
      until,
      campaignIds,
    });
  } catch (err) {
    if (err instanceof MetaApiError) {
      // Log the trace id + raw message before remapping so debugging
      // a "Meta is rate-limiting…" report from the UI still has a
      // server-side breadcrumb back to the original failure.
      console.error(
        `[/api/intelligence/creatives] Meta error: code=${err.code ?? "?"} trace=${err.fbtraceId ?? "?"} msg="${err.message}"`,
      );
      const mapped = mapMetaErrorForUi(err);
      return NextResponse.json(
        {
          ok: false,
          ...err.toJSON(),
          // Override the verbatim Meta string with our friendlier
          // copy. `toJSON()` already populated `code`, `type`, and
          // `fbtrace_id` — we want those for debugging but not the
          // raw "Service temporarily unavailable" message that
          // confused users.
          error: mapped.message,
          retryable: mapped.retryable,
        },
        { status: 502 },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/intelligence/creatives] fetch failed:", msg);
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to load creative insights.",
        // Unknown failure modes (DNS hiccup, downstream Supabase
        // blip, etc.) are usually transient — let the UI offer a
        // retry rather than dead-ending the user.
        retryable: true,
      },
      { status: 500 },
    );
  }

  // Merge user tags onto each row. One Supabase round trip; fan-out lookup
  // is in-memory which is fine for the realistic upper bound (a few k tags).
  const tags = await listAllTagsForUser(user.id);
  const tagsByAd = new Map<string, CreativeInsightRow["tags"]>();
  for (const t of tags) {
    const arr = tagsByAd.get(t.meta_ad_id) ?? [];
    arr.push({ id: t.id, type: t.tag_type, value: t.tag_value });
    tagsByAd.set(t.meta_ad_id, arr);
  }
  for (const row of rows) {
    row.tags = tagsByAd.get(row.adId) ?? [];
  }

  return NextResponse.json({ ok: true, creatives: rows });
}

// ─── Error mapping ───────────────────────────────────────────────────────────

/**
 * Same transient/rate-limit codeset that `lib/meta/client.ts` retries
 * inside `graphGetWithToken`. Duplicated here (rather than importing)
 * because it's a route-local UX concern: if a request still fails
 * after the retry budget is exhausted, we want to tell the user it's
 * worth retrying again later rather than dropping Meta's verbatim
 * string in the UI. Keep both lists in sync if either changes.
 */
const RATE_LIMIT_CODES = new Set<number>([1, 2, 4, 17, 32, 341, 613]);
const OAUTH_EXPIRED_CODE = 190;

interface UiError {
  message: string;
  retryable: boolean;
}

function mapMetaErrorForUi(err: MetaApiError): UiError {
  if (err.code != null && RATE_LIMIT_CODES.has(err.code)) {
    return {
      message: `Meta is rate-limiting this account right now — wait a minute and retry. (Meta code ${err.code})`,
      retryable: true,
    };
  }
  if (err.code === OAUTH_EXPIRED_CODE) {
    return {
      message:
        "Your Meta connection has expired. Reconnect under Account → Facebook.",
      retryable: false,
    };
  }
  return { message: err.message, retryable: false };
}
