/**
 * lib/d2c/mailchimp/credentials.ts
 *
 * Resolve per-client Mailchimp credentials ({apiKey, serverPrefix}).
 *
 * Resolution order:
 *   1. d2c_connections row for (client_id, provider='mailchimp') — decrypted
 *      via get_d2c_credentials RPC. This is the production source of truth.
 *   2. Environment variable fallback (local dev only) — logs a warning.
 *
 * Mailchimp keys are `<key>-<dc>` where the datacenter suffix (e.g. us7) is
 * also the server prefix. The full string is used as the Basic-auth password.
 */

export interface MailchimpCredentials {
  apiKey: string;
  serverPrefix: string;
  /** Where the credential came from — for logging / audit. */
  source: "connection" | "env";
  connectionId?: string;
}

/** Parse a `<key>-us7` style Mailchimp API key into {apiKey, serverPrefix}. */
export function parseMailchimpApiKey(raw: string): MailchimpCredentials | null {
  const key = raw.trim();
  const dash = key.lastIndexOf("-");
  if (dash <= 0 || dash === key.length - 1) return null;
  const serverPrefix = key.slice(dash + 1);
  if (!/^[a-z]{2}\d{1,3}$/i.test(serverPrefix)) return null;
  return { apiKey: key, serverPrefix, source: "env" };
}

function fromEnv(envVarName: string): MailchimpCredentials | null {
  const raw = process.env[envVarName];
  if (!raw) return null;
  const parsed = parseMailchimpApiKey(raw);
  if (!parsed) {
    console.warn(`[d2c mailchimp creds] ${envVarName} is set but not a valid <key>-<dc> Mailchimp key`);
    return null;
  }
  console.warn(
    `[d2c mailchimp creds] using env fallback ${envVarName} (dc=${parsed.serverPrefix}) — local dev only. Seed d2c_connections for production.`,
  );
  return parsed;
}

/**
 * Resolve Mailchimp credentials for a client. Tries the encrypted
 * d2c_connections row first (if a supabase client + clientId are given),
 * then falls back to the named env var.
 *
 * The d2c DB layer imports `server-only`, so it is dynamically imported here
 * and never pulled into env-only callers (e.g. the local CLI).
 */
export async function resolveMailchimpCredentials(opts: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any | null;
  clientId?: string | null;
  /** Env var to fall back to (default JACKIES_MAILCHIMP_API_KEY). */
  envVarName?: string;
}): Promise<MailchimpCredentials | null> {
  const envVarName = opts.envVarName ?? "JACKIES_MAILCHIMP_API_KEY";

  if (opts.supabase && opts.clientId) {
    try {
      const { getD2CConnectionCredentials, listD2CConnectionsForUser } =
        await import("../../db/d2c.ts");
      const conns = await listD2CConnectionsForUser(opts.supabase, {
        clientId: opts.clientId,
      });
      const mc = conns.find((c) => c.provider === "mailchimp");
      if (mc) {
        const creds = await getD2CConnectionCredentials(opts.supabase, mc.id);
        const apiKey =
          creds && typeof creds.api_key === "string" ? creds.api_key.trim() : "";
        const serverPrefix =
          creds && typeof creds.server_prefix === "string"
            ? creds.server_prefix.trim()
            : parseMailchimpApiKey(apiKey)?.serverPrefix ?? "";
        if (apiKey && serverPrefix) {
          return { apiKey, serverPrefix, source: "connection", connectionId: mc.id };
        }
        console.warn(
          `[d2c mailchimp creds] connection ${mc.id} missing api_key/server_prefix — falling back to env`,
        );
      }
    } catch (e) {
      console.warn(
        "[d2c mailchimp creds] connection lookup failed, falling back to env:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  return fromEnv(envVarName);
}
