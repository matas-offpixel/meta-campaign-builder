/**
 * Nightly Google Ads campaign-grain refresh (migration 192). Restates the
 * last three complete days for every client Google Ads account: campaigns
 * per day, search terms, user locations, and the account's enabled
 * conversion actions. Read-only against Google Ads: query only.
 *
 * Accounts: an account is fetched when a non-archived client or an event
 * of a non-archived client links it (events.google_ads_account_id, else
 * clients.google_ads_account_id, the same resolution as rollup-sync).
 *
 * Silent-failure rule: when the event rollup has Google spend > 0 on a day
 * for an account and this run produced no campaign rows for that account
 * on that day, the account is failed (`rollup_spend_without_campaign_rows`)
 * and the run is not ok.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { isArchivedClientStatus, logSkippedArchivedClients } from "../../db/client-status.ts";
import {
  countEnabledConversionActions,
  mapCampaignRow,
  mapLocationRows,
  mapSearchTermRows,
  type AccountScope,
  type DailySnapshotRow,
  type GaqlCampaignRow,
  type GaqlConversionActionRow,
  type GaqlLocationRow,
  type GaqlSearchTermRow,
  type LocationSnapshotRow,
  type PlanLink,
  type SearchTermSnapshotRow,
} from "./map.ts";
import {
  CONVERSION_ACTIONS_QUERY,
  campaignDailyQuery,
  locationQuery,
  searchTermsQuery,
  type Window,
} from "./queries.ts";

export const GOOGLE_ADS_INSIGHTS_DAYS = 3;
/** googleAds:search returns at most this many rows a page; GoogleAdsClient.query reads one page. */
export const GOOGLE_ADS_PAGE_ROWS = 10_000;
const UPSERT_CHUNK = 500;
const PAGE = 1000;
const IN_CHUNK = 200;

export type GoogleAdsCredentialsLike = {
  customer_id: string;
  refresh_token: string;
  login_customer_id?: string | null;
};

/** GoogleAdsClient.query, bound by the caller. Never a mutate. */
export type GoogleAdsQuery = (credentials: GoogleAdsCredentialsLike, gaql: string) => Promise<unknown[]>;

export type AccountStatus =
  | "ok"
  | "no_credentials"
  | "query_error"
  | "write_error"
  | "page_truncated"
  | "rollup_spend_without_campaign_rows";

export type AccountOutcome = {
  googleAdsAccountId: string;
  customerId: string | null;
  status: AccountStatus;
  calls: number;
  campaignRows: number;
  searchTermRows: number;
  locationRows: number;
  /** Distinct campaigns per advertising_channel_type. */
  campaignsByChannel: Record<string, number>;
  enabledConversionActions: number | null;
  /** Days with event-rollup Google spend > 0 and no campaign rows. */
  missingDays?: string[];
  /** One-day spans that still filled a whole page. */
  truncatedDays?: string[];
  error?: string;
};

export type GoogleAdsInsightsRunResult = {
  ok: boolean;
  skippedReason?: "killswitch";
  since?: string;
  until?: string;
  accounts?: number;
  calls?: number;
  rowsWritten?: number;
  outcomes?: AccountOutcome[];
  accountLoadErrors?: string[];
  runLogError?: string;
};

export type FetchedRows = {
  scope: AccountScope;
  campaigns: DailySnapshotRow[];
  searchTerms: SearchTermSnapshotRow[];
  locations: LocationSnapshotRow[];
};

