/**
 * lib/cirqlin/page-audience/step.ts
 *
 * HE2's step in the 23:55 UTC mailchimp-eod-snapshot cron, after the
 * CIRQLIN signups pass: one GET /api/partner/page-audience per linked page,
 * in sequence, all time, into cirqlin_page_audience (migration 247), one
 * row per page per fetch day.
 *
 * Behind ENABLE_CIRQLIN_AUDIENCE_INGEST, which must be exactly "1". Off,
 * the step makes no call and no read.
 *
 * The bucket: CIRQLIN allows 60 partner reads per 10 minutes per IP, shared
 * with the signups read. The cron counts the signups pass's calls and this
 * step makes at most what is left, so the run never asks past the bucket.
 * Pages it can't reach are reported (`skippedOnBucket`); pages fetched
 * longest ago go first, so the same pages aren't the ones left every night.
 * A 429 stops the step and is reported. A 401 or 404 skips that page and is
 * reported; so are a 400, a body that fails the shape or geography check,
 * and a failed read. The cron's time budget stops it too (`skippedOnTime`).
 *
 * The self-check is the smoke test: each page's signups against the stored
 * /signups page-id total (signup_source_snapshots, source 'cirqlin', the
 * latest snapshot, via page_id for this page). A mismatch is logged and
 * stored on the row with both numbers; it is never corrected.
 *
 * PB5 (design record 2026-11-15-dashboard-v2-panels-and-he2-gaps): only a
 * total written in this cron run is compared, one at or after the run's
 * signups pass started. An older total is "unchecked": a signups read that
 * failed tonight, a page the signups pass skipped, a tag-only sync. Against
 * yesterday's total a mismatch would only mean people signed up today.
 *
 * Shows of archived clients are left out. Counts only; nothing here logs
 * the secret or a request.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadArchivedClientIds } from "../../db/client-status.ts";
import { loadAllPaged } from "../../db/paged-read.ts";
import { CIRQLIN_FAILURE_SENTINEL_DAY } from "../sync.ts";
import { fetchCirqlinPageAudience, type PageAudience, type PageAudienceFailure } from "./client.ts";
import { latestPageAudienceRows, PAGE_AUDIENCE_TABLE } from "./read.ts";

type Db = Pick<SupabaseClient, "from">;

/** CIRQLIN's partner-read limit: 60 calls per 10 minutes per IP, both endpoints. */
export const CIRQLIN_PARTNER_BUCKET = 60;

export function isCirqlinAudienceIngestEnabled(env: Record<string, string | undefined>): boolean {
  return env.ENABLE_CIRQLIN_AUDIENCE_INGEST === "1";
}

export interface PageAudienceTarget {
  eventId: string;
  pageId: string;
  isUmbrella: boolean;
}

/** Linked pages of shows whose client isn't archived (a show with no client counts). One target per page: the first show by event id. */
export async function loadPageAudienceTargets(db: Db, archived?: Set<string>): Promise<PageAudienceTarget[]> {
  const archivedIds = archived ?? (await loadArchivedClientIds(db));
  const events = await loadAllPaged<{ id: string; client_id: string | null; cirqlin_page_id: string | null; is_umbrella: boolean | null }>(
    db,
    "events",
    "id,client_id,cirqlin_page_id,is_umbrella",
    ["id"],
    (q) => q.not("cirqlin_page_id", "is", null),
  );
  const byPage = new Map<string, PageAudienceTarget>();
  for (const e of events) {
    if (e.client_id && archivedIds.has(e.client_id)) continue;
    const page = e.cirqlin_page_id?.trim().toLowerCase();
    if (!page || byPage.has(page)) continue;
    byPage.set(page, { eventId: e.id, pageId: page, isUmbrella: e.is_umbrella === true });
  }
  return [...byPage.values()];
}

export type SignupsCheck = { status: "ok" | "mismatch" | "unchecked"; stored: number | null; storedAt: string | null };

/**
 * This page's signups against a stored /signups total. No stored page-id
 * total → unchecked. With `since` (the run's signups-pass start), a total
 * written before it, or at a time that can't be read, → unchecked (PB5).
 */
export function checkSignups(signups: number, stored: { total: number; at: string } | null, since?: string): SignupsCheck {
  if (!stored) return { status: "unchecked", stored: null, storedAt: null };
  if (since !== undefined && !writtenSince(stored.at, since)) return { status: "unchecked", stored: null, storedAt: null };
  return { status: stored.total === signups ? "ok" : "mismatch", stored: stored.total, storedAt: stored.at };
}

