import { getCurrentBuildVersion } from "@/lib/build-version";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import type { ClientPortalData } from "@/lib/db/client-portal-server";

/**
 * lib/reporting/client-portal-snapshot.ts
 *
 * Read + write helpers for `client_portal_snapshots` (migration 123) — the
 * snapshot-first cache for the INTERNAL client portal payload. One row per
 * `(client_id, build_version)` carrying the full `ClientPortalData` ok-payload
 * so a cold `/clients/[id]` (and `/clients/[id]/dashboard`) load serves from
 * Postgres in <1s instead of re-running the 10+ step service-role waterfall.
 *
 * Applies the PR #87 (`active_creatives_snapshots`) pattern, with two
 * deliberate differences:
 *   - Reader uses the RLS-enforced anon (cookie-bound) client so a user only
 *     ever sees snapshots for clients they own (migration 123's owner-read
 *     policy). The live loader already trusts caller ownership, but the cache
 *     read re-asserts it via RLS as defence in depth.
 *   - Writer uses the service-role client (bypasses RLS) and REFUSES to
 *     persist anything but a complete `ok` payload — last-good > garbage, the
 *     same refusal contract as `writeActiveCreativesSnapshot`.
 *
 * No `import "server-only"`: both exports are only ever reached from server
 * transports (the portal loader + the refresh cron), and omitting the
 * directive keeps the module importable under raw Node for unit tests, same
 * rationale as `active-creatives-refresh-runner.ts`.
 */

const TABLE = "client_portal_snapshots";

/** Default freshness window — a snapshot older than this is treated as a miss. */
export const CLIENT_PORTAL_SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000;

interface SnapshotRow {
  payload_jsonb: ClientPortalData;
  refreshed_at: string;
  build_version: string;
}

/**
 * Look up the freshest snapshot for `clientId` written by the CURRENT build.
 *
 * Returns null (→ caller falls back to a live load) on:
 *   - no row for this `(client_id, build_version)` — cron hasn't populated, or
 *     the row predates this deploy (build_version invalidation),
 *   - the row is older than `maxAgeMs`,
 *   - the stored payload isn't a complete `ok` payload (defensive),
 *   - any DB / RLS error (never 500 the dashboard over a cache miss).
 *
 * Diagnostic single-line logs (`console.error`, key=value) so cache behaviour
 * is greppable in Vercel without a debugger.
 */
export async function readClientPortalSnapshot(
  clientId: string,
  opts?: { maxAgeMs?: number },
): Promise<ClientPortalData | null> {
  if (!clientId) return null;
  const maxAgeMs = opts?.maxAgeMs ?? CLIENT_PORTAL_SNAPSHOT_MAX_AGE_MS;
  const build = getCurrentBuildVersion();

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch (err) {
    console.error(
      `[client-portal] cache=error client=${clientId} stage=client_init msg=${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }

  // Regenerated Supabase types may not include migration 123 yet; cast to
  // reach the new table without polluting the typed surface. Same pattern as
  // active-creatives-snapshots.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const { data, error } = await sb
    .from(TABLE)
    .select("payload_jsonb, refreshed_at, build_version")
    .eq("client_id", clientId)
    .eq("build_version", build)
    .order("refreshed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(
      `[client-portal] cache=error client=${clientId} stage=read msg=${error.message}`,
    );
    return null;
  }
  if (!data) {
    console.error(`[client-portal] cache=miss client=${clientId} build=${build}`);
    return null;
  }

  const row = data as SnapshotRow;
  const refreshedMs = new Date(row.refreshed_at).getTime();
  const ageMs = Number.isFinite(refreshedMs)
    ? Date.now() - refreshedMs
    : Number.POSITIVE_INFINITY;
  if (ageMs > maxAgeMs) {
    console.error(
      `[client-portal] cache=stale client=${clientId} age_ms=${Math.round(ageMs)} max_age_ms=${maxAgeMs}`,
    );
    return null;
  }

  const payload = row.payload_jsonb;
  if (!payload || payload.ok !== true) {
    // Should never happen — the writer refuses non-ok payloads — but never
    // serve a degraded cached result; fall back to a live load.
    console.error(`[client-portal] cache=invalid client=${clientId}`);
    return null;
  }

  console.error(
    `[client-portal] cache=hit client=${clientId} age_ms=${Math.round(ageMs)} build=${build}`,
  );
  return payload;
}

/**
 * Persist a fresh `ClientPortalData` snapshot for `clientId`. Service-role
 * only — throws if `SUPABASE_SERVICE_ROLE_KEY` is missing.
 *
 * Refusal contract (mirrors `writeActiveCreativesSnapshot`): a snapshot is
 * only worth writing if it's a COMPLETE `ok` payload. A null / non-ok /
 * structurally-incomplete payload would overwrite a good last-known-good row
 * with garbage, so we THROW instead — the runner catches per-client and keeps
 * the previous snapshot intact.
 */
export async function writeClientPortalSnapshot(
  clientId: string,
  payload: ClientPortalData,
): Promise<void> {
  if (!clientId) {
    throw new Error("writeClientPortalSnapshot: clientId is required");
  }
  if (!payload || payload.ok !== true) {
    throw new Error(
      `writeClientPortalSnapshot: refusing to cache non-ok payload for client=${clientId} (reason=${
        payload && "reason" in payload ? payload.reason : "null"
      })`,
    );
  }
  if (!payload.client?.id || !Array.isArray(payload.events)) {
    throw new Error(
      `writeClientPortalSnapshot: refusing to cache structurally-incomplete payload for client=${clientId}`,
    );
  }

  // createServiceRoleClient() throws if SUPABASE_SERVICE_ROLE_KEY is unset.
  const admin = createServiceRoleClient();
  const build = getCurrentBuildVersion();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as unknown as any;
  const { error } = await sb.from(TABLE).upsert(
    {
      client_id: clientId,
      build_version: build,
      payload_jsonb: payload,
      refreshed_at: new Date().toISOString(),
    },
    { onConflict: "client_id,build_version" },
  );
  if (error) {
    throw new Error(
      `writeClientPortalSnapshot: upsert failed for client=${clientId}: ${error.message}`,
    );
  }

  // Prune snapshots from prior builds for this client. The unique key is
  // (client_id, build_version), so without this every deploy would leave a
  // dead multi-MB row behind that's never read again (readers filter on the
  // current build_version) — unbounded growth on a 500MB Nano instance. Keep
  // exactly one live row per client. Best-effort: the write already
  // succeeded, so a prune failure is logged, not thrown. A rollback to an
  // older build simply repopulates via the live-load fallback + next cron.
  const { error: pruneError } = await sb
    .from(TABLE)
    .delete()
    .eq("client_id", clientId)
    .neq("build_version", build);
  if (pruneError) {
    console.error(
      `[client-portal] prune failed client=${clientId} msg=${pruneError.message}`,
    );
  }
}
