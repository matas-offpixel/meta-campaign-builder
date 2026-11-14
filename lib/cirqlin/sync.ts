/**
 * lib/cirqlin/sync.ts
 *
 * Persist Cirqlin's partner-read payload into `signup_source_snapshots`.
 * One row per (event, source, day). A Cirqlin miss never throws — the
 * Mailchimp refresh / EOD cron report it and keep writing.
 *
 * `no_page` / `unauthorized` / `error` upsert a 1970-01-01 failure
 * marker. That unique key is not a live count — writing London-today
 * would hide 1,843. They ping `ads_ops` once per event+reason except
 * `no_page`. `not_configured` writes nothing and does not alert; it
 * is a fetch reason only, never a persisted row.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchCirqlinSignupsByTag } from "./client.ts";
import { buildCirqlinSnapshotRows } from "./snapshot-rows.ts";
import type { CirqlinFetchFailureReason } from "./types.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any>;

/** Reserved day so a failure marker cannot collide with Cirqlin `daily[].day`. */
export const CIRQLIN_FAILURE_SENTINEL_DAY = "1970-01-01";

/** Once per `cirqlin_sync_failed:<eventId>:<reason>`, not hourly. */
export const CIRQLIN_ALERT_DEDUPE_WINDOW_MS = Number.MAX_SAFE_INTEGER;

export interface CirqlinSyncResult {
  eventId: string;
  ok: boolean;
  reason?: CirqlinFetchFailureReason | "upsert";
  counted?: number;
  daysWritten?: number;
  error?: string;
}

export interface CirqlinSyncNotify {
  (input: {
    channel: "ads_ops";
    text: string;
    dedupeKey: string;
    dedupeWindowMs: number;
    /** EOD is 23:55 UTC — a business-hours gate would swallow the only fire. */
    respectBusinessHours: false;
  }): Promise<unknown>;
}

function shouldAlert(reason: CirqlinFetchFailureReason | "upsert"): boolean {
  return reason === "unauthorized" || reason === "error" || reason === "upsert";
}

async function alertCirqlinFailure(input: {
  eventId: string;
  reason: CirqlinFetchFailureReason | "upsert";
  message?: string;
  notify?: CirqlinSyncNotify;
}): Promise<void> {
  if (!shouldAlert(input.reason)) return;
  const text = `Cirqlin signup sync failed for ${input.eventId} (${input.reason}${
    input.message ? `: ${input.message}` : ""
  })`;
  const dedupeKey = `cirqlin_sync_failed:${input.eventId}:${input.reason}`;
  if (!input.notify) return;
  try {
    await input.notify({
      channel: "ads_ops",
      text,
      dedupeKey,
      dedupeWindowMs: CIRQLIN_ALERT_DEDUPE_WINDOW_MS,
      respectBusinessHours: false,
    });
  } catch {
    // Fail open — a Slack miss must not throw out of the Cirqlin leg.
  }
}

async function writeSentinelRow(
  supabase: AnySupabase,
  input: {
    eventId: string;
    tag: string;
    day: string;
    reason: Extract<CirqlinFetchFailureReason, "no_page" | "unauthorized" | "error">;
    now: Date;
  },
): Promise<CirqlinSyncResult> {
  const { error } = await supabase.from("signup_source_snapshots").upsert(
    {
      event_id: input.eventId,
      source: "cirqlin",
      day: input.day,
      signups_day: 0,
      signups_total: 0,
      raw_json: { reason: input.reason, tag: input.tag },
      snapshot_at: input.now.toISOString(),
    },
    { onConflict: "event_id,source,day" },
  );
  if (error) {
    return { eventId: input.eventId, ok: false, reason: "upsert", error: error.message };
  }
  return {
    eventId: input.eventId,
    ok: input.reason === "no_page",
    reason: input.reason,
    counted: 0,
    daysWritten: 1,
  };
}

/**
 * Fetch Cirqlin for `tag` and upsert the daily rows. `no_page`,
 * `unauthorized` and `error` write a reserved-day marker so the card
 * can say Cirqlin was asked without touching a live day's unique key.
 */