export function isGoogleAdsDailyInsightsEnabled(env: Record<string, string | undefined>): boolean {
  return env.ENABLE_GOOGLE_ADS_DAILY_INSIGHTS === "1";
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Last `days` complete UTC days, ending yesterday. */
export function insightsWindow(now: Date, days: number = GOOGLE_ADS_INSIGHTS_DAYS): Window {
  const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const since = new Date(until.getTime() - (days - 1) * 86_400_000);
  return { since: isoDay(since), until: isoDay(until) };
}

function addDays(dayIso: string, n: number): string {
  return isoDay(new Date(Date.parse(`${dayIso}T00:00:00Z`) + n * 86_400_000));
}

function daysBetween(w: Window): number {
  return Math.round((Date.parse(`${w.until}T00:00:00Z`) - Date.parse(`${w.since}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * A span that fills a page may have been cut off, so it is halved until
 * it doesn't, down to one day. A full one-day page is kept and reported.
 */
export async function queryAllRows<T>(
  run: (w: Window) => Promise<T[]>,
  w: Window,
  truncatedDays: string[],
): Promise<T[]> {
  const rows = await run(w);
  if (rows.length < GOOGLE_ADS_PAGE_ROWS) return rows;
  const days = daysBetween(w);
  if (days <= 1) {
    truncatedDays.push(w.since);
    return rows;
  }
  const mid = addDays(w.since, Math.floor(days / 2) - 1);
  return [
    ...(await queryAllRows(run, { since: w.since, until: mid }, truncatedDays)),
    ...(await queryAllRows(run, { since: addDays(mid, 1), until: w.until }, truncatedDays)),
  ];
}

/** `customers/{id}/…` resource names carry the customer id without dashes. */
export function customerDigits(customerId: string): string {
  return customerId.replace(/\D/g, "");
}

type AccountRow = { id: string; user_id: string; google_customer_id: string | null };

export type LoadedAccounts = {
  accounts: AccountRow[];
  /** Event id → Google Ads account id, for the rollup cross-check. */
  eventAccount: Map<string, string>;
  errors: string[];
};

async function readAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function loadGoogleAdsAccounts(db: SupabaseClient): Promise<LoadedAccounts> {
  const errors: string[] = [];
  const clients = await readAll<{ id: string; status: string | null; google_ads_account_id: string | null }>(
    (from, to) => db.from("clients").select("id, status, google_ads_account_id").range(from, to),
    "clients",
  );
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const archived = clients.filter((c) => isArchivedClientStatus(c.status));
  const events = await readAll<{ id: string; client_id: string | null; google_ads_account_id: string | null }>(
    (from, to) => db.from("events").select("id, client_id, google_ads_account_id").range(from, to),
    "events",
  );

  const wanted = new Set<string>();
  for (const c of clients) {
    if (c.google_ads_account_id && !isArchivedClientStatus(c.status)) wanted.add(c.google_ads_account_id);
  }
  const eventAccount = new Map<string, string>();
  for (const e of events) {
    const client = e.client_id ? clientById.get(e.client_id) : undefined;
    if (client && isArchivedClientStatus(client.status)) continue;
    const account = e.google_ads_account_id ?? client?.google_ads_account_id ?? null;
    if (!account) continue;
    eventAccount.set(e.id, account);
    wanted.add(account);
  }
  logSkippedArchivedClients("google-ads-daily-insights", archived.length);

  let accounts: AccountRow[] = [];
  if (wanted.size > 0) {
    const { data, error } = await db
      .from("google_ads_accounts")
      .select("id, user_id, google_customer_id")
      .in("id", [...wanted]);
    if (error) errors.push(`google_ads_accounts: ${error.message}`);
    accounts = ((data ?? []) as AccountRow[]).sort((a, b) => a.id.localeCompare(b.id));
  }
  return { accounts, eventAccount, errors };
}

/** campaign resource name → plan. A Search push wins over a hand-filled video link. */
export async function loadPlanLookup(db: SupabaseClient): Promise<Map<string, PlanLink>> {
  const lookup = new Map<string, PlanLink>();
  const video = await readAll<{ plan_id: string; google_campaign_resource_name: string }>(
    (from, to) =>
      db
        .from("google_video_campaigns")
        .select("plan_id, google_campaign_resource_name")
        .not("google_campaign_resource_name", "is", null)
        .range(from, to),
    "google_video_campaigns",
  );
  for (const row of video) lookup.set(row.google_campaign_resource_name, { plan_id: row.plan_id, plan_kind: "video" });
  const search = await readAll<{ plan_id: string; pushed_resource_name: string }>(
    (from, to) =>
      db
        .from("google_search_campaigns")
        .select("plan_id, pushed_resource_name")
        .not("pushed_resource_name", "is", null)
        .order("created_at", { ascending: true })
        .range(from, to),
    "google_search_campaigns",
  );
  for (const row of search) lookup.set(row.pushed_resource_name, { plan_id: row.plan_id, plan_kind: "search" });
  return lookup;
}

/** Account id → day → event-rollup Google spend, for days with spend > 0. */
export async function loadRollupGoogleSpend(
  db: SupabaseClient,
  eventAccount: ReadonlyMap<string, string>,
  w: Window,
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  const ids = [...eventAccount.keys()];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const rows = await readAll<{ event_id: string; date: string; google_ads_spend: number | string | null }>(
      (from, to) =>
        db
          .from("event_daily_rollups")
          .select("event_id, date, google_ads_spend")
          .in("event_id", chunk)
          .gte("date", w.since)
          .lte("date", w.until)
          .gt("google_ads_spend", 0)
          .range(from, to),
      "event_daily_rollups",
    );
    for (const row of rows) {
      const account = eventAccount.get(row.event_id);
      const spend = Number(row.google_ads_spend ?? 0);
      if (!account || !(spend > 0)) continue;
      const byDay = out.get(account) ?? new Map<string, number>();
      byDay.set(row.date, (byDay.get(row.date) ?? 0) + spend);
      out.set(account, byDay);
    }
  }
  return out;
}

/** Days the rollup shows spend for but no campaign row covers. */
export function missingCampaignDays(
  rollupSpendByDay: ReadonlyMap<string, number> | undefined,
  campaignRows: readonly Pick<DailySnapshotRow, "date">[],
): string[] {
  if (!rollupSpendByDay) return [];
  const covered = new Set(campaignRows.map((r) => r.date));
  return [...rollupSpendByDay.entries()]
    .filter(([date, spend]) => spend > 0 && !covered.has(date))
    .map(([date]) => date)
    .sort();
}

async function upsertAll(
  db: SupabaseClient,
  table: string,
  rows: readonly object[],
  onConflict: string,
): Promise<string | null> {
  for (let start = 0; start < rows.length; start += UPSERT_CHUNK) {
    const { error } = await db.from(table).upsert(rows.slice(start, start + UPSERT_CHUNK), { onConflict });
    if (error) return `${table}: ${error.message}`;
  }
  return null;
}

function campaignsByChannel(rows: readonly DailySnapshotRow[]): Record<string, number> {
  const seen = new Map<string, string>();
  for (const r of rows) seen.set(r.campaign_resource_name, r.advertising_channel_type ?? "UNKNOWN");
  const out: Record<string, number> = {};
  for (const channel of seen.values()) out[channel] = (out[channel] ?? 0) + 1;
  return out;
}

export async function runGoogleAdsDailyInsights(deps: {
  env: Record<string, string | undefined>;
  db: SupabaseClient;
  query: GoogleAdsQuery;
  loadCredentials: (googleAdsAccountId: string) => Promise<GoogleAdsCredentialsLike | null>;
  now?: Date;
  /** Backfill: restrict to these google_ads_accounts ids. */
  accountIds?: string[];
  window?: Window;
  /** False = fetch and report only, write nothing (backfill dry run). Default true. */
  write?: boolean;
  /** Insert a google_ads_insights_runs row. The cron does; the backfill doesn't. */
  recordRun?: boolean;
  onRows?: (rows: FetchedRows) => void;
}): Promise<GoogleAdsInsightsRunResult> {
  if (!isGoogleAdsDailyInsightsEnabled(deps.env)) return { ok: true, skippedReason: "killswitch" };

  const write = deps.write !== false;
  const now = deps.now ?? new Date();
  const fetchedAt = now.toISOString();
  const window = deps.window ?? insightsWindow(now);
  const loaded = await loadGoogleAdsAccounts(deps.db);
  const accounts = deps.accountIds
    ? loaded.accounts.filter((a) => deps.accountIds!.includes(a.id))
    : loaded.accounts;
  const plans = await loadPlanLookup(deps.db);
  const rollupSpend = await loadRollupGoogleSpend(deps.db, loaded.eventAccount, window);

  const outcomes: AccountOutcome[] = [];
  let calls = 0;
  let rowsWritten = 0;
  for (const account of accounts) {
    const outcome: AccountOutcome = {
      googleAdsAccountId: account.id,
      customerId: account.google_customer_id,
      status: "ok",
      calls: 0,
      campaignRows: 0,
      searchTermRows: 0,
      locationRows: 0,
      campaignsByChannel: {},
      enabledConversionActions: null,
    };
    outcomes.push(outcome);

    let credentials: GoogleAdsCredentialsLike | null;
    try {
      credentials = await deps.loadCredentials(account.id);
    } catch (err) {
      credentials = null;
      outcome.error = err instanceof Error ? err.message : String(err);
    }
    if (!credentials) {
      outcome.status = "no_credentials";
      console.error(`[google-ads-daily-insights] ${account.id} no_credentials ${outcome.error ?? ""}`);
      continue;
    }
    const creds = credentials;
    const scope: AccountScope = {
      googleAdsAccountId: account.id,
      userId: account.user_id,
      customerId: customerDigits(creds.customer_id),
    };
    const run = async <T>(gaql: string): Promise<T[]> => {
      outcome.calls += 1;
      return (await deps.query(creds, gaql)) as T[];
    };

    const truncatedDays: string[] = [];
    let fetched: FetchedRows;
    let enabled: number;
    try {
      const campaignRaw = await queryAllRows((w) => run<GaqlCampaignRow>(campaignDailyQuery(w)), window, truncatedDays);
      const termRaw = await queryAllRows((w) => run<GaqlSearchTermRow>(searchTermsQuery(w)), window, truncatedDays);
      const locationRaw = await queryAllRows((w) => run<GaqlLocationRow>(locationQuery(w)), window, truncatedDays);
      enabled = countEnabledConversionActions(await run<GaqlConversionActionRow>(CONVERSION_ACTIONS_QUERY));
      const byKey = new Map<string, DailySnapshotRow>();
      for (const raw of campaignRaw) {
        const row = mapCampaignRow(raw, scope, plans, fetchedAt);
        if (row) byKey.set(`${row.campaign_resource_name}|${row.date}`, row);
      }
      fetched = {
        scope,
        campaigns: [...byKey.values()],
        searchTerms: mapSearchTermRows(termRaw, scope, plans, fetchedAt),
        locations: mapLocationRows(locationRaw, scope, fetchedAt),
      };
    } catch (err) {
      calls += outcome.calls;
      outcome.status = "query_error";
      outcome.error = err instanceof Error ? err.message : String(err);
      console.error(`[google-ads-daily-insights] ${account.id} query_error: ${outcome.error}`);
      continue;
    }
    calls += outcome.calls;
    outcome.campaignRows = fetched.campaigns.length;
    outcome.searchTermRows = fetched.searchTerms.length;
    outcome.locationRows = fetched.locations.length;
    outcome.campaignsByChannel = campaignsByChannel(fetched.campaigns);
    outcome.enabledConversionActions = enabled;
    deps.onRows?.(fetched);

    if (write) {
      const writeError =
        (await upsertAll(deps.db, "google_ads_daily_snapshots", fetched.campaigns, "campaign_resource_name,date")) ??
        (await upsertAll(
          deps.db,
          "google_ads_search_terms_snapshots",
          fetched.searchTerms,
          "campaign_resource_name,ad_group_resource_name,date,search_term,match_type",
        )) ??
        (await upsertAll(
          deps.db,
          "google_ads_location_snapshots",
          fetched.locations,
          "campaign_resource_name,date,country_criterion_id,location_type",
        ));
      if (writeError) {
        outcome.status = "write_error";
        outcome.error = writeError;
        console.error(`[google-ads-daily-insights] ${account.id} write_error: ${writeError}`);
        continue;
      }
      rowsWritten += fetched.campaigns.length + fetched.searchTerms.length + fetched.locations.length;
      const { error } = await deps.db
        .from("google_ads_accounts")
        .update({ enabled_conversion_actions: enabled, conversion_actions_checked_at: fetchedAt })
        .eq("id", account.id);
      if (error) console.error(`[google-ads-daily-insights] ${account.id} conversion actions write failed: ${error.message}`);
    }

    const missingDays = missingCampaignDays(rollupSpend.get(account.id), fetched.campaigns);
    if (missingDays.length > 0) {
      outcome.status = "rollup_spend_without_campaign_rows";
      outcome.missingDays = missingDays;
      outcome.error = `Event rollup shows Google spend on ${missingDays.join(", ")} but no campaign rows were fetched.`;
      console.error(`[google-ads-daily-insights] ${account.id} ${outcome.status}: ${missingDays.join(",")}`);
    } else if (truncatedDays.length > 0) {
      outcome.status = "page_truncated";
      outcome.truncatedDays = truncatedDays;
      outcome.error = `More than ${GOOGLE_ADS_PAGE_ROWS} rows on ${truncatedDays.join(", ")}; the rest were not read.`;
      console.error(`[google-ads-daily-insights] ${account.id} page_truncated: ${truncatedDays.join(",")}`);
    }
  }

  console.log(
    `[google-ads-daily-insights] window=${window.since}..${window.until} accounts=${accounts.length} google_calls=${calls} rows=${rowsWritten} write=${write}`,
  );

  const result: GoogleAdsInsightsRunResult = {
    ok: outcomes.every((o) => o.status === "ok") && loaded.errors.length === 0,
    since: window.since,
    until: window.until,
    accounts: accounts.length,
    calls,
    rowsWritten,
    outcomes,
    ...(loaded.errors.length > 0 ? { accountLoadErrors: loaded.errors } : {}),
  };

  if (write && deps.recordRun) {
    const failed = outcomes.filter((o) => o.status !== "ok");
    const { error } = await deps.db.from("google_ads_insights_runs").insert({
      run_at: fetchedAt,
      since: window.since,
      until: window.until,
      ok: result.ok,
      accounts: accounts.length,
      calls,
      rows_written: rowsWritten,
      failed_accounts: failed.map((o) => ({
        google_ads_account_id: o.googleAdsAccountId,
        customer_id: o.customerId,
        status: o.status,
        error: o.error ?? null,
        missing_days: o.missingDays ?? [],
      })),
      outcomes,
    });
    if (error) {
      result.ok = false;
      result.runLogError = error.message;
      console.error(`[google-ads-daily-insights] run log insert failed: ${error.message}`);
    }
  }
  return result;
}
