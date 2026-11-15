/**
 * lib/audience-breakdowns/runner.ts
 *
 * The nightly audience breakdowns step (dashboard v2 HE1), run inside the
 * ad-daily-insights cron behind its own killswitch: ENABLE_AUDIENCE_BREAKDOWNS
 * must be exactly "1" (default off), for both the Meta and the TikTok leg.
 * Restates the last three complete UTC days, as ad_daily_insights does, so
 * attribution lag settles. Read-only against both platforms.
 *
 * Meta accounts: lib/ad-daily-insights/runner.ts loadClientAdAccounts (the
 * same accounts, archived clients' left out). TikTok accounts: every
 * non-archived show's own TikTok account, else its client's.
 *
 * Writes never send NULL over a stored value: campaign_name and event_id
 * are left out of a row that can't fill them, and rows are batched by
 * their exact key set (supabase-js sends a bulk upsert's columns as the
 * union of every row's keys). A dry run reads and attributes, and writes
 * nothing.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadClientAdAccounts, insightsWindow } from "../ad-daily-insights/runner.ts";
import type { GraphGet } from "../ad-daily-insights/fetch.ts";
import { normalizeAdAccountId } from "../meta/ad-account.ts";
import { loadBreakdownScope, metaOwners, tiktokOwners, type BreakdownScope } from "./attribution.ts";
import { fetchMetaAccountBreakdowns, type MetaBreakdownRow } from "./meta.ts";
import { fetchTikTokAdvertiserBreakdowns, type TikTokBreakdownRow, type TikTokRequest } from "./tiktok.ts";

export const AUDIENCE_BREAKDOWNS_DAYS = 3;
const UPSERT_CHUNK = 500;

export const META_TABLE = "meta_audience_breakdowns";
export const TIKTOK_TABLE = "tiktok_audience_breakdowns";
export const META_CONFLICT = "meta_campaign_id,date,breakdown,age,gender,region";
export const TIKTOK_CONFLICT = "tiktok_campaign_id,date,breakdown,age,gender,nation";

export function isAudienceBreakdownsEnabled(env: Record<string, string | undefined>): boolean {
  return env.ENABLE_AUDIENCE_BREAKDOWNS === "1";
}

export type BreakdownPlatform = "meta" | "tiktok";

export type BreakdownAccountOutcome = {
  platform: BreakdownPlatform;
  /** act_… for Meta; the tiktok_accounts id for TikTok. */
  account: string;
  advertiserId?: string;
  status: "ok" | "rate_limited" | "auth_error" | "error" | "write_error" | "skipped" | "deferred";
  calls: number;
  rows: number;
  /** Rows attributed to a show. */
  attributed: number;
  error?: string;
  windowSplit?: { from: number; to: number };
};

export type AudienceBreakdownsRunResult = {
  ok: boolean;
  skippedReason?: "killswitch";
  dryRun?: boolean;
  since?: string;
  until?: string;
  metaCalls?: number;
  tiktokCalls?: number;
  rowsWritten?: number;
  /** Rows read (and, outside a dry run, written). */
  rowsRead?: number;
  outcomes?: BreakdownAccountOutcome[];
  error?: string;
  accountLoadErrors?: string[];
};

export type TikTokDeps = {
  request: TikTokRequest;
  /** Decrypted access token for a tiktok_accounts id, or null. */
  getToken: (accountId: string) => Promise<string | null>;
};

/** Rows grouped by their exact key set, then chunked. */
export function batchesByKeySet<T extends object>(rows: readonly T[], chunk = UPSERT_CHUNK): T[][] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = Object.keys(row).sort().join(",");
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const out: T[][] = [];
  for (const group of groups.values()) for (let i = 0; i < group.length; i += chunk) out.push(group.slice(i, i + chunk));
  return out;
}

async function upsert<T extends object>(db: SupabaseClient, table: string, onConflict: string, rows: readonly T[]): Promise<string | null> {
  for (const batch of batchesByKeySet(rows)) {
    const { error } = await db.from(table).upsert(batch, { onConflict });
    if (error) return error.message;
  }
  return null;
}

