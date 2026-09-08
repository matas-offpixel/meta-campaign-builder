/**
 * Server load for the canvas read-across. `ad_plans` is read only.
 */

import "server-only";

import { isCampaignPlanPhase } from "./phase.ts";
import type { AdPlanReadRow, CampaignPlanSibling } from "./ad-plan-read.ts";

type QueryClient = {
  from: (table: string) => {
    select: (cols: string) => {
      in: (col: string, values: string[]) => {
        neq: (
          col: string,
          value: string,
        ) => Promise<{
          data: Array<Record<string, unknown>> | null;
          error: { message?: string } | null;
        }>;
      };
      eq: (
        col: string,
        value: string,
      ) => Promise<{
        data: Array<Record<string, unknown>> | null;
        error: { message?: string } | null;
      }>;
    };
  };
};

function asAdPlan(row: Record<string, unknown>): AdPlanReadRow | null {
  const eventId = typeof row.event_id === "string" ? row.event_id : null;
  const startDate = typeof row.start_date === "string" ? row.start_date : null;
  const endDate = typeof row.end_date === "string" ? row.end_date : null;
  if (!eventId || !startDate || !endDate) return null;
  const rawBudget = row.total_budget;
  const totalBudget =
    rawBudget == null || rawBudget === "" || Number.isNaN(Number(rawBudget))
      ? null
      : Number(rawBudget);
  const rawTarget = row.ticket_target;
  const ticketTarget =
    rawTarget == null || rawTarget === "" || Number.isNaN(Number(rawTarget))
      ? null
      : Number(rawTarget);
  return { eventId, totalBudget, startDate, endDate, ticketTarget };
}

function asSibling(row: Record<string, unknown>): CampaignPlanSibling | null {
  const id = typeof row.id === "string" ? row.id : null;
  const eventId = typeof row.event_id === "string" ? row.event_id : null;
  if (!id || !eventId) return null;
  return {
    id,
    eventId,
    phase: isCampaignPlanPhase(row.phase) ? row.phase : null,
    totalDailyBudget: Number(row.total_daily_budget ?? 0) || 0,
    startDate: typeof row.start_date === "string" ? row.start_date : null,
    endDate: typeof row.end_date === "string" ? row.end_date : null,
  };
}

export async function loadAdPlansForEvents(
  supabase: unknown,
  eventIds: string[],
): Promise<AdPlanReadRow[]> {
  if (eventIds.length === 0) return [];
  const client = supabase as QueryClient;
  const { data, error } = await client
    .from("ad_plans")
    .select("event_id, total_budget, start_date, end_date, ticket_target, status, created_at")
    .in("event_id", eventIds)
    .neq("status", "archived");
  if (error || !data) return [];
  const ranked = [...data].sort((a, b) => {
    const aAt = typeof a.created_at === "string" ? a.created_at : "";
    const bAt = typeof b.created_at === "string" ? b.created_at : "";
    return aAt < bAt ? 1 : aAt > bAt ? -1 : 0;
  });
  const latest = new Map<string, AdPlanReadRow>();
  for (const row of ranked) {
    const parsed = asAdPlan(row);
    if (parsed && !latest.has(parsed.eventId)) latest.set(parsed.eventId, parsed);
  }
  return [...latest.values()];
}

export async function loadCampaignPlanSiblingsForUser(
  supabase: unknown,
  userId: string,
): Promise<CampaignPlanSibling[]> {
  const client = supabase as QueryClient;
  const { data, error } = await client
    .from("campaign_plans")
    .select("id, event_id, phase, total_daily_budget, start_date, end_date")
    .eq("user_id", userId);
  if (error || !data) return [];
  return data.flatMap((row) => {
    const parsed = asSibling(row);
    return parsed ? [parsed] : [];
  });
}

export async function loadCampaignPlanSiblingsForEvent(
  supabase: unknown,
  eventId: string,
): Promise<CampaignPlanSibling[]> {
  const client = supabase as QueryClient;
  const { data, error } = await client
    .from("campaign_plans")
    .select("id, event_id, phase, total_daily_budget, start_date, end_date")
    .eq("event_id", eventId);
  if (error || !data) return [];
  return data.flatMap((row) => {
    const parsed = asSibling(row);
    return parsed ? [parsed] : [];
  });
}
