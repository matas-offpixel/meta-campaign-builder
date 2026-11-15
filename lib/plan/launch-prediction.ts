/**
 * The prediction written at launch. One cost-per-unit row, from
 * `planBenchmark` over the venue's other shows. No benchmark yet
 * means Off Pixel's starting point. A blank target still writes.
 */

import { loadPlanBenchmarkRows } from "./launch-reads.ts";
import { toBenchmarkUnit, LAUNCH_STARTING_POINT } from "./launch-face.ts";
import { loadPlanForMetaDraft } from "./linked-plan.ts";
import { planBenchmark } from "./benchmarks.ts";
import {
  predictionFromBenchmark,
  writePredictionsAtLaunch,
  type CampaignPlanPrediction,
} from "./predictions.ts";
import type { PlanTargetUnit } from "../types.ts";
import type { MetricChipBenchmark } from "../viz/metric-chip.ts";

export function predictionUnitForDraft(input: {
  objective?: string | null;
  presetUnit?: PlanTargetUnit | null;
}): PlanTargetUnit | null {
  if (input.presetUnit) return input.presetUnit;
  switch (input.objective) {
    case "registration":
      return "reg";
    case "purchase":
    case "initiate_checkout":
      return "purchase";
    case "traffic":
      return "click";
    case "awareness":
      return "view";
    default:
      return null;
  }
}

export function draftPredictionSkipReason(input: {
  eventId?: string | null;
  unit: PlanTargetUnit | null;
  planId: string | null;
  eventPlanCount: number;
}): string | null {
  if (!input.eventId?.trim()) return "no event";
  if (!input.unit) return "no unit";
  if (input.planId) return null;
  if (input.eventPlanCount > 1) return "more than one plan";
  return "no plan";
}

export function choosePredictionPlanId(
  linkedPlanId: string | null,
  eventPlanIds: readonly string[],
): string | null {
  if (linkedPlanId) return linkedPlanId;
  if (eventPlanIds.length === 1) return eventPlanIds[0] ?? null;
  return null;
}

export function predictionRowForLaunch(input: {
  userId: string;
  planId: string;
  unit: PlanTargetUnit;
  benchmark: MetricChipBenchmark | undefined;
}): CampaignPlanPrediction {
  return predictionFromBenchmark({
    userId: input.userId,
    planId: input.planId,
    unit: input.unit,
    benchmark: input.benchmark,
    startingPoint: LAUNCH_STARTING_POINT[input.unit],
  });
}

type EventFacts = {
  clientId: string | null;
  venueKey: string | null;
  venueName: string | null;
};

async function loadEventFacts(supabase: unknown, eventId: string): Promise<EventFacts | null> {
  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, value: string) => {
          maybeSingle: () => Promise<{
            data: {
              client_id?: string | null;
              venue_key?: string | null;
              venue_name?: string | null;
            } | null;
            error: { message?: string } | null;
          }>;
        };
      };
    };
  };
  const { data, error } = await client
    .from("events")
    .select("client_id, venue_key, venue_name")
    .eq("id", eventId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    clientId: data.client_id ?? null,
    venueKey: data.venue_key?.trim() || null,
    venueName: data.venue_name?.trim() || null,
  };
}

export async function writePlanLaunchPrediction(
  supabase: unknown,
  input: { userId: string; planId: string; eventId: string | null; unit: PlanTargetUnit },
): Promise<{ ok: true } | { ok: false; tableMissing: boolean; error: string }> {
  const event = input.eventId ? await loadEventFacts(supabase, input.eventId) : null;
  const rows =
    event?.clientId && event.venueKey
      ? await loadPlanBenchmarkRows(supabase, { clientId: event.clientId, venueKey: event.venueKey })
      : [];
  const benchmark =
    event?.clientId && event.venueKey
      ? planBenchmark({
          rows,
          clientId: event.clientId,
          venueKey: event.venueKey,
          venueLabel: event.venueName || event.venueKey,
          unit: toBenchmarkUnit(input.unit),
          excludeEventId: input.eventId,
        })
      : undefined;
  const written = await writePredictionsAtLaunch(supabase, [
    predictionRowForLaunch({
      userId: input.userId,
      planId: input.planId,
      unit: input.unit,
      benchmark,
    }),
  ]);
  if (!written.ok && !written.tableMissing) {
    console.error("[launch-prediction] write failed", written.error);
  }
  return written;
}

async function eventPlanIds(supabase: unknown, eventId: string, userId: string): Promise<string[]> {
  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, value: string) => {
          eq: (col: string, value: string) => Promise<{
            data: Array<{ id?: string }> | null;
            error: { message?: string } | null;
          }>;
        };
      };
    };
  };
  const { data, error } = await client
    .from("campaign_plans")
    .select("id")
    .eq("event_id", eventId)
    .eq("user_id", userId);
  if (error || !data) return [];
  return data.map((row) => row.id).filter((id): id is string => Boolean(id));
}

export async function writeDraftLaunchPrediction(
  supabase: unknown,
  input: {
    userId: string;
    draftId: string;
    eventId?: string | null;
    unit: PlanTargetUnit | null;
  },
): Promise<{ written: boolean; reason: string | null }> {
  if (!input.eventId?.trim()) {
    console.log(`[launch-prediction] skipped: no event draft=${input.draftId}`);
    return { written: false, reason: "no event" };
  }
  if (!input.unit) {
    console.log(`[launch-prediction] skipped: no unit draft=${input.draftId}`);
    return { written: false, reason: "no unit" };
  }
  const linked = await loadPlanForMetaDraft(supabase, input.draftId, input.userId);
  const plans = linked ? [] : await eventPlanIds(supabase, input.eventId.trim(), input.userId);
  const planId = choosePredictionPlanId(linked?.id ?? null, plans);
  const reason = draftPredictionSkipReason({
    eventId: input.eventId,
    unit: input.unit,
    planId,
    eventPlanCount: plans.length,
  });
  if (reason || !input.unit || !planId) {
    console.log(`[launch-prediction] skipped: ${reason ?? "no plan"} draft=${input.draftId}`);
    return { written: false, reason: reason ?? "no plan" };
  }
  const written = await writePlanLaunchPrediction(supabase, {
    userId: input.userId,
    planId,
    eventId: input.eventId?.trim() || null,
    unit: input.unit,
  });
  return { written: written.ok, reason: null };
}
