/**
 * Nightly ad_daily_insights refresh. Restates the last three complete
 * UTC days for every client ad account so attribution lag settles.
 *
 * Accounts: distinct union of clients.meta_ad_account_id,
 * events.meta_ad_account_id and launched_ad_sets.ad_account_id. One
 * account failing (rate limit, auth, anything) is logged and skipped.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadArchivedClientIds, logSkippedArchivedClients } from "../db/client-status.ts";
import { metaObjectiveNeedsPromotedEvent } from "../launched-ad-sets/snapshot.ts";
import { normalizeAdAccountId } from "../meta/ad-account.ts";
import { createPromotedEventLookup } from "./adset-meta.ts";
import { deriveAdDailyInsight, type AdDailyInsightRow } from "./derive.ts";
import { fetchAdAccountInsightsAdaptive, type AccountFetchStatus, type GraphGet } from "./fetch.ts";

export const AD_DAILY_INSIGHTS_DAYS = 3;
const UPSERT_CHUNK = 500;
const PAGE = 1000;

export type AccountOutcome = {
  adAccountId: string;
  status: AccountFetchStatus | "write_error";
  /** Insights calls plus ad set promoted_object calls. */
  calls: number;
  adsetCalls: number;
  pages: number;
  rows: number;
  error?: string;
  /** The stored or Meta promoted event read failed; affected rows omit promoted_event and keep the stored value. */
  adsetError?: string;
  /** Set when a failing span was split into smaller ones. */
  windowSplit?: { from: number; to: number };
};

export type AdDailyInsightsRunResult = {
  ok: boolean;
  skippedReason?: "killswitch";
  since?: string;
  until?: string;
  accounts?: number;
  metaCalls?: number;
  rowsWritten?: number;
  outcomes?: AccountOutcome[];
  accountLoadErrors?: string[];
};

