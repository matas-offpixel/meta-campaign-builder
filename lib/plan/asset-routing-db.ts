import { isRelationMissing } from "./schema-probe.ts";
import {
  PLAN_ASSET_ROUTES_TABLE,
  rowToPlanAssetRoute,
  type PlanAssetRouteRow,
  type TikTokRouteUploadStatus,
} from "./asset-routing.ts";

type ListClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, value: string) => {
        eq: (
          col: string,
          value: string,
        ) => Promise<{
          data: Record<string, unknown>[] | null;
          error: { code?: string; message?: string } | null;
        }>;
      };
    };
    upsert: (
      row: Record<string, unknown>,
      opts?: { onConflict?: string },
    ) => Promise<{ error: { code?: string; message?: string } | null }>;
  };
};

export async function loadPlanAssetRoutes(
  supabase: unknown,
  planId: string,
  userId: string,
): Promise<
  | { ok: true; routes: PlanAssetRouteRow[] }
  | { ok: false; tableMissing: boolean; error: string }
> {
  const { data, error } = await (supabase as ListClient)
    .from(PLAN_ASSET_ROUTES_TABLE)
    .select("*")
    .eq("plan_id", planId)
    .eq("user_id", userId);
  if (error) {
    return {
      ok: false,
      tableMissing: isRelationMissing(error),
      error: error.message ?? "campaign_plan_asset_routes read failed",
    };
  }
  return { ok: true, routes: (data ?? []).map(rowToPlanAssetRoute) };
}

export async function upsertPlanAssetRoute(
  supabase: unknown,
  row: PlanAssetRouteRow & { userId: string },
): Promise<{ ok: true } | { ok: false; tableMissing: boolean; error: string }> {
  const { error } = await (supabase as ListClient).from(PLAN_ASSET_ROUTES_TABLE).upsert(
    {
      plan_id: row.planId,
      asset_id: row.assetId,
      user_id: row.userId,
      channel: "tiktok",
      enabled: row.enabled,
      upload_status: row.uploadStatus,
      upload_error: row.uploadError,
      derived_creative_id: row.derivedCreativeId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "plan_id,asset_id,channel" },
  );
  if (!error) return { ok: true };
  return {
    ok: false,
    tableMissing: isRelationMissing(error),
    error: error.message ?? "campaign_plan_asset_routes upsert failed",
  };
}

export function routeStatusAfterUpload(
  ok: boolean,
  launched: boolean,
): TikTokRouteUploadStatus {
  if (launched) return "launched";
  return ok ? "ready" : "failed";
}