export async function syncCirqlinSignupsForEvent(
  supabase: AnySupabase,
  input: { eventId: string; tag: string },
  opts?: {
    now?: Date;
    notify?: CirqlinSyncNotify;
    fetchImpl?: typeof fetch;
    secret?: string;
    base?: string;
    timeoutMs?: number;
  },
): Promise<CirqlinSyncResult> {
  const now = opts?.now ?? new Date();
  const fetched = await fetchCirqlinSignupsByTag(input.tag, {
    fetchImpl: opts?.fetchImpl,
    secret: opts?.secret,
    base: opts?.base,
    timeoutMs: opts?.timeoutMs,
  });
  if (!fetched.ok) {
    if (fetched.reason === "no_page") {
      return writeSentinelRow(supabase, {
        eventId: input.eventId,
        tag: input.tag,
        day: CIRQLIN_FAILURE_SENTINEL_DAY,
        reason: "no_page",
        now,
      });
    }
    await alertCirqlinFailure({
      eventId: input.eventId,
      reason: fetched.reason,
      message: fetched.message,
      notify: opts?.notify,
    });
    if (fetched.reason === "unauthorized" || fetched.reason === "error") {
      const written = await writeSentinelRow(supabase, {
        eventId: input.eventId,
        tag: input.tag,
        day: CIRQLIN_FAILURE_SENTINEL_DAY,
        reason: fetched.reason,
        now,
      });
      if (!written.ok && written.reason === "upsert") {
        await alertCirqlinFailure({
          eventId: input.eventId,
          reason: "upsert",
          message: written.error,
          notify: opts?.notify,
        });
      }
      return {
        eventId: input.eventId,
        ok: false,
        reason: fetched.reason,
        error: fetched.message,
        daysWritten: written.daysWritten,
      };
    }
    return {
      eventId: input.eventId,
      ok: false,
      reason: fetched.reason,
      error: fetched.message,
    };
  }

  const rows = buildCirqlinSnapshotRows(input.eventId, fetched.payload);

  const { error } = await supabase
    .from("signup_source_snapshots")
    .upsert(rows, { onConflict: "event_id,source,day" });

  if (error) {
    await alertCirqlinFailure({
      eventId: input.eventId,
      reason: "upsert",
      message: error.message,
      notify: opts?.notify,
    });
    return {
      eventId: input.eventId,
      ok: false,
      reason: "upsert",
      error: error.message,
    };
  }

  return {
    eventId: input.eventId,
    ok: true,
    counted: fetched.payload.totals.counted,
    daysWritten: rows.length,
  };
}

/**
 * Dashboard v2 (HN2): sync by the event's linked CIRQLIN page first, the
 * Mailchimp tag only as a fallback (lib/cirqlin/page-signups.ts). A page
 * lookup that fails and has no tag to fall back to writes nothing, never a
 * 0 and never a marker row, and reports why.
 */
export async function syncCirqlinSignupsForEventByPage(
  supabase: AnySupabase,
  input: { eventId: string; pageId: string | null; tag: string | null },
  opts?: {
    now?: Date;
    notify?: CirqlinSyncNotify;
    fetchImpl?: typeof fetch;
    secret?: string;
    base?: string;
    timeoutMs?: number;
  },
): Promise<CirqlinSyncResult & { via: "page_id" | "tag" | null; pageReason?: string }> {
  const { fetchCirqlinSignupsByPage, fallsBackToTag, pageSnapshotRows } = await import("./page-signups.ts");
  const now = opts?.now ?? new Date();
  if (input.pageId) {
    const fetched = await fetchCirqlinSignupsByPage(input.pageId, {
      fetchImpl: opts?.fetchImpl,
      secret: opts?.secret,
      base: opts?.base,
      timeoutMs: opts?.timeoutMs,
    });
    if (fetched.ok) {
      const rows = pageSnapshotRows(input.eventId, fetched.payload, now.toISOString());
      if (rows.length) {
        const { error } = await supabase.from("signup_source_snapshots").upsert(rows, { onConflict: "event_id,source,day" });
        if (error) {
          await alertCirqlinFailure({ eventId: input.eventId, reason: "upsert", message: error.message, notify: opts?.notify });
          return { eventId: input.eventId, ok: false, reason: "upsert", error: error.message, via: "page_id" };
        }
      }
      return { eventId: input.eventId, ok: true, counted: fetched.payload.total, daysWritten: rows.length, via: "page_id" };
    }
    if (!input.tag || !fallsBackToTag(fetched.reason)) {
      return {
        eventId: input.eventId,
        ok: false,
        reason: fetched.reason === "unauthorized" ? "unauthorized" : fetched.reason === "not_configured" ? "not_configured" : "error",
        error: `page ${fetched.reason}${fetched.message ? `: ${fetched.message}` : ""}`,
        via: null,
        pageReason: fetched.reason,
      };
    }
    const viaTag = await syncCirqlinSignupsForEvent(supabase, { eventId: input.eventId, tag: input.tag }, opts);
    return { ...viaTag, via: "tag", pageReason: fetched.reason };
  }
  if (!input.tag) return { eventId: input.eventId, ok: false, reason: "no_page", via: null };
  return { ...(await syncCirqlinSignupsForEvent(supabase, { eventId: input.eventId, tag: input.tag }, opts)), via: "tag" };
}
