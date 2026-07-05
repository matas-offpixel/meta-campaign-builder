import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getD2CTokenKey } from "@/lib/d2c/secrets";
import {
  toPublicConfig,
  type CrmConnectionConfig,
} from "@/lib/admin/crm-schema";

/**
 * lib/db/crm-connections.ts — admin-dashboard access to `d2c_connections`
 * for the self-service CRM integrations (OP909 Phase 8).
 *
 * All callers pass the SERVICE-ROLE client: d2c_connections RLS is keyed
 * to the OPERATOR's user_id (migration 030), not the client user's, so a
 * client admin's session can't see the rows. Authorisation therefore
 * happens in the server action via requireClientContext() + the
 * client_id filter here — same pattern as lib/db/fan-signups.ts.
 *
 * The decrypted blob never leaves the server: reads return only the
 * non-secret CrmConnectionConfig slice (api key reduced to a boolean).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

export type CrmProvider = "bird" | "mailchimp";

export interface CrmConnectionSummary {
  id: string;
  status: string;
  lastError: string | null;
  lastSyncedAt: string | null;
  liveEnabled: boolean;
  approvedByMatas: boolean;
  config: CrmConnectionConfig;
}

const EMPTY_CONFIG: CrmConnectionConfig = {
  apiKeyConfigured: false,
  workspaceId: null,
  channelId: null,
  templateProjectId: null,
  templateVersionId: null,
  serverPrefix: null,
  audienceId: null,
};

interface ConnectionRow {
  id: string;
  user_id: string;
  status: string;
  last_error: string | null;
  last_synced_at: string | null;
  live_enabled: boolean;
  approved_by_matas: boolean;
}

async function findConnectionRow(
  db: AnySupabaseClient,
  clientId: string,
  provider: CrmProvider,
): Promise<ConnectionRow | null> {
  const { data, error } = await db
    .from("d2c_connections")
    .select(
      "id, user_id, status, last_error, last_synced_at, live_enabled, approved_by_matas",
    )
    .eq("client_id", clientId)
    .eq("provider", provider)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[crm-connections] find", error.message);
    return null;
  }
  return (data as ConnectionRow | null) ?? null;
}

/**
 * Decrypt a connection's credentials blob (or null when none stored).
 * Server-action / RSC use only.
 */
export async function getDecryptedCrmCredentials(
  db: AnySupabaseClient,
  connectionId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await db.rpc("get_d2c_credentials", {
    p_id: connectionId,
    p_key: getD2CTokenKey(),
  });
  if (error) {
    console.warn("[crm-connections] decrypt", error.message);
    throw new Error(
      "Could not decrypt the stored credentials — re-save the connection.",
    );
  }
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    if (Object.keys(obj).length > 0) return obj;
  }
  return null;
}

/** Read-model for the integration pages — no secrets in the return. */
export async function getCrmConnectionSummary(
  db: AnySupabaseClient,
  clientId: string,
  provider: CrmProvider,
): Promise<CrmConnectionSummary | null> {
  const row = await findConnectionRow(db, clientId, provider);
  if (!row) return null;
  let config = EMPTY_CONFIG;
  try {
    const blob = await getDecryptedCrmCredentials(db, row.id);
    config = toPublicConfig(blob);
  } catch {
    // Undecryptable blob (rotated D2C_TOKEN_KEY) — surface as unconfigured
    // so the client can re-save rather than seeing a hard error page.
  }
  return {
    id: row.id,
    status: row.status,
    lastError: row.last_error,
    lastSyncedAt: row.last_synced_at,
    liveEnabled: row.live_enabled,
    approvedByMatas: row.approved_by_matas,
    config,
  };
}

/**
 * Create-or-update the (client, provider) connection and store the full
 * credentials blob via the set_d2c_credentials RPC (pgcrypto, migration
 * 042). Existing rows keep their original user_id (usually the operator's)
 * so cron reads and the (user_id, client_id, provider) unique key are
 * undisturbed; new rows are owned by the client user who created them.
 */
export async function saveCrmConnection(
  db: AnySupabaseClient,
  input: {
    clientId: string;
    userId: string;
    provider: CrmProvider;
    credentials: Record<string, unknown>;
    externalAccountId: string | null;
  },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const existing = await findConnectionRow(db, input.clientId, input.provider);

  let rowId: string;
  if (existing) {
    const { error } = await db
      .from("d2c_connections")
      .update({
        external_account_id: input.externalAccountId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
    rowId = existing.id;
  } else {
    const { data, error } = await db
      .from("d2c_connections")
      .insert({
        user_id: input.userId,
        client_id: input.clientId,
        provider: input.provider,
        credentials: {},
        external_account_id: input.externalAccountId,
        status: "active",
      })
      .select("id")
      .single();
    if (error || !data?.id) {
      return { ok: false, error: error?.message ?? "Insert returned no row." };
    }
    rowId = data.id as string;
  }

  const { error: rpcError } = await db.rpc("set_d2c_credentials", {
    p_id: rowId,
    p_credentials: input.credentials,
    p_key: getD2CTokenKey(),
  });
  if (rpcError) {
    // RPC failures are key-length / row-missing shaped — never echo creds.
    return { ok: false, error: `Credential save failed: ${rpcError.message}` };
  }
  return { ok: true, id: rowId };
}

/** Record the outcome of a connection test on the row. */
export async function recordCrmTestOutcome(
  db: AnySupabaseClient,
  connectionId: string,
  outcome: { ok: boolean; error?: string | null },
): Promise<void> {
  const { error } = await db
    .from("d2c_connections")
    .update(
      outcome.ok
        ? {
            status: "active",
            last_error: null,
            last_synced_at: new Date().toISOString(),
          }
        : { status: "error", last_error: outcome.error ?? "Test failed." },
    )
    .eq("id", connectionId);
  if (error) console.warn("[crm-connections] test outcome", error.message);
}
