import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  D2CBriefIngestJob,
  D2CBriefIngestSource,
  D2CBriefIngestStatus,
  D2CChannel,
  D2CConnection,
  D2CConnectionStatus,
  D2CEventCopy,
  D2CEventCopyBundle,
  D2CJobType,
  D2CProviderName,
  D2CScheduledSend,
  D2CScheduledSendApprovalStatus,
  D2CScheduledSendStatus,
  D2CTemplate,
} from "@/lib/d2c/types";
import type { EventVariablesSource } from "@/lib/d2c/event-variables";
import { getD2CTokenKey } from "../d2c/secrets.ts";

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
    job_type: (raw.job_type as D2CJobType | null) ?? null,
    idempotency_key: (raw.idempotency_key as string | null) ?? null,
    bird_campaign_id: (raw.bird_campaign_id as string | null) ?? null,
    bird_broadcast_id: (raw.bird_broadcast_id as string | null) ?? null,
    bird_campaign_edit_url: (raw.bird_campaign_edit_url as string | null) ?? null,
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

export async function getD2CTemplateById(
  supabase: AnySupabaseClient,
  id: string,
): Promise<D2CTemplate | null> {
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("d2c_templates")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.warn("[d2c getTemplateById]", error.message);
    return null;
  }
  return data
    ? mapD2CTemplate(data as unknown as Record<string, unknown>)
    : null;
}

// ─── events (read-only helpers for send-content resolution) ────────────────

export interface D2CEventVariablesRow extends EventVariablesSource {
  user_id: string;
}

/**
 * The event columns `resolveEventVariables` (lib/d2c/event-variables.ts)
 * needs, plus `user_id` for ownership checks. Mirrors the cron's own
 * `fetchEventForCron` — shared here so the test-send route (and any other
 * caller that needs to preview/resend a send's real content) doesn't
 * duplicate the query.
 */
export async function getEventVariablesSource(
  supabase: AnySupabaseClient,
  eventId: string,
): Promise<D2CEventVariablesRow | null> {
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("events")
    .select(
      "name, event_date, event_start_at, event_timezone, ticket_url, presale_at, general_sale_at, venue_name, venue_city, user_id",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (error) {
    console.warn("[d2c getEventVariablesSource]", error.message);
    return null;
  }
  return data as D2CEventVariablesRow | null;
}

/** Headliner artist names for `{{artist_headliners}}`. Mirrors the cron's `listHeadlinerNamesForCron`. */
export async function listEventHeadlinerNames(
  supabase: AnySupabaseClient,
  eventId: string,
): Promise<string[]> {
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("event_artists")
    .select("is_headliner, artist:artists ( name )")
    .eq("event_id", eventId)
    .order("billing_order", { ascending: true });
  if (error || !data) return [];
  const names: string[] = [];
  for (const row of data as {
    is_headliner: boolean;
    artist: { name: string } | { name: string }[] | null;
  }[]) {
    if (!row.is_headliner) continue;
    const rel = row.artist;
    const a = Array.isArray(rel) ? rel[0] : rel;
    if (a?.name) names.push(a.name);
  }
  return names;
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
  jobType?: D2CJobType | null;
  idempotencyKey?: string | null;
}

export async function updateScheduledSendAudience(
  supabase: AnySupabaseClient,
  id: string,
  audience: Record<string, unknown>,
): Promise<D2CScheduledSend | null> {
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("d2c_scheduled_sends")
    .update({ audience, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) {
    console.warn("[d2c updateScheduledSendAudience]", error.message);
    return null;
  }
  return data
    ? mapD2CScheduledSend(data as unknown as Record<string, unknown>)
    : null;
}

export async function getScheduledSendById(
  supabase: AnySupabaseClient,
  id: string,
): Promise<D2CScheduledSend | null> {
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("d2c_scheduled_sends")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.warn("[d2c getScheduledSendById]", error.message);
    return null;
  }
  return data
    ? mapD2CScheduledSend(data as unknown as Record<string, unknown>)
    : null;
}

/**
 * Fetch the (single) autoresp_setup send for an event on a channel. Used by the
 * autoresponder fire paths (Mailchimp webhook = email, Bird poll = whatsapp).
 */
export async function getAutorespSendForEvent(
  supabase: AnySupabaseClient,
  eventId: string,
  channel: D2CChannel,
): Promise<D2CScheduledSend | null> {
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("d2c_scheduled_sends")
    .select("*")
    .eq("event_id", eventId)
    .eq("job_type", "autoresp_setup")
    .eq("channel", channel)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[d2c getAutorespSendForEvent]", error.message);
    return null;
  }
  return data
    ? mapD2CScheduledSend(data as unknown as Record<string, unknown>)
    : null;
}

