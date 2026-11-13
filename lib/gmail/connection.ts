/**
 * lib/gmail/connection.ts
 *
 * The connected inbox and its refresh token (migration 234). The token is
 * encrypted in Postgres with GMAIL_TOKEN_KEY through set_/get_gmail_refresh_token,
 * which only the service role can call. It's never logged or returned to a page.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export function gmailTokenKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.GMAIL_TOKEN_KEY;
  return key && key.length >= 16 ? key : null;
}

export interface GmailConnectionRow {
  id: string;
  user_id: string;
  email: string;
  scope: string;
  connected_at: string;
  last_pull_at: string | null;
  last_pull_error: string | null;
}

export async function saveGmailConnection(
  sb: Db,
  input: { userId: string; email: string; scope: string; refreshToken: string; key: string },
): Promise<void> {
  const { data, error } = await sb
    .from("gmail_connections")
    .upsert(
      {
        user_id: input.userId,
        email: input.email,
        scope: input.scope,
        connected_at: new Date().toISOString(),
        last_pull_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select("id")
    .single();
  if (error) throw new Error(`gmail_connections upsert failed: ${error.message}`);
  const { error: rpcError } = await sb.rpc("set_gmail_refresh_token", {
    p_connection_id: data.id,
    p_refresh_token: input.refreshToken,
    p_key: input.key,
  });
  if (rpcError) throw new Error(`Storing the Gmail token failed: ${rpcError.message}`);
}

/** The connected inbox the pull reads (the earliest connected, if more than one). */
export async function loadGmailConnection(sb: Db): Promise<GmailConnectionRow | null> {
  const { data, error } = await sb
    .from("gmail_connections")
    .select("id,user_id,email,scope,connected_at,last_pull_at,last_pull_error")
    .order("connected_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1);
  if (error) throw new Error(`gmail_connections read failed: ${error.message}`);
  return ((data ?? [])[0] as GmailConnectionRow | undefined) ?? null;
}

export async function loadGmailRefreshToken(sb: Db, connectionId: string, key: string): Promise<string | null> {
  const { data, error } = await sb.rpc("get_gmail_refresh_token", { p_connection_id: connectionId, p_key: key });
  if (error) throw new Error(`Reading the Gmail token failed: ${error.message}`);
  return (data as string | null) ?? null;
}

export async function recordPull(sb: Db, connectionId: string, error: string | null): Promise<void> {
  await sb
    .from("gmail_connections")
    .update({ last_pull_at: new Date().toISOString(), last_pull_error: error, updated_at: new Date().toISOString() })
    .eq("id", connectionId);
}
