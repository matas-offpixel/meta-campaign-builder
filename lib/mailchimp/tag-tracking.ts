import "server-only";

import crypto from "node:crypto";

/**
 * Shared helpers for the layered Mailchimp tag-tracking architecture
 * (webhooks + EOD cron + resumable backfill).
 *
 * Per-day snapshot rows are always written at a DETERMINISTIC timestamp
 * (`${day}T12:00:00Z`) so the existing unique index
 * `uq_mailchimp_tag_snapshots_event_snapshot_at (event_id, snapshot_at)`
 * dedupes to exactly one row per UTC day. Every writer (webhook recompute,
 * EOD reconciliation, backfill chunk) must use {@link daySnapshotAt} so they
 * upsert the same row rather than appending intra-day duplicates.
 */

/** Loose Supabase client type — callers pass the service-role client. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDb = any;

/** Canonical hour-of-day for per-day snapshot timestamps (noon UTC). */
export const DAY_SNAPSHOT_ISO_SUFFIX = "T12:00:00Z";

/** Returns the deterministic `snapshot_at` for a given UTC `YYYY-MM-DD` day. */
export function daySnapshotAt(day: string): string {
  return `${day}${DAY_SNAPSHOT_ISO_SUFFIX}`;
}

/** Current UTC day as `YYYY-MM-DD`. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Mailchimp member hash = md5 of the lowercased email address. */
export function md5Email(email: string): string {
  return crypto.createHash("md5").update(email.trim().toLowerCase()).digest("hex");
}

export interface TagEventRow {
  id: string;
  user_id: string;
  client_id: string | null;
  mailchimp_audience_id: string | null;
  mailchimp_tag: string | null;
}

/**
 * Recomputes the cumulative tag count for a single event on a single UTC day
 * from the append-only event log, then upserts the deterministic per-day
 * snapshot row.
 *
 * Cumulative = (latest snapshot strictly before `day`) + (net adds/removes
 * recorded in mailchimp_tag_event_log for `day`). Idempotent: re-running for
 * the same day always recomputes net-from-log, so repeated webhook deliveries
 * converge on the correct value.
 */
export async function recomputeDaySnapshot(
  sb: AnyDb,
  eventId: string,
  day: string = todayUtc(),
): Promise<{ ok: boolean; cumulative?: number; net?: number; baseline?: number; error?: string }> {
  const { data: event } = await sb
    .from("events")
    .select("user_id, client_id, mailchimp_audience_id, mailchimp_tag")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return { ok: false, error: "event_not_found" };

  const ev = event as TagEventRow;
  if (!ev.mailchimp_tag || !ev.mailchimp_audience_id) {
    return { ok: false, error: "event_missing_tag_or_audience" };
  }

  const dayStart = `${day}T00:00:00Z`;
  const dayEnd = `${day}T23:59:59.999Z`;

  // Baseline: latest snapshot strictly before this day.
  const { data: priorSnap } = await sb
    .from("mailchimp_tag_snapshots")
    .select("email_subscribers")
    .eq("event_id", eventId)
    .lt("snapshot_at", dayStart)
    .order("snapshot_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const baseline = (priorSnap?.email_subscribers as number | undefined) ?? 0;

  // Net additions/removals recorded for this day.
  const { data: dayEvents } = await sb
    .from("mailchimp_tag_event_log")
    .select("action")
    .eq("event_id", eventId)
    .gte("event_timestamp", dayStart)
    .lte("event_timestamp", dayEnd);

  let net = 0;
  for (const row of (dayEvents ?? []) as Array<{ action: string }>) {
    net += row.action === "added" ? 1 : -1;
  }

  const cumulative = Math.max(0, baseline + net);

  const { error: upsertErr } = await sb.from("mailchimp_tag_snapshots").upsert(
    {
      user_id: ev.user_id,
      event_id: eventId,
      client_id: ev.client_id,
      mailchimp_audience_id: ev.mailchimp_audience_id,
      mailchimp_tag: ev.mailchimp_tag,
      total_contacts: cumulative,
      email_subscribers: cumulative,
      snapshot_at: daySnapshotAt(day),
      raw_json: {
        source: "mailchimp_webhook_realtime",
        method: "incremental_from_event_log",
        baseline_prior_day: baseline,
        net_today: net,
        recomputed_at: new Date().toISOString(),
      },
    },
    { onConflict: "event_id,snapshot_at" },
  );

  if (upsertErr) return { ok: false, error: upsertErr.message };
  return { ok: true, cumulative, net, baseline };
}

/** Resolves the base URL for self-referential server-to-server fetches. */
export function resolveAppBaseUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;
  return null;
}

/** Standard cron/ops bearer auth check (mirrors existing cron routes). */
export function isCronAuthorized(authHeader: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = authHeader ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() === expected.trim();
  }
  return header.trim() === expected.trim();
}
