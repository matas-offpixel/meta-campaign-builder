import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { runGoogleAdsRollupLeg } from "@/lib/dashboard/google-ads-rollup-leg";
import { eachInclusiveYmd } from "@/lib/dashboard/rollup-date-range";
import { runTikTokRollupLeg } from "@/lib/dashboard/tiktok-rollup-leg";
import {
  upsertGoogleAdsRollups,
  upsertMetaRollups,
  upsertTikTokRollups,
  type MetaUpsertRow,
} from "@/lib/db/event-daily-rollups";
import { fetchEventDailyMetaMetrics } from "@/lib/insights/meta";
import type { DailyMetaMetricsRow } from "@/lib/insights/types";
import { getGoogleAdsCredentials } from "@/lib/google-ads/credentials";
import { fetchGoogleAdsDailyRollupInsights } from "@/lib/google-ads/rollup-insights";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { getTikTokCredentials } from "@/lib/tiktok/credentials";
import { fetchTikTokDailyRollupInsights } from "@/lib/tiktok/rollup-insights";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Platform = "meta" | "google_ads" | "tiktok";

interface RequestBody {
  event_id?: unknown;
  platforms?: unknown;
}

interface LegResult {
  ok: boolean;
  rows_written: number;
  reason?: string;
  error?: string;
}

const ALL_PLATFORMS: Platform[] = ["meta", "google_ads", "tiktok"];

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (typeof body.event_id !== "string" || body.event_id.length === 0) {
    return NextResponse.json(
      { ok: false, error: "event_id is required" },
      { status: 400 },
    );
  }
  const platforms = parsePlatforms(body.platforms);
  if (!platforms.ok) {
    return NextResponse.json(
      { ok: false, error: platforms.error },
      { status: 400 },
    );
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Service-role client unavailable",
      },
      { status: 500 },
    );
  }

  const { data: event, error: eventErr } = await admin
    .from("events")
    .select(
      "id, user_id, event_code, event_timezone, event_date, client_id, tiktok_account_id, google_ads_account_id, client:clients ( meta_ad_account_id, tiktok_account_id, google_ads_account_id )",
    )
    .eq("id", body.event_id)
    .maybeSingle();

  if (eventErr) {
    return NextResponse.json(
      { ok: false, error: eventErr.message },
      { status: 500 },
    );
  }
  if (!event) {
    return NextResponse.json(
      { ok: false, error: "Event not found" },
      { status: 404 },
    );
  }

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }
  if (user.id !== event.user_id) {
    return NextResponse.json(
      { ok: false, error: "Forbidden" },
      { status: 403 },
    );
  }

  const clientRel = event.client as
    | {
        meta_ad_account_id: string | null;
        tiktok_account_id: string | null;
        google_ads_account_id: string | null;
      }
    | Array<{
        meta_ad_account_id: string | null;
        tiktok_account_id: string | null;
        google_ads_account_id: string | null;
      }>
    | null;
  const client = Array.isArray(clientRel) ? clientRel[0] : clientRel;

  const until = new Date();
  const since = new Date(until);
  since.setDate(since.getDate() - 59);
  const window = { since: ymd(since), until: ymd(until) };
  const eventCode = (event.event_code as string | null) ?? null;
  const results: Partial<Record<Platform, LegResult>> = {};

  if (platforms.value.includes("meta")) {
    results.meta = await runMetaBackfill(admin, {
      eventId: event.id,
      userId: event.user_id,
      eventCode,
      adAccountId: client?.meta_ad_account_id ?? null,
      ...window,
    });
  }

  if (platforms.value.includes("google_ads")) {
    const result = await runGoogleAdsRollupLeg({
      supabase: admin,
      eventId: event.id,
      userId: event.user_id,
      eventCode,
      googleAdsAccountId:
        ((event.google_ads_account_id as string | null) ?? null) ??
        client?.google_ads_account_id ??
        null,
      ...window,
      deps: {
        getCredentials: getGoogleAdsCredentials,
        fetchDailyInsights: fetchGoogleAdsDailyRollupInsights,
        upsertRollups: upsertGoogleAdsRollups,
      },
    });
    results.google_ads = normalizeLegResult(result);
  }

  if (platforms.value.includes("tiktok")) {
    const result = await runTikTokRollupLeg({
      supabase: admin,
      eventId: event.id,
      userId: event.user_id,
      eventCode,
      tiktokAccountId:
        ((event.tiktok_account_id as string | null) ?? null) ??
        client?.tiktok_account_id ??
        null,
      retryDelayMs: 10_000,
      ...window,
      deps: {
        getCredentials: getTikTokCredentials,
        fetchDailyInsights: fetchTikTokDailyRollupInsights,
        upsertRollups: upsertTikTokRollups,
        sleep,
      },
    });
    results.tiktok = normalizeLegResult(result);
  }

  const ok = Object.values(results).every(isOkOrExpectedSkip);
  return NextResponse.json(
    { ok, event_id: event.id, results, window },
    { status: ok ? 200 : 207 },
  );
}

