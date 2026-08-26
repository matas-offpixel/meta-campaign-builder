import { upsertPlanLaunchRow } from "./persist.ts";
import { deriveCampaignPlanStatus, type CampaignPlanLaunchRecord } from "./types.ts";

/**
 * Write a wizard-side Meta launch onto campaign_plan_meta_launch.
 *
 * The plan must reflect reality however the launch happened — fan-out
 * already writes this row; launching the linked draft FROM the Meta
 * wizard must do the same. Ordinary (non-plan) drafts have no row for
 * this draft_id and are a no-op.
 */
export async function recordWizardMetaLaunch(
  supabase: unknown,
  input: {
    draftId: string;
    userId: string;
    campaignId: string | null;
    ok: boolean;
    error?: string | null;
  },
): Promise<{ recorded: boolean; planId: string | null }> {
  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, value: string) => {
          maybeSingle: () => Promise<{
            data: {
              plan_id?: string;
              user_id?: string;
              draft_id?: string | null;
              platform_campaign_id?: string | null;
              status?: string;
              error?: string | null;
            } | null;
            error: unknown;
          }>;
        };
      };
      update: (row: Record<string, unknown>) => {
        eq: (col: string, value: string) => Promise<{ error: unknown }>;
      };
    };
  };

  const { data, error } = await client
    .from("campaign_plan_meta_launch")
    .select("plan_id, user_id, draft_id, platform_campaign_id, status, error")
    .eq("draft_id", input.draftId)
    .maybeSingle();
  if (error || !data?.plan_id) return { recorded: false, planId: null };
  if (data.user_id && data.user_id !== input.userId) {
    return { recorded: false, planId: null };
  }

  const record: CampaignPlanLaunchRecord = {
    status: input.ok ? "live" : "failed",
    platformCampaignId: input.campaignId ?? data.platform_campaign_id ?? null,
    draftId: input.draftId,
    error: input.ok ? null : (input.error ?? "Wizard launch failed"),
  };

  const write = await upsertPlanLaunchRow(supabase, {
    planId: data.plan_id,
    userId: input.userId,
    adapter: "meta",
    record,
  });
  if (!write.ok) return { recorded: false, planId: data.plan_id };

  const tiktok = await client
    .from("campaign_plan_tiktok_launch")
    .select("status")
    .eq("plan_id", data.plan_id)
    .maybeSingle();
  const google = await client
    .from("campaign_plan_google_launch")
    .select("status")
    .eq("plan_id", data.plan_id)
    .maybeSingle();

  const status = deriveCampaignPlanStatus({
    meta: record,
    tiktok: {
      status: (tiktok.data?.status as CampaignPlanLaunchRecord["status"]) ?? "idle",
      platformCampaignId: null,
      draftId: null,
      error: null,
    },
    google: {
      status: (google.data?.status as CampaignPlanLaunchRecord["status"]) ?? "idle",
      platformCampaignId: null,
      draftId: null,
      error: null,
    },
  });

  await client.from("campaign_plans").update({ status }).eq("id", data.plan_id);
  return { recorded: true, planId: data.plan_id };
}
