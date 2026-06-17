import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  getAudience,
  getAudienceListActivity,
  getAudienceSegments,
  MailchimpApiError,
  type MailchimpActivityRow,
  type MailchimpAudience,
} from "@/lib/mailchimp/client";
import { getMailchimpCredentials } from "@/lib/mailchimp/credentials";
import { reconstructDailyCumulatives, resolveMailchimpAudienceId, isWritableMailchimpDailySnapshot } from "@/lib/mailchimp/activity-reconstruct";

export { resolveMailchimpAudienceId };

export interface MailchimpSyncEventRow {
  id: string;
  user_id: string;
  kind: string | null;
  mailchimp_audience_id: string | null;
  event_start_at?: string | null;
  client: { mailchimp_account_id: string | null; mailchimp_audience_id: string | null } | null;
}

// resolveMailchimpAudienceId is imported from activity-reconstruct and re-exported above.

export interface SyncMailchimpAudienceResult {
  eventId: string;
  ok: boolean;
  snapshotId?: string;
  error?: string;
}

/**
 * Syncs the Mailchimp audience snapshot for one event.
 *
 * Shared by the daily cron and the manual-refresh endpoint so the logic
 * stays in one place and the cron tests exercise the same code.
 */
export async function syncMailchimpAudienceForEvent(
  supabase: ReturnType<typeof createServiceRoleClient>,
  event: MailchimpSyncEventRow,
): Promise<SyncMailchimpAudienceResult> {
  const audienceId = resolveMailchimpAudienceId(event);
  if (!audienceId) {
    return { eventId: event.id, ok: false, error: "no_audience_id" };
  }

  // Resolve the Mailchimp account for this event (via client).
  const client = Array.isArray(event.client) ? event.client[0] : event.client;
  const accountId = client?.mailchimp_account_id ?? null;
  if (!accountId) {
    return { eventId: event.id, ok: false, error: "no_account_id" };
  }

  let credentials;
  try {
    credentials = await getMailchimpCredentials(supabase, accountId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { eventId: event.id, ok: false, error: `credentials: ${message}` };
  }
  if (!credentials) {
    return { eventId: event.id, ok: false, error: "no_credentials" };
  }

  let audience: MailchimpAudience;
  try {
    audience = await getAudience(credentials.dc, audienceId, credentials.apiKey);
  } catch (err) {
    const message =
      err instanceof MailchimpApiError ? err.message : String(err);
    return { eventId: event.id, ok: false, error: `api: ${message}` };
  }

  const stats = audience.stats;
  // Determine client_id from the first client col returned (may be null for events without client).
  const clientId = (event as { client_id?: string | null }).client_id ?? null;

  const snapshotRow = {
    user_id: event.user_id,
    event_id: event.id,
    client_id: clientId,
    mailchimp_audience_id: audienceId,
    total_contacts: stats.member_count,
    email_subscribers:
      stats.member_count -
      (stats.unsubscribe_count ?? 0) -
      (stats.cleaned_count ?? 0),
    pending: null as number | null,
    unsubscribed: stats.unsubscribe_count ?? null,
    cleaned: stats.cleaned_count ?? null,
    member_count_since_send: stats.member_count_since_send ?? null,
    avg_open_rate: stats.open_rate ?? null,
    avg_click_rate: stats.click_rate ?? null,
    snapshot_at: new Date().toISOString(),
    raw_json: JSON.parse(JSON.stringify(audience)) as object,
  };

  // Upsert — unique on (event_id, snapshot_at::date).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const { data: upserted, error: upsertError } = await sb
    .from("mailchimp_audience_snapshots")
    .upsert(snapshotRow, {
      onConflict: "event_id,snapshot_at",
      ignoreDuplicates: false,
    })
    .select("id")
    .maybeSingle();

  if (upsertError) {
    return {
      eventId: event.id,
      ok: false,
      error: `upsert: ${upsertError.message}`,
    };
  }

  return {
    eventId: event.id,
    ok: true,
    snapshotId: (upserted as { id?: string } | null)?.id,
  };
}

export interface SyncMailchimpDailyHistoryResult {
  ok: boolean;
  rowsWritten: number;
  firstDate?: string;
  lastDate?: string;
  error?: string;
}

/**
 * Pulls per-day subscriber activity for a brand_campaign event and writes
 * one `mailchimp_audience_snapshots` row per day into the table.
 *
 * Mirrors how the Eventbrite ticket-sales cron writes `tickets_sold` per day
 * into `event_daily_rollups` — cumulative value stored per day, canonical
 * aggregator (cumulative_snapshot semantics) handles carry-forward and CPR.
 *
 * Algorithm:
 *   1. Fetch current audience total via getAudience() → anchor for today.
 *   2. Fetch per-day delta activity via getAudienceListActivity().
 *   3. Walk the activity backwards from today, reconstructing each day's
 *      end-of-day cumulative subscriber count.
 *   4. Delete existing rows in the date window (any prior source) and
 *      insert fresh rows — idempotent, safe to re-run.
 *
 * `email_subscribers` stores the CUMULATIVE running total at end of that day,
 * NOT the daily delta. This is what `buildMailchimpRegistrationSnapshotPoints`
 * expects when emitting `ticketsKind: "cumulative_snapshot"` points.
 */
export async function syncMailchimpAudienceDailyHistory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: ReturnType<typeof createServiceRoleClient> | any,
  event: MailchimpSyncEventRow & { client_id?: string | null },
  windowDays = 180,
): Promise<SyncMailchimpDailyHistoryResult> {
  const audienceId = resolveMailchimpAudienceId(event);
  if (!audienceId) {
    console.error(
      `[mailchimp-daily-sync] event=${event.id} failed: no_audience_id`,
    );
    return { ok: false, rowsWritten: 0, error: "no_audience_id" };
  }

  const client = Array.isArray(event.client) ? event.client[0] : event.client;
  const accountId = client?.mailchimp_account_id ?? null;
  if (!accountId) {
    console.error(
      `[mailchimp-daily-sync] event=${event.id} failed: no_account_id (connect at /settings/mailchimp)`,
    );
    return { ok: false, rowsWritten: 0, error: "no_account_id" };
  }

  let credentials;
  try {
    credentials = await getMailchimpCredentials(supabase, accountId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[mailchimp-daily-sync] event=${event.id} credentials error: ${message}`,
    );
    return {
      ok: false,
      rowsWritten: 0,
      error: `credentials: ${message}`,
    };
  }
  if (!credentials) {
    console.error(
      `[mailchimp-daily-sync] event=${event.id} failed: no_credentials (mailchimp_accounts.credentials_encrypted empty or decrypt returned null)`,
    );
    return { ok: false, rowsWritten: 0, error: "no_credentials" };
  }

  // Anchor: fetch current audience stats so we know the live cumulative total.
  let audience: MailchimpAudience;
  try {
    audience = await getAudience(credentials.dc, audienceId, credentials.apiKey);
  } catch (err) {
    const message =
      err instanceof MailchimpApiError ? err.message : String(err);
    console.error(
      `[mailchimp-daily-sync] event=${event.id} api_audience error: ${message}`,
    );
    return {
      ok: false,
      rowsWritten: 0,
      error: `api_audience: ${message}`,
    };
  }

  // Active subscriber count (same formula as syncMailchimpAudienceForEvent).
  const currentActiveTotal =
    audience.stats.member_count -
    (audience.stats.unsubscribe_count ?? 0) -
    (audience.stats.cleaned_count ?? 0);

  // Fetch per-day activity deltas.
  let activityRows: MailchimpActivityRow[];
  try {
    activityRows = await getAudienceListActivity(
      credentials.apiKey,
      credentials.dc,
      audienceId,
      Math.min(windowDays, 180),
    );
  } catch (err) {
    const message =
      err instanceof MailchimpApiError ? err.message : String(err);
    console.error(
      `[mailchimp-daily-sync] event=${event.id} api_activity error: ${message}`,
    );
    return {
      ok: false,
      rowsWritten: 0,
      error: `api_activity: ${message}`,
    };
  }

  if (activityRows.length === 0) {
    console.warn(
      `[mailchimp-daily-sync] event=${event.id} ok but zero activity rows from Mailchimp API`,
    );
    return { ok: true, rowsWritten: 0 };
  }

  // Reconstruct per-day cumulative totals via pure helper (testable without server-only).
  const dailyCumulatives = reconstructDailyCumulatives(activityRows, currentActiveTotal, {
    eventStartAt: event.event_start_at ?? null,
  }).filter(({ cumulative }) => isWritableMailchimpDailySnapshot(cumulative));

  if (dailyCumulatives.length === 0) {
    console.warn(
      `[mailchimp-daily-sync] event=${event.id} ok but no trustworthy daily rows after reconstruction`,
    );
    return { ok: true, rowsWritten: 0 };
  }

  const firstDate = dailyCumulatives[0]!.day;
  const lastDate = dailyCumulatives[dailyCumulatives.length - 1]!.day;
  const clientId = (event as { client_id?: string | null }).client_id ?? null;

  // Rows to insert. snapshot_at is anchored to noon UTC so the expression
  // unique index timezone('UTC', snapshot_at)::date resolves consistently
  // regardless of the server's local timezone.
  const rows = dailyCumulatives.map(({ day, cumulative }) => ({
    user_id: event.user_id,
    event_id: event.id,
    client_id: clientId,
    mailchimp_audience_id: audienceId,
    total_contacts: cumulative,
    email_subscribers: cumulative,
    snapshot_at: `${day}T12:00:00Z`,
    raw_json: { source: "mailchimp_api_daily_sync" } as object,
  }));

  // Delete existing rows for this event in the activity window before
  // re-inserting — ensures we overwrite any previously synced or manually
  // inserted estimates without hitting the unique-index conflict.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const { error: deleteError } = await sb
    .from("mailchimp_audience_snapshots")
    .delete()
    .eq("event_id", event.id)
    .gte("snapshot_at", `${firstDate}T00:00:00Z`)
    .lte("snapshot_at", `${lastDate}T23:59:59Z`);

  if (deleteError) {
    console.error(
      `[mailchimp-daily-sync] event=${event.id} delete error: ${deleteError.message}`,
    );
    return { ok: false, rowsWritten: 0, error: `delete: ${deleteError.message}` };
  }

  const { error: insertError } = await sb
    .from("mailchimp_audience_snapshots")
    .insert(rows);

  if (insertError) {
    console.error(
      `[mailchimp-daily-sync] event=${event.id} insert error: ${insertError.message}`,
    );
    return { ok: false, rowsWritten: 0, error: `insert: ${insertError.message}` };
  }

  console.log(
    `[mailchimp-daily-sync] event=${event.id} wrote ${rows.length} rows ${firstDate}..${lastDate}`,
  );
  return { ok: true, rowsWritten: rows.length, firstDate, lastDate };
}

// ── Tag-scoped snapshot sync ──────────────────────────────────────────────────

/**
 * Event row shape required by syncMailchimpTagForEvent.
 * Extends MailchimpSyncEventRow with the tag column.
 */
export interface MailchimpTagSyncEventRow extends MailchimpSyncEventRow {
  mailchimp_tag: string;
  client_id?: string | null;
}

export interface SyncMailchimpTagResult {
  eventId: string;
  ok: boolean;
  snapshotId?: string;
  memberCount?: number;
  error?: string;
}

/**
 * Syncs one tag-scoped Mailchimp snapshot for a single-event row that has
 * `mailchimp_tag` set.
 *
 * Algorithm:
 *   1. Resolve audience ID + credentials (same as syncMailchimpAudienceForEvent).
 *   2. Fetch /lists/{audienceId}/segments to find the segment whose name
 *      matches event.mailchimp_tag (case-insensitive trim).
 *   3. Write one row to mailchimp_tag_snapshots with the segment's member_count.
 *
 * Why segments, not tags? Mailchimp tags created in the UI appear in the
 * /segments endpoint as type="static" segments. member_count is the canonical
 * count of list members currently carrying that tag.
 *
 * Idempotent: upserts on (event_id, snapshot_at::date UTC).
 */
export async function syncMailchimpTagForEvent(
  supabase: ReturnType<typeof createServiceRoleClient>,
  event: MailchimpTagSyncEventRow,
): Promise<SyncMailchimpTagResult> {
  const audienceId = resolveMailchimpAudienceId(event);
  if (!audienceId) {
    return { eventId: event.id, ok: false, error: "no_audience_id" };
  }

  const client = Array.isArray(event.client) ? event.client[0] : event.client;
  const accountId = client?.mailchimp_account_id ?? null;
  if (!accountId) {
    return { eventId: event.id, ok: false, error: "no_account_id" };
  }

  let credentials;
  try {
    credentials = await getMailchimpCredentials(supabase, accountId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { eventId: event.id, ok: false, error: `credentials: ${message}` };
  }
  if (!credentials) {
    return { eventId: event.id, ok: false, error: "no_credentials" };
  }

  // Fetch all static segments (= tags) for this audience.
  let segmentsResponse;
  try {
    segmentsResponse = await getAudienceSegments(
      credentials.dc,
      audienceId,
      credentials.apiKey,
      { type: "static", count: 1000 },
    );
  } catch (err) {
    const message = err instanceof MailchimpApiError ? err.message : String(err);
    return { eventId: event.id, ok: false, error: `api_segments: ${message}` };
  }

  const tagLower = event.mailchimp_tag.trim().toLowerCase();
  const matchedSegment = segmentsResponse.segments.find(
    (s) => s.type === "static" && s.name.trim().toLowerCase() === tagLower,
  );

  if (!matchedSegment) {
    console.warn(
      `[mailchimp-tag-sync] event=${event.id} tag="${event.mailchimp_tag}" not found in ${segmentsResponse.segments.length} segments for audience ${audienceId}`,
    );
    return { eventId: event.id, ok: false, error: `tag_not_found: ${event.mailchimp_tag}` };
  }

  const memberCount = matchedSegment.member_count;
  const clientId = event.client_id ?? null;

  const snapshotRow = {
    user_id: event.user_id,
    event_id: event.id,
    client_id: clientId,
    mailchimp_audience_id: audienceId,
    mailchimp_tag: event.mailchimp_tag,
    total_contacts: memberCount,
    email_subscribers: memberCount,
    snapshot_at: new Date().toISOString(),
    raw_json: {
      segment_id: matchedSegment.id,
      segment_name: matchedSegment.name,
      member_count: matchedSegment.member_count,
      source: "mailchimp_tag_sync",
    } as object,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const { data: upserted, error: upsertError } = await sb
    .from("mailchimp_tag_snapshots")
    .upsert(snapshotRow, {
      onConflict: "event_id,snapshot_at",
      ignoreDuplicates: false,
    })
    .select("id")
    .maybeSingle();

  if (upsertError) {
    return {
      eventId: event.id,
      ok: false,
      error: `upsert: ${upsertError.message}`,
    };
  }

  console.log(
    `[mailchimp-tag-sync] event=${event.id} tag="${event.mailchimp_tag}" member_count=${memberCount}`,
  );

  return {
    eventId: event.id,
    ok: true,
    snapshotId: (upserted as { id?: string } | null)?.id,
    memberCount,
  };
}
