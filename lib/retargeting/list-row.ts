/**
 * HR2 (docs/design-record/2026-11-17-retargeting-campaign.html): a customer
 * list uploaded with a role (Signups, Similar, Buyers) and a show is
 * recorded as a meta_custom_audiences row (migration 256), so the show's
 * Retargeting campaign can put it in its tier. Before this the upload route
 * wrote no row (audit §4.1).
 *
 * Only the list's name, role, show and Meta id are stored: never a hash,
 * never a count of who's on it. The upload time (source_meta.uploadedAt)
 * drives RT8's "Buyers list uploaded {d Mon} · {n} days old".
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ListRole } from "./audiences.ts";

type Db = Pick<SupabaseClient, "from">;

export function isListRole(value: unknown): value is ListRole {
  return value === "signups" || value === "similar" || value === "buyers";
}

export type ListRowInput = { userId: string; clientId: string; eventId: string; name: string; role: ListRole; metaAudienceId: string; adAccountId: string; now: Date };

/** The row's fields. Pure. */
export function listRowPayload(input: ListRowInput): Record<string, unknown> {
  return {
    user_id: input.userId,
    client_id: input.clientId,
    event_id: input.eventId,
    name: input.name,
    funnel_stage: "retargeting",
    audience_subtype: "customer_list",
    list_role: input.role,
    retention_days: null,
    source_id: input.metaAudienceId,
    source_meta: { subtype: "customer_list", role: input.role, uploadedAt: input.now.toISOString() },
    meta_audience_id: input.metaAudienceId,
    meta_ad_account_id: input.adAccountId,
    status: "ready",
    status_error: null,
  };
}

/** Insert the row, or (a re-upload into the same list) move its upload time and role. Never throws: the upload already succeeded. */
export async function recordRoleList(db: Db, input: ListRowInput): Promise<{ ok: boolean; error?: string }> {
  try {
    const found = await db.from("meta_custom_audiences").select("id").eq("meta_audience_id", input.metaAudienceId).eq("audience_subtype", "customer_list").limit(1);
    if (found.error) return { ok: false, error: found.error.message };
    const id = ((found.data ?? []) as { id: string }[])[0]?.id;
    const payload = listRowPayload(input);
    const res = id ? await db.from("meta_custom_audiences").update(payload).eq("id", id) : await db.from("meta_custom_audiences").insert(payload);
    return res.error ? { ok: false, error: res.error.message } : { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
