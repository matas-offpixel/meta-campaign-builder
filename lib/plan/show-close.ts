/**
 * Show-close writer for campaign_plan_predictions — canon §1.3 (b).
 *
 * A separate pass at the end of each rollup-sync-events tick, keyed on
 * open prediction rows (`actual_at is null`), never on the cron's event
 * eligibility loop. First tick after events.event_date (London) writes
 * the plan-window actual once with closed_reason = 'show'.
 *
 * DB-only. No Meta / TikTok / Google calls.
 */

import { todayIsoDate } from "./event-picker.ts";
import { planLaunchedAt, planStampLondonDate } from "./launch-face.ts";
import { loadPlanLaunchRecords } from "./load.ts";
import {
  loadPlanWindowActual,
  writePredictionActualsAtClose,
  type PredictionUnit,
} from "./predictions.ts";

export function showCloseCutoffDate(now: Date = new Date()): string {
  const today = todayIsoDate(now);
  const [year, month, day] = today.split("-").map(Number);
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  noon.setUTCDate(noon.getUTCDate() - 1);
  return todayIsoDate(noon);
}

export type ShowCloseResult = {
  considered: number;
  written: number;
};

type OpenPrediction = {
  plan_id: string;
  unit: PredictionUnit | null;
};

type LivePlanRow = {
  id: string;
  status: string;
  event_id: string | null;
  target_unit: PredictionUnit | null;
};

export async function closeDueShowPredictions(
  supabase: unknown,
  now: Date = new Date(),
): Promise<ShowCloseResult> {
  const cutoff = showCloseCutoffDate(now);
  const open = await loadOpenPredictions(supabase);
  let considered = 0;
  let written = 0;

  for (const row of open) {
    const plan = await loadLivePlan(supabase, row.plan_id);
    if (!plan?.event_id) continue;
    const eventDate = await loadEventDate(supabase, plan.event_id);
    if (!eventDate || eventDate > cutoff) continue;
    considered += 1;

    const launches = await loadPlanLaunchRecords(supabase, plan.id);
    const launchedAt = planLaunchedAt(launches);
    const actual = await loadPlanWindowActual(supabase, {
      eventId: plan.event_id,
      sinceDate: launchedAt ? planStampLondonDate(launchedAt) : null,
      untilDate: eventDate,
      unit: row.unit ?? plan.target_unit,
    });
    if (actual == null) continue;

    const result = await writePredictionActualsAtClose(supabase, {
      planId: plan.id,
      actual,
      closedReason: "show",
    });
    if (result.ok) written += 1;
  }

  return { considered, written };
}

async function loadOpenPredictions(supabase: unknown): Promise<OpenPrediction[]> {
  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        is: (
          col: string,
          value: null,
        ) => Promise<{
          data: OpenPrediction[] | null;
          error: { message?: string } | null;
        }>;
      };
    };
  };
  const { data, error } = await client
    .from("campaign_plan_predictions")
    .select("plan_id, unit")
    .is("actual_at", null);
  if (error || !data) return [];
  return data;
}

async function loadLivePlan(
  supabase: unknown,
  planId: string,
): Promise<LivePlanRow | null> {
  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, value: string) => {
          maybeSingle: () => Promise<{
            data: LivePlanRow | null;
            error: { message?: string } | null;
          }>;
        };
      };
    };
  };
  const { data, error } = await client
    .from("campaign_plans")
    .select("id, status, event_id, target_unit")
    .eq("id", planId)
    .maybeSingle();
  if (error || !data || data.status !== "live" || !data.event_id) return null;
  return data;
}

async function loadEventDate(supabase: unknown, eventId: string): Promise<string | null> {
  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, value: string) => {
          maybeSingle: () => Promise<{
            data: { event_date?: string | null } | null;
            error: { message?: string } | null;
          }>;
        };
      };
    };
  };
  const { data, error } = await client
    .from("events")
    .select("event_date")
    .eq("id", eventId)
    .maybeSingle();
  if (error || !data?.event_date) return null;
  return String(data.event_date).slice(0, 10);
}
