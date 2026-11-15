import type { WizardMode } from "../types.ts";
import { parsePlanLaunchStatus, planOwnsLaunch } from "./linked-plan.ts";
import { upsertPlanLaunchRow } from "./persist.ts";
import { deriveCampaignPlanStatus, type CampaignPlanLaunchRecord } from "./types.ts";

/**
 * Write a wizard-side Meta launch onto campaign_plan_meta_launch.
 *
 * Only when the plan owns that launch (`planOwnsLaunch`). The caller
 * passes wizard mode and draft status from before the launch: the
 * success path publishes the draft before this runs, and a published
 * draft would otherwise look creator-owned. Ordinary drafts, and
 * creator-owned launches, write nothing here.
 */
export async function recordWizardMetaLaunch(
  supabase: unknown,
  input: {
    draftId: string;
    userId: string;
    campaignId: string | null;
    ok: boolean;
    error?: string | null;
    platformAdAccountId?: string | null;
    /** Wizard mode as it was when Launch was pressed. */
    wizardMode: WizardMode | null | undefined;
    /** Draft status as it was when Launch was pressed, before publish. */
    draftStatus: "draft" | "published" | "archived" | null | undefined;
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
              platform_ad_account_id?: string | null;
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
    .select("plan_id, user_id, draft_id, platform_campaign_id, platform_ad_account_id, status, error")
    .eq("draft_id", input.draftId)
    .maybeSingle();
  if (error || !data?.plan_id) return { recorded: false, planId: null };
  if (data.user_id && data.user_id !== input.userId) {
    return { recorded: false, planId: null };
  }

  if (
    !planOwnsLaunch({
      wizardMode: input.wizardMode,
      planLaunchStatus: parsePlanLaunchStatus(data.status),
      draftStatus: input.draftStatus,
    })
  ) {
    console.log("[plan-record] skipped: creator-owned launch");
    return { recorded: false, planId: data.plan_id };
  }

  const record: CampaignPlanLaunchRecord = {
    status: input.ok ? "live" : "failed",
    platformCampaignId: input.campaignId ?? data.platform_campaign_id ?? null,
    draftId: input.draftId,
    error: input.ok ? null : (input.error ?? "Wizard launch failed"),
    platformAdAccountId:
      input.platformAdAccountId ?? data.platform_ad_account_id ?? null,
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
