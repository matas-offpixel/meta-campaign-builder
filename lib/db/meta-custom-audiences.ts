import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  AudienceSourceMeta,
  AudienceStatus,
  FunnelStage,
  MetaCustomAudience,
  MetaCustomAudienceInsert,
  MetaCustomAudienceUpdate,
} from "@/lib/types/audience";

const TABLE = "meta_custom_audiences";

interface MetaCustomAudienceRow {
  id: string;
  user_id: string;
  client_id: string;
  event_id: string | null;
  name: string;
  funnel_stage: FunnelStage;
  audience_subtype: MetaCustomAudience["audienceSubtype"];
  retention_days: number;
  source_id: string;
  source_meta: AudienceSourceMeta | Record<string, unknown>;
  meta_audience_id: string | null;
  meta_ad_account_id: string;
  status: AudienceStatus;
  status_error: string | null;
  created_at: string;
  updated_at: string;
}

type MetaCustomAudiencePayload = {
  user_id?: string;
  client_id?: string;
  event_id?: string | null;
  name?: string;
  funnel_stage?: FunnelStage;
  audience_subtype?: MetaCustomAudience["audienceSubtype"];
  retention_days?: number;
  source_id?: string;
  source_meta?: AudienceSourceMeta | Record<string, unknown>;
  meta_audience_id?: string | null;
  meta_ad_account_id?: string;
  status?: AudienceStatus;
  status_error?: string | null;
};

export async function listAudiencesForClient(
  clientId: string,
  opts: {
    eventId?: string;
    funnelStage?: FunnelStage;
    status?: AudienceStatus[];
  } = {},
): Promise<MetaCustomAudience[]> {
  const supabase = await createClient();
  let query = supabase
    .from(TABLE)
    .select("*")
    .eq("client_id", clientId)
    .order("updated_at", { ascending: false });

  if (opts.eventId) query = query.eq("event_id", opts.eventId);
  if (opts.funnelStage) query = query.eq("funnel_stage", opts.funnelStage);
  if (opts.status?.length) query = query.in("status", opts.status);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as MetaCustomAudienceRow[]).map(rowToAudience);
}

export async function getAudienceById(
  id: string,
): Promise<MetaCustomAudience | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? rowToAudience(data as MetaCustomAudienceRow) : null;
}

export async function createAudienceDraft(
  input: MetaCustomAudienceInsert,
): Promise<MetaCustomAudience> {
  const supabase = await createClient();
  const payload: MetaCustomAudiencePayload = {
    ...audienceInsertToRow(input),
    status: "draft",
  };
  const { data, error } = await supabase
    .from(TABLE)
    .insert(payload)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return rowToAudience(data as MetaCustomAudienceRow);
}

export async function createAudienceDrafts(
  inputs: MetaCustomAudienceInsert[],
): Promise<MetaCustomAudience[]> {
  if (inputs.length === 0) return [];
  const supabase = await createClient();
  const payloads = inputs.map((input) => ({
    ...audienceInsertToRow(input),
    status: "draft" as const,
  }));
  const { data, error } = await supabase
    .from(TABLE)
    .insert(payloads)
    .select("*");

  if (error) throw new Error(error.message);
  return ((data ?? []) as MetaCustomAudienceRow[]).map(rowToAudience);
}

export async function updateAudience(
  id: string,
  patch: MetaCustomAudienceUpdate,
): Promise<MetaCustomAudience | null> {
  const current = await getAudienceById(id);
  if (!current) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from(TABLE)
    .update(audienceUpdateToRow(patch))
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? rowToAudience(data as MetaCustomAudienceRow) : null;
}

export async function archiveAudience(id: string): Promise<boolean> {
  const updated = await updateAudience(id, { status: "archived" });
  return Boolean(updated);
}

function audienceInsertToRow(
  input: MetaCustomAudienceInsert,
): MetaCustomAudiencePayload {
  return {
    user_id: input.userId,
    client_id: input.clientId,
    event_id: input.eventId,
    name: input.name,
    funnel_stage: input.funnelStage,
    audience_subtype: input.audienceSubtype,
    retention_days: input.retentionDays,
    source_id: input.sourceId,
    source_meta: input.sourceMeta,
    meta_ad_account_id: input.metaAdAccountId,
  };
}

function audienceUpdateToRow(
  patch: MetaCustomAudienceUpdate,
): MetaCustomAudiencePayload {
  return {
    client_id: patch.clientId,
    event_id: patch.eventId,
    name: patch.name,
    funnel_stage: patch.funnelStage,
    audience_subtype: patch.audienceSubtype,
    retention_days: patch.retentionDays,
    source_id: patch.sourceId,
    source_meta: patch.sourceMeta,
    meta_audience_id: patch.metaAudienceId,
    meta_ad_account_id: patch.metaAdAccountId,
    status: patch.status,
    status_error: patch.statusError,
  };
}

function rowToAudience(row: MetaCustomAudienceRow): MetaCustomAudience {
  return {
    id: row.id,
    userId: row.user_id,
    clientId: row.client_id,
    eventId: row.event_id,
    name: row.name,
    funnelStage: row.funnel_stage,
    audienceSubtype: row.audience_subtype,
    retentionDays: row.retention_days,
    sourceId: row.source_id,
    sourceMeta: row.source_meta,
    metaAudienceId: row.meta_audience_id,
    metaAdAccountId: row.meta_ad_account_id,
    status: row.status,
    statusError: row.status_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
