import "server-only";

import { createClient } from "@/lib/supabase/server";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { listEventsServer } from "@/lib/db/events-server";
import type { EventWithClient } from "@/lib/db/events";
import {
  fetchEventCampaignInsights,
  normaliseAdAccountId,
} from "@/lib/reporting/event-insights";
import { aggregate, type Aggregate } from "@/lib/reporting/aggregate";
import { computeBenchmarks } from "@/lib/reporting/ad-account-benchmarks";

/**
 * lib/reporting/rollup-server.ts
 *
 * Server-side data layer for the cross-event rollup at /reporting.
 *
 * Two-stage load:
 *   1. Resolve the candidate event set: every event the user owns
 *      (RLS-scoped) that has ≥1 published `campaign_drafts` row
 *      with `event_id` set. Optional client_id filter is applied
 *      at the SQL layer — keeps the in-memory pass cheap.
 *   2. For each event with a usable (event_code + ad_account)
 *      pair, fetch Meta campaign-level insights via the same
 *      helper the per-event panel uses. Per-event failures are
 *      isolated so a single 502 from Meta doesn't blank the page;
 *      benchmarks are fetched once per ad account and reused
 *      across the rows that share it.
 */

export interface RollupRow {
  event: EventWithClient;
  /** How many published drafts are linked to this event (badge). */
  linkedCampaignsCount: number;
  /** Number of Meta campaigns matched in the window. */
  metaCampaignsMatched: number;
  /** Sum-then-divide aggregate across matched Meta campaigns. */
  totals: Aggregate;
  /** Reason the row has no insights data, if any. */
  reason:
    | null
    | "no_event_code"
    | "no_ad_account"
    | "meta_token_failed"
    | "meta_insights_failed";
}

export interface RollupBenchmark {
  /** Account-id keyed rolling 90-day baseline used for cell colour-coding. */
  ctr: number | null;
  cpm: number | null;
  cpr: number | null;
  campaignsCounted: number;
}

export interface RollupResult {
  events: RollupRow[];
  /** Aggregate across every row's totals — drives the page-level KPI strip. */
  totals: Aggregate;
  /**
   * Benchmark per-ad-account, keyed on the normalised `act_*` id, used
   * by the table cells to decide better/worse colour. We pick the row's
   * own ad account when colouring; pages with mixed accounts get
   * per-row baselines rather than one global mean (which would lie).
   */
  benchmarksByAccount: Record<string, RollupBenchmark>;
  /** Window actually used for insights — echoed back so the UI can label it. */
  window: { since: string; until: string };
  /** Total candidate events before per-row filtering. Powers empty-state copy. */
  candidateEventsConsidered: number;
}

export interface LoadRollupInput {
  userId: string;
  /** Optional client filter — UUID. */
  clientId?: string | null;
  /** YYYY-MM-DD inclusive. */
  since: string;
  /** YYYY-MM-DD inclusive. */
  until: string;
}

/**
 * Default the rollup window to the last 30 days when callers don't
 * pass an explicit pair. Mirrors the per-event default so a "narrow
 * to one event" check shows the same numbers as the per-event report.
 */
export function defaultRollupWindow(now: Date = new Date()): {
  since: string;
  until: string;
} {
  const until = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return { since, until };
}

/**
 * Returns events owned by `userId` that have at least one published
 * `campaign_drafts` row with `event_id` set. The published-status
 * filter is what makes this surface "live" — drafts and archived
 * campaigns never appear in the rollup. RLS handles ownership; we
 * still bound by user_id because campaign_drafts rows can exist
 * without an event_id at all and we'd rather pay one extra column
 * filter than hope the join shape is always tight.
 */
export async function listEventsWithPublishedCampaigns(
  userId: string,
  options?: { clientId?: string | null },
): Promise<EventWithClient[]> {
  const supabase = await createClient();

  const { data: draftRows, error: draftErr } = await supabase
    .from("campaign_drafts")
    .select("event_id")
    .eq("user_id", userId)
    .eq("status", "published")
    .not("event_id", "is", null);
  if (draftErr) {
    console.warn("[rollup] published drafts query failed:", draftErr.message);
    return [];
  }
  const eventIds = new Set<string>();
  for (const row of draftRows ?? []) {
    const id = row.event_id as string | null;
    if (id) eventIds.add(id);
  }
  if (eventIds.size === 0) return [];

  // Reuse the existing list helper so we get the same client-join
  // shape as everywhere else, then filter to the published-set in
  // memory. The candidate set is bounded by the user's RLS scope so
  // the in-memory pass is small in practice.
  const allEvents = await listEventsServer(userId, {
    clientId: options?.clientId ?? undefined,
  });
  return allEvents.filter((e) => eventIds.has(e.id));
}

/**
 * Per-event published-draft count, keyed on event_id, used to render
 * the "Linked campaigns" badge on each row. Pulled in one query so
 * the rollup doesn't fan out N reads for N events.
 */
