/**
 * MML ② persistence. Migration 193. A missing table is reported, never thrown.
 */

import { isRelationMissing } from "./schema-probe.ts";
import type { IntakeBucket } from "./creative-intake.ts";

export const INTAKE_ASSETS = "campaign_plan_intake_assets";
export const INTAKE_GROUPS = "campaign_plan_creative_groups";
export const INTAKE_MEMBERS = "campaign_plan_creative_group_members";

type Err = { code?: string; message?: string } | null;

function db(supabase: unknown) {
  return supabase as {
    from: (table: string) => {
      select: (cols: string) => Chain;
      insert: (row: Record<string, unknown> | Record<string, unknown>[]) => Chain;
      update: (row: Record<string, unknown>) => Chain;
      delete: () => Chain;
      upsert: (
        row: Record<string, unknown>,
        opts?: { onConflict?: string },
      ) => Promise<{ error: Err }>;
    };
  };
}

type Chain = {
  eq: (col: string, value: string | number) => Chain;
  in: (col: string, values: string[]) => Chain;
  is: (col: string, value: null) => Chain;
  order: (col: string, opts?: { ascending?: boolean }) => Chain;
  select: (cols?: string) => Chain;
  maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: Err }>;
  then: PromiseLike<{ data: Record<string, unknown>[] | null; error: Err }>["then"];
};

async function rows(
  query: Chain,
): Promise<{ ok: true; rows: Record<string, unknown>[] } | { ok: false; tableMissing: boolean; error: string }> {
  const { data, error } = await query;
  if (error) {
    return {
      ok: false,
      tableMissing: isRelationMissing(error),
      error: error.message ?? "intake read failed",
    };
  }
  return { ok: true, rows: data ?? [] };
}

export interface IntakeAssetRecord {
  planId: string;
  assetId: string;
  detectedBucket: IntakeBucket;
  aspectOverride: IntakeBucket | null;
  detectedWidth: number | null;
  detectedHeight: number | null;
  unreadableReason: string | null;
  sortOrder: number;
}

export interface IntakeGroupRecord {
  id: string;
  planId: string;
  stableKey: string;
  position: number;
  metaCreativeId: string | null;
  sentFingerprint: string | null;
  assetIds: string[];
}

function bucket(value: unknown): IntakeBucket {
  return value === "1:1" || value === "4:5" || value === "9:16" || value === "other" ? value : "other";
}

function assetRow(row: Record<string, unknown>): IntakeAssetRecord {
  return {
    planId: String(row.plan_id),
    assetId: String(row.asset_id),
    detectedBucket: bucket(row.detected_bucket),
    aspectOverride: row.aspect_override == null ? null : bucket(row.aspect_override),
    detectedWidth: typeof row.detected_width === "number" ? row.detected_width : null,
    detectedHeight: typeof row.detected_height === "number" ? row.detected_height : null,
    unreadableReason: typeof row.unreadable_reason === "string" ? row.unreadable_reason : null,
    sortOrder: Number(row.sort_order ?? 0),
  };
}

export async function listIntakeAssets(
  supabase: unknown,
  planId: string,
  userId: string,
): Promise<
  { ok: true; assets: IntakeAssetRecord[] } | { ok: false; tableMissing: boolean; error: string }
> {
  const listed = await rows(
    db(supabase).from(INTAKE_ASSETS).select("*").eq("plan_id", planId).eq("user_id", userId).order("sort_order"),
  );
  if (!listed.ok) return listed;
  return { ok: true, assets: listed.rows.map(assetRow) };
}

export async function attachIntakeAsset(
  supabase: unknown,
  row: {
    planId: string;
    assetId: string;
    userId: string;
    detectedBucket: IntakeBucket;
    detectedWidth: number | null;
    detectedHeight: number | null;
    unreadableReason: string | null;
  },
): Promise<{ ok: true; created: boolean } | { ok: false; tableMissing: boolean; error: string }> {
  const existing = await db(supabase)
    .from(INTAKE_ASSETS)
    .select("asset_id")
    .eq("plan_id", row.planId)
    .eq("asset_id", row.assetId)
    .maybeSingle();
  if (existing.error) {
    return {
      ok: false,
      tableMissing: isRelationMissing(existing.error),
      error: existing.error.message ?? "intake asset read failed",
    };
  }
  if (existing.data) return { ok: true, created: false };
  const { error } = await db(supabase).from(INTAKE_ASSETS).upsert(
    {
      plan_id: row.planId,
      asset_id: row.assetId,
      user_id: row.userId,
      detected_bucket: row.detectedBucket,
      detected_width: row.detectedWidth,
      detected_height: row.detectedHeight,
      unreadable_reason: row.unreadableReason,
    },
    { onConflict: "plan_id,asset_id" },
  );
  if (error) {
    return {
      ok: false,
      tableMissing: isRelationMissing(error),
      error: error.message ?? "intake asset insert failed",
    };
  }
  return { ok: true, created: true };
}

