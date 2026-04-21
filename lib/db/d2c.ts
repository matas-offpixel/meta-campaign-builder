import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  D2CChannel,
  D2CConnection,
  D2CConnectionStatus,
  D2CProviderName,
  D2CScheduledSend,
  D2CScheduledSendStatus,
  D2CTemplate,
} from "@/lib/d2c/types";

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

// ─── d2c_connections ─────────────────────────────────────────────────────

export async function listD2CConnectionsForUser(
  supabase: AnySupabaseClient,
  options?: { clientId?: string | null },
): Promise<D2CConnection[]> {
  const sb = asAny(supabase);
  let query = sb
    .from("d2c_connections")
    .select("*")
    .order("created_at", { ascending: false });
  if (options?.clientId) {
    query = query.eq("client_id", options.clientId);
  }
  const { data, error } = await query;
  if (error) {
    console.warn("[d2c listConnections]", error.message);
    return [];
  }
  return (data ?? []) as unknown as D2CConnection[];
}

export async function getD2CConnectionById(
  supabase: AnySupabaseClient,
  id: string,
): Promise<D2CConnection | null> {
  const sb = asAny(supabase);
  const { data, error } = await sb
    .from("d2c_connections")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.warn("[d2c getConnectionById]", error.message);
    return null;
  }
  return (data as unknown as D2CConnection) ?? null;
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
  const { data, error } = await sb
    .from("d2c_connections")
    .upsert(
      {
        user_id: input.userId,
        client_id: input.clientId,
        provider: input.provider,
        credentials: input.credentials,
        external_account_id: input.externalAccountId,
        status: input.status ?? "active",
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,client_id,provider" },
    )
    .select("*")
    .maybeSingle();
  if (error) {
    console.warn("[d2c upsertConnection]", error.message);
    return null;
  }
  return (data as unknown as D2CConnection) ?? null;
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
      query = query.eq("client_id", options.clientId);
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
  return (data ?? []) as unknown as D2CTemplate[];
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
  return (data as unknown as D2CTemplate) ?? null;
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
  return (data ?? []) as unknown as D2CScheduledSend[];
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
    })
    .select("*")
    .maybeSingle();
  if (error) {
    console.warn("[d2c insertScheduledSend]", error.message);
    return null;
  }
  return (data as unknown as D2CScheduledSend) ?? null;
}

export async function updateScheduledSendStatus(
  supabase: AnySupabaseClient,
  id: string,
  patch: {
    status?: D2CScheduledSendStatus;
    resultJsonb?: unknown;
    dryRun?: boolean;
  },
): Promise<D2CScheduledSend | null> {
  const sb = asAny(supabase);
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.resultJsonb !== undefined) update.result_jsonb = patch.resultJsonb;
  if (patch.dryRun !== undefined) update.dry_run = patch.dryRun;
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
  return (data as unknown as D2CScheduledSend) ?? null;
}

export async function deleteScheduledSend(
  supabase: AnySupabaseClient,
  id: string,
): Promise<void> {
  const sb = asAny(supabase);
  const { error } = await sb.from("d2c_scheduled_sends").delete().eq("id", id);
  if (error) console.warn("[d2c deleteScheduledSend]", error.message);
}
