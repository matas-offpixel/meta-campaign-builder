import "server-only";

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
