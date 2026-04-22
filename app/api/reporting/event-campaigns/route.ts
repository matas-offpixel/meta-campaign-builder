import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { graphGetWithToken, MetaApiError } from "@/lib/meta/client";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { getEventByIdServer } from "@/lib/db/events-server";
import {
  computeBenchmarks,
  type AdAccountBenchmarks,
} from "@/lib/reporting/ad-account-benchmarks";

/**
 * GET /api/reporting/event-campaigns?eventId=…&since=…&until=…&platform=meta
 *
 * Returns the live performance snapshot for every Meta campaign whose
 * name (case-insensitive) contains the event's `event_code`, plus the
 * ad account's rolling 90-day benchmark used by the UI to colour-code
 * each metric cell.
 *
 *   {
 *     ok: true,
 *     campaigns: [{ id, name, status, spend, impressions, clicks,
 *                   ctr, cpm, cpr, results, ad_account_id }],
 *     benchmarks: { ctr, cpm, cpr, campaignsCounted },
 *     event_code,
 *     ad_account_id,
 *     window: { since, until },
 *   }
 *
 * Failure modes (`ok: false`):
 *   - `not_signed_in`            — 401
 *   - `event_not_found`          — 404 (RLS-filtered miss; never leak)
 *   - `no_event_code`            — 200, empty campaigns, message in `reason`
 *   - `no_ad_account`            — 200, ditto, no client default ad account
 *   - `meta_token_failed`        — 502
 *   - `meta_insights_failed`     — 502
 */

interface InsightsRow {
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: Array<{ action_type?: string; value?: string }>;
}

interface InsightsResponse {
  data?: InsightsRow[];
  paging?: { cursors?: { after?: string }; next?: string };
}

interface CampaignMeta {
  status?: string;
  effective_status?: string;
}

const MAX_PAGES = 20;

const RESULT_ACTION_PRIORITY = [
  "offsite_conversion.fb_pixel_purchase",
  "purchase",
  "lead",
  "complete_registration",
  "onsite_conversion.lead_grouped",
  "landing_page_view",
  "link_click",
  "post_engagement",
];

function pickResults(row: InsightsRow): number {
  const actions = row.actions ?? [];
  for (const type of RESULT_ACTION_PRIORITY) {
    const match = actions.find((a) => a.action_type === type);
    if (match) {
      const v = Number.parseFloat(match.value ?? "");
      if (Number.isFinite(v)) return v;
    }
  }
  return 0;
}