export function isAdDailyInsightsEnabled(env: Record<string, string | undefined>): boolean {
  return env.ENABLE_AD_DAILY_INSIGHTS === "1";
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Last `days` complete UTC days, ending yesterday. */
export function insightsWindow(now: Date, days: number = AD_DAILY_INSIGHTS_DAYS): { since: string; until: string } {
  const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const since = new Date(until.getTime() - (days - 1) * 86_400_000);
  return { since: isoDay(since), until: isoDay(until) };
}

async function loadColumn(
  db: SupabaseClient,
  table: string,
  column: string,
  clientColumn: string,
): Promise<{ account: string; clientId: string | null }[]> {
  const out: { account: string; clientId: string | null }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select(`${column}, ${clientColumn}`)
      .not(column, "is", null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}.${column}: ${error.message}`);
    const rows = (data ?? []) as unknown as Record<string, string | null>[];
    for (const row of rows) {
      if (row[column]) out.push({ account: row[column] as string, clientId: row[clientColumn] ?? null });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * An account is fetched when any non-archived client, event or launched
 * ad set uses it. Rows with no client count as active.
 */
export async function loadClientAdAccounts(
  db: SupabaseClient,
): Promise<{ accounts: string[]; errors: string[]; skippedArchivedAccounts: number }> {
  const sources: [table: string, column: string, clientColumn: string][] = [
    ["clients", "meta_ad_account_id", "id"],
    ["events", "meta_ad_account_id", "client_id"],
    ["launched_ad_sets", "ad_account_id", "client_id"],
  ];
  const archivedClientIds = await loadArchivedClientIds(db);
  const accounts = new Set<string>();
  const archivedOnly = new Set<string>();
  const errors: string[] = [];
  for (const [table, column, clientColumn] of sources) {
    try {
      for (const row of await loadColumn(db, table, column, clientColumn)) {
        const id = normalizeAdAccountId(row.account);
        if (!id) continue;
        if (row.clientId && archivedClientIds.has(row.clientId)) archivedOnly.add(id);
        else accounts.add(id);
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  const skippedArchivedAccounts = [...archivedOnly].filter((id) => !accounts.has(id)).length;
  logSkippedArchivedClients(
    "ad-daily-insights",
    archivedClientIds.size,
    `skipped_archived_accounts=${skippedArchivedAccounts}`,
  );
  return { accounts: [...accounts].sort(), errors, skippedArchivedAccounts };
}

/**
 * supabase-js sends a bulk upsert's `columns` as the union of every row's
 * keys, so a row missing a key in a mixed batch would write NULL to that
 * column. Rows are grouped by their exact key set: a column a row cannot
 * fill is absent from its batch and keeps the stored value
 * (merge-duplicates updates only the columns sent).
 */
export function upsertBatches(rows: readonly AdDailyInsightRow[]): AdDailyInsightRow[][] {
  const groups = new Map<string, AdDailyInsightRow[]>();
  for (const row of rows) {
    const key = Object.keys(row).sort().join(",");
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const batches: AdDailyInsightRow[][] = [];
  for (const group of groups.values()) {
    for (let start = 0; start < group.length; start += UPSERT_CHUNK) batches.push(group.slice(start, start + UPSERT_CHUNK));
  }
  return batches;
}

async function upsertRows(db: SupabaseClient, rows: AdDailyInsightRow[]): Promise<string | null> {
  for (const batch of upsertBatches(rows)) {
    const { error } = await db.from("ad_daily_insights").upsert(batch, { onConflict: "meta_ad_id,date" });
    if (error) return error.message;
  }
  return null;
}

export async function runAdDailyInsights(deps: {
  env: Record<string, string | undefined>;
  db: SupabaseClient;
  graphGet: GraphGet;
  now?: Date;
  /** Override for the backfill script. */
  accounts?: string[];
  window?: { since: string; until: string };
}): Promise<AdDailyInsightsRunResult> {
  if (!isAdDailyInsightsEnabled(deps.env)) return { ok: true, skippedReason: "killswitch" };

  const now = deps.now ?? new Date();
  const { since, until } = deps.window ?? insightsWindow(now);
  const loaded = deps.accounts
    ? { accounts: deps.accounts, errors: [] as string[] }
    : await loadClientAdAccounts(deps.db);

  const outcomes: AccountOutcome[] = [];
  const promotedEvents = createPromotedEventLookup(deps.db, deps.graphGet);
  let metaCalls = 0;
  let rowsWritten = 0;
  for (const adAccountId of loaded.accounts) {
    let written = 0;
    let adsetCalls = 0;
    let adsetError: string | undefined;
    const fetched = await fetchAdAccountInsightsAdaptive(
      deps.graphGet,
      adAccountId,
      since,
      until,
      async (span) => {
        // One upsert cannot touch the same (ad, day) twice.
        const byKey = new Map<string, AdDailyInsightRow>();
        for (const raw of span.rows) {
          const row = deriveAdDailyInsight(adAccountId, raw, now);
          if (row) byKey.set(`${row.meta_ad_id}|${row.date}`, row);
        }
        const rows = [...byKey.values()];
        if (rows.length === 0) return null;
        const lookup = await promotedEvents.resolve(
          rows
            .filter((row) => metaObjectiveNeedsPromotedEvent(row.campaign_objective, row.optimization_goal))
            .flatMap((row) => (row.meta_adset_id ? [row.meta_adset_id] : [])),
        );
        adsetCalls += lookup.calls;
        if (lookup.error) adsetError = lookup.error;
        else if (lookup.storedReadError) adsetError = lookup.storedReadError;
        for (const row of rows) {
          const event = promotedEvents.eventOf(row.meta_adset_id);
          if (event) row.promoted_event = event;
        }
        const writeError = await upsertRows(deps.db, rows);
        if (!writeError) written += rows.length;
        return writeError;
      },
    );
    metaCalls += fetched.calls + adsetCalls;
    rowsWritten += written;
    const outcome: AccountOutcome = {
      adAccountId,
      status: fetched.status,
      calls: fetched.calls + adsetCalls,
      adsetCalls,
      pages: fetched.pages,
      rows: written,
      ...(fetched.error ? { error: fetched.error } : {}),
      ...(adsetError ? { adsetError } : {}),
      ...(fetched.windowSplit ? { windowSplit: fetched.windowSplit } : {}),
    };
    if (fetched.windowSplit) {
      console.log(
        `[ad-daily-insights] ${adAccountId} window_split=${fetched.windowSplit.from}d→${fetched.windowSplit.to}d status=${outcome.status} meta_calls=${outcome.calls}`,
      );
    }
    if (outcome.status !== "ok") {
      console.error(`[ad-daily-insights] ${adAccountId} ${outcome.status}: ${outcome.error ?? ""}`);
    }
    if (adsetError) {
      console.error(`[ad-daily-insights] ${adAccountId} promoted_object read failed after ${adsetCalls} calls: ${adsetError}`);
    }
    outcomes.push(outcome);
  }

  console.log(
    `[ad-daily-insights] window=${since}..${until} accounts=${loaded.accounts.length} meta_calls=${metaCalls} rows=${rowsWritten}`,
  );

  return {
    ok: outcomes.every((o) => o.status === "ok") && loaded.errors.length === 0,
    since,
    until,
    accounts: loaded.accounts.length,
    metaCalls,
    rowsWritten,
    outcomes,
    ...(loaded.errors.length > 0 ? { accountLoadErrors: loaded.errors } : {}),
  };
}
