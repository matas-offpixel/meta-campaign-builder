import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../db/database.types.ts";
import { resolveServerMetaToken } from "./server-token.ts";
import { resolveSystemUserToken } from "./system-user-token.ts";

type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * Inline copy of `lib/db/clients.ts#findClientByMetaAdAccountId` —
 * inlined deliberately so this resolver doesn't drag the browser-side
 * `lib/supabase/client` import (which `lib/db/clients.ts` pulls at
 * module load) into Node test environments. The two implementations
 * MUST stay equivalent; the canonical helper continues to live in
 * `lib/db/clients.ts` for non-resolver callers.
 */
async function findClientByMetaAdAccountIdInline(
  supabase: TypedSupabaseClient,
  adAccountId: string,
): Promise<{ id: string; userId: string } | null> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, user_id")
    .eq("meta_ad_account_id", adAccountId)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(
      `[findClientByMetaAdAccountId] lookup failed ad_account_id=${adAccountId} msg=${error.message}`,
    );
    return null;
  }
  if (!data) return null;
  return { id: data.id, userId: data.user_id };
}

/**
 * lib/meta/audience-write-token.ts
 *
 * Phase 1 canary token resolver for the audience-builder bulk writes
 * (see `docs/META_TOKEN_ARCHITECTURE_2026-05-11.md` §5). Lives in its
 * own file (no `import "server-only"`) so the unit tests can import it
 * directly without a `server-only` package shim — the runtime safety
 * comes from `createServiceRoleClient` (used downstream) requiring
 * the server-only `SUPABASE_SERVICE_ROLE_KEY` env var, which is the
 * same posture as `lib/meta/server-token.ts`.
 *
 * Resolution order:
 *   1. Look up the client owning the ad account via
 *      `findClientByMetaAdAccountId`.
 *   2. If found, try the per-client System User token. The resolver
 *      itself returns `null` when the feature flag is off, the env
 *      key is missing, the column is unset, or the RPC errors — so
 *      we never block on the new path.
 *   3. Fall back to `resolveServerMetaToken` (personal OAuth + env
 *      var) for every miss.
 *
 * Returns the token *and* its source so callers can include it in
 * downstream telemetry (`tokenSource=system_user|db|env`).
 */
export async function resolveAudienceWriteToken(
  supabase: TypedSupabaseClient,
  args: { userId: string; metaAdAccountId: string; audienceId: string },
  options: {
    /**
     * Test-only escape hatch — injected service-role client for the
     * `resolveSystemUserToken` RPC. Production callers leave this
     * unset and the resolver instantiates a fresh service-role
     * client.
     */
    injectedServiceRoleClient?: SupabaseClient;
  } = {},
): Promise<{ token: string; source: "system_user" | "db" | "env" }> {
  const owning = await findClientByMetaAdAccountIdInline(
    supabase,
    args.metaAdAccountId,
  );
  if (owning) {
    const systemUser = await resolveSystemUserToken(owning.id, supabase, {
      injectedServiceRoleClient: options.injectedServiceRoleClient,
    });
    if (systemUser) {
      console.info(
        `[audience-write] tokenSource=system_user audienceId=${args.audienceId} clientId=${owning.id} adAccountId=${args.metaAdAccountId}`,
      );
      return { token: systemUser.token, source: "system_user" };
    }
  } else {
    console.warn(
      `[audience-write] no client row for ad_account_id=${args.metaAdAccountId} — using personal token`,
    );
  }
  const personal = await resolveServerMetaToken(supabase, args.userId);
  console.info(
    `[audience-write] tokenSource=${personal.source} audienceId=${args.audienceId} adAccountId=${args.metaAdAccountId}`,
  );
  return { token: personal.token, source: personal.source };
}
