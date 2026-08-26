import { rowToCampaignPlanIntent } from "./persist.ts";
import {
  IDLE_PLAN_LAUNCH,
  type CampaignPlan,
  type CampaignPlanLaunchRecord,
  type CampaignPlanLaunches,
} from "./types.ts";

interface LaunchRow {
  status?: CampaignPlanLaunchRecord["status"];
  platform_campaign_id?: string | null;
  draft_id?: string | null;
  error?: string | null;
}

function toLaunch(row: LaunchRow | null | undefined): CampaignPlanLaunchRecord {
  if (!row) return { ...IDLE_PLAN_LAUNCH };
  return {
    status: row.status ?? "idle",
    platformCampaignId: row.platform_campaign_id ?? null,
    draftId: row.draft_id ?? null,
    error: row.error ?? null,
  };
}

type LaunchQuery = {
  select: (cols: string) => {
    eq: (col: string, value: string) => {
      maybeSingle: () => Promise<{
        data: LaunchRow | null;
        error: { message?: string } | null;
      }>;
    };
  };
};

export async function loadPlanLaunchRecords(
  supabase: { from: (table: string) => LaunchQuery } | unknown,
  planId: string,
): Promise<CampaignPlan["launches"]> {
  const client = supabase as { from: (table: string) => LaunchQuery };
  const [meta, tiktok, google] = await Promise.all([
    client.from("campaign_plan_meta_launch").select("*").eq("plan_id", planId).maybeSingle(),
    client.from("campaign_plan_tiktok_launch").select("*").eq("plan_id", planId).maybeSingle(),
    client.from("campaign_plan_google_launch").select("*").eq("plan_id", planId).maybeSingle(),
  ]);
  return {
    meta: toLaunch(meta.data),
    tiktok: toLaunch(tiktok.data),
    google: toLaunch(google.data),
  };
}

export function emptyPlanLaunches(): CampaignPlanLaunches {
  return {
    meta: { ...IDLE_PLAN_LAUNCH },
    tiktok: { ...IDLE_PLAN_LAUNCH },
    google: { ...IDLE_PLAN_LAUNCH },
  };
}

/** Load a saved plan plus its launch children, scoped to the owner. */
export async function loadPlanForUser(
  supabase: unknown,
  planId: string,
  userId: string,
): Promise<CampaignPlan | null> {
  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, value: string) => {
          eq: (col: string, value: string) => {
            maybeSingle: () => Promise<{
              data: Record<string, unknown> | null;
              error: unknown;
            }>;
          };
        };
      };
    };
  };
  const { data, error } = await client
    .from("campaign_plans")
    .select("*")
    .eq("id", planId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as Record<string, unknown>;
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: (row.name as string | null) ?? null,
    status: row.status as CampaignPlan["status"],
    intent: rowToCampaignPlanIntent(row as never),
    launches: await loadPlanLaunchRecords(supabase, row.id as string),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
