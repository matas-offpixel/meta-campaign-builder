/**
 * lib/dashboard/event-recency.ts
 *
 * Helpers for classifying events and venue groups as "past" vs "active"
 * on the client dashboard.
 *
 * "Past" is intentionally generous: an event that finished yesterday is
 * NOT considered past — it stays visible in the active section for one
 * full day after the event date so operators working on next-day
 * reporting don't lose their data. Only events strictly older than
 * PAST_THRESHOLD_DAYS are hidden by default.
 *
 * All date comparisons use Europe/London (BST/GMT) so UK-based clients
 * see "today" as their local day, not UTC midnight.
 *
 * Both helpers are pure functions that accept an optional `now: Date`
 * so tests can inject a fixed clock.
 */

/** Days grace period before an event is considered "past". */
export const PAST_THRESHOLD_DAYS = 1;

/**
 * Returns today's date (YYYY-MM-DD) in the Europe/London timezone.
 * BST (UTC+1) May–Oct, GMT (UTC+0) Oct–Mar.
 */
export function londonTodayIso(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD natively — zero-fills month + day so
  // lexicographic comparison is safe without further parsing.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Returns true when `event_date` is strictly before
 * (today in Europe/London) − PAST_THRESHOLD_DAYS.
 *
 * Practically: an event from 2+ days ago is past; yesterday's event,
 * today's event, and any future event are NOT past. Null `event_date`
 * is treated as NOT past so events without a date stay visible.
 */
export function isPastEvent(
  event_date: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!event_date) return false;
  // Normalise to YYYY-MM-DD; event_date may carry a time component.
  const ymd = event_date.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  if (!ymd) return false;
  const eventDay = ymd[1];

  const todayLondon = londonTodayIso(now);
  const todayMs = Date.parse(`${todayLondon}T00:00:00Z`);
  if (!Number.isFinite(todayMs)) return false;

  const thresholdMs = todayMs - PAST_THRESHOLD_DAYS * 86_400_000;
  const thresholdDay = new Date(thresholdMs).toISOString().slice(0, 10);

  // Lexicographic comparison on ISO dates is correct.
  return eventDay < thresholdDay;
}

/**
 * Returns true ONLY when EVERY event in the group is past.
 *
 * An empty group is not considered past (defensive — should not occur
 * in practice because the loader filters out venues with no events).
 *
 * This is the single source of truth for group-level recency: both the
 * server-side topline aggregation and the client-side venue table use
 * this helper, not their own inline logic, so the two surfaces always
 * agree on which groups belong in the "Past Events" section.
 */
export function isPastVenueGroup(
  events: ReadonlyArray<{ event_date: string | null | undefined }>,
  now: Date = new Date(),
): boolean {
  if (events.length === 0) return false;
  return events.every((ev) => isPastEvent(ev.event_date, now));
}

// ─── Cancellation helpers ──────────────────────────────────────────────────

/**
 * Returns true when the event's `status` field equals `'cancelled'`.
 * Treats absent / null status as NOT cancelled, preserving backwards
 * compatibility with legacy event rows that predate the status column.
 *
 * Cancellation takes priority over all recency logic — a cancelled event
 * with a future date still belongs in the Cancelled section, not Active.
 */
export function isCancelledEvent(event: {
  status?: string | null;
}): boolean {
  return event.status === "cancelled";
}

/**
 * Returns true ONLY when EVERY event in the group is cancelled.
 *
 * If any fixture in a multi-event group is NOT cancelled, the whole
 * group stays in whichever bucket its non-cancelled events qualify for
 * (active or past). This is the group-level counterpart of
 * `isCancelledEvent` and mirrors `isPastVenueGroup`'s semantics.
 *
 * Priority: cancelled > past > active. A venue group where every event
 * has `status='cancelled'` goes to the Cancelled accordion regardless
 * of its `event_date`s.
 */
export function isCancelledVenueGroup(
  events: ReadonlyArray<{ status?: string | null }>,
): boolean {
  if (events.length === 0) return false;
  return events.every((ev) => isCancelledEvent(ev));
}
