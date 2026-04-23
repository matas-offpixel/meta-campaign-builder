import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  D2CChannel,
  D2CConnection,
  D2CConnectionStatus,
  D2CProviderName,
  D2CScheduledSend,
  D2CScheduledSendApprovalStatus,
  D2CScheduledSendStatus,
  D2CTemplate,
} from "@/lib/d2c/types";
import { getD2CTokenKey } from "@/lib/d2c/secrets";

/**
 * lib/db/d2c.ts
 *
 * Server-side CRUD for the three D2C tables introduced in migration 030:
 *   - d2c_connections
 *   - d2c_templates
 *   - d2c_scheduled_sends
 *
 * Same regen-pending pattern as `lib/db/ticketing.ts` — accepts any
 * concrete `SupabaseClient` so this lib compiles before / after the
 * regen for migration 030. After regen, drop `AnySupabaseClient` and
 * use `Tables<"d2c_*">` directly.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

function asAny(supabase: AnySupabaseClient): AnySupabaseClient {
  return supabase;
}

/** Never select `credentials_encrypted` into API responses. */
const D2C_CONNECTION_PUBLIC_COLUMNS =
  "id, user_id, client_id, provider, credentials, external_account_id, status, last_synced_at, last_error, live_enabled, approved_by_matas, created_at, updated_at";

function mapD2CScheduledSend(raw: Record<string, unknown>): D2CScheduledSend {
  return {
    id: raw.id as string,
    user_id: raw.user_id as string,
    event_id: raw.event_id as string,
    template_id: raw.template_id as string,
    connection_id: raw.connection_id as string,
    channel: raw.channel as D2CScheduledSend["channel"],
    audience: (raw.audience as Record<string, unknown>) ?? {},
    variables: (raw.variables as Record<string, unknown>) ?? {},
    scheduled_for: raw.scheduled_for as string,
    status: raw.status as D2CScheduledSendStatus,
    result_jsonb: raw.result_jsonb ?? null,
    dry_run: Boolean(raw.dry_run),
    approval_status:
      (raw.approval_status as D2CScheduledSendApprovalStatus) ??
      "pending_approval",
    approved_by: (raw.approved_by as string | null) ?? null,
    approved_at: (raw.approved_at as string | null) ?? null,
    created_at: raw.created_at as string,
    updated_at: raw.updated_at as string,
  };
}

function mapPublicD2CConnection(raw: Record<string, unknown>): D2CConnection {
  return {
    id: raw.id as string,
    user_id: raw.user_id as string,
    client_id: raw.client_id as string,
    provider: raw.provider as D2CConnection["provider"],
    credentials: {},
    external_account_id: (raw.external_account_id as string | null) ?? null,
    status: raw.status as D2CConnectionStatus,
    last_synced_at: (raw.last_synced_at as string | null) ?? null,
    last_error: (raw.last_error as string | null) ?? null,
    live_enabled: Boolean(raw.live_enabled),
    approved_by_matas: Boolean(raw.approved_by_matas),
    created_at: raw.created_at as string,
    updated_at: raw.updated_at as string,
  };
}

// ─── d2c_connections ─────────────────────────────────────────────────────

export async function listD2CConnectionsForUser(
  supabase: AnySupabaseClient,
  options?: { clientId?: string | null },
): Promise<D2CConnection[]> {
  const sb = asAny(supabase);
  let query = sb
    .from("d2c_connections")
    .select(D2C_CONNECTION_PUBLIC_COLUMNS)
    .order("created_at", { ascending: false });
  if (options?.clientId) {
    query = query.eq("client_id", options.clientId);
  }
  const { data, error } = await query;
  if (error) {
    console.warn("[d2c listConnections]", error.message);
    return [];
  }
  return (data ?? []).map((row) =>
    mapPublicD2CConnection(row as unknown as Record<string, unknown>),
  );
}

export async function getD2CConnectionById(
  supabase: AnySupabaseClient,
  id: string,
): Promise<D2CConnection | null> {
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("d2c_connections")
    .select(D2C_CONNECTION_PUBLIC_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.warn("[d2c getConnectionById]", error.message);
    return null;
  }
  if (!data) return null;
  return mapPublicD2CConnection(data as unknown as Record<string, unknown>);
}

export interface UpsertD2CConnectionInput {
  userId: string;
  clientId: string;
  provider: D2CProviderName;
  credentials: Record<string, unknown>;
  externalAccountId: string | null;
  status?: D2CConnectionStatus;
}

