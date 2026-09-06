import { randomBytes } from "node:crypto";

import { isPlanShareToken } from "./share-role.ts";

export function generatePlanShareToken(): string {
  return randomBytes(12).toString("base64url");
}

export type PlanShareRow = {
  token: string;
  planId: string;
  enabled: boolean;
};

type ShareQuery = {
  select: (cols: string) => {
    eq: (col: string, value: string) => {
      maybeSingle: () => Promise<{
        data: {
          token?: string;
          plan_id?: string;
          enabled?: boolean;
          can_edit?: boolean;
        } | null;
        error: { message?: string; code?: string } | null;
      }>;
    };
  };
  insert: (row: Record<string, unknown>) => {
    select: (cols: string) => {
      single: () => Promise<{
        data: { token?: string; plan_id?: string; enabled?: boolean } | null;
        error: { message?: string; code?: string } | null;
      }>;
    };
  };
  update: (row: Record<string, unknown>) => {
    eq: (col: string, value: string) => {
      eq: (col: string, value: string) => {
        select: (cols: string) => {
          maybeSingle: () => Promise<{
            data: { token?: string; plan_id?: string; enabled?: boolean } | null;
            error: { message?: string } | null;
          }>;
        };
      };
    };
  };
};

function toRow(data: {
  token?: string;
  plan_id?: string;
  enabled?: boolean;
} | null): PlanShareRow | null {
  if (!data?.token || !data.plan_id) return null;
  return { token: data.token, planId: data.plan_id, enabled: data.enabled !== false };
}

/** Service-role resolve. Unknown, disabled, or a plan uuid → null (generic 404). */
export async function resolvePlanShareToken(
  supabase: unknown,
  token: string,
): Promise<{ planId: string } | null> {
  if (!isPlanShareToken(token)) return null;
  const client = supabase as { from: (table: string) => ShareQuery };
  const { data, error } = await client
    .from("plan_share_tokens")
    .select("token, plan_id, enabled, can_edit")
    .eq("token", token)
    .maybeSingle();
  if (error || !data?.plan_id || data.enabled === false) return null;
  return { planId: data.plan_id };
}

export async function loadOwnerPlanShare(
  supabase: unknown,
  planId: string,
  userId: string,
): Promise<PlanShareRow | null> {
  const client = supabase as { from: (table: string) => ShareQuery };
  const { data, error } = await client
    .from("plan_share_tokens")
    .select("token, plan_id, enabled")
    .eq("plan_id", planId)
    .maybeSingle();
  if (error || !data) return null;
  const row = toRow(data);
  if (!row) return null;
  void userId;
  return row;
}

export async function mintPlanShareToken(
  supabase: unknown,
  input: { planId: string; userId: string },
): Promise<PlanShareRow | { error: string }> {
  const existing = await loadOwnerPlanShare(supabase, input.planId, input.userId);
  const client = supabase as { from: (table: string) => ShareQuery };
  if (existing) {
    if (existing.enabled) return existing;
    const { data, error } = await client
      .from("plan_share_tokens")
      .update({ enabled: true })
      .eq("plan_id", input.planId)
      .eq("user_id", input.userId)
      .select("token, plan_id, enabled")
      .maybeSingle();
    if (error || !data) return { error: error?.message ?? "Could not re-enable share" };
    return toRow(data) ?? { error: "Could not re-enable share" };
  }

  const token = generatePlanShareToken();
  const { data, error } = await client
    .from("plan_share_tokens")
    .insert({
      token,
      plan_id: input.planId,
      user_id: input.userId,
      enabled: true,
      can_edit: false,
    })
    .select("token, plan_id, enabled")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not mint share" };
  return toRow(data) ?? { error: "Could not mint share" };
}

export async function revokePlanShareToken(
  supabase: unknown,
  input: { planId: string; userId: string },
): Promise<{ ok: true } | { error: string }> {
  const client = supabase as { from: (table: string) => ShareQuery };
  const { error } = await client
    .from("plan_share_tokens")
    .update({ enabled: false })
    .eq("plan_id", input.planId)
    .eq("user_id", input.userId)
    .select("token, plan_id, enabled")
    .maybeSingle();
  if (error) return { error: error.message ?? "Could not revoke share" };
  return { ok: true };
}
