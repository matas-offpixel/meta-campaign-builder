import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * lib/meta/system-user-token.ts
 *
 * Note on `server-only`: we deliberately omit the
 * `import "server-only"` marker here, mirroring `lib/meta/server-token.ts`.
 * Runtime safety comes from `createServiceRoleClient` requiring
 * `SUPABASE_SERVICE_ROLE_KEY` (server-only env var). Keeping the marker
 * out lets `node --test` import the module directly without a
 * `server-only` package shim. The `createServiceRoleClient` import is
 * also lazy (dynamic) so a unit test that supplies its own
 * `injectedServiceRoleClient` doesn't pull in `next/headers` via the
 * supabase server module.
 *
 * Phase 1 of the per-client Meta token migration (see
 * `docs/META_TOKEN_ARCHITECTURE_2026-05-11.md`). Resolves a client's
 * encrypted **Meta Business Manager System User token** if one has
 * been provisioned, otherwise returns `null` so the caller can fall
 * back to the legacy personal-OAuth path
 * (`resolveServerMetaToken`). The two highest-volume non-interactive
 * paths route through here as a canary:
 *
 *   - `lib/dashboard/rollup-sync-runner.ts` (Meta leg)
 *   - `lib/meta/audience-write.ts` (createMetaCustomAudience +
 *     archive delete)
 *
 * Behavioural contract:
 *
 *   - **Never throws.** Every failure mode (env flag off, key missing,
 *     RPC error, key mismatch) is logged and produces `null`, so the
 *     caller can fall through cleanly to the personal token. We'd
 *     rather degrade silently into the existing path than block a
 *     cron run on a brand-new column.
 *   - **Service-role read only.** Migration 090 grants execute on the
 *     `get_meta_system_user_token` RPC to `service_role` only, so we
 *     deliberately ignore the caller's `supabase` argument when
 *     calling the RPC and use a fresh service-role client. The arg
 *     stays in the signature so test hooks / future callers can
 *     inject one — see `injectedServiceRoleClient` below.
 *   - **Best-effort `last_used_at` write.** A successful resolve fires
 *     the timestamp update without awaiting. If the write fails (RLS,
 *     transient network) we log and move on; the read result is
 *     authoritative.
 *
 * Feature flag: `OFFPIXEL_META_SYSTEM_USER_ENABLED=true`. With the flag
 * unset (or "false") the resolver short-circuits without touching the
 * DB so a 100 % rollback is a single env flip — no migration revert
 * needed.
 */

export type SystemUserTokenSource = "system_user";

export interface ResolvedSystemUserToken {
  token: string;
  source: SystemUserTokenSource;
}

/**
 * Returns true when the `OFFPIXEL_META_SYSTEM_USER_ENABLED` flag is
 * set to the literal string "true". Anything else (unset, "false",
 * "0") keeps the resolver dormant.
 *
 * Exported so callers can branch their telemetry on it without
 * re-reading env every call site.
 */
export function metaSystemUserEnabled(): boolean {
  return process.env.OFFPIXEL_META_SYSTEM_USER_ENABLED === "true";
}

/**
 * Soft env-var fetch — returns `null` when `META_SYSTEM_TOKEN_KEY` is
 * unset or shorter than the SQL guard's 8-char floor. Mirrors
 * `lib/ticketing/secrets.ts#tryGetEventbriteTokenKey` so the surface
 * is consistent across token families.
 */
function tryGetMetaSystemTokenKey(): string | null {
  const value = process.env.META_SYSTEM_TOKEN_KEY;
  if (!value || value.length < 8) return null;
  return value;
}

/**
 * Same as `tryGetMetaSystemTokenKey` but throws — used by the admin
 * write route where a missing key is a configuration error worth
 * surfacing as a 500.
 */
export function getMetaSystemTokenKey(): string {
  const value = process.env.META_SYSTEM_TOKEN_KEY;
  if (!value || value.length < 8) {
    throw new Error(
      "META_SYSTEM_TOKEN_KEY is not set. Add it to .env.local and Vercel " +
        "(production + preview) before saving Meta System User tokens.",
    );
  }
  return value;
}

