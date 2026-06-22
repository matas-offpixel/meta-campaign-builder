import "server-only";

import crypto from "node:crypto";

import { getMailchimpCredentials } from "@/lib/mailchimp/credentials";
import { getMemberTags } from "@/lib/mailchimp/client";
import type { createServiceRoleClient } from "@/lib/supabase/server";

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

/**
 * Profile-update fallback: reconciles a single member's current Mailchimp tag
 * state against our event log for every tracked tag on (client, audience), then
 * recomputes affected snapshots.
 *
 * Mailchimp's classic webhook UI exposes "Profile updates" (not tag events), so
 * this path receives only the member email. We re-fetch the member's tags and
 * diff: a tag present in Mailchimp with no open "added" log row → synthesise an
 * "added" row (using Mailchimp's real `date_added`); a tag absent in Mailchimp
 * whose last log row is "added" → synthesise a "removed" row. Self-correcting
 * even if the Customer Journey webhook misfires.
 */
export async function handleProfileUpdate(
  supabase: ReturnType<typeof createServiceRoleClient>,
  clientId: string,
  audienceId: string,
  email: string,
): Promise<{ ok: boolean; reconciled: number; error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const memberHash = md5Email(email);

  // Events tracking this client + audience that have a tag set.
  const { data: events } = await sb
    .from("events")
    .select("id, user_id, client_id, mailchimp_tag, client:clients ( mailchimp_account_id )")
    .eq("client_id", clientId)
    .eq("mailchimp_audience_id", audienceId)
    .not("mailchimp_tag", "is", null);

  if (!events || events.length === 0) {
    return { ok: true, reconciled: 0 };
  }

  // Resolve credentials once (all events on this audience share the account).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const first = events[0] as any;
  const clientRow = Array.isArray(first.client) ? first.client[0] : first.client;
  const accountId = clientRow?.mailchimp_account_id ?? null;
  if (!accountId) return { ok: false, reconciled: 0, error: "no_account_id" };

  const creds = await getMailchimpCredentials(supabase, accountId);
  if (!creds) return { ok: false, reconciled: 0, error: "no_credentials" };

  const memberTags = await getMemberTags(creds.dc, audienceId, memberHash, creds.apiKey);
  const tagByName = new Map(memberTags.map((t) => [t.name, t]));

  let reconciled = 0;
  const affectedDays = new Map<string, Set<string>>(); // eventId → set of days

  for (const event of events) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ev = event as any;
    const tagName: string = ev.mailchimp_tag;
    const mcTag = tagByName.get(tagName);
    const hasTagNow = Boolean(mcTag);

    // Last logged action for this member+event.
    const { data: lastRow } = await sb
      .from("mailchimp_tag_event_log")
      .select("action")
      .eq("event_id", ev.id)
      .eq("member_email_hash", memberHash)
      .order("event_timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastAction: string | null = lastRow?.action ?? null;

    let newAction: "added" | "removed" | null = null;
    let eventTimestamp = new Date().toISOString();
    if (hasTagNow && lastAction !== "added") {
      newAction = "added";
      // Use Mailchimp's real application time when available.
      if (mcTag?.date_added) eventTimestamp = new Date(mcTag.date_added).toISOString();
    } else if (!hasTagNow && lastAction === "added") {
      newAction = "removed";
    }

    if (!newAction) continue;

    const { error: insErr } = await sb.from("mailchimp_tag_event_log").upsert(
      {
        event_id: ev.id,
        user_id: ev.user_id,
        client_id: ev.client_id,
        mailchimp_audience_id: audienceId,
        mailchimp_tag: tagName,
        member_email_hash: memberHash,
        member_email_address: email,
        action: newAction,
        event_timestamp: eventTimestamp,
        raw_webhook_body: { source: "profile_update_reconcile", has_tag_now: hasTagNow },
      },
      { onConflict: "event_id,member_email_hash,action,event_timestamp", ignoreDuplicates: true },
    );
    if (insErr) continue;

    reconciled += 1;
    const day = eventTimestamp.slice(0, 10);
    if (!affectedDays.has(ev.id)) affectedDays.set(ev.id, new Set());
    affectedDays.get(ev.id)!.add(day);
  }

  // Recompute snapshots for every (event, day) we touched.
  for (const [eventId, days] of affectedDays) {
    for (const day of days) {
      await recomputeDaySnapshot(sb, eventId, day);
    }
  }

  return { ok: true, reconciled };
}

/**
 * Fire-and-forget kick of the resumable tag backfill for an event. Safe to call
 * whenever an event gains a `mailchimp_tag`; the start endpoint dedupes against
 * any in-progress job, and the per-minute cron drives the work.
 */
export async function maybeTriggerTagBackfill(
  eventId: string,
  mailchimpTag: string | null | undefined,
): Promise<void> {
  if (!mailchimpTag) return;
  const base = resolveAppBaseUrl();
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) return;
  void fetch(`${base}/api/events/${eventId}/mailchimp/tag-backfill/start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  }).catch(() => {
    /* best-effort; per-minute cron + manual trigger backstop */
  });
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