/** Sets event_id on Meta rows by the dashboard's rule; returns how many got one. */
export function attributeMetaRows(scope: Parameters<typeof metaOwners>[0], rows: MetaBreakdownRow[]): number {
  const names = new Map<string, string>();
  for (const r of rows) {
    const name = r.campaign_name ?? "";
    const current = names.get(r.meta_campaign_id);
    if (current == null || name > current) names.set(r.meta_campaign_id, name);
  }
  const owners = metaOwners(scope, names);
  let n = 0;
  for (const r of rows) {
    const owner = owners.get(r.meta_campaign_id);
    if (owner) {
      r.event_id = owner;
      n++;
    }
  }
  return n;
}

export function attributeTikTokRows(
  scope: Parameters<typeof tiktokOwners>[0],
  rows: TikTokBreakdownRow[],
  names: ReadonlyMap<string, string>,
): number {
  const owners = tiktokOwners(scope, names, new Set(rows.map((r) => r.tiktok_campaign_id)));
  let n = 0;
  for (const r of rows) {
    const owner = owners.get(r.tiktok_campaign_id);
    if (owner) {
      r.event_id = owner;
      n++;
    }
  }
  return n;
}

/** The TikTok accounts to read: each show's own, else its client's. Sorted. */
export function tiktokAccountsOf(scope: Pick<BreakdownScope, "shows">): string[] {
  return [...new Set(scope.shows.map((s) => s.tiktokAccountId).filter((id): id is string => !!id))].sort();
}

