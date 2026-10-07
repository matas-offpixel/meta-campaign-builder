/**
 * Nightly ad_daily_insights refresh. Restates the last three complete
 * UTC days for every client ad account so attribution lag settles.
 *
 * Accounts: distinct union of clients.meta_ad_account_id,
 * events.meta_ad_account_id and launched_ad_sets.ad_account_id. One
 * account failing (rate limit, auth, anything) is logged and skipped.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeAdAccountId } from "../meta/ad-account.ts";
import { deriveAdDailyInsight, type AdDailyInsightRow } from "./derive.ts";
import { fetchAdAccountInsights, type AccountFetchStatus, type GraphGet } from "./fetch.ts";

export const AD_DAILY_INSIGHTS_DAYS = 3;
const UPSERT_CHUNK = 500;
const PAGE = 1000;

export type AccountOutcome = {
  adAccountId: string;
  status: AccountFetchStatus | "write_error";
  calls: number;
  pages: number;
  rows: number;
  error?: string;
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

async function loadColumn(db: SupabaseClient, table: string, column: string): Promise<string[]> {
  const out: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select(column)
      .not(column, "is", null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}.${column}: ${error.message}`);
    const rows = (data ?? []) as unknown as Record<string, string | null>[];
    for (const row of rows) if (row[column]) out.push(row[column] as string);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function loadClientAdAccounts(db: SupabaseClient): Promise<{ accounts: string[]; errors: string[] }> {
  const sources: [string, string][] = [
    ["clients", "meta_ad_account_id"],
    ["events", "meta_ad_account_id"],
    ["launched_ad_sets", "ad_account_id"],
  ];
  const accounts = new Set<string>();
  const errors: string[] = [];
  for (const [table, column] of sources) {
    try {
      for (const raw of await loadColumn(db, table, column)) {
        const id = normalizeAdAccountId(raw);
        if (id) accounts.add(id);
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { accounts: [...accounts].sort(), errors };
}

async function upsertRows(db: SupabaseClient, rows: AdDailyInsightRow[]): Promise<string | null> {
  for (let start = 0; start < rows.length; start += UPSERT_CHUNK) {
    const { error } = await db
      .from("ad_daily_insights")
      .upsert(rows.slice(start, start + UPSERT_CHUNK), { onConflict: "meta_ad_id,date" });
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
  let metaCalls = 0;
  let rowsWritten = 0;
  for (const adAccountId of loaded.accounts) {
    const fetched = await fetchAdAccountInsights(deps.graphGet, adAccountId, since, until);
    metaCalls += fetched.calls;
    // One upsert cannot touch the same (ad, day) twice.
    const byKey = new Map<string, AdDailyInsightRow>();
    for (const raw of fetched.rows) {
      const row = deriveAdDailyInsight(adAccountId, raw, now);
      if (row) byKey.set(`${row.meta_ad_id}|${row.date}`, row);
    }
    const rows = [...byKey.values()];
    const outcome: AccountOutcome = {
      adAccountId,
      status: fetched.status,
      calls: fetched.calls,
      pages: fetched.pages,
      rows: 0,
      ...(fetched.error ? { error: fetched.error } : {}),
    };
    // Partial pages from a failed account are still facts; keep them.
    if (rows.length > 0) {
      const writeError = await upsertRows(deps.db, rows);
      if (writeError) {
        outcome.status = "write_error";
        outcome.error = writeError;
      } else {
        outcome.rows = rows.length;
        rowsWritten += rows.length;
      }
    }
    if (outcome.status !== "ok") {
      console.error(`[ad-daily-insights] ${adAccountId} ${outcome.status}: ${outcome.error ?? ""}`);
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