async function countPublishedDraftsByEvent(
  userId: string,
): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaign_drafts")
    .select("event_id")
    .eq("user_id", userId)
    .eq("status", "published")
    .not("event_id", "is", null);
  const map = new Map<string, number>();
  if (error) {
    console.warn("[rollup] count drafts failed:", error.message);
    return map;
  }
  for (const row of data ?? []) {
    const id = row.event_id as string | null;
    if (!id) continue;
    map.set(id, (map.get(id) ?? 0) + 1);
  }
  return map;
}

const EMPTY_TOTALS: Aggregate = {
  spend: 0,
  impressions: 0,
  clicks: 0,
  results: 0,
  ctr: null,
  cpm: null,
  cpr: null,
};

const EMPTY_BENCHMARK: RollupBenchmark = {
  ctr: null,
  cpm: null,
  cpr: null,
  campaignsCounted: 0,
};

/**
 * Build the full rollup. Per-event Meta failures are caught and
 * encoded on the row as `reason` rather than thrown — the page
 * should never blank because one ad account is misconfigured.
 *
 * Token resolution is the one global failure: if there's no Meta
 * token at all we still return rows (with the per-row reason set
 * to `meta_token_failed`) so the page renders the events table
 * with a blank insights column rather than 500-ing.
 */
export async function loadCrossEventRollup(
  input: LoadRollupInput,
): Promise<RollupResult> {
  const window = { since: input.since, until: input.until };

  const [candidates, draftCounts] = await Promise.all([
    listEventsWithPublishedCampaigns(input.userId, {
      clientId: input.clientId ?? null,
    }),
    countPublishedDraftsByEvent(input.userId),
  ]);
  const candidateEventsConsidered = candidates.length;

  if (candidates.length === 0) {
    return {
      events: [],
      totals: EMPTY_TOTALS,
      benchmarksByAccount: {},
      window,
      candidateEventsConsidered,
    };
  }

  // One token resolution for the whole page. Meta credentials are
  // per-user, not per-event, so a single resolve is correct (and
  // cheap — `resolveServerMetaToken` already short-circuits to env).
  const supabase = await createClient();
  let token: string | null = null;
  try {
    const resolved = await resolveServerMetaToken(supabase, input.userId);
    token = resolved.token;
  } catch (err) {
    console.warn(
      "[rollup] Meta token resolve failed:",
      err instanceof Error ? err.message : String(err),
    );
  }

  const benchmarksByAccount: Record<string, RollupBenchmark> = {};
  const rows: RollupRow[] = [];
  const totalsAccumulator: Array<{
    spend: number;
    impressions: number;
    clicks: number;
    results: number;
  }> = [];

  for (const event of candidates) {
    const eventCode = event.event_code?.trim() ?? "";
    const adAccountRaw =
      (event.client?.meta_ad_account_id as string | null | undefined) ?? null;
    const linkedCampaignsCount = draftCounts.get(event.id) ?? 0;

    if (!eventCode) {
      rows.push({
        event,
        linkedCampaignsCount,
        metaCampaignsMatched: 0,
        totals: EMPTY_TOTALS,
        reason: "no_event_code",
      });
      continue;
    }
    if (!adAccountRaw) {
      rows.push({
        event,
        linkedCampaignsCount,
        metaCampaignsMatched: 0,
        totals: EMPTY_TOTALS,
        reason: "no_ad_account",
      });
      continue;
    }
    if (!token) {
      rows.push({
        event,
        linkedCampaignsCount,
        metaCampaignsMatched: 0,
        totals: EMPTY_TOTALS,
        reason: "meta_token_failed",
      });
      continue;
    }

    const adAccountId = normaliseAdAccountId(adAccountRaw);
    try {
      const insights = await fetchEventCampaignInsights({
        adAccountId,
        eventCode,
        token,
        window,
      });
      const totals = aggregate(insights);
      rows.push({
        event,
        linkedCampaignsCount,
        metaCampaignsMatched: insights.length,
        totals,
        reason: null,
      });
      totalsAccumulator.push({
        spend: totals.spend,
        impressions: totals.impressions,
        clicks: totals.clicks,
        results: totals.results,
      });

      // Lazily compute benchmarks once per account. Default 90-day
      // window — independent of the rollup's range toggle so the
      // colour-coding baseline doesn't shift when the user narrows.
      if (!(adAccountId in benchmarksByAccount)) {
        try {
          const b = await computeBenchmarks({ adAccountId, token });
          benchmarksByAccount[adAccountId] = b;
        } catch (err) {
          console.warn(
            "[rollup] benchmarks fetch failed for",
            adAccountId,
            err instanceof Error ? err.message : String(err),
          );
          benchmarksByAccount[adAccountId] = EMPTY_BENCHMARK;
        }
      }
    } catch (err) {
      console.warn(
        "[rollup] insights fetch failed for event",
        event.id,
        err instanceof Error ? err.message : String(err),
      );
      rows.push({
        event,
        linkedCampaignsCount,
        metaCampaignsMatched: 0,
        totals: EMPTY_TOTALS,
        reason: "meta_insights_failed",
      });
    }
  }

  return {
    events: rows,
    totals: aggregate(totalsAccumulator),
    benchmarksByAccount,
    window,
    candidateEventsConsidered,
  };
}
