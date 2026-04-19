import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import type { AdPlan, AdPlanDay } from "./ad-plans";

/**
 * Server-side counterparts to lib/db/ad-plans.ts read helpers. Used by
 * the /events/[id] server page to prefetch the plan + days in parallel
 * with the existing event + drafts fetch.
 *
 * Lives in a separate file because lib/supabase/server.ts pulls in
 * `next/headers`, which can't be bundled into client components.
 */

export async function getPlanByEventIdServer(
  eventId: string,
): Promise<AdPlan | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ad_plans")
    .select("*")
    .eq("event_id", eventId)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("Supabase getPlanByEventIdServer error:", error.message);
    return null;
  }
  return (data as AdPlan | null) ?? null;
}

export async function listDaysForPlanServer(
  planId: string,
): Promise<AdPlanDay[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ad_plan_days")
    .select("*")
    .eq("plan_id", planId)
    .order("day", { ascending: true });

  if (error) {
    console.warn("Supabase listDaysForPlanServer error:", error.message);
    return [];
  }
  return (data ?? []) as AdPlanDay[];
}

// ─── Tickets-sold lookup (plan-side source of truth) ─────────────────────

/**
 * Latest plan-day cumulative tickets-sold figure for an event, used by the
 * report's "Tickets sold" stat card.
 *
 * Source: `ad_plan_days.tickets_sold_cumulative`, which the user fills in
 * day-by-day on the Plan tab. This is the authoritative number when an
 * event has a plan — preferred over the manual `events.tickets_sold`
 * override because the plan has dated history (so the report can show a
 * "From campaign plan · {date}" sub-line) and is the same number the
 * client sees on the Plan tab.
 *
 * Returns the latest non-null cumulative value across all of the event's
 * non-archived plans. Returns null when the event has no plan, no plan-day
 * rows, or no recorded cumulative on any day. The caller should fall
 * back to `events.tickets_sold` in that case.
 */
export async function getLatestTicketsSoldForEvent(
  eventId: string,
): Promise<{ value: number; asOfDay: string } | null> {
  const supabase = await createClient();
  return queryLatestTicketsSold(supabase, eventId);
}

/**
 * Service-role mirror of {@link getLatestTicketsSoldForEvent} for the
 * public share route. The share route already hits Supabase as service-
 * role to read the share token + event row, so the plan-tickets fetch
 * piggybacks on the same client rather than instantiating a second one.
 */
export async function getLatestTicketsSoldForEventAdmin(
  admin: SupabaseClient,
  eventId: string,
): Promise<{ value: number; asOfDay: string } | null> {
  return queryLatestTicketsSold(admin, eventId);
}

async function queryLatestTicketsSold(
  supabase: SupabaseClient,
  eventId: string,
): Promise<{ value: number; asOfDay: string } | null> {
  try {
    // Resolve plan ids first because `tickets_sold_cumulative` lives on
    // `ad_plan_days`. Excluding archived plans matches what the Plan tab
    // surfaces — an archived plan's stale cumulative shouldn't override
    // a freshly-revived one.
    const plansResult = await supabase
      .from("ad_plans")
      .select("id")
      .eq("event_id", eventId)
      .neq("status", "archived");
    if (plansResult.error) {
      console.warn(
        "Supabase getLatestTicketsSoldForEvent (plans) error:",
        plansResult.error.message,
      );
      return null;
    }
    const planIds = (plansResult.data ?? []).map((row) => row.id as string);
    if (planIds.length === 0) return null;

    const daysResult = await supabase
      .from("ad_plan_days")
      .select("day, tickets_sold_cumulative")
      .in("plan_id", planIds)
      .not("tickets_sold_cumulative", "is", null)
      .order("day", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (daysResult.error) {
      console.warn(
        "Supabase getLatestTicketsSoldForEvent (days) error:",
        daysResult.error.message,
      );
      return null;
    }
    const row = daysResult.data as
      | { day: string; tickets_sold_cumulative: number | null }
      | null;
    if (!row || row.tickets_sold_cumulative == null) return null;
    return { value: row.tickets_sold_cumulative, asOfDay: row.day };
  } catch (err) {
    console.warn(
      "Supabase getLatestTicketsSoldForEvent unexpected error:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
