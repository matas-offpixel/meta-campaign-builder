import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { listAllTagsForUser } from "@/lib/db/creative-tags";
import {
  readCachedCreativeSnapshots,
  upsertCreativeSnapshots,
} from "@/lib/db/creative-insight-snapshots";
import { fetchCreativeInsights } from "@/lib/meta/creative-insights";
import { MetaApiError } from "@/lib/meta/client";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import type {
  CreativeDatePreset,
  CreativeInsightRow,
} from "@/lib/types/intelligence";

/**
 * GET /api/intelligence/creatives
 *   ?adAccountId=act_…           required
 *   ?datePreset=last_30d|…       optional, default `last_30d`
 *   ?refresh=1                   optional, force live Meta fetch
 *   ?campaignIds=                optional, only honoured on the live path
 *   ?since=&until=               accepted as no-op for backwards-compat
 *
 * Default behaviour is to read from `creative_insight_snapshots` —
 * the cache table pre-warmed every 2h by /api/cron/refresh-creative-
 * insights. Cache miss returns `needsRefresh: true` (with no rows) so
 * the UI can prompt the user to kick a live fetch rather than render
 * an empty heatmap.
 *
 * `?refresh=1` runs the live Meta fetch (~5 min on a 1k-ad account),
 * upserts the result into the cache, and returns it with
 * `source: 'live'`. The MetaApiError → friendly UI mapping shipped in
 * PR #17 is preserved on this path.
 *
 * `since` / `until` were never wired through to Meta's `time_range`
 * parameter pre-H1 — we accept them as no-ops here so in-flight
 * shares / bookmarks keep working without 400ing.
 */

const VALID_PRESETS: CreativeDatePreset[] = [
  "today",
  "yesterday",
  "last_3d",
  "last_7d",
  "last_14d",
  "last_30d",
  "maximum",
];

function parseDatePreset(raw: string | null): CreativeDatePreset {
  if (!raw) return "last_30d";
  const v = raw.trim();
  return (VALID_PRESETS as readonly string[]).includes(v)
    ? (v as CreativeDatePreset)
    : "last_30d";
}

function attachTags(
  rows: CreativeInsightRow[],
  tagsByAd: Map<string, CreativeInsightRow["tags"]>,
): CreativeInsightRow[] {
  for (const row of rows) {
    row.tags = tagsByAd.get(row.adId) ?? [];
  }
  return rows;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
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

  const datePreset = parseDatePreset(
    req.nextUrl.searchParams.get("datePreset"),
  );
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  const campaignIdsParam = req.nextUrl.searchParams.get("campaignIds");
  const campaignIds = campaignIdsParam
    ? campaignIdsParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  // Tags are merged on either path; pull them once up-front so the
  // cache and live branches share the work.
  const tags = await listAllTagsForUser(user.id);
  const tagsByAd = new Map<string, CreativeInsightRow["tags"]>();
  for (const t of tags) {
    const arr = tagsByAd.get(t.meta_ad_id) ?? [];
    arr.push({ id: t.id, type: t.tag_type, value: t.tag_value });
    tagsByAd.set(t.meta_ad_id, arr);
  }

  // ── Cache path (default) ────────────────────────────────────────────
  if (!refresh) {
    const cached = await readCachedCreativeSnapshots({
      supabase,
      userId: user.id,
      adAccountId,
      datePreset,
    });
    if (cached.rows.length === 0 && cached.snapshotAt === null) {
      return NextResponse.json({
        ok: true,
        creatives: [],
        snapshotAt: null,
        source: "cache" as const,
        needsRefresh: true,
      });
    }
    const decorated = attachTags(cached.rows, tagsByAd);
    return NextResponse.json({
      ok: true,
      creatives: decorated,
      snapshotAt: cached.snapshotAt,
      source: "cache" as const,
      needsRefresh: false,
    });
  }

  // ── Live path (?refresh=1) ──────────────────────────────────────────
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
      datePreset,
      campaignIds,
    });
  } catch (err) {
    if (err instanceof MetaApiError) {
      // PR #17: log the trace + raw message before remapping so
      // debugging a "Meta is rate-limiting…" report still has a
      // server-side breadcrumb back to the original failure.
      console.error(
        `[/api/intelligence/creatives] Meta error: code=${err.code ?? "?"} trace=${err.fbtraceId ?? "?"} msg="${err.message}"`,
      );
      const mapped = mapMetaErrorForUi(err);
      return NextResponse.json(
        {
          ok: false,
          ...err.toJSON(),
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
        retryable: true,
      },
      { status: 500 },
    );
  }

  // Write through to the cache so the next default load is instant.
  // Best-effort; an upsert failure here shouldn't fail the response.
  await upsertCreativeSnapshots({
    supabase,
    userId: user.id,
    adAccountId,
    datePreset,
    rows,
  }).catch((err) => {
    console.warn(
      "[/api/intelligence/creatives] cache write failed:",
      err instanceof Error ? err.message : String(err),
    );
  });

  const decorated = attachTags(rows, tagsByAd);
  return NextResponse.json({
    ok: true,
    creatives: decorated,
    snapshotAt: new Date().toISOString(),
    source: "live" as const,
    needsRefresh: false,
  });
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