function parseDateParam(
  value: string | null,
): string | null {
  if (!value) return null;
  // Accepts YYYY-MM-DD only — anything else is silently ignored so a
  // malformed querystring doesn't 400 the whole panel. Defensive
  // because the UI builds these client-side from a presets dropdown.
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function resolveWindow(
  since: string | null,
  until: string | null,
  rangeKey: string | null,
): { since: string; until: string } {
  if (since && until) return { since, until };
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const days =
    rangeKey === "yesterday"
      ? 1
      : rangeKey === "3d"
        ? 3
        : rangeKey === "7d"
          ? 7
          : rangeKey === "14d"
            ? 14
            : rangeKey === "all"
              ? 365 * 5
              : 30;
  const startMs = now.getTime() - days * 24 * 60 * 60 * 1000;
  const start = new Date(startMs).toISOString().slice(0, 10);
  const end =
    rangeKey === "yesterday"
      ? new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : today;
  return { since: start, until: end };
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, reason: "not_signed_in", error: "Not signed in" },
      { status: 401 },
    );
  }

  const eventId = req.nextUrl.searchParams.get("eventId")?.trim() ?? "";
  if (!eventId) {
    return NextResponse.json(
      { ok: false, reason: "bad_request", error: "eventId is required" },
      { status: 400 },
    );
  }

  const event = await getEventByIdServer(eventId);
  if (!event) {
    return NextResponse.json(
      { ok: false, reason: "event_not_found", error: "Event not found" },
      { status: 404 },
    );
  }

  const eventCode = event.event_code?.trim() ?? "";
  const adAccountIdRaw =
    (event.client?.meta_ad_account_id as string | null | undefined) ?? null;

  if (!eventCode) {
    return NextResponse.json({
      ok: true,
      reason: "no_event_code",
      campaigns: [],
      benchmarks: nullBenchmarks(),
      event_code: null,
      ad_account_id: adAccountIdRaw,
      window: null,
    });
  }
  if (!adAccountIdRaw) {
    return NextResponse.json({
      ok: true,
      reason: "no_ad_account",
      campaigns: [],
      benchmarks: nullBenchmarks(),
      event_code: eventCode,
      ad_account_id: null,
      window: null,
    });
  }

  const adAccountId = adAccountIdRaw.startsWith("act_")
    ? adAccountIdRaw
    : `act_${adAccountIdRaw}`;

  const range = req.nextUrl.searchParams.get("range");
  const sinceParam = parseDateParam(req.nextUrl.searchParams.get("since"));
  const untilParam = parseDateParam(req.nextUrl.searchParams.get("until"));
  const window = resolveWindow(sinceParam, untilParam, range);

  let token: string;
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    token = resolved.token;
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "No Meta token available";
    return NextResponse.json(
      { ok: false, reason: "meta_token_failed", error: msg },
      { status: 502 },
    );
  }

  // Aggregate insights per campaign in the window. We pull at the
  // `campaign` level so each row is one campaign and we don't have to
  // re-aggregate ad-set rows. `effective_status` comes through a
  // separate /campaigns batch below because /insights doesn't return it.
  const codeLower = eventCode.toLowerCase();
  const aggregates = new Map<
    string,
    {
      id: string;
      name: string;
      spend: number;
      impressions: number;
      clicks: number;
      results: number;
    }
  >();

  let after: string | undefined;
  let pageCount = 0;
  try {
    while (pageCount < MAX_PAGES) {
      const queryParams: Record<string, string> = {
        fields: "campaign_id,campaign_name,spend,impressions,clicks,actions",
        time_range: JSON.stringify({ since: window.since, until: window.until }),
        level: "campaign",
        limit: "500",
      };
      if (after) queryParams.after = after;
      const res = await graphGetWithToken<InsightsResponse>(
        `/${adAccountId}/insights`,
        queryParams,
        token,
      );
      for (const row of res.data ?? []) {
        const id = row.campaign_id;
        const name = row.campaign_name ?? "";
        if (!id) continue;
        if (!name.toLowerCase().includes(codeLower)) continue;
        const existing = aggregates.get(id) ?? {
          id,
          name,
          spend: 0,
          impressions: 0,
          clicks: 0,
          results: 0,
        };
        existing.spend += Number.parseFloat(row.spend ?? "") || 0;
        existing.impressions += Number.parseFloat(row.impressions ?? "") || 0;
        existing.clicks += Number.parseFloat(row.clicks ?? "") || 0;
        existing.results += pickResults(row);
        aggregates.set(id, existing);
      }
      pageCount += 1;
      const nextCursor = res.paging?.cursors?.after;
      if (!res.paging?.next || !nextCursor) break;
      after = nextCursor;
    }
  } catch (err) {
    const msg = err instanceof MetaApiError ? err.message : err instanceof Error ? err.message : String(err);
    console.error("[reporting/event-campaigns] insights failed:", msg);
    return NextResponse.json(
      { ok: false, reason: "meta_insights_failed", error: msg },
      { status: 502 },
    );
  }

  // Resolve per-campaign effective_status for the matched ids in one
  // batch. Skipped if no campaigns matched — saves a Graph round-trip.
  const matchedIds = [...aggregates.keys()];
  const statuses = new Map<string, string>();
  if (matchedIds.length > 0) {
    try {
      const res = await graphGetWithToken<{
        data?: Array<{ id: string; effective_status?: string; status?: string }>;
      }>(
        `/`,
        {
          ids: matchedIds.join(","),
          fields: "effective_status,status",
        },
        token,
      );
      // Meta returns either an array or a keyed object depending on
      // whether `ids=` was used. graphGetWithToken serialises the
      // request the same way, so we expect the keyed shape. Fall back
      // to the array form defensively.
      const raw = res as unknown as Record<string, CampaignMeta> & {
        data?: Array<{ id: string } & CampaignMeta>;
      };
      if (Array.isArray(raw.data)) {
        for (const row of raw.data) {
          if (row.id) {
            statuses.set(
              row.id,
              row.effective_status ?? row.status ?? "UNKNOWN",
            );
          }
        }
      } else {
        for (const id of matchedIds) {
          const row = raw[id];
          if (row) {
            statuses.set(
              id,
              row.effective_status ?? row.status ?? "UNKNOWN",
            );
          }
        }
      }
    } catch (err) {
      // Status fetch is best-effort — degrade to "UNKNOWN" rather than
      // failing the whole panel.
      console.warn(
        "[reporting/event-campaigns] status fetch failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const campaigns = matchedIds.map((id) => {
    const a = aggregates.get(id)!;
    const ctr = a.impressions > 0 ? (a.clicks / a.impressions) * 100 : null;
    const cpm = a.impressions > 0 ? (a.spend / a.impressions) * 1000 : null;
    const cpr = a.results > 0 ? a.spend / a.results : null;
    return {
      id,
      name: a.name,
      status: statuses.get(id) ?? "UNKNOWN",
      spend: a.spend,
      impressions: a.impressions,
      clicks: a.clicks,
      ctr,
      cpm,
      cpr,
      results: a.results,
      ad_account_id: adAccountId,
    };
  });

  // Benchmarks always run against the rolling 90-day window
  // regardless of the active time-range toggle so the colour-coding
  // baseline doesn't move under the user's feet when they switch
  // ranges.
  let benchmarks: AdAccountBenchmarks;
  try {
    benchmarks = await computeBenchmarks({
      adAccountId,
      token,
    });
  } catch (err) {
    console.warn(
      "[reporting/event-campaigns] benchmarks failed:",
      err instanceof Error ? err.message : String(err),
    );
    benchmarks = nullBenchmarks();
  }

  return NextResponse.json({
    ok: true,
    campaigns,
    benchmarks,
    event_code: eventCode,
    ad_account_id: adAccountId,
    window,
  });
}

function nullBenchmarks(): AdAccountBenchmarks {
  return { ctr: null, cpm: null, cpr: null, campaignsCounted: 0 };
}
