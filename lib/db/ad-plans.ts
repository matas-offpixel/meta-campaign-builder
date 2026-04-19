import { createClient } from "@/lib/supabase/client";
import type { EventRow } from "@/lib/db/events";
import type { ObjectiveBudgets } from "@/lib/dashboard/objectives";

// ─── Types ───────────────────────────────────────────────────────────────────
//
// Hand-typed (rather than via Tables<"ad_plans"> from the generated
// database.types.ts) because the types file is a snapshot and the new
// tables only exist after migration 005 is applied + types regenerated.
// Once that's done these can be swapped for Tables<> imports without
// changing call sites.

export type AdPlanStatus = "draft" | "live" | "completed" | "archived";

export const AD_PLAN_STATUSES: AdPlanStatus[] = [
  "draft",
  "live",
  "completed",
  "archived",
];

export interface AdPlan {
  id: string;
  user_id: string;
  event_id: string;
  name: string;
  status: AdPlanStatus;
  total_budget: number | null;
  ticket_target: number | null;
  landing_page_url: string | null;
  /** YYYY-MM-DD */
  start_date: string;
  /** YYYY-MM-DD */
  end_date: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdPlanDay {
  id: string;
  plan_id: string;
  user_id: string;
  /** YYYY-MM-DD */
  day: string;
  phase_marker: string | null;
  allocation_pct: number | null;
  objective_budgets: ObjectiveBudgets;
  tickets_sold_cumulative: number | null;
  /**
   * Per-day ticket target. Null means "use the plan-level even-spread
   * default" — the grid renders a faded ghost in that case. Explicit
   * zero is meaningful (no target that day).
   */
  ticket_target: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdPlanAudience {
  id: string;
  plan_id: string;
  user_id: string;
  sort_order: number;
  objective: string;
  geo_bucket: string | null;
  city: string | null;
  location: string | null;
  proximity_km: number | null;
  age_min: number | null;
  age_max: number | null;
  placements: string[];
  daily_budget: number | null;
  total_budget: number | null;
  audience_name: string | null;
  info: string | null;
  created_at: string;
  updated_at: string;
}

/** Patch shape for updatePlanDay. objective_budgets is replaced wholesale. */
export type AdPlanDayPatch = Partial<
  Pick<
    AdPlanDay,
    | "phase_marker"
    | "allocation_pct"
    | "objective_budgets"
    | "tickets_sold_cumulative"
    | "ticket_target"
    | "notes"
  >
>;

/** Bulk-update item — must include id so the upsert routes by primary key. */
export type AdPlanDayBulkPatch = AdPlanDayPatch & { id: string };

/**
 * Patch shape for updatePlan. Whitelisted to the header-editable fields +
 * status/name so callers can't accidentally mutate dates / IDs from the
 * inline-edit path.
 */
export type AdPlanPatch = Partial<
  Pick<
    AdPlan,
    "total_budget" | "ticket_target" | "landing_page_url" | "name" | "status"
  >
>;

// ─── Date helpers (local, lightweight) ───────────────────────────────────────
//
// Plan dates are date-only strings and must be compared at calendar-day
// granularity, not by ms. parseLocalDate / fmtLocalDate keep us in the
// local-midnight regime so YYYY-MM-DD strings round-trip cleanly.

function parseLocalDate(ymd: string): Date {
  return new Date(ymd + "T00:00:00");
}

function fmtLocalDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayYmd(): string {
  return fmtLocalDate(new Date());
}

function addDays(ymd: string, days: number): string {
  const d = parseLocalDate(ymd);
  d.setDate(d.getDate() + days);
  return fmtLocalDate(d);
}

function isoToYmd(iso: string | null | undefined): string | null {
  if (!iso) return null;
  // event.event_date is already YYYY-MM-DD; the timestamptz milestones
  // need to be coerced to the local calendar day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return fmtLocalDate(d);
}

/**
 * Build the ordered list of YYYY-MM-DD strings from start through end
 * inclusive. Caller guarantees end >= start (DB constraint anyway).
 */
function expandDateRange(start: string, end: string): string[] {
  const out: string[] = [];
  let cursor = start;
  // Belt-and-braces guard: cap at 365 days so a malformed end never
  // produces an unbounded loop (the DB constraint catches it too).
  let safety = 0;
  while (cursor <= end && safety < 366) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
    safety += 1;
  }
  return out;
}

// ─── Phase-marker seeding ────────────────────────────────────────────────────
//
// Apply on plan creation only. Never overwrite an existing phase_marker.
// "Final push" (event_date - 10) and "Final month" (event_date - 30) are
// only applied when their day doesn't already collide with one of the
// four authoritative milestones.

interface PhaseSeed {
  day: string;
  marker: string;
}

function buildPhaseSeeds(event: EventRow): PhaseSeed[] {
  if (!event.event_date) return [];

  const eventDay = event.event_date;
  const announceDay = isoToYmd(event.announcement_at);
  const presaleDay = isoToYmd(event.presale_at);
  const generalDay = isoToYmd(event.general_sale_at);

  // Authoritative milestones first — they take precedence on collision.
  const seeds: PhaseSeed[] = [];
  const claimed = new Set<string>();

  const claim = (day: string | null, marker: string) => {
    if (!day || claimed.has(day)) return;
    seeds.push({ day, marker });
    claimed.add(day);
  };

  claim(announceDay, "Announce");
  claim(presaleDay, "Pre-sale");
  claim(generalDay, "Gen sale");
  claim(eventDay, "Event day");

  // Derived markers — skip if the day is already taken by a real milestone.
  claim(addDays(eventDay, -10), "Final push");
  claim(addDays(eventDay, -30), "Final month");

  return seeds;
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/**
 * Most recent non-archived plan for an event, or null.
 * Archived plans are excluded so they don't shadow a live replacement —
 * archiving is explicit user intent to drop the plan from the active view.
 */
export async function getPlanByEventId(
  eventId: string,
): Promise<AdPlan | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("ad_plans")
    .select("*")
    .eq("event_id", eventId)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("Supabase getPlanByEventId error:", error.message);
    return null;
  }
  return (data as AdPlan | null) ?? null;
}

