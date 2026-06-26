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

  // A zero member_count means the tag exists in Mailchimp but has no
  // contacts yet — tag just created, briefly renamed, or lookup race.
  // Writing a 0 snapshot creates "drop-to-zero" chart artifacts.
  // Return ok=true so callers don't treat this as an error, but include
  // a skip_reason so logs can surface it.
  if (memberCount === 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as unknown as any;
    const { data: existingNonZero } = await sb
      .from("mailchimp_tag_snapshots")
      .select("email_subscribers")
      .eq("event_id", event.id)
      .gt("email_subscribers", 0)
      .order("snapshot_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const skipReason = existingNonZero
      ? "zero_count_but_have_history"
      : "zero_count_no_history";
    console.warn(
      `[mailchimp-tag-sync] event=${event.id} tag="${event.mailchimp_tag}" member_count=0 — skipping write (${skipReason})`,
    );
    return { eventId: event.id, ok: true, memberCount: 0 };
  }

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

// ── Tag daily-history backfill (Option C: snapshot-based deltas + weighted ramp) ─

/**
 * Weighted launch-burst curve for pre-snapshot ramp rows.
 *
 * Index 0 = day BEFORE first activity (anchor, always 0).
 * Index 1 = launch day (~40 % of first snapshot value).
 * Index 2 = day after launch (~75 %).
 * Values beyond the array length stay at the last weight (0.75).
 *
 * Rationale: real event campaigns front-load registrations on launch day
 * ("announcement + paid burst"). A pure linear ramp assigns 0 to the launch
 * day itself; the 40/75 weights give launch-day a meaningful estimate that
 * is within ~15 % of Eventree truth for Camelphat (496 actual vs ~518 ramp).
 */
const WEIGHTED_RAMP_WEIGHTS = [0.0, 0.4, 0.75];

/** One day worth of date arithmetic (UTC). */
function addDaysUtcStr(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Number of calendar days from `start` (inclusive) to `end` (exclusive). */
function dayDiffUtc(start: string, end: string): number {
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * Reconstructs per-day cumulative `email_subscribers` history for a
 * tag-scoped event using real Mailchimp tag snapshots as the truth source.
 *
 * Algorithm:
 *   1. Read all existing `mailchimp_tag_snapshots` rows for the event.
 *      Group by calendar day, keep the latest snapshot per day.
 *      Exclude any previously written `linear_ramp_pre_snapshot` rows from
 *      this grouping so re-runs stay idempotent.
 *   2. Find the event's campaign start (first `event_daily_rollups` row).
 *   3. If campaignStart < firstSnapshotDay: write weighted-ramp rows from 0 →
 *      firstSnapshotValue across the pre-snapshot window. The ramp starts ONE
 *      day BEFORE the first real-activity day so that launch day gets a
 *      non-zero estimate. These are labelled `method: "weighted_ramp_pre_snapshot"`
 *      in raw_json so:
 *        • The Daily Trend chart shows a believable curve from campaign launch.
 *        • The Daily Tracker filters them out for delta (REGS) computation,
 *          so pre-snapshot days correctly show "—" instead of a fake count.
 *   4. Delete all existing `source=mailchimp_tag_daily_history` rows for the
 *      event (idempotent cleanup of PR #622 backwards-walk rows and any
 *      previous ramp rows).
 *   5. Insert the new ramp rows (if any).
 *
 * Why not meta_regs (PR #622's approach)?
 *   Meta REG counts only capture Meta-attributed clicks — they miss TikTok,
 *   Google, organic, and direct signups. Subtracting meta_regs from the
 *   Mailchimp total gives a curve that systematically under-estimates by
 *   ~40 % for multi-channel campaigns (e.g. Camelphat: 1,380 Meta REGS vs.
 *   2,339 real Mailchimp count). The snapshot-based approach is the truth.
 *
 * Trade-off:
 *   Pre-snapshot days (before the first real cron run) use a weighted-launch-burst
 *   ramp approximation. Mid-window cumulatives are exact (taken from real syncs).
 *   The end-of-window number is always exact.
 *
 * All log lines use console.error so Vercel surfaces them reliably
 * (console.log is filtered under load — PRs #514, #525, #619).
 */
export async function syncMailchimpTagDailyHistory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: ReturnType<typeof createServiceRoleClient> | any,
  event: MailchimpTagSyncEventRow & { client_id?: string | null },
): Promise<SyncMailchimpDailyHistoryResult> {
  const audienceId = resolveMailchimpAudienceId(event);
  if (!audienceId) {
    console.error(
      `[mailchimp-tag-history] event=${event.id} failed: no_audience_id`,
    );
    return { ok: false, rowsWritten: 0, error: "no_audience_id" };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;

  // ── Step 1: Read all tag snapshots; group by day keeping latest ───────────
  const { data: allSnaps, error: snapReadErr } = await sb
    .from("mailchimp_tag_snapshots")
    .select("snapshot_at, email_subscribers, raw_json")
    .eq("event_id", event.id)
    .order("snapshot_at", { ascending: true });

  if (snapReadErr) {
    console.error(
      `[mailchimp-tag-history] event=${event.id} snapshot read error: ${snapReadErr.message}`,
    );
    return { ok: false, rowsWritten: 0, error: `snapshot_read: ${snapReadErr.message}` };
  }

  // Keep only rows that are real point-in-time syncs (not previous ramp rows)
  // so that the first-snapshot value we use as the ramp target is accurate.
  const realSnaps = (
    allSnaps as Array<{
      snapshot_at: string;
      email_subscribers: number | null;
      raw_json?: Record<string, unknown> | null;
    }>
  ).filter(
    (r) =>
      r.raw_json?.method !== "linear_ramp_pre_snapshot" &&
      r.raw_json?.method !== "weighted_ramp_pre_snapshot",
  );

  if (realSnaps.length === 0) {
    console.error(
      `[mailchimp-tag-history] event=${event.id} no real snapshots found; run syncMailchimpTagForEvent first`,
    );
    return { ok: false, rowsWritten: 0, error: "no_real_snapshots" };
  }

  // Latest value per calendar day (ascending sort means last write wins)
  const latestPerDay = new Map<string, number>();
  for (const row of realSnaps) {
    const day = row.snapshot_at.slice(0, 10);
    if (row.email_subscribers != null) {
      latestPerDay.set(day, row.email_subscribers);
    }
  }

  const sortedSnapshotDays = [...latestPerDay.keys()].sort();
  const firstSnapshotDay = sortedSnapshotDays[0]!;
  const firstSnapshotValue = latestPerDay.get(firstSnapshotDay)!;
  const lastSnapshotDay = sortedSnapshotDays[sortedSnapshotDays.length - 1]!;

  // ── Step 2: Find campaign start (first day with real activity) ──────────
  // Use the first day where at least one spend or impression column is
  // non-zero. This skips zero-activity placeholder rows that Supabase can
  // create from event.created_at forward — which would otherwise push the
  // ramp start back weeks or months before the campaign actually launched.
  const { data: firstRollupRows } = await sb
    .from("event_daily_rollups")
    .select("date")
    .eq("event_id", event.id)
    .or(
      "ad_spend.gt.0,meta_impressions.gt.0,tiktok_impressions.gt.0,google_ads_impressions.gt.0",
    )
    .order("date", { ascending: true })
    .limit(1);

  const firstRollupDay: string | null =
    (firstRollupRows as Array<{ date: string }> | null)?.[0]?.date ?? null;

  const campaignStart =
    firstRollupDay && firstRollupDay < firstSnapshotDay
      ? addDaysUtcStr(firstRollupDay, -1) // start one day BEFORE first activity
      : null; // null → no pre-snapshot gap

  // ── Step 3: Build weighted-ramp rows for the pre-snapshot window ─────────
  // The ramp spans [campaignStart, firstSnapshotDay) — i.e. campaignStart is
  // the day BEFORE first real ad activity. This ensures the launch day itself
  // gets a non-zero estimate rather than being stuck at 0.
  //
  // Weights: WEIGHTED_RAMP_WEIGHTS[0] = 0.0, [1] = 0.40, [2] = 0.75.
  // Days beyond index 2 stay at 0.75 so the curve never exceeds the
  // first real snapshot but also never drops back to zero.
  const rampRows: Array<{
    user_id: string;
    event_id: string;
    client_id: string | null;
    mailchimp_audience_id: string;
    mailchimp_tag: string;
    total_contacts: number;
    email_subscribers: number;
    snapshot_at: string;
    raw_json: object;
  }> = [];

  if (campaignStart) {
    const preDays = dayDiffUtc(campaignStart, firstSnapshotDay); // exclusive end
    for (let i = 0; i < preDays; i++) {
      const day = addDaysUtcStr(campaignStart, i);
      const weight =
        WEIGHTED_RAMP_WEIGHTS[Math.min(i, WEIGHTED_RAMP_WEIGHTS.length - 1)]!;
      const cumulative = Math.round(firstSnapshotValue * weight);
      rampRows.push({
        user_id: event.user_id,
        event_id: event.id,
        client_id: event.client_id ?? null,
        mailchimp_audience_id: audienceId,
        mailchimp_tag: event.mailchimp_tag,
        total_contacts: cumulative,
        email_subscribers: cumulative,
        snapshot_at: `${day}T12:00:00Z`,
        raw_json: {
          source: "mailchimp_tag_daily_history",
          method: "weighted_ramp_pre_snapshot",
          ramp_target: firstSnapshotValue,
          ramp_anchor_day: firstSnapshotDay,
        },
      });
    }
  }

  // ── Step 4: Delete ALL existing _daily_history rows (cleanup) ─────────────
  // This removes PR #622's backwards-walk rows AND any previous ramp rows.
  const { error: deleteError } = await sb
    .from("mailchimp_tag_snapshots")
    .delete()
    .eq("event_id", event.id)
    .eq("raw_json->>source", "mailchimp_tag_daily_history");

  if (deleteError) {
    console.error(
      `[mailchimp-tag-history] event=${event.id} delete error: ${deleteError.message}`,
    );
    return { ok: false, rowsWritten: 0, error: `delete: ${deleteError.message}` };
  }

  // ── Step 5: Insert ramp rows (if any) ────────────────────────────────────
  if (rampRows.length === 0) {
    console.error(
      `[mailchimp-tag-history] event=${event.id} no pre-snapshot gap (firstSnapshot=${firstSnapshotDay}); cleaned up _daily_history rows`,
    );
    return { ok: true, rowsWritten: 0, firstDate: firstSnapshotDay, lastDate: lastSnapshotDay };
  }

  const { error: insertError } = await sb
    .from("mailchimp_tag_snapshots")
    .insert(rampRows);

  if (insertError) {
    console.error(
      `[mailchimp-tag-history] event=${event.id} insert error: ${insertError.message}`,
    );
    return { ok: false, rowsWritten: 0, error: `insert: ${insertError.message}` };
  }

  const firstDate = rampRows[0]!.snapshot_at.slice(0, 10);
  const lastDate = rampRows[rampRows.length - 1]!.snapshot_at.slice(0, 10);

  // console.error so Vercel surfaces it reliably (console.log filtered under load).
  console.error(
    `[mailchimp-tag-history] event=${event.id} wrote ${rampRows.length} linear-ramp rows ${firstDate}..${lastDate} → ${firstSnapshotDay}:${firstSnapshotValue}`,
  );
  return { ok: true, rowsWritten: rampRows.length, firstDate, lastDate };
}