export async function upsertD2CConnection(
  supabase: AnySupabaseClient,
  input: UpsertD2CConnectionInput,
): Promise<D2CConnection | null> {
  const sb = asAny(supabase);
  const key = getD2CTokenKey();
  const { data, error } = await sb
    .from("d2c_connections")
    .upsert(
      {
        user_id: input.userId,
        client_id: input.clientId,
        provider: input.provider,
        credentials: {},
        external_account_id: input.externalAccountId,
        status: input.status ?? "active",
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,client_id,provider" },
    )
    .select("id")
    .maybeSingle();
  if (error) {
    console.warn("[d2c upsertConnection]", error.message);
    return null;
  }
  if (!data?.id) return null;
  const rowId = data.id as string;

  const { error: rpcError } = await sb.rpc("set_d2c_credentials", {
    p_id: rowId,
    p_credentials: input.credentials,
    p_key: key,
  });
  if (rpcError) {
    console.warn("[d2c upsertConnection] set_d2c_credentials", rpcError.message);
    return null;
  }

  return getD2CConnectionById(supabase, rowId);
}

/**
 * Decrypts provider credentials for server-side sends (cron, immediate paths).
 * Falls back to legacy plaintext `credentials` jsonb when no encrypted blob exists.
 */
export async function getD2CConnectionCredentials(
  supabase: AnySupabaseClient,
  id: string,
): Promise<Record<string, unknown> | null> {
  const sb = asAny(supabase);
  const key = getD2CTokenKey();
  const { data: decrypted, error } = await sb.rpc("get_d2c_credentials", {
    p_id: id,
    p_key: key,
  });
  if (error) {
    console.warn("[d2c getD2CConnectionCredentials]", error.message);
    throw new Error(
      "Could not decrypt D2C credentials. Re-save the connection or check D2C_TOKEN_KEY.",
    );
  }
  if (decrypted !== null && typeof decrypted === "object" && !Array.isArray(decrypted)) {
    const obj = decrypted as Record<string, unknown>;
    if (Object.keys(obj).length > 0) return obj;
  }

  const { data: legacy, error: legErr } = await sb
    .from("d2c_connections")
    .select("credentials")
    .eq("id", id)
    .maybeSingle();
  if (legErr) {
    console.warn("[d2c getD2CConnectionCredentials legacy]", legErr.message);
    return null;
  }
  const creds = legacy?.credentials as Record<string, unknown> | undefined;
  if (creds && typeof creds === "object" && Object.keys(creds).length > 0) {
    return creds;
  }
  return null;
}

export async function setD2CConnectionLiveFlag(
  supabase: AnySupabaseClient,
  id: string,
  flags: { liveEnabled: boolean; approvedByMatas: boolean },
): Promise<D2CConnection | null> {
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("d2c_connections")
    .update({
      live_enabled: flags.liveEnabled,
      approved_by_matas: flags.approvedByMatas,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(D2C_CONNECTION_PUBLIC_COLUMNS)
    .maybeSingle();
  if (error) {
    console.warn("[d2c setD2CConnectionLiveFlag]", error.message);
    return null;
  }
  if (!data) return null;
  return mapPublicD2CConnection(data as unknown as Record<string, unknown>);
}

export async function setD2CConnectionStatus(
  supabase: AnySupabaseClient,
  id: string,
  status: D2CConnectionStatus,
  lastError?: string | null,
): Promise<void> {
  const sb = asAny(supabase);
  const patch: Record<string, unknown> = { status };
  if (lastError !== undefined) patch.last_error = lastError;
  const { error } = await sb.from("d2c_connections").update(patch).eq("id", id);
  if (error) console.warn("[d2c setConnectionStatus]", error.message);
}

export async function deleteD2CConnection(
  supabase: AnySupabaseClient,
  id: string,
): Promise<void> {
  const sb = asAny(supabase);
  const { error } = await sb.from("d2c_connections").delete().eq("id", id);
  if (error) console.warn("[d2c deleteConnection]", error.message);
}

// ─── d2c_templates ───────────────────────────────────────────────────────

export interface UpsertD2CTemplateInput {
  id?: string;
  userId: string;
  clientId: string | null;
  name: string;
  channel: D2CChannel;
  subject?: string | null;
  bodyMarkdown: string;
  variablesJsonb?: string[];
}

function mapD2CTemplate(raw: Record<string, unknown>): D2CTemplate {
  const v = raw.variables_jsonb;
  const vars = Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
  return {
    id: raw.id as string,
    user_id: raw.user_id as string,
    client_id: (raw.client_id as string | null) ?? null,
    name: raw.name as string,
    channel: raw.channel as D2CChannel,
    subject: (raw.subject as string | null) ?? null,
    body_markdown: raw.body_markdown as string,
    variables_jsonb: vars,
    created_at: raw.created_at as string,
    updated_at: raw.updated_at as string,
  };
}

export async function listD2CTemplatesForUser(
  supabase: AnySupabaseClient,
  options?: { clientId?: string | null; channel?: D2CChannel | null },
): Promise<D2CTemplate[]> {
  const sb = asAny(supabase);
  let query = sb
    .from("d2c_templates")
    .select("*")
    .order("created_at", { ascending: false });
  if (options?.clientId !== undefined) {
    if (options.clientId === null) {
      query = query.is("client_id", null);
    } else {
      const cid = options.clientId;
      query = query.or(`client_id.eq.${cid},client_id.is.null`);
    }
  }
  if (options?.channel) {
    query = query.eq("channel", options.channel);
  }
  const { data, error } = await query;
  if (error) {
    console.warn("[d2c listTemplates]", error.message);
    return [];
  }
  return (data ?? []).map((row) =>
    mapD2CTemplate(row as unknown as Record<string, unknown>),
  );
}

export async function upsertD2CTemplate(
  supabase: AnySupabaseClient,
  input: UpsertD2CTemplateInput,
): Promise<D2CTemplate | null> {
  const sb = asAny(supabase);
  const row: Record<string, unknown> = {
    user_id: input.userId,
    client_id: input.clientId,
    name: input.name,
    channel: input.channel,
    subject: input.subject ?? null,
    body_markdown: input.bodyMarkdown,
    variables_jsonb: input.variablesJsonb ?? [],
    updated_at: new Date().toISOString(),
  };
  if (input.id) row.id = input.id;
  const { data, error } = await sb
    .from("d2c_templates")
    .upsert(row)
    .select("*")
    .maybeSingle();
  if (error) {
    console.warn("[d2c upsertTemplate]", error.message);
    return null;
  }
  return data
    ? mapD2CTemplate(data as unknown as Record<string, unknown>)
    : null;
}

export async function deleteD2CTemplate(
  supabase: AnySupabaseClient,
  id: string,
): Promise<void> {
  const sb = asAny(supabase);
  const { error } = await sb.from("d2c_templates").delete().eq("id", id);
  if (error) console.warn("[d2c deleteTemplate]", error.message);
}

// ─── d2c_scheduled_sends ─────────────────────────────────────────────────

export interface InsertD2CScheduledSendInput {
  userId: string;
  eventId: string;
  templateId: string;
  connectionId: string;
  channel: D2CChannel;
  audience: Record<string, unknown>;
  variables: Record<string, unknown>;
  scheduledFor: string;
  status?: D2CScheduledSendStatus;
  resultJsonb?: unknown;
  dryRun?: boolean;
  approvalStatus?: D2CScheduledSendApprovalStatus;
}

export async function listScheduledSendsForEvent(
  supabase: AnySupabaseClient,
  eventId: string,
): Promise<D2CScheduledSend[]> {
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("d2c_scheduled_sends")
    .select("*")
    .eq("event_id", eventId)
    .order("scheduled_for", { ascending: true });
  if (error) {
    console.warn("[d2c listScheduledSends]", error.message);
    return [];
  }
  return (data ?? []).map((row) =>
    mapD2CScheduledSend(row as unknown as Record<string, unknown>),
  );
}

export async function insertScheduledSend(
  supabase: AnySupabaseClient,
  input: InsertD2CScheduledSendInput,
): Promise<D2CScheduledSend | null> {
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("d2c_scheduled_sends")
    .insert({
      user_id: input.userId,
      event_id: input.eventId,
      template_id: input.templateId,
      connection_id: input.connectionId,
      channel: input.channel,
      audience: input.audience,
      variables: input.variables,
      scheduled_for: input.scheduledFor,
      status: input.status ?? "scheduled",
      result_jsonb: input.resultJsonb ?? null,
      dry_run: input.dryRun ?? true,
      approval_status: input.approvalStatus ?? "pending_approval",
    })
    .select("*")
    .maybeSingle();
  if (error) {
    console.warn("[d2c insertScheduledSend]", error.message);
    return null;
  }
  return data
    ? mapD2CScheduledSend(data as unknown as Record<string, unknown>)
    : null;
}

export async function updateScheduledSendStatus(
  supabase: AnySupabaseClient,
  id: string,
  patch: {
    status?: D2CScheduledSendStatus;
    resultJsonb?: unknown;
    dryRun?: boolean;
    approvalStatus?: D2CScheduledSendApprovalStatus;
    approvedBy?: string | null;
    approvedAt?: string | null;
  },
): Promise<D2CScheduledSend | null> {
  const sb = asAny(supabase);
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.resultJsonb !== undefined) update.result_jsonb = patch.resultJsonb;
  if (patch.dryRun !== undefined) update.dry_run = patch.dryRun;
  if (patch.approvalStatus !== undefined)
    update.approval_status = patch.approvalStatus;
  if (patch.approvedBy !== undefined) update.approved_by = patch.approvedBy;
  if (patch.approvedAt !== undefined) update.approved_at = patch.approvedAt;
  const { data, error } = await sb
    .from("d2c_scheduled_sends")
    .update(update)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) {
    console.warn("[d2c updateScheduledSendStatus]", error.message);
    return null;
  }
  return data
    ? mapD2CScheduledSend(data as unknown as Record<string, unknown>)
    : null;
}

export async function deleteScheduledSend(
  supabase: AnySupabaseClient,
  id: string,
): Promise<void> {
  const sb = asAny(supabase);
  const { error } = await sb.from("d2c_scheduled_sends").delete().eq("id", id);
  if (error) console.warn("[d2c deleteScheduledSend]", error.message);
}