export async function listDaysForPlan(planId: string): Promise<AdPlanDay[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("ad_plan_days")
    .select("*")
    .eq("plan_id", planId)
    .order("day", { ascending: true });

  if (error) {
    console.warn("Supabase listDaysForPlan error:", error.message);
    return [];
  }
  return (data ?? []) as AdPlanDay[];
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export class CreatePlanError extends Error {
  constructor(
    message: string,
    public code: "no_event_date" | "no_user" | "insert_failed",
  ) {
    super(message);
    this.name = "CreatePlanError";
  }
}

/**
 * Create a plan for an event and seed one ad_plan_days row per day from
 * COALESCE(announcement_at::date, today()) through event_date inclusive.
 *
 * Returns the persisted plan + days so the caller can render immediately
 * without a follow-up read.
 *
 * Failure modes:
 *  - event.event_date is null → throws CreatePlanError("no_event_date")
 *  - no authenticated session → throws CreatePlanError("no_user")
 *  - insert returns an error from PostgREST → throws CreatePlanError
 *    ("insert_failed") with the underlying message
 */
export async function createPlanForEvent(event: EventRow): Promise<{
  plan: AdPlan;
  days: AdPlanDay[];
}> {
  if (!event.event_date) {
    throw new CreatePlanError(
      "Event needs a date before a plan can be created.",
      "no_event_date",
    );
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new CreatePlanError("Not signed in.", "no_user");
  }

  const startDate = isoToYmd(event.announcement_at) ?? todayYmd();
  // Past event_date is allowed — retrospective plans are a real use case.
  const endDate = event.event_date;
  // If announcement is somehow after the event, clamp start_date to event_date
  // so the DB constraint passes; user can edit later.
  const effectiveStart = startDate <= endDate ? startDate : endDate;

  const { data: planRow, error: planErr } = await supabase
    .from("ad_plans")
    .insert({
      user_id: user.id,
      event_id: event.id,
      name: `${event.name} — Ad Plan`,
      status: "draft",
      start_date: effectiveStart,
      end_date: endDate,
      // Inherit the event's marketing budget so the plan opens with a
      // working total instead of "—". Null when the event leaves it blank;
      // the user can set/override it directly on the plan header.
      total_budget: event.budget_marketing ?? null,
    })
    .select("*")
    .single();

  if (planErr || !planRow) {
    throw new CreatePlanError(
      planErr?.message ?? "Failed to create plan.",
      "insert_failed",
    );
  }
  const plan = planRow as AdPlan;

  // Day seeding ------------------------------------------------------------
  const dateRange = expandDateRange(effectiveStart, endDate);
  const seeds = new Map(buildPhaseSeeds(event).map((s) => [s.day, s.marker]));

  const dayInserts = dateRange.map((day) => ({
    plan_id: plan.id,
    user_id: user.id,
    day,
    phase_marker: seeds.get(day) ?? null,
    objective_budgets: {},
  }));

  const { data: dayRows, error: daysErr } = await supabase
    .from("ad_plan_days")
    .insert(dayInserts)
    .select("*")
    .order("day", { ascending: true });

  if (daysErr) {
    // Best-effort cleanup so we don't leave an orphan plan with no days.
    // If this also fails the user gets a no-days state next render and
    // can delete + recreate; the error is logged either way.
    await supabase.from("ad_plans").delete().eq("id", plan.id);
    throw new CreatePlanError(
      daysErr.message ?? "Failed to seed plan days.",
      "insert_failed",
    );
  }

  return {
    plan,
    days: (dayRows ?? []) as AdPlanDay[],
  };
}

/**
 * Update a single plan row. Caller resolves with the persisted record so
 * the optimistic local mirror can sync to the canonical updated_at.
 */
export async function updatePlan(
  id: string,
  patch: AdPlanPatch,
): Promise<AdPlan> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("ad_plans")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to update plan.");
  }
  return data as AdPlan;
}

