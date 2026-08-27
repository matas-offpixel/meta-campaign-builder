import { planChildRowsAllowHardDelete } from "./delete-policy.ts";
import { loadPlanLaunchRecords } from "./load.ts";
import { isRelationMissing } from "./schema-probe.ts";
import { deriveCampaignPlanStatus } from "./types.ts";

type DeleteChain = {
  eq: (
    col: string,
    value: string,
  ) => DeleteChain & Promise<{ error: { code?: string; message?: string } | null }>;
};

type UpdateChain = {
  eq: (
    col: string,
    value: string,
  ) => UpdateChain & Promise<{ error: { code?: string; message?: string } | null }>;
};

/**
 * Hard-delete the plan row only. Launch children cascade. campaign_drafts
 * and launched platform entities are never touched — pinned by test.
 */
export async function deleteCampaignPlan(
  supabase: unknown,
  planId: string,
  userId: string,
): Promise<
  | { ok: true }
  | { ok: false; action: "archive" | "delete"; tableMissing: boolean; error: string }
> {
  const launches = await loadPlanLaunchRecords(supabase, planId);
  if (!planChildRowsAllowHardDelete(launches)) {
    return {
      ok: false,
      action: "archive",
      tableMissing: false,
      error:
        "A launch child row is no longer idle — archive this plan instead. Linked drafts are not deleted.",
    };
  }
  const client = supabase as {
    from: (table: string) => { delete: () => DeleteChain };
  };
  const { error } = await client
    .from("campaign_plans")
    .delete()
    .eq("id", planId)
    .eq("user_id", userId);
  if (!error) return { ok: true };
  return {
    ok: false,
    action: "delete",
    tableMissing: isRelationMissing(error),
    error: error.message ?? "campaign_plans delete failed",
  };
}

export async function archiveCampaignPlan(
  supabase: unknown,
  planId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; tableMissing: boolean; error: string }> {
  const client = supabase as {
    from: (table: string) => {
      update: (row: Record<string, unknown>) => UpdateChain;
    };
  };
  const { error } = await client
    .from("campaign_plans")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", planId)
    .eq("user_id", userId);
  if (!error) return { ok: true };
  return {
    ok: false,
    tableMissing: isRelationMissing(error),
    error: error.message ?? "campaign_plans archive failed",
  };
}

export async function unarchiveCampaignPlan(
  supabase: unknown,
  planId: string,
  userId: string,
): Promise<
  | { ok: true; status: ReturnType<typeof deriveCampaignPlanStatus> }
  | { ok: false; tableMissing: boolean; error: string }
> {
  const launches = await loadPlanLaunchRecords(supabase, planId);
  const status = deriveCampaignPlanStatus(launches);
  const client = supabase as {
    from: (table: string) => {
      update: (row: Record<string, unknown>) => UpdateChain;
    };
  };
  const { error } = await client
    .from("campaign_plans")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", planId)
    .eq("user_id", userId);
  if (!error) return { ok: true, status };
  return {
    ok: false,
    tableMissing: isRelationMissing(error),
    error: error.message ?? "campaign_plans unarchive failed",
  };
}