function parsePlatforms(value: unknown):
  | { ok: true; value: Platform[] }
  | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: ALL_PLATFORMS };
  if (!Array.isArray(value)) {
    return { ok: false, error: "platforms must be an array when provided" };
  }
  const out: Platform[] = [];
  for (const item of value) {
    if (item !== "meta" && item !== "google_ads" && item !== "tiktok") {
      return { ok: false, error: `Unsupported platform: ${String(item)}` };
    }
    if (!out.includes(item)) out.push(item);
  }
  return { ok: true, value: out.length > 0 ? out : ALL_PLATFORMS };
}

async function runMetaBackfill(
  supabase: SupabaseClient,
  args: {
    eventId: string;
    userId: string;
    eventCode: string | null;
    adAccountId: string | null;
    since: string;
    until: string;
  },
): Promise<LegResult> {
  if (!args.eventCode) {
    return {
      ok: false,
      rows_written: 0,
      reason: "no_event_code",
      error: "Event has no event_code.",
    };
  }
  if (!args.adAccountId) {
    return {
      ok: false,
      rows_written: 0,
      reason: "no_ad_account",
      error: "Event/client has no Meta ad account.",
    };
  }

  try {
    const { token } = await resolveServerMetaToken(supabase, args.userId);
    const meta = await fetchEventDailyMetaMetrics({
      eventCode: args.eventCode,
      adAccountId: args.adAccountId,
      token,
      since: args.since,
      until: args.until,
    });
    if (!meta.ok) {
      return {
        ok: false,
        rows_written: 0,
        reason: meta.error.reason,
        error: meta.error.message,
      };
    }
    const rows = zeroPadMetaRows(meta.days, {
      since: args.since,
      until: args.until,
    });
    await upsertMetaRollups(supabase, {
      userId: args.userId,
      eventId: args.eventId,
      rows,
    });
    return { ok: true, rows_written: rows.length };
  } catch (err) {
    return {
      ok: false,
      rows_written: 0,
      reason: "meta_failed",
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

function zeroPadMetaRows(
  rows: DailyMetaMetricsRow[],
  window: { since: string; until: string },
): MetaUpsertRow[] {
  const byDate = new Map<string, MetaUpsertRow>();
  for (const row of rows) {
    byDate.set(row.day, {
      date: row.day,
      ad_spend: row.spend,
      link_clicks: row.linkClicks,
      meta_regs: row.metaRegs,
      meta_impressions: row.impressions,
      meta_reach: row.reach,
      meta_video_plays_3s: row.videoPlays3s,
      meta_video_plays_15s: row.videoPlays15s,
      meta_video_plays_p100: row.videoPlaysP100,
      meta_engagements: row.engagements,
    });
  }
  for (const date of eachInclusiveYmd(window.since, window.until)) {
    if (!byDate.has(date)) {
      byDate.set(date, {
        date,
        ad_spend: 0,
        link_clicks: 0,
        meta_regs: 0,
        meta_impressions: 0,
        meta_reach: 0,
        meta_video_plays_3s: 0,
        meta_video_plays_15s: 0,
        meta_video_plays_p100: 0,
        meta_engagements: 0,
      });
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeLegResult(result: {
  ok: boolean;
  rowsWritten?: number;
  reason?: string;
  error?: string;
}): LegResult {
  return {
    ok: result.ok,
    rows_written: result.rowsWritten ?? 0,
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.error ? { error: result.error } : {}),
  };
}

function isOkOrExpectedSkip(result: LegResult): boolean {
  return (
    result.ok ||
    result.reason === "no_event_code" ||
    result.reason === "no_ad_account" ||
    result.reason === "no_google_ads_account" ||
    result.reason === "no_tiktok_account"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