export async function updatePlanDay(
  dayId: string,
  patch: AdPlanDayPatch,
): Promise<AdPlanDay> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("ad_plan_days")
    .update(patch)
    .eq("id", dayId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to update plan day.");
  }
  return data as AdPlanDay;
}

/**
 * Bulk update for paste / drag-fill. One round-trip per call; PostgREST
 * doesn't expose a true multi-row update so we fan out parallel updates
 * keyed by id and await all. Each patch must include the id of the row
 * to update.
 *
 * Returns the updated rows so the caller can replace its local mirror
 * without a follow-up read.
 */
export async function bulkUpdatePlanDays(
  patches: AdPlanDayBulkPatch[],
): Promise<AdPlanDay[]> {
  if (patches.length === 0) return [];
  const supabase = createClient();

  const settled = await Promise.all(
    patches.map(async ({ id, ...patch }) => {
      const { data, error } = await supabase
        .from("ad_plan_days")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? `Failed to update day ${id}.`);
      }
      return data as AdPlanDay;
    }),
  );

  return settled;
}

export async function deletePlan(planId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("ad_plans").delete().eq("id", planId);
  if (error) {
    throw new Error(error.message);
  }
}

// ─── Resync ──────────────────────────────────────────────────────────────────

export class ResyncPlanError extends Error {
  constructor(
    message: string,
    public code:
      | "no_event_date"
      | "event_not_found"
      | "plan_not_found"
      | "update_failed",
  ) {
    super(message);
    this.name = "ResyncPlanError";
  }
}

/**
 * Re-pull plan-level values from the source event:
 *  - total_budget ← event.budget_marketing (only when set)
 *  - ticket_target ← event.capacity (only when set)
 *  - phase_marker on every day is cleared, then re-seeded from
 *    buildPhaseSeeds(event) — the same logic createPlanForEvent uses.
 *
 * Per-day edits are preserved: objective_budgets, tickets_sold_cumulative,
 * ticket_target (per-day), and notes are never touched.
 *
 * Reuses buildPhaseSeeds so creation + resync share one source of truth
 * for the milestone calendar — moving an event's announcement_at then
 * resyncing produces the same markers a fresh plan would seed today.
 */
export async function resyncPlanFromEvent(
  planId: string,
  eventId: string,
): Promise<void> {
  const supabase = createClient();

  // Pull the event row directly rather than going through getEventById
  // (which joins clients we don't need here). Keeps the resync path
  // independent of unrelated lib/db/events surface area.
  const { data: eventRow, error: eventErr } = await supabase
    .from("events")
    .select(
      "id, event_date, announcement_at, presale_at, general_sale_at, budget_marketing, capacity",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (eventErr) {
    throw new ResyncPlanError(eventErr.message, "event_not_found");
  }
  if (!eventRow) {
    throw new ResyncPlanError("Event not found.", "event_not_found");
  }
  if (!eventRow.event_date) {
    throw new ResyncPlanError(
      "Event needs a date before its plan can be resynced.",
      "no_event_date",
    );
  }

  const event = eventRow as Pick<
    EventRow,
    | "id"
    | "event_date"
    | "announcement_at"
    | "presale_at"
    | "general_sale_at"
    | "budget_marketing"
    | "capacity"
  >;

  // Plan-level patch: only overwrite fields the event actually carries.
  // Skipping nulls preserves manually-typed plan values when the event
  // leaves the field blank — matches the spec's "(if set)" guard.
  const planPatch: AdPlanPatch = {};
  if (event.budget_marketing != null) {
    planPatch.total_budget = event.budget_marketing;
  }
  if (event.capacity != null) {
    planPatch.ticket_target = event.capacity;
  }

  if (Object.keys(planPatch).length > 0) {
    const { error: planErr } = await supabase
      .from("ad_plans")
      .update(planPatch)
      .eq("id", planId);
    if (planErr) {
      throw new ResyncPlanError(planErr.message, "update_failed");
    }
  }

  // Phase-marker recompute: clean slate then re-seed. Per the slice
  // spec, this is destructive on phase_marker (user consented via the
  // confirm dialog upstream). Other day-level fields are untouched.
  const { data: dayRows, error: daysErr } = await supabase
    .from("ad_plan_days")
    .select("id, day")
    .eq("plan_id", planId);

  if (daysErr) {
    throw new ResyncPlanError(daysErr.message, "update_failed");
  }

  const seeds = new Map(
    buildPhaseSeeds(event as EventRow).map((s) => [s.day, s.marker]),
  );

  // Fan out updates in parallel — same pattern as bulkUpdatePlanDays.
  await Promise.all(
    (dayRows ?? []).map(async (row) => {
      const { id, day } = row as { id: string; day: string };
      const next = seeds.get(day) ?? null;
      const { error } = await supabase
        .from("ad_plan_days")
        .update({ phase_marker: next })
        .eq("id", id);
      if (error) {
        throw new ResyncPlanError(error.message, "update_failed");
      }
    }),
  );
}
