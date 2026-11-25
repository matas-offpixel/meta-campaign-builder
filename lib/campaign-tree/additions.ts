/**
 * The campaign_additions log (migration 266, R7): one row per campaign each
 * time the stage sheet adds creatives or an audience to it. The rows are the
 * tree's history ("+ 3 ads added Fri 4 Dec · to 6 ad sets · Matas").
 *
 * One run of the sheet carries one `runId`. A retry of the same run, or the
 * audience write's second batch of ad sets for the same campaign, finds the
 * run's row and adds its ad sets to it, so a run is logged once per campaign.
 *
 * Written through the operator's session (owner RLS, `user_id` = the
 * operator). Never throws into a write path: a failed log is returned.
 */

import type { TreeStage } from "./tree.ts";

type Err = { code?: string; message?: string } | null;

/** The slice of the Supabase client the log uses. */
export interface AdditionsDb {
  from(table: "campaign_additions"): {
    select(cols: string): {
      eq(col: string, value: unknown): AdditionsSelect;
    };
    insert(row: Record<string, unknown>): PromiseLike<{ error: Err }>;
    update(patch: Record<string, unknown>): {
      eq(col: string, value: unknown): PromiseLike<{ error: Err }>;
    };
  };
}

interface AdditionsSelect extends PromiseLike<{ data: Record<string, unknown>[] | null; error: Err }> {
  eq(col: string, value: unknown): AdditionsSelect;
}

export interface CreativeAdditionDetail {
  runId: string;
  /** Creatives in the run: "+ {n} ads added". */
  creatives: number;
  /** Ads Meta created for this campaign. */
  ads: number;
  who: string | null;
  source: "campaign_tree";
}

export interface AudienceAdditionDetail {
  runId: string;
  audienceId: string;
  audienceName: string;
  direction: "include";
  who: string | null;
  source: "campaign_tree";
}

export interface CampaignAdditionInput {
  userId: string;
  eventId: string;
  stage: TreeStage;
  metaCampaignId: string;
  /** The ad sets that got the addition. */
  metaAdSetIds: string[];
  kind: "creative" | "audience";
  detail: CreativeAdditionDetail | AudienceAdditionDetail;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The operator as the tree names them: the first word of their name. */
export function additionWho(metadata: Record<string, unknown> | null | undefined): string | null {
  const name = [metadata?.full_name, metadata?.name].find((v) => typeof v === "string" && v.trim()) as string | undefined;
  return name ? name.trim().split(/\s+/)[0]! : null;
}

function union(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])];
}

export async function logCampaignAddition(
  db: AdditionsDb,
  input: CampaignAdditionInput,
): Promise<{ ok: true; merged: boolean } | { ok: false; error: string }> {
  if (input.metaAdSetIds.length === 0) return { ok: true, merged: false };
  if (!UUID.test(input.detail.runId)) return { ok: false, error: "runId is not a uuid" };
  try {
    const { data, error } = await db
      .from("campaign_additions")
      .select("id, meta_adset_ids, detail")
      .eq("event_id", input.eventId)
      .eq("meta_campaign_id", input.metaCampaignId)
      .eq("kind", input.kind)
      .eq("detail->>runId", input.detail.runId);
    if (error) return { ok: false, error: error.message ?? "read failed" };
    const existing = (data ?? [])[0];
    if (existing) {
      const before = Array.isArray(existing.meta_adset_ids) ? (existing.meta_adset_ids as string[]) : [];
      const prior = (existing.detail ?? {}) as Record<string, unknown>;
      const detail =
        input.kind === "creative"
          ? { ...prior, ...input.detail, ads: (typeof prior.ads === "number" ? prior.ads : 0) + (input.detail as CreativeAdditionDetail).ads }
          : { ...prior, ...input.detail };
      const { error: updateError } = await db
        .from("campaign_additions")
        .update({ meta_adset_ids: union(before, input.metaAdSetIds), detail })
        .eq("id", existing.id);
      return updateError ? { ok: false, error: updateError.message ?? "update failed" } : { ok: true, merged: true };
    }
    const { error: insertError } = await db.from("campaign_additions").insert({
      user_id: input.userId,
      event_id: input.eventId,
      stage: input.stage,
      meta_campaign_id: input.metaCampaignId,
      meta_adset_ids: input.metaAdSetIds,
      kind: input.kind,
      detail: input.detail,
      created_by: input.userId,
    });
    return insertError ? { ok: false, error: insertError.message ?? "insert failed" } : { ok: true, merged: false };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "log failed" };
  }
}