/** `at` is at or after `since`, both read as instants (Postgres writes "+00:00", JS "Z"). */
export function writtenSince(at: string, since: string): boolean {
  const a = Date.parse(at);
  const b = Date.parse(since);
  return Number.isFinite(a) && Number.isFinite(b) && a >= b;
}

type SnapshotQuery = {
  select(columns: string): SnapshotQuery;
  eq(column: string, value: unknown): SnapshotQuery;
  neq(column: string, value: unknown): SnapshotQuery;
  order(column: string, options: { ascending: boolean }): SnapshotQuery;
  limit(n: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
};

/**
 * The stored /signups all-time total for this page: the event's newest
 * CIRQLIN snapshot row, only when it was written by the page-id read for
 * this page (a tag read sums every page on the tag, a different number).
 */
export async function storedSignupsTotal(db: Db, eventId: string, pageId: string): Promise<{ total: number; at: string } | null> {
  const q = (db.from("signup_source_snapshots") as unknown as SnapshotQuery)
    .select("signups_total,snapshot_at,raw_json,day")
    .eq("event_id", eventId)
    .eq("source", "cirqlin")
    .neq("day", CIRQLIN_FAILURE_SENTINEL_DAY)
    .order("snapshot_at", { ascending: false })
    .order("day", { ascending: false });
  const { data, error } = await q.limit(1);
  if (error) throw new Error(`signup_source_snapshots: ${error.message}`);
  const row = data?.[0] as { signups_total?: unknown; snapshot_at?: unknown; raw_json?: unknown } | undefined;
  if (!row) return null;
  const raw = row.raw_json != null && typeof row.raw_json === "object" ? (row.raw_json as Record<string, unknown>) : {};
  if (raw.via !== "page_id" || typeof raw.page_id !== "string" || raw.page_id.toLowerCase() !== pageId) return null;
  const total = Number(row.signups_total);
  if (!Number.isInteger(total) || total < 0 || typeof row.snapshot_at !== "string") return null;
  return { total, at: row.snapshot_at };
}

export function pageAudienceRow(target: PageAudienceTarget, audience: PageAudience, check: SignupsCheck, fetchDay: string, fetchedAt: string) {
  return {
    page_id: target.pageId,
    fetch_day: fetchDay,
    event_id: target.eventId,
    is_umbrella: target.isUmbrella,
    signups: audience.signups,
    geo_cities: audience.geography.cities,
    geo_everywhere_else: audience.geography.everywhere_else,
    geo_couldnt_tell: audience.geography.couldnt_tell,
    consent_marketing: audience.consent.marketing,
    channels_offered: audience.consent.channels_offered,
    community_joined: audience.community_joined,
    community_link_clicks: audience.community_link_clicks,
    community_code_shared: audience.community_code_shared,
    whatsapp_with_phone: audience.whatsapp_with_phone,
    partner_opt_in: audience.partner_opt_in,
    partner_box_offered: audience.partner_box_offered,
    daily_timezone: audience.daily_timezone,
    signups_check: check.status,
    signups_stored: check.stored,
    signups_stored_at: check.storedAt,
    fetched_at: fetchedAt,
  };
}

/** Never-fetched pages first, then the oldest fetch, then page id. */
export function orderTargets(targets: readonly PageAudienceTarget[], lastFetchDay: ReadonlyMap<string, string>): PageAudienceTarget[] {
  return [...targets].sort((a, b) => {
    const x = lastFetchDay.get(a.pageId) ?? "";
    const y = lastFetchDay.get(b.pageId) ?? "";
    if (x !== y) return x < y ? -1 : 1;
    return a.pageId < b.pageId ? -1 : a.pageId > b.pageId ? 1 : 0;
  });
}

export interface PageAudienceStepResult {
  enabled: boolean;
  ok: boolean;
  /** Linked pages considered. */
  pages: number;
  rowsWritten: number;
  /** page-audience calls this step made. */
  calls: number;
  bucket: { size: number; signupsPassCalls: number; left: number };
  skippedOnBucket: number;
  skippedOnTime: number;
  rateLimited: boolean;
  notConfigured: boolean;
  failures: { pageId: string; eventId: string; reason: PageAudienceFailure | "upsert"; status?: number }[];
  checks: { ok: number; mismatch: number; unchecked: number };
  mismatches: { pageId: string; eventId: string; signups: number; stored: number }[];
  error?: string;
}

export async function runPageAudienceStep(input: {
  env: Record<string, string | undefined>;
  db: Db;
  /** Partner calls the signups pass made in this run. */
  signupsPassCalls: number;
  /** When this run's signups pass started (ISO). Only a stored total written since is compared (PB5). */
  signupsPassStartedAt: string;
  now?: () => Date;
  /** True when the cron's time budget is spent; checked before each call. */
  overBudget?: () => boolean;
  targets?: PageAudienceTarget[];
  fetchImpl?: typeof fetch;
  secret?: string;
  base?: string;
  timeoutMs?: number;
  log?: (line: string) => void;
}): Promise<PageAudienceStepResult> {
  const now = input.now ?? (() => new Date());
  const left = Math.max(0, CIRQLIN_PARTNER_BUCKET - Math.max(0, input.signupsPassCalls));
  const result: PageAudienceStepResult = {
    enabled: isCirqlinAudienceIngestEnabled(input.env),
    ok: true,
    pages: 0,
    rowsWritten: 0,
    calls: 0,
    bucket: { size: CIRQLIN_PARTNER_BUCKET, signupsPassCalls: input.signupsPassCalls, left },
    skippedOnBucket: 0,
    skippedOnTime: 0,
    rateLimited: false,
    notConfigured: false,
    failures: [],
    checks: { ok: 0, mismatch: 0, unchecked: 0 },
    mismatches: [],
  };
  if (!result.enabled) return result;
  const log = input.log ?? ((line: string) => console.log(line));

  let ordered: PageAudienceTarget[];
  try {
    const targets = input.targets ?? (await loadPageAudienceTargets(input.db));
    const latest = await latestPageAudienceRows(input.db, targets.map((t) => t.pageId));
    ordered = orderTargets(targets, new Map([...latest].map(([page, row]) => [page, row.fetch_day])));
  } catch (err) {
    // Nothing is fetched if the pages can't be read.
    return { ...result, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  result.pages = ordered.length;

  for (let i = 0; i < ordered.length; i += 1) {
    const target = ordered[i]!;
    if (input.overBudget?.()) {
      result.skippedOnTime = ordered.length - i;
      break;
    }
    if (result.calls >= left) {
      result.skippedOnBucket = ordered.length - i;
      break;
    }
    const fetched = await fetchCirqlinPageAudience(target.pageId, {
      fetchImpl: input.fetchImpl,
      secret: input.secret,
      base: input.base,
      timeoutMs: input.timeoutMs,
    });
    if (fetched.called) result.calls += 1;
    if (!fetched.ok) {
      if (fetched.reason === "not_configured") {
        result.notConfigured = true;
        result.ok = false;
        break;
      }
      result.failures.push({ pageId: target.pageId, eventId: target.eventId, reason: fetched.reason, status: fetched.status });
      if (fetched.reason === "rate_limited") {
        result.rateLimited = true;
        result.skippedOnBucket = ordered.length - i - 1;
        break;
      }
      continue;
    }

    const at = now();
    let check: SignupsCheck;
    try {
      check = checkSignups(fetched.audience.signups, await storedSignupsTotal(input.db, target.eventId, target.pageId), input.signupsPassStartedAt);
    } catch {
      check = checkSignups(fetched.audience.signups, null);
    }
    result.checks[check.status] += 1;
    if (check.status === "mismatch") {
      result.mismatches.push({ pageId: target.pageId, eventId: target.eventId, signups: fetched.audience.signups, stored: check.stored! });
      log(`[cirqlin-page-audience] signups_check=mismatch page=${target.pageId} event=${target.eventId} page_audience=${fetched.audience.signups} signups_stored=${check.stored}`);
    }
    const row = pageAudienceRow(target, fetched.audience, check, at.toISOString().slice(0, 10), at.toISOString());
    const { error } = await (input.db.from(PAGE_AUDIENCE_TABLE) as unknown as {
      upsert(rows: unknown[], o: { onConflict: string }): PromiseLike<{ error: { message: string } | null }>;
    }).upsert([row], { onConflict: "page_id,fetch_day" });
    if (error) {
      result.failures.push({ pageId: target.pageId, eventId: target.eventId, reason: "upsert" });
      continue;
    }
    result.rowsWritten += 1;
  }

  // A 404 is a page that isn't published: reported, not a broken run.
  if (result.rateLimited || result.failures.some((f) => f.reason !== "no_page")) result.ok = false;
  log(
    `[cirqlin-page-audience] pages=${result.pages} calls=${result.calls} signups_pass_calls=${result.bucket.signupsPassCalls} bucket_left=${left} written=${result.rowsWritten} skipped_bucket=${result.skippedOnBucket} skipped_time=${result.skippedOnTime} rate_limited=${result.rateLimited} failures=${result.failures.length} mismatches=${result.mismatches.length}`,
  );
  return result;
}