export async function setIntakeAspectOverride(
  supabase: unknown,
  input: { planId: string; assetId: string; userId: string; override: IntakeBucket | null },
): Promise<{ ok: true } | { ok: false; tableMissing: boolean; error: string }> {
  const { error } = await db(supabase)
    .from(INTAKE_ASSETS)
    .update({ aspect_override: input.override, updated_at: new Date().toISOString() })
    .eq("plan_id", input.planId)
    .eq("asset_id", input.assetId)
    .eq("user_id", input.userId);
  if (!error) return { ok: true };
  return {
    ok: false,
    tableMissing: isRelationMissing(error),
    error: error.message ?? "aspect override failed",
  };
}

export async function listIntakeGroups(
  supabase: unknown,
  planId: string,
  userId: string,
): Promise<
  { ok: true; groups: IntakeGroupRecord[] } | { ok: false; tableMissing: boolean; error: string }
> {
  const listed = await rows(
    db(supabase).from(INTAKE_GROUPS).select("*").eq("plan_id", planId).eq("user_id", userId).order("position"),
  );
  if (!listed.ok) return listed;
  const members = await rows(
    db(supabase)
      .from(INTAKE_MEMBERS)
      .select("group_id, asset_id, position")
      .eq("plan_id", planId)
      .eq("user_id", userId)
      .order("position"),
  );
  if (!members.ok) return members;
  return {
    ok: true,
    groups: listed.rows.map((row) => ({
      id: String(row.id),
      planId: String(row.plan_id),
      stableKey: String(row.stable_key),
      position: Number(row.position ?? 0),
      metaCreativeId: typeof row.meta_creative_id === "string" ? row.meta_creative_id : null,
      sentFingerprint: typeof row.sent_fingerprint === "string" ? row.sent_fingerprint : null,
      assetIds: members.rows
        .filter((member) => member.group_id === row.id)
        .map((member) => String(member.asset_id)),
    })),
  };
}

export async function insertIntakeGroup(
  supabase: unknown,
  input: { id: string; planId: string; userId: string; stableKey: string; position: number },
): Promise<{ ok: true } | { ok: false; tableMissing: boolean; error: string }> {
  const { error } = await db(supabase)
    .from(INTAKE_GROUPS)
    .insert({
      id: input.id,
      plan_id: input.planId,
      user_id: input.userId,
      stable_key: input.stableKey,
      position: input.position,
    })
    .select("id")
    .maybeSingle();
  if (!error) return { ok: true };
  return {
    ok: false,
    tableMissing: isRelationMissing(error),
    error: error.message ?? "group insert failed",
  };
}

export async function replaceGroupMembers(
  supabase: unknown,
  input: { planId: string; userId: string; groupId: string; assetIds: string[] },
): Promise<{ ok: true } | { ok: false; tableMissing: boolean; error: string }> {
  if (input.assetIds.length > 0) {
    const removed = await db(supabase)
      .from(INTAKE_MEMBERS)
      .delete()
      .eq("plan_id", input.planId)
      .in("asset_id", input.assetIds);
    if (removed.error) {
      return {
        ok: false,
        tableMissing: isRelationMissing(removed.error),
        error: removed.error.message ?? "member delete failed",
      };
    }
  }
  if (input.assetIds.length === 0) return { ok: true };
  const inserted = await db(supabase).from(INTAKE_MEMBERS).insert(
    input.assetIds.map((assetId, position) => ({
      group_id: input.groupId,
      plan_id: input.planId,
      asset_id: assetId,
      user_id: input.userId,
      position,
    })),
  );
  if (!inserted.error) return { ok: true };
  return {
    ok: false,
    tableMissing: isRelationMissing(inserted.error),
    error: inserted.error.message ?? "member insert failed",
  };
}

export async function clearGroupMembers(
  supabase: unknown,
  input: { planId: string; groupId: string },
): Promise<{ ok: true } | { ok: false; tableMissing: boolean; error: string }> {
  const { error } = await db(supabase)
    .from(INTAKE_MEMBERS)
    .delete()
    .eq("plan_id", input.planId)
    .eq("group_id", input.groupId);
  if (!error) return { ok: true };
  return {
    ok: false,
    tableMissing: isRelationMissing(error),
    error: error.message ?? "unmatch failed",
  };
}

export async function deleteEmptyIntakeGroups(
  supabase: unknown,
  planId: string,
  userId: string,
): Promise<void> {
  const groups = await listIntakeGroups(supabase, planId, userId);
  if (!groups.ok) return;
  for (const group of groups.groups) {
    if (group.assetIds.length > 0 || group.stableKey.startsWith("single:") || group.metaCreativeId) continue;
    await db(supabase).from(INTAKE_GROUPS).delete().eq("id", group.id).eq("user_id", userId);
  }
}

export async function stampIntakeGroup(
  supabase: unknown,
  input: {
    planId: string;
    userId: string;
    stableKey: string;
    metaCreativeId: string;
    fingerprint: string;
    position: number;
  },
): Promise<{ ok: true } | { ok: false; tableMissing: boolean; error: string }> {
  const { error } = await db(supabase).from(INTAKE_GROUPS).upsert(
    {
      plan_id: input.planId,
      user_id: input.userId,
      stable_key: input.stableKey,
      meta_creative_id: input.metaCreativeId,
      sent_fingerprint: input.fingerprint,
      position: input.position,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "plan_id,stable_key" },
  );
  if (!error) return { ok: true };
  return {
    ok: false,
    tableMissing: isRelationMissing(error),
    error: error.message ?? "group stamp failed",
  };
}