interface ResolveOptions {
  /**
   * Optional service-role client override — primarily for tests. When
   * omitted, the resolver instantiates a fresh service-role client via
   * `createServiceRoleClient`.
   */
  injectedServiceRoleClient?: SupabaseClient;
}

/**
 * Resolves the System User token for `clientId`. Returns `null` when
 * any of the following are true:
 *
 *   - the feature flag is off
 *   - `META_SYSTEM_TOKEN_KEY` is missing
 *   - the client has no `meta_system_user_token_encrypted` blob
 *   - the RPC errors (logged, never thrown)
 *
 * Callers MUST treat `null` as "fall back to the personal-OAuth path".
 *
 * The `_supabase` parameter is kept for API symmetry with
 * `resolveServerMetaToken(supabase, userId)` and to make the call
 * sites read consistently — the actual RPC always runs on a
 * service-role client because migration 090 grants execute to that
 * role only.
 */
export async function resolveSystemUserToken(
  clientId: string,
  _supabase: SupabaseClient,
  options: ResolveOptions = {},
): Promise<ResolvedSystemUserToken | null> {
  if (!metaSystemUserEnabled()) {
    // Silent skip — this is the rollback safety guarantee called out
    // in the PR brief. No DB read, no log spam.
    return null;
  }

  const key = tryGetMetaSystemTokenKey();
  if (!key) {
    console.info(
      `[resolveSystemUserToken] tokenSource=skip clientId=${clientId} reason=no_key`,
    );
    return null;
  }

  let serviceRoleClient: SupabaseClient;
  try {
    if (options.injectedServiceRoleClient) {
      serviceRoleClient = options.injectedServiceRoleClient;
    } else {
      // Dynamic import keeps `lib/supabase/server` (which pulls
      // `next/headers`) out of the test-time module graph when a
      // caller injects its own client.
      const mod = await import("../supabase/server.ts");
      serviceRoleClient = mod.createServiceRoleClient();
    }
  } catch (err) {
    console.warn(
      `[resolveSystemUserToken] tokenSource=skip clientId=${clientId} reason=service_role_unavailable msg=${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }

  let token: string | null = null;
  try {
    const { data, error } = await serviceRoleClient.rpc(
      "get_meta_system_user_token",
      { p_client_id: clientId, p_key: key },
    );
    if (error) {
      console.warn(
        `[resolveSystemUserToken] tokenSource=skip clientId=${clientId} reason=error msg=${error.message}`,
      );
      return null;
    }
    if (typeof data === "string" && data.length > 0) {
      token = data;
    }
  } catch (err) {
    console.warn(
      `[resolveSystemUserToken] tokenSource=skip clientId=${clientId} reason=error msg=${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }

  if (!token) {
    console.info(
      `[resolveSystemUserToken] tokenSource=skip clientId=${clientId} reason=no_row`,
    );
    return null;
  }

  console.info(
    `[resolveSystemUserToken] tokenSource=system_user clientId=${clientId} prefix=${token.slice(0, 8)}…`,
  );

  // Best-effort last-used-at stamp. Fire-and-forget so the caller
  // doesn't pay the latency or care about the result. Failures here
  // are diagnostic, not fatal.
  void touchLastUsedAt(serviceRoleClient, clientId);

  return { token, source: "system_user" };
}

async function touchLastUsedAt(
  supabase: SupabaseClient,
  clientId: string,
): Promise<void> {
  try {
    // The Supabase generated types don't yet know about this column
    // (regenerated post-merge). The runtime column exists per
    // migration 090; cast through `unknown` so TS doesn't complain at
    // build time.
    const { error } = await (
      supabase as unknown as {
        from: (table: string) => {
          update: (patch: Record<string, unknown>) => {
            eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
          };
        };
      }
    )
      .from("clients")
      .update({ meta_system_user_token_last_used_at: new Date().toISOString() })
      .eq("id", clientId);
    if (error) {
      console.warn(
        `[resolveSystemUserToken] last_used_at update failed clientId=${clientId} msg=${error.message}`,
      );
    }
  } catch (err) {
    console.warn(
      `[resolveSystemUserToken] last_used_at update threw clientId=${clientId} msg=${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
