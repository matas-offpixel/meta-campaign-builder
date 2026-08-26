import { loadLinkedDraftsForPlan, loadLinkedMetaDraft } from "./linked-drafts.ts";
import {
  HISTORICAL_BACKFILL_NOTE,
  buildRoutingMatrix,
  type RoutingMatrixRow,
} from "./asset-routing.ts";
import { loadPlanAssetRoutes } from "./asset-routing-db.ts";
import { resolveLinkedRegistryAssets } from "./asset-routing-execute.ts";
import type { CampaignPlan } from "./types.ts";

export async function loadPlanRoutingMatrix(
  supabase: unknown,
  plan: CampaignPlan,
): Promise<{
  rows: RoutingMatrixRow[];
  note: string | null;
  tableMissing: boolean;
}> {
  if (!plan.launches.meta.draftId) {
    return { rows: [], note: "Build the Meta campaign and upload assets first.", tableMissing: false };
  }
  const draft = await loadLinkedMetaDraft(supabase, plan.launches.meta.draftId, plan.userId);
  const { assets, refs } = await resolveLinkedRegistryAssets(supabase, plan.userId, draft);
  const saved = await loadPlanAssetRoutes(supabase, plan.id, plan.userId);
  if (!saved.ok && saved.tableMissing) {
    return {
      rows: [],
      note: "creative_assets is not in this database (migration 161).",
      tableMissing: true,
    };
  }
  const routes = saved.ok ? saved.routes : [];
  const rows = buildRoutingMatrix({ assets, refs, routes });
  return {
    rows,
    note: rows.length === 0 ? HISTORICAL_BACKFILL_NOTE : null,
    tableMissing: false,
  };
}

export async function loadPlanDraftsForRouting(supabase: unknown, plan: CampaignPlan) {
  return loadLinkedDraftsForPlan(supabase, plan);
}
