import { isRelationMissing } from "./schema-probe.ts";
import { normalizePlanTime } from "./schedule.ts";
import type {
  CampaignPlan,
  CampaignPlanLaunchRecord,
  PlanAdapterName,
} from "./types.ts";

export const PLAN_LAUNCH_TABLE: Record<PlanAdapterName, string> = {
  meta: "campaign_plan_meta_launch",
  tiktok: "campaign_plan_tiktok_launch",
  google: "campaign_plan_google_launch",
};

export function campaignPlanToRow(plan: CampaignPlan) {
  const row: Record<string, unknown> = {
    id: plan.id,
    user_id: plan.userId,
    event_id: plan.intent.eventId,
    name: plan.name,
    status: plan.status,
    objective_intent: plan.intent.objectiveIntent,
    total_daily_budget: plan.intent.budget.totalDaily,
    daily_budget_meta: plan.intent.budget.metaDaily,
    daily_budget_tiktok: plan.intent.budget.tiktokDaily,
    daily_budget_google: plan.intent.budget.googleDaily,
    destination_url: plan.intent.destinationUrl,
    audience_cluster_ref: plan.intent.audienceClusterRef,
    creative_set_ref: plan.intent.creativeSetRef,
    start_date: plan.intent.startDate,
    end_date: plan.intent.endDate,
    updated_at: new Date().toISOString(),
  };
  // Omit time columns when unset so a persist before migration 159
  // still writes. Setting a time requires the columns to exist.
  const startTime = normalizePlanTime(plan.intent.startTime);
  const endTime = normalizePlanTime(plan.intent.endTime);
  if (startTime) row.start_time = startTime;
  if (endTime) row.end_time = endTime;
  return row;
}

export function rowToCampaignPlanIntent(row: {
  event_id: string;
  objective_intent: CampaignPlan["intent"]["objectiveIntent"];
  total_daily_budget: number;
  daily_budget_meta: number;
  daily_budget_tiktok: number;
  daily_budget_google: number;
  destination_url: string;
  audience_cluster_ref: string | null;
  creative_set_ref: string | null;
  start_date: string | null;
  end_date: string | null;
  start_time?: string | null;
  end_time?: string | null;
}): CampaignPlan["intent"] {
  return {
    eventId: row.event_id,
    objectiveIntent: row.objective_intent,
    budget: {
      totalDaily: Number(row.total_daily_budget),
      metaDaily: Number(row.daily_budget_meta),
      tiktokDaily: Number(row.daily_budget_tiktok),
      googleDaily: Number(row.daily_budget_google),
    },
    destinationUrl: row.destination_url,
    audienceClusterRef: row.audience_cluster_ref,
    creativeSetRef: row.creative_set_ref,
    startDate: row.start_date,
    endDate: row.end_date,
    startTime: normalizePlanTime(row.start_time),
    endTime: normalizePlanTime(row.end_time),
  };
}

export interface PersistClient {
  from: (table: string) => {
    select: (cols: string) => {
      limit: (n: number) => Promise<{
        data: unknown;
        error: { code?: string; message?: string } | null;
      }>;
    };
    upsert: (
      row: Record<string, unknown>,
      opts?: { onConflict?: string },
    ) => Promise<{ error: { code?: string; message?: string } | null }>;
  };
}

export async function probeCampaignPlansTable(
  supabase: PersistClient | unknown,
): Promise<{ tableMissing: boolean; error: string | null }> {
  const client = supabase as PersistClient;
  const { error } = await client.from("campaign_plans").select("id").limit(1);
  if (!error) return { tableMissing: false, error: null };
  if (isRelationMissing(error)) {
    return { tableMissing: true, error: error.message ?? "relation missing" };
  }
  return { tableMissing: false, error: error.message ?? "campaign_plans read failed" };
}

export async function upsertCampaignPlan(
  supabase: PersistClient | unknown,
  plan: CampaignPlan,
): Promise<{ ok: true } | { ok: false; tableMissing: boolean; error: string }> {
  if (!plan.intent.eventId) {
    return { ok: false, tableMissing: false, error: "event_id is required to persist a plan" };
  }
  const client = supabase as PersistClient;
  const { error } = await client.from("campaign_plans").upsert(campaignPlanToRow(plan), {
    onConflict: "id",
  });
  if (!error) return { ok: true };
  return {
    ok: false,
    tableMissing: isRelationMissing(error),
    error: error.message ?? "campaign_plans upsert failed",
  };
}

export async function upsertPlanLaunchRow(
  supabase: PersistClient | unknown,
  input: {
    planId: string;
    userId: string;
    adapter: PlanAdapterName;
    record: CampaignPlanLaunchRecord;
  },
): Promise<{ ok: true } | { ok: false; tableMissing: boolean; error: string }> {
  const client = supabase as PersistClient;
  const { error } = await client.from(PLAN_LAUNCH_TABLE[input.adapter]).upsert(
    {
      plan_id: input.planId,
      user_id: input.userId,
      draft_id: input.record.draftId,
      platform_campaign_id: input.record.platformCampaignId,
      status: input.record.status,
      error: input.record.error,
    },
    { onConflict: "plan_id" },
  );
  if (!error) return { ok: true };
  return {
    ok: false,
    tableMissing: isRelationMissing(error),
    error: error.message ?? `${input.adapter} launch row upsert failed`,
  };
}

