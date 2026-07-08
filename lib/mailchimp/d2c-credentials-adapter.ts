import "server-only";

import { resolveMailchimpCredentials } from "../d2c/mailchimp/credentials.ts";
import type { MailchimpCredentials } from "./credentials.ts";

/**
 * lib/mailchimp/d2c-credentials-adapter.ts
 *
 * Bridges the D2C onboarding credential store (`d2c_connections`, decrypted
 * with `D2C_TOKEN_KEY` via `getD2CConnectionCredentials`) into the shape the
 * classic tag-tracking arc expects (`MailchimpCredentials` — `{ apiKey, dc,
 * ... }`, normally sourced from `clients.mailchimp_account_id` +
 * `mailchimp_accounts` / `MAILCHIMP_TOKEN_KEY`).
 *
 * Fallback path only: `handleProfileUpdate` tries the legacy
 * `clients.mailchimp_account_id` route first and only reaches this when that
 * yields nothing — i.e. for every D2C-only client (Throwback, Hop on the
 * Top, ...) whose Mailchimp credentials were captured through the D2C
 * connection UI instead of the older per-account flow.
 *
 * Reuses `resolveMailchimpCredentials` (the same resolver the live D2C send
 * path already uses) rather than re-implementing the `d2c_connections`
 * lookup + decrypt + `server_prefix`/`parseMailchimpApiKey` cross-check —
 * one source of truth for "how do we get Mailchimp creds for a D2C client".
 */
export async function getMailchimpCredsFromD2CConnection(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  clientId: string | null | undefined,
  audienceId?: string | null,
): Promise<MailchimpCredentials | null> {
  if (!clientId) return null;
  const resolved = await resolveMailchimpCredentials({ supabase, clientId });
  if (!resolved) {
    console.warn(
      `[mailchimp d2c-credentials-adapter] no active d2c_connections mailchimp row for client=${clientId} audience=${audienceId ?? "unknown"}`,
    );
    return null;
  }
  return {
    apiKey: resolved.apiKey,
    dc: resolved.serverPrefix,
    loginId: null,
    accountName: null,
  };
}
