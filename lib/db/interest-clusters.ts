import type { SupabaseClient } from "@supabase/supabase-js";

import {
  findClusterForInterests,
  isClusterVertical,
  rowToInterestCluster,
  type ClusterVertical,
  type InterestCluster,
  type InterestClusterInterest,
  type InterestClusterRow,
} from "../interest-clusters.ts";
import { isRelationMissing } from "../plan/schema-probe.ts";

const TABLE = "interest_clusters";
const COLUMNS =
  "id, name, vertical, interests, evidence, source, use_count, last_used_at, archived_at, created_at, updated_at";

export type ClusterResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string; tableMissing?: boolean; existing?: InterestCluster };

function failure<T>(error: { code?: string; message?: string } | null, fallback = 400): ClusterResult<T> {
  if (isRelationMissing(error)) {
    return { ok: false, status: 503, tableMissing: true, error: "interest_clusters is missing — apply migration 181" };
  }
  if (error?.code === "23505") return { ok: false, status: 409, error: "A cluster with that name already exists" };
  return { ok: false, status: fallback, error: error?.message ?? "Unknown error" };
}

export async function listInterestClusters(
  supabase: SupabaseClient,
  userId: string,
): Promise<ClusterResult<InterestCluster[]>> {
  const { data, error } = await supabase
    .from(TABLE)
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("name", { ascending: true });
  if (error) return failure(error);
  return { ok: true, value: (data ?? []).map((r) => rowToInterestCluster(r as InterestClusterRow)) };
}

/** clients.vertical for a client the user owns; null when unknown or the column is not there yet. */
export async function loadClientVertical(
  supabase: SupabaseClient,
  userId: string,
  clientId: string,
): Promise<ClusterVertical | null> {
  const { data, error } = await supabase
    .from("clients")
    .select("vertical")
    .eq("id", clientId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  const vertical = (data as { vertical?: unknown }).vertical;
  return isClusterVertical(vertical) ? vertical : null;
}

/** Operator save. A live cluster with the same interest set is returned as a 409 with `existing`. */
export async function createInterestCluster(
  supabase: SupabaseClient,
  userId: string,
  input: { name: string; vertical: ClusterVertical; interests: InterestClusterInterest[] },
): Promise<ClusterResult<InterestCluster>> {
  const listed = await listInterestClusters(supabase, userId);
  if (!listed.ok) return listed;
  const existing = findClusterForInterests(listed.value, input.interests);
  if (existing) {
    return { ok: false, status: 409, error: `Already saved as ${existing.name}`, existing };
  }
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      user_id: userId,
      name: input.name,
      vertical: input.vertical,
      interests: input.interests,
      evidence: null,
      source: "operator",
    })
    .select(COLUMNS)
    .maybeSingle();
  if (error || !data) return failure(error);
  return { ok: true, value: rowToInterestCluster(data as InterestClusterRow) };
}

export interface InterestClusterPatch {
  name?: string;
  archived?: boolean;
  /** Replace the interest set. Evidence is cleared: it measured the old set. */
  interests?: InterestClusterInterest[];
}

export async function updateInterestCluster(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  patch: InterestClusterPatch,
): Promise<ClusterResult<InterestCluster>> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.archived !== undefined) update.archived_at = patch.archived ? new Date().toISOString() : null;
  if (patch.interests !== undefined) {
    update.interests = patch.interests;
    update.evidence = null;
  }
  const { data, error } = await supabase
    .from(TABLE)
    .update(update)
    .eq("id", id)
    .eq("user_id", userId)
    .select(COLUMNS)
    .maybeSingle();
  if (error) return failure(error);
  if (!data) return { ok: false, status: 404, error: "Cluster not found" };
  return { ok: true, value: rowToInterestCluster(data as InterestClusterRow) };
}

/** use_count + 1 and last_used_at = now. Read-then-write; the counter is per user. */
export async function markInterestClusterUsed(
  supabase: SupabaseClient,
  userId: string,
  id: string,
): Promise<ClusterResult<InterestCluster>> {
  const { data: current, error: readError } = await supabase
    .from(TABLE)
    .select("use_count")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) return failure(readError);
  if (!current) return { ok: false, status: 404, error: "Cluster not found" };
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      use_count: ((current as { use_count: number | null }).use_count ?? 0) + 1,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", userId)
    .select(COLUMNS)
    .maybeSingle();
  if (error || !data) return failure(error);
  return { ok: true, value: rowToInterestCluster(data as InterestClusterRow) };
}
