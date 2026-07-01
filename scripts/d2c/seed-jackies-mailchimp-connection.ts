/**
 * scripts/d2c/seed-jackies-mailchimp-connection.ts
 *
 * Phase 3: migrate the Jackies Mailchimp key from .env.local into an encrypted
 * d2c_connections row. Idempotent (upsert on user_id,client_id,provider).
 *
 * Writes live_enabled=false, approved_by_matas=false — so this NEVER enables
 * live sends. Flipping those is a separate, deliberate Matas action.
 *
 * Requires env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * D2C_TOKEN_KEY, JACKIES_MAILCHIMP_API_KEY.
 *
 *   node --experimental-strip-types scripts/d2c/seed-jackies-mailchimp-connection.ts [--dry-run]
 */

import { createClient } from "@supabase/supabase-js";
import { parseMailchimpApiKey } from "../../lib/d2c/mailchimp/credentials.ts";

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const url = reqEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = reqEnv("SUPABASE_SERVICE_ROLE_KEY");
  const tokenKey = reqEnv("D2C_TOKEN_KEY");
  const rawKey = reqEnv("JACKIES_MAILCHIMP_API_KEY");

  const parsed = parseMailchimpApiKey(rawKey);
  if (!parsed) throw new Error("JACKIES_MAILCHIMP_API_KEY is not a valid <key>-<dc> Mailchimp key");

  const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: clients, error: cErr } = await sb
    .from("clients")
    .select("id, user_id, name")
    .ilike("name", "%jackies%")
    .limit(5);
  if (cErr) throw new Error(`clients lookup failed: ${cErr.message}`);
  if (!clients?.length) throw new Error('No client matching "%jackies%"');
  if (clients.length > 1) {
    console.warn(`Multiple Jackies clients found — using first:`, clients.map((c) => `${c.name}(${c.id})`).join(", "));
  }
  const client = clients[0] as { id: string; user_id: string; name: string };
  console.log(`Resolved client "${client.name}" id=${client.id} user=${client.user_id}`);

  if (dryRun) {
    console.log(`[DRY RUN] would upsert d2c_connections {client_id:${client.id}, provider:mailchimp, dc:${parsed.serverPrefix}, live_enabled:false, approved_by_matas:false}`);
    return;
  }

  const { data: up, error: uErr } = await sb
    .from("d2c_connections")
    .upsert(
      {
        user_id: client.user_id,
        client_id: client.id,
        provider: "mailchimp",
        credentials: {},
        external_account_id: parsed.serverPrefix,
        status: "active",
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,client_id,provider" },
    )
    .select("id, live_enabled, approved_by_matas")
    .maybeSingle();
  if (uErr) throw new Error(`upsert failed: ${uErr.message}`);
  const rowId = (up as { id: string }).id;

  const { error: rpcErr } = await sb.rpc("set_d2c_credentials", {
    p_id: rowId,
    p_credentials: { api_key: parsed.apiKey, server_prefix: parsed.serverPrefix },
    p_key: tokenKey,
  });
  if (rpcErr) throw new Error(`set_d2c_credentials failed: ${rpcErr.message}`);

  console.log(
    `✓ Seeded d2c_connections id=${rowId} provider=mailchimp dc=${parsed.serverPrefix} ` +
      `live_enabled=${(up as { live_enabled: boolean }).live_enabled} approved_by_matas=${(up as { approved_by_matas: boolean }).approved_by_matas}`,
  );
  console.log("Credentials encrypted via set_d2c_credentials. Plaintext env var can now be removed from .env.local once cron is confirmed reading from the connection.");
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