export async function runAudienceBreakdowns(deps: {
  env: Record<string, string | undefined>;
  db: SupabaseClient;
  graphGet: GraphGet;
  tiktok?: TikTokDeps;
  now?: Date;
  window?: { since: string; until: string };
  platforms?: readonly BreakdownPlatform[];
  /** Only these Meta accounts (act_…) / TikTok account ids. */
  metaAccounts?: string[];
  tiktokAccounts?: string[];
  dryRun?: boolean;
  /** Each account's attributed rows, written or not (the backfill prints a sample from these). */
  onRows?: (platform: BreakdownPlatform, account: string, rows: readonly (MetaBreakdownRow | TikTokBreakdownRow)[]) => void;
  /** Stop starting new accounts at this epoch ms; the rest are reported "deferred". */
  deadline?: number;
}): Promise<AudienceBreakdownsRunResult> {
  if (!isAudienceBreakdownsEnabled(deps.env)) return { ok: true, skippedReason: "killswitch" };
  const now = deps.now ?? new Date();
  const { since, until } = deps.window ?? insightsWindow(now, AUDIENCE_BREAKDOWNS_DAYS);
  const platforms = new Set(deps.platforms ?? ["meta", "tiktok"]);
  const dryRun = deps.dryRun === true;

  let scope: BreakdownScope;
  try {
    scope = await loadBreakdownScope(deps.db);
  } catch (err) {
    // Without the shows and overrides nothing can be attributed: write nothing rather than unattributed rows.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[audience-breakdowns] scope read failed: ${message}`);
    return { ok: false, since, until, error: `scope read failed: ${message}` };
  }

  const outcomes: BreakdownAccountOutcome[] = [];
  const accountLoadErrors: string[] = [];
  let metaCalls = 0;
  let tiktokCalls = 0;
  let rowsWritten = 0;
  let rowsRead = 0;
  const pastDeadline = () => deps.deadline != null && Date.now() >= deps.deadline;

  if (platforms.has("meta")) {
    let accounts: string[];
    if (deps.metaAccounts) accounts = deps.metaAccounts.map((a) => normalizeAdAccountId(a)).filter((a): a is string => !!a);
    else {
      const loaded = await loadClientAdAccounts(deps.db);
      accounts = loaded.accounts;
      accountLoadErrors.push(...loaded.errors);
    }
    for (const account of accounts) {
      if (pastDeadline()) {
        outcomes.push({ platform: "meta", account, status: "deferred", calls: 0, rows: 0, attributed: 0 });
        continue;
      }
      let rows = 0;
      let attributed = 0;
      const fetched = await fetchMetaAccountBreakdowns({
        graphGet: deps.graphGet,
        adAccountId: account,
        since,
        until,
        now,
        onSpan: async (span) => {
          attributed += attributeMetaRows(scope, span.rows);
          rows += span.rows.length;
          deps.onRows?.("meta", account, span.rows);
          if (dryRun || span.rows.length === 0) return null;
          const error = await upsert(deps.db, META_TABLE, META_CONFLICT, span.rows);
          if (!error) rowsWritten += span.rows.length;
          return error;
        },
      });
      metaCalls += fetched.calls;
      rowsRead += rows;
      const failed = fetched.stopped ?? fetched.results.find((r) => r.result.status !== "ok")?.result ?? null;
      const split = fetched.results.find((r) => r.result.windowSplit)?.result.windowSplit;
      const errors = fetched.results.filter((r) => r.result.error).map((r) => `${r.breakdown}: ${r.result.error}`);
      const outcome: BreakdownAccountOutcome = {
        platform: "meta",
        account,
        status: failed?.status ?? "ok",
        calls: fetched.calls,
        rows,
        attributed,
        ...(errors.length ? { error: errors.join("; ") } : {}),
        ...(split ? { windowSplit: split } : {}),
      };
      if (outcome.status !== "ok") console.error(`[audience-breakdowns] meta ${account} ${outcome.status} after ${outcome.calls} calls: ${outcome.error ?? ""}`);
      outcomes.push(outcome);
    }
  }

  if (platforms.has("tiktok")) {
    const accounts = deps.tiktokAccounts ?? tiktokAccountsOf(scope);
    let advertisers = new Map<string, string | null>();
    if (accounts.length) {
      const { data, error } = await deps.db.from("tiktok_accounts").select("id,tiktok_advertiser_id").in("id", accounts);
      if (error) accountLoadErrors.push(`tiktok_accounts: ${error.message}`);
      else advertisers = new Map(((data ?? []) as { id: string; tiktok_advertiser_id: string | null }[]).map((a) => [a.id, a.tiktok_advertiser_id]));
    }
    for (const account of accounts) {
      const advertiserId = advertisers.get(account) ?? null;
      const base = { platform: "tiktok" as const, account, ...(advertiserId ? { advertiserId } : {}), calls: 0, rows: 0, attributed: 0 };
      if (pastDeadline()) {
        outcomes.push({ ...base, status: "deferred" });
        continue;
      }
      if (!deps.tiktok) {
        outcomes.push({ ...base, status: "skipped", error: "no TikTok client wired" });
        continue;
      }
      if (!advertiserId) {
        outcomes.push({ ...base, status: "skipped", error: "no_advertiser_id" });
        continue;
      }
      let token: string | null;
      try {
        token = await deps.tiktok.getToken(account);
      } catch (err) {
        outcomes.push({ ...base, status: "skipped", error: `credentials: ${err instanceof Error ? err.message : String(err)}` });
        continue;
      }
      if (!token) {
        outcomes.push({ ...base, status: "skipped", error: "no_credentials" });
        continue;
      }
      const fetched = await fetchTikTokAdvertiserBreakdowns({ request: deps.tiktok.request, advertiserId, token, since, until, now });
      tiktokCalls += fetched.calls;
      const attributed = attributeTikTokRows(scope, fetched.rows, fetched.names);
      rowsRead += fetched.rows.length;
      deps.onRows?.("tiktok", account, fetched.rows);
      let status: BreakdownAccountOutcome["status"] = fetched.status;
      let error = fetched.error;
      if (!dryRun && fetched.rows.length) {
        const writeError = await upsert(deps.db, TIKTOK_TABLE, TIKTOK_CONFLICT, fetched.rows);
        if (writeError) {
          status = "write_error";
          error = writeError;
        } else rowsWritten += fetched.rows.length;
      }
      const outcome: BreakdownAccountOutcome = { ...base, status, calls: fetched.calls, rows: fetched.rows.length, attributed, ...(error ? { error } : {}) };
      if (status !== "ok") console.error(`[audience-breakdowns] tiktok ${account} ${status} after ${fetched.calls} calls: ${error ?? ""}`);
      outcomes.push(outcome);
    }
  }

  console.log(
    `[audience-breakdowns] window=${since}..${until} dry_run=${dryRun} meta_calls=${metaCalls} tiktok_calls=${tiktokCalls} rows=${rowsRead} written=${rowsWritten} archived_clients_skipped=${scope.archivedClients}`,
  );
  const settled = outcomes.every((o) => o.status === "ok" || o.status === "skipped");
  return {
    ok: settled && accountLoadErrors.length === 0,
    ...(dryRun ? { dryRun } : {}),
    since,
    until,
    metaCalls,
    tiktokCalls,
    rowsRead,
    rowsWritten,
    outcomes,
    ...(accountLoadErrors.length ? { accountLoadErrors } : {}),
  };
}
