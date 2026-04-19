import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  OverviewActivity,
  OverviewFilter,
  OverviewPhaseMarker,
  OverviewRow,
  PhasePillColor,
} from "@/lib/types/overview";

/**
 * Server-side data layer for the campaign overview dashboard.
 *
 * Pulls every event for `userId`, joins the parent client + the
 * latest non-archived ad plan + the most-recent ad_plan_days row
 * (for tickets-sold cumulative + phase marker) + the most-recent
 * client_report_weekly_snapshots row + the next two upcoming
 * event_key_moments rows.
 *
 * Spend is intentionally NOT fetched here — those columns stay null
 * until the client clicks "Load Stats", which fans out into the
 * /api/overview/stats route.
 *
 * Strategy: one round-trip per join (events → clients via PostgREST
 * embed; ad_plans → ad_plan_days → snapshots → moments via separate
 * .in() queries fired in parallel). Bulk grouping happens in memory.
 */

export async function listOverviewEvents(
  userId: string,
  filter: OverviewFilter,
): Promise<OverviewRow[]> {
  const supabase = await createClient();

  const todayUtc = new Date();
  const todayYmd = ymd(todayUtc);

  let q = supabase
    .from("events")
    .select(
      "id, name, event_date, event_code, venue_name, venue_city, capacity, budget_marketing, tickets_sold, client:clients ( id, name, slug, primary_type, meta_ad_account_id )",
    )
    .eq("user_id", userId);

  q = filter === "future"
    ? q.gte("event_date", todayYmd).order("event_date", { ascending: true, nullsFirst: false })
    : q.lt("event_date", todayYmd).order("event_date", { ascending: false, nullsFirst: false });

  const { data: eventRows, error } = await q;
  if (error) {
    console.warn("[overview-server] events fetch error:", error.message);
    return [];
  }
  // PostgREST embed types `client` as an array even when the FK is
  // many-to-one; the actual payload is one object per event. Cast via
  // `unknown` after normalising the embed shape so call sites get a
  // single client object (or null).
  const events: OverviewEventBase[] = (eventRows ?? []).map((row) => {
    const raw = row as unknown as Omit<OverviewEventBase, "client"> & {
      client:
        | OverviewEventBase["client"]
        | NonNullable<OverviewEventBase["client"]>[]
        | null;
    };
    const clientRel = Array.isArray(raw.client)
      ? raw.client[0] ?? null
      : raw.client;
    return { ...raw, client: clientRel };
  });
  if (events.length === 0) return [];

  const eventIds = events.map((e) => e.id);

  // Fan out the four secondary fetches in parallel — they don't
  // depend on each other; only the final assemble pass does.
  const [plansById, dayByPlanId, snapshotByEvent, momentsByEvent] =
    await Promise.all([
      fetchLatestPlanByEvent(supabase, eventIds),
      Promise.resolve(null), // placeholder, replaced after plans resolve
      fetchLatestSnapshotByEvent(supabase, eventIds),
      fetchUpcomingMomentsByEvent(supabase, eventIds, todayYmd),
    ]);

  // Now that we know the plan ids, fetch the most-recent day per plan.
  const planIds = Array.from(plansById.values()).map((p) => p.id);
  const daysByPlan = planIds.length > 0
    ? await fetchLatestDayByPlan(supabase, planIds, todayYmd)
    : new Map<string, AdPlanDayLite>();
  // Suppress the unused dayByPlanId placeholder so eslint stays quiet.
  void dayByPlanId;

  return events.map((e) => {
    const client = e.client;
    const plan = plansById.get(e.id) ?? null;
    const day = plan ? daysByPlan.get(plan.id) ?? null : null;
    const snap = snapshotByEvent.get(e.id) ?? null;
    const upcomingMoments = momentsByEvent.get(e.id) ?? [];

    const tickets = resolveTicketsSold({
      snapshot: snap?.tickets_sold ?? null,
      planDay: day?.tickets_sold_cumulative ?? null,
      legacy: e.tickets_sold,
    });

    const daysUntil = computeDaysUntil(e.event_date, todayUtc);
    const nextPhase = resolveNextPhase({ planDay: day, moments: upcomingMoments });
    const nextActivity = resolveNextActivity(upcomingMoments, nextPhase);

    return {
      event_id: e.id,
      event_date: e.event_date,
      name: e.name,
      venue_name: e.venue_name,
      venue_city: e.venue_city,
      event_code: e.event_code,
      capacity: e.capacity,
      tickets_sold: tickets,
      budget_marketing: e.budget_marketing,
      days_until: daysUntil,
      next_phase: nextPhase,
      next_activity: nextActivity,
      client: client
        ? {
            id: client.id,
            name: client.name,
            slug: client.slug,
            primary_type: client.primary_type,
          }
        : null,
      meta_ad_account_id: client?.meta_ad_account_id ?? null,
      spend_total: null,
      spend_yesterday: null,
      budget_left: null,
      left_per_day: null,
    } satisfies OverviewRow;
  });
}

// ─── Sub-fetchers ─────────────────────────────────────────────────

interface OverviewEventBase {
  id: string;
  name: string;
  event_date: string | null;
  event_code: string | null;
  venue_name: string | null;
  venue_city: string | null;
  capacity: number | null;
  budget_marketing: number | null;
  tickets_sold: number | null;
  client: {
    id: string;
    name: string;
    slug: string | null;
    primary_type: string | null;
    meta_ad_account_id: string | null;
  } | null;
}

interface AdPlanLite {
  id: string;
  event_id: string;
  status: string | null;
  total_budget: number | null;
  created_at: string;
}

interface AdPlanDayLite {
  id: string;
  plan_id: string;
  day: string;
  phase_marker: string | null;
  tickets_sold_cumulative: number | null;
}

