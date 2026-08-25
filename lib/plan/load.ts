import { IDLE_PLAN_LAUNCH, type CampaignPlan, type CampaignPlanLaunchRecord } from "./types.ts";

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
