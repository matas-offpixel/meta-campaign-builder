import { createClient } from "@/lib/supabase/client";

// ─── Types ───────────────────────────────────────────────────────────────────
//
// Hand-typed (rather than via Tables<"event_key_moments"> from the
// generated database.types.ts) because the types file is a snapshot
// and this table only exists after migration 008 is applied + types
// regenerated. Once that's done these can be swapped for Tables<>
// imports without changing call sites — same pattern as ad-plans.ts.

export type EventKeyMomentCategory = "phase" | "lineup" | "press" | "custom";
export type EventKeyMomentSource = "auto" | "manual";

export interface EventKeyMoment {
  id: string;
  user_id: string;
  event_id: string;
  /** YYYY-MM-DD */
  moment_date: string;
  label: string;
  category: EventKeyMomentCategory;
  source: EventKeyMomentSource;
  /**
   * Forward-compat hook for future pacing logic that wants to lift
   * spend on key dates (e.g. lineup drop = 1.5×). Null means no
   * multiplier; the pacing engine ignores it for now.
   */
  budget_multiplier: number | null;
  created_at: string;
  updated_at: string;
}

// ─── Auto-seed table ─────────────────────────────────────────────────────────
//
// Single source of truth for the time-based phase markers. Offsets are
// in days; a positive integer means N days BEFORE the event (since the
// event is the anchor). 0 = event day. Adding/removing entries here
// flows through to every event that gets a regenerate call — manual
// rows are untouched.

interface AutoMomentSpec {
  offsetDays: number;
  label: string;
}

const AUTO_PHASE_MOMENTS: ReadonlyArray<AutoMomentSpec> = [
  { offsetDays: 90, label: "3 months to go" },
  { offsetDays: 60, label: "2 months to go" },
  { offsetDays: 30, label: "1 month to go" },
  { offsetDays: 14, label: "2 weeks to go" },
  { offsetDays: 10, label: "10 days to go" },
  { offsetDays: 7, label: "1 week to go" },
  { offsetDays: 3, label: "3 days to go" },
  { offsetDays: 0, label: "Event Day" },
] as const;

export const AUTO_MOMENT_COUNT = AUTO_PHASE_MOMENTS.length;

// ─── Date helpers (local-tz, mirror lib/dashboard/pacing.ts) ────────────────

function parseLocalDate(ymd: string): Date {
  return new Date(ymd + "T00:00:00");
}

function fmtLocalDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isoToYmd(iso: string | null | undefined): string | null {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return fmtLocalDate(d);
}

/**
 * Compute the canonical auto-moment dates for an event_date.
 * Pure — no DB. Exported so the backfill script + tests can use it
 * without needing a Supabase client.
 */
export function computeAutoMoments(
  eventDateIso: string,
): Array<{ moment_date: string; label: string }> {
  const ymd = isoToYmd(eventDateIso);
  if (!ymd) return [];
  const eventDay = parseLocalDate(ymd);
  return AUTO_PHASE_MOMENTS.map((m) => {
    const d = new Date(eventDay);
    d.setDate(d.getDate() - m.offsetDays);
    return { moment_date: fmtLocalDate(d), label: m.label };
  });
}

// ─── Read ────────────────────────────────────────────────────────────────────

/**
 * List every moment for one event, ordered by date. Used by the plan
 * grid to overlay moment labels in the Day column.
 */
export async function listMomentsForEvent(
  eventId: string,
): Promise<EventKeyMoment[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("event_key_moments")
    .select("*")
    .eq("event_id", eventId)
    .order("moment_date", { ascending: true });

  if (error) {
    console.warn("Supabase listMomentsForEvent error:", error.message);
    return [];
  }
  return (data ?? []) as EventKeyMoment[];
}

// ─── Auto-seed (regenerate) ──────────────────────────────────────────────────

/**
 * Wipe every source='auto' row for `eventId` and insert a fresh set
 * computed from `eventDate`. source='manual' rows are untouched —
 * Matas's curated lineup / press / custom moments survive an event
 * date change.
 *
 * Safe to call from create + update paths in lib/db/events.ts. If
 * `eventDate` is null we still wipe stale auto rows but insert nothing
 * (no anchor → no offsets to compute). Errors are surfaced to the
 * caller via throw so a failed regenerate doesn't silently leave a
 * half-seeded set behind.
 */
export async function regenerateAutoMoments(args: {
  eventId: string;
  userId: string;
  /**
   * ISO date (YYYY-MM-DD or full timestamp). Null wipes existing auto
   * rows without re-seeding — the right behaviour when the event date
   * is cleared.
   */
  eventDate: string | null;
}): Promise<EventKeyMoment[]> {
  const { eventId, userId, eventDate } = args;
  const supabase = createClient();

  // Wipe first so a half-seeded run leaves a clean (empty) state.
  const { error: delErr } = await supabase
    .from("event_key_moments")
    .delete()
    .eq("event_id", eventId)
    .eq("source", "auto");
  if (delErr) {
    console.warn("Supabase regenerateAutoMoments delete error:", delErr.message);
    throw delErr;
  }

  if (!eventDate) return [];

  const moments = computeAutoMoments(eventDate);
  if (moments.length === 0) return [];

  const rows = moments.map((m) => ({
    user_id: userId,
    event_id: eventId,
    moment_date: m.moment_date,
    label: m.label,
    category: "phase" as const,
    source: "auto" as const,
    budget_multiplier: null,
  }));

  const { data, error: insErr } = await supabase
    .from("event_key_moments")
    .insert(rows)
    .select("*");
  if (insErr) {
    console.warn("Supabase regenerateAutoMoments insert error:", insErr.message);
    throw insErr;
  }
  return (data ?? []) as EventKeyMoment[];
}