interface SnapshotLite {
  event_id: string;
  tickets_sold: number | null;
  captured_at: string;
}

interface MomentLite {
  event_id: string;
  moment_date: string;
  label: string;
  category: string | null;
}

/** Latest non-archived ad_plan per event_id, keyed by event_id. */
async function fetchLatestPlanByEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventIds: string[],
): Promise<Map<string, AdPlanLite>> {
  const out = new Map<string, AdPlanLite>();
  const { data, error } = await supabase
    .from("ad_plans")
    .select("id, event_id, status, total_budget, created_at")
    .in("event_id", eventIds)
    .neq("status", "archived")
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[overview-server] plans fetch error:", error.message);
    return out;
  }
  for (const row of (data ?? []) as AdPlanLite[]) {
    if (!out.has(row.event_id)) out.set(row.event_id, row);
  }
  return out;
}

/**
 * For each plan id, return the row whose `day` is today, or — failing
 * that — the most-recent day on or before today. Two-pass select:
 * "today exact" then "most recent before today" so we never look at a
 * future day's targets when summarising current state.
 */
async function fetchLatestDayByPlan(
  supabase: Awaited<ReturnType<typeof createClient>>,
  planIds: string[],
  todayYmd: string,
): Promise<Map<string, AdPlanDayLite>> {
  const out = new Map<string, AdPlanDayLite>();
  const { data, error } = await supabase
    .from("ad_plan_days")
    .select("id, plan_id, day, phase_marker, tickets_sold_cumulative")
    .in("plan_id", planIds)
    .lte("day", todayYmd)
    .order("day", { ascending: false });
  if (error) {
    console.warn("[overview-server] plan_days fetch error:", error.message);
    return out;
  }
  for (const row of (data ?? []) as AdPlanDayLite[]) {
    if (!out.has(row.plan_id)) out.set(row.plan_id, row);
  }
  return out;
}

async function fetchLatestSnapshotByEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventIds: string[],
): Promise<Map<string, SnapshotLite>> {
  const out = new Map<string, SnapshotLite>();
  const { data, error } = await supabase
    .from("client_report_weekly_snapshots")
    .select("event_id, tickets_sold, captured_at")
    .in("event_id", eventIds)
    .order("captured_at", { ascending: false });
  if (error) {
    console.warn("[overview-server] snapshots fetch error:", error.message);
    return out;
  }
  for (const row of (data ?? []) as SnapshotLite[]) {
    if (!out.has(row.event_id)) out.set(row.event_id, row);
  }
  return out;
}

async function fetchUpcomingMomentsByEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventIds: string[],
  todayYmd: string,
): Promise<Map<string, MomentLite[]>> {
  const out = new Map<string, MomentLite[]>();
  const { data, error } = await supabase
    .from("event_key_moments")
    .select("event_id, moment_date, label, category")
    .in("event_id", eventIds)
    .gte("moment_date", todayYmd)
    .order("moment_date", { ascending: true });
  if (error) {
    console.warn("[overview-server] moments fetch error:", error.message);
    return out;
  }
  for (const row of (data ?? []) as MomentLite[]) {
    const list = out.get(row.event_id) ?? [];
    if (list.length >= 2) continue;
    list.push(row);
    out.set(row.event_id, list);
  }
  return out;
}

// ─── Resolvers ────────────────────────────────────────────────────

function resolveTicketsSold(args: {
  snapshot: number | null;
  planDay: number | null;
  legacy: number | null;
}): number | null {
  if (args.snapshot !== null) return args.snapshot;
  if (args.planDay !== null) return args.planDay;
  if (args.legacy !== null) return args.legacy;
  return null;
}

/**
 * Pick the next phase marker for the table pill. Source priority:
 *   1. Plan-day phase_marker for today (matches what the Plan tab shows).
 *   2. Earliest upcoming event_key_moment whose category is 'phase'.
 */
function resolveNextPhase(args: {
  planDay: AdPlanDayLite | null;
  moments: MomentLite[];
}): OverviewPhaseMarker | null {
  if (args.planDay?.phase_marker) {
    return {
      name: args.planDay.phase_marker,
      date: args.planDay.day,
      color: phaseColor(args.planDay.phase_marker),
    };
  }
  const phaseMoment = args.moments.find((m) => m.category === "phase");
  if (phaseMoment) {
    return {
      name: phaseMoment.label,
      date: phaseMoment.moment_date,
      color: phaseColor(phaseMoment.label),
    };
  }
  return null;
}

/**
 * The next non-phase moment that isn't the same row we already
 * surfaced as next_phase. Falls back to the very next moment when no
 * disambiguation is needed.
 */
function resolveNextActivity(
  moments: MomentLite[],
  nextPhase: OverviewPhaseMarker | null,
): OverviewActivity | null {
  for (const m of moments) {
    if (
      nextPhase &&
      m.label === nextPhase.name &&
      m.moment_date === nextPhase.date
    ) {
      continue;
    }
    if (m.category === "phase") continue;
    return { description: m.label, date: m.moment_date };
  }
  return null;
}

function phaseColor(name: string): PhasePillColor {
  const lc = name.toLowerCase();
  if (lc.includes("last chance")) return "orange";
  if (lc.includes("general sale")) return "green";
  if (lc.includes("presale")) return "blue";
  if (lc.includes("announce")) return "purple";
  return "grey";
}

function computeDaysUntil(
  eventDate: string | null,
  today: Date,
): number | null {
  if (!eventDate) return null;
  const target = new Date(`${eventDate}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) return null;
  const todayUtc = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  const diffMs = target.getTime() - todayUtc.getTime();
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}

function ymd(d: Date): string {
  const utc = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  return utc.toISOString().slice(0, 10);
}