/** All armed-or-not autoresp_setup sends on a channel (Bird poll cron scan). */
export async function listAutorespSendsByChannel(
  supabase: AnySupabaseClient,
  channel: D2CChannel,
): Promise<D2CScheduledSend[]> {
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("d2c_scheduled_sends")
    .select("*")
    .eq("job_type", "autoresp_setup")
    .eq("channel", channel);
  if (error) {
    console.warn("[d2c listAutorespSendsByChannel]", error.message);
    return [];
  }
  return (data ?? []).map((row) =>
    mapD2CScheduledSend(row as unknown as Record<string, unknown>),
  );
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
      job_type: input.jobType ?? null,
      idempotency_key: input.idempotencyKey ?? null,
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

/**
 * Idempotent insert keyed on `idempotency_key` (migration 124). Used by the
 * brief processor so re-running an ingest does not create duplicate sends.
 * Requires `idempotencyKey` to be set on the input.
 */
export async function upsertScheduledSendByIdempotencyKey(
  supabase: AnySupabaseClient,
  input: InsertD2CScheduledSendInput & { idempotencyKey: string },
): Promise<D2CScheduledSend | null> {
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("d2c_scheduled_sends")
    .upsert(
      {
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
        job_type: input.jobType ?? null,
        idempotency_key: input.idempotencyKey,
      },
      { onConflict: "idempotency_key" },
    )
    .select("*")
    .maybeSingle();
  if (error) {
    console.warn("[d2c upsertScheduledSendByIdempotencyKey]", error.message);
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
    birdCampaignId?: string | null;
    birdBroadcastId?: string | null;
    birdCampaignEditUrl?: string | null;
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
  if (patch.birdCampaignId !== undefined)
    update.bird_campaign_id = patch.birdCampaignId;
  if (patch.birdBroadcastId !== undefined)
    update.bird_broadcast_id = patch.birdBroadcastId;
  if (patch.birdCampaignEditUrl !== undefined)
    update.bird_campaign_edit_url = patch.birdCampaignEditUrl;
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

// ─── d2c_event_copy (migration 124) ──────────────────────────────────────

function mapD2CEventCopy(raw: Record<string, unknown>): D2CEventCopy {
  const bundle =
    raw.copy_jsonb && typeof raw.copy_jsonb === "object"
      ? (raw.copy_jsonb as D2CEventCopyBundle)
      : {};
  return {
    id: raw.id as string,
    user_id: raw.user_id as string,
    event_id: raw.event_id as string,
    client_id: raw.client_id as string,
    artwork_url: (raw.artwork_url as string | null) ?? null,
    whatsapp_community_url: (raw.whatsapp_community_url as string | null) ?? null,
    copy_jsonb: bundle,
    source_brief_job_id: (raw.source_brief_job_id as string | null) ?? null,
    created_at: raw.created_at as string,
    updated_at: raw.updated_at as string,
  };
}

export async function getD2CEventCopy(
  supabase: AnySupabaseClient,
  eventId: string,
): Promise<D2CEventCopy | null> {
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("d2c_event_copy")
    .select("*")
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) {
    console.warn("[d2c getD2CEventCopy]", error.message);
    return null;
  }
  return data
    ? mapD2CEventCopy(data as unknown as Record<string, unknown>)
    : null;
}

export interface UpsertD2CEventCopyInput {
  userId: string;
  eventId: string;
  clientId: string;
  artworkUrl?: string | null;
  whatsappCommunityUrl?: string | null;
  copyJsonb: D2CEventCopyBundle;
  sourceBriefJobId?: string | null;
}

export async function upsertD2CEventCopy(
  supabase: AnySupabaseClient,
  input: UpsertD2CEventCopyInput,
): Promise<D2CEventCopy | null> {
  const sb = asAny(supabase);
  const row: Record<string, unknown> = {
    user_id: input.userId,
    event_id: input.eventId,
    client_id: input.clientId,
    copy_jsonb: input.copyJsonb,
    updated_at: new Date().toISOString(),
  };
  if (input.artworkUrl !== undefined) row.artwork_url = input.artworkUrl;
  if (input.whatsappCommunityUrl !== undefined)
    row.whatsapp_community_url = input.whatsappCommunityUrl;
  if (input.sourceBriefJobId !== undefined)
    row.source_brief_job_id = input.sourceBriefJobId;

  const { data, error } = await sb
    .from("d2c_event_copy")
    .upsert(row, { onConflict: "event_id" })
    .select("*")
    .maybeSingle();
  if (error) {
    console.warn("[d2c upsertD2CEventCopy]", error.message);
    return null;
  }
  return data
    ? mapD2CEventCopy(data as unknown as Record<string, unknown>)
    : null;
}

/** Patch just the artwork URL / community URL on an existing copy row. */
export async function updateD2CEventCopyFields(
  supabase: AnySupabaseClient,
  eventId: string,
  patch: { artworkUrl?: string | null; whatsappCommunityUrl?: string | null },
): Promise<D2CEventCopy | null> {
  const sb = asAny(supabase);
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.artworkUrl !== undefined) update.artwork_url = patch.artworkUrl;
  if (patch.whatsappCommunityUrl !== undefined)
    update.whatsapp_community_url = patch.whatsappCommunityUrl;
  const { data, error } = await sb
    .from("d2c_event_copy")
    .update(update)
    .eq("event_id", eventId)
    .select("*")
    .maybeSingle();
  if (error) {
    console.warn("[d2c updateD2CEventCopyFields]", error.message);
    return null;
  }
  return data
    ? mapD2CEventCopy(data as unknown as Record<string, unknown>)
    : null;
}

// ─── d2c_brief_ingest_jobs (migration 125) ───────────────────────────────

function mapBriefIngestJob(raw: Record<string, unknown>): D2CBriefIngestJob {
  return {
    id: raw.id as string,
    user_id: raw.user_id as string,
    client_id: raw.client_id as string,
    source: raw.source as D2CBriefIngestSource,
    source_uri: (raw.source_uri as string | null) ?? null,
    status: raw.status as D2CBriefIngestStatus,
    result_event_id: (raw.result_event_id as string | null) ?? null,
    error: (raw.error as string | null) ?? null,
    created_at: raw.created_at as string,
    updated_at: raw.updated_at as string,
  };
}

export async function insertBriefIngestJob(
  supabase: AnySupabaseClient,
  input: {
    userId: string;
    clientId: string;
    source: D2CBriefIngestSource;
    sourceUri?: string | null;
  },
): Promise<D2CBriefIngestJob | null> {
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("d2c_brief_ingest_jobs")
    .insert({
      user_id: input.userId,
      client_id: input.clientId,
      source: input.source,
      source_uri: input.sourceUri ?? null,
      status: "pending",
    })
    .select("*")
    .maybeSingle();
  if (error) {
    console.warn("[d2c insertBriefIngestJob]", error.message);
    return null;
  }
  return data
    ? mapBriefIngestJob(data as unknown as Record<string, unknown>)
    : null;
}

export async function getBriefIngestJob(
  supabase: AnySupabaseClient,
  id: string,
): Promise<D2CBriefIngestJob | null> {
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("d2c_brief_ingest_jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.warn("[d2c getBriefIngestJob]", error.message);
    return null;
  }
  return data
    ? mapBriefIngestJob(data as unknown as Record<string, unknown>)
    : null;
}

export async function updateBriefIngestJob(
  supabase: AnySupabaseClient,
  id: string,
  patch: {
    status?: D2CBriefIngestStatus;
    resultEventId?: string | null;
    error?: string | null;
  },
): Promise<D2CBriefIngestJob | null> {
  const sb = asAny(supabase);
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.resultEventId !== undefined)
    update.result_event_id = patch.resultEventId;
  if (patch.error !== undefined) update.error = patch.error;
  const { data, error } = await sb
    .from("d2c_brief_ingest_jobs")
    .update(update)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) {
    console.warn("[d2c updateBriefIngestJob]", error.message);
    return null;
  }
  return data
    ? mapBriefIngestJob(data as unknown as Record<string, unknown>)
    : null;
}
