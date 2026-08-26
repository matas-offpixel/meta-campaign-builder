import { countUnregisteredMetaAssets } from "./asset-backfill.ts";
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
  unregisteredCount: number;
}> {
  if (!plan.launches.meta.draftId) {
    return {
      rows: [],
      note: "Build the Meta campaign and upload assets first.",
      tableMissing: false,
      unregisteredCount: 0,
    };
  }
  const draft = await loadLinkedMetaDraft(supabase, plan.launches.meta.draftId, plan.userId);
  const { assets, refs } = await resolveLinkedRegistryAssets(supabase, plan.userId, draft);
  const saved = await loadPlanAssetRoutes(supabase, plan.id, plan.userId);
  if (!saved.ok && saved.tableMissing) {
    return {
      rows: [],
      note: "creative_assets is not in this database (migration 161).",
      tableMissing: true,
      unregisteredCount: 0,
    };
  }
  const routes = saved.ok ? saved.routes : [];
  const rows = buildRoutingMatrix({ assets, refs, routes });
  const unregisteredCount = countUnregisteredMetaAssets(refs);
  return {
    rows,
    note:
      rows.length === 0
        ? unregisteredCount > 0
          ? HISTORICAL_BACKFILL_NOTE
          : "Build the Meta campaign and upload assets first."
        : null,
    tableMissing: false,
    unregisteredCount,
  };
}

export async function loadPlanDraftsForRouting(supabase: unknown, plan: CampaignPlan) {
  return loadLinkedDraftsForPlan(supabase, plan);
}
