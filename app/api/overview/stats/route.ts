import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import {
  fetchEventInsights,
  fetchEventSpendByDay,
} from "@/lib/insights/meta";
import type {
  OverviewSpendResponse,
  OverviewSpendStats,
} from "@/lib/types/overview";

/**
 * Authenticated GET — lazy spend stats for the campaign overview.
 *
 * Body: `?eventIds=id1,id2,...` (comma-separated, capped at 20). For
 * each event the user owns whose client has a Meta ad account, we
 * call:
 *   - fetchEventInsights datePreset='maximum' → spend_total
 *   - fetchEventSpendByDay since=until=yesterday → spend_yesterday
 *
 * Response shape: `{ ok: true, stats: { [eventId]: { spend_total,
 * spend_yesterday } } }`. Events the user doesn't own / events
 * without an ad account / events whose Meta call failed land as
 * `{ spend_total: null, spend_yesterday: null }` so the table can
 * render a uniform "—" without distinguishing failure modes.
 *
 * Cache: 5-minute revalidate per event id (driven by the segment-
 * level export). The route handler itself stays force-dynamic on the
 * URL params so a different `eventIds` set always re-fans, but
 * each individual Meta call's underlying cache via fetchEventInsights
 * is preserved through the existing per-route caching there.
 */

export const revalidate = 300;

const MAX_EVENT_IDS = 20;

function parseEventIds(value: string | null): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  for (const raw of value.split(",")) {
    const trimmed = raw.trim();
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        trimmed,
      )
    ) {
      seen.add(trimmed);
    }
    if (seen.size >= MAX_EVENT_IDS) break;
  }
  return Array.from(seen);
}

function ymdYesterdayUtc(): string {
  const now = new Date();
  const utc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  utc.setUTCDate(utc.getUTCDate() - 1);
  return utc.toISOString().slice(0, 10);
}

interface EventLookup {
  id: string;
  event_code: string | null;
  meta_ad_account_id: string | null;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorised" },
      { status: 401 },
    );
  }

  const eventIds = parseEventIds(req.nextUrl.searchParams.get("eventIds"));
  if (eventIds.length === 0) {
    return NextResponse.json({ ok: true, stats: {} satisfies OverviewSpendResponse });
  }

  // Owner check + ad-account fan-in via a single RLS-scoped read.
  const { data: events, error: evErr } = await supabase
    .from("events")
    .select(
      "id, event_code, client:clients ( meta_ad_account_id )",
    )
    .in("id", eventIds)
    .eq("user_id", user.id);
  if (evErr) {
    return NextResponse.json(
      { ok: false, error: evErr.message },
      { status: 500 },
    );
  }

  const lookups: EventLookup[] = (events ?? []).map((row) => {
    const clientRel = row.client as
      | { meta_ad_account_id: string | null }
      | { meta_ad_account_id: string | null }[]
      | null;
    const adAccount = Array.isArray(clientRel)
      ? (clientRel[0]?.meta_ad_account_id ?? null)
      : (clientRel?.meta_ad_account_id ?? null);
    return {
      id: row.id,
      event_code: row.event_code,
      meta_ad_account_id: adAccount,
    };
  });

  // Resolve the Meta OAuth token once — every per-event call shares
  // the same user-scoped token. If no token is available we still
  // return a stats object with all-null entries so the client renders
  // "—" gracefully instead of erroring.
  let token: string | null = null;
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    token = resolved.token;
  } catch {
    token = null;
  }

  const stats: OverviewSpendResponse = {};

  // Pre-fill so missing rows still appear in the response.
  for (const id of eventIds) {
    stats[id] = { spend_total: null, spend_yesterday: null };
  }

  if (!token) {
    return NextResponse.json({ ok: true, stats });
  }

  const yesterday = ymdYesterdayUtc();

  await Promise.all(
    lookups.map(async (lookup) => {
      if (!lookup.event_code || !lookup.meta_ad_account_id) {
        // Already pre-filled with nulls; just no-op.
        return;
      }
      const next: OverviewSpendStats = {
        spend_total: null,
        spend_yesterday: null,
      };

      try {
        const insights = await fetchEventInsights({
          eventCode: lookup.event_code,
          adAccountId: lookup.meta_ad_account_id,
          token: token as string,
          datePreset: "maximum",
        });
        if (insights.ok) {
          next.spend_total = insights.data.totalSpend;
        }
      } catch {
        // Silent: leave spend_total null.
      }

      try {
        const yday = await fetchEventSpendByDay({
          eventCode: lookup.event_code,
          adAccountId: lookup.meta_ad_account_id,
          token: token as string,
          since: yesterday,
          until: yesterday,
        });
        if (yday.ok) {
          // Single-day window typically yields one row, but Meta can
          // return zero rows (no spend that day) or one row per
          // matched campaign — sum defensively either way.
          const sum = yday.days.reduce(
            (acc, row) => acc + (Number.isFinite(row.spend) ? row.spend : 0),
            0,
          );
          next.spend_yesterday = sum;
        }
      } catch {
        // Silent: leave spend_yesterday null.
      }

      stats[lookup.id] = next;
    }),
  );

  return NextResponse.json({ ok: true, stats });
}
