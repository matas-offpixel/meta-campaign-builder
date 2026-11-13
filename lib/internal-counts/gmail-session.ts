/**
 * lib/internal-counts/gmail-session.ts
 *
 * The connected inbox, ready to read: connection row, decrypted refresh
 * token, a fresh access token and a Gmail client. Shared by the cron and
 * the backfill script. Returns a reason instead of throwing when Gmail
 * isn't connected or configured, so the cron can answer 200 with it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { GmailClient } from "../gmail/client.ts";
import { gmailTokenKey, loadGmailConnection, loadGmailRefreshToken, type GmailConnectionRow } from "../gmail/connection.ts";
import { gmailOAuthConfigFromEnv, refreshGmailAccessToken } from "../gmail/oauth.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export type GmailSession =
  | { ok: true; connection: GmailConnectionRow; gmail: GmailClient }
  | { ok: false; reason: string };

export async function openGmailSession(sb: Db, env: NodeJS.ProcessEnv = process.env): Promise<GmailSession> {
  const { config, missing } = gmailOAuthConfigFromEnv(env);
  if (!config) return { ok: false, reason: `not_configured: ${missing.join(", ")}` };
  const key = gmailTokenKey(env);
  if (!key) return { ok: false, reason: "not_configured: GMAIL_TOKEN_KEY" };
  const connection = await loadGmailConnection(sb);
  if (!connection) return { ok: false, reason: "gmail_not_connected" };
  const refresh = await loadGmailRefreshToken(sb, connection.id, key);
  if (!refresh) return { ok: false, reason: "gmail_not_connected" };
  const token = await refreshGmailAccessToken(refresh, config);
  return { ok: true, connection, gmail: new GmailClient(token.access_token) };
}
