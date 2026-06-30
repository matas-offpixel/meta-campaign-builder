import { createServiceRoleClient } from "@/lib/supabase/server";
import { loadClientPortalByClientId } from "@/lib/db/client-portal-server";
import { writeClientPortalSnapshot } from "@/lib/reporting/client-portal-snapshot";

/**
 * lib/reporting/client-portal-snapshot-runner.ts
 *
 * Walks every active client and pre-populates `client_portal_snapshots`
 * (migration 123) so the dashboard read path serves a warm payload. Mirrors
 * the `active-creatives-refresh-runner` shape: resolve the work set once,
 * isolate per-client failures, return a structured summary.
 *
 * SEQUENTIAL by design (memory: feedback_supabase_burstable_compute_cascade) —
 * the portal loader is the single heaviest query path in the app, and we run
 * on Nano Supabase (500MB RAM). Fanning out across clients in parallel risks a
 * memory + connection-pool cascade. One client at a time, with a per-client
 * timeout so one slow/stuck client can't starve the rest of the batch.
 *
 * `console.error` for every production-diagnostic log
 * (memory: feedback_vercel_log_filtering_console_error_only).
 *
 * No `import "server-only"`: only reached from the cron route + (optional)
 * admin route, and omitting it keeps the module raw-Node importable.
 */

/** Per-client ceiling. A client that exceeds this is logged + skipped. */
export const CLIENT_PORTAL_REFRESH_TIMEOUT_MS = 30_000;

export interface RefreshAllResult {
  ok: number;
  failed: string[];
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Refresh the portal snapshot for every active client.
 *
 * Client set: `status != 'archived'` — active + paused clients are still
 * surfaced across the dashboard (Today pacing alerts, client list, per-client
 * detail), so their snapshots are worth keeping warm. Archived clients are
 * hidden from the dashboard, so caching them would be wasted work + memory.
 * (`clients` has no soft-delete column; `status` is the only lifecycle flag.)
 */
export async function refreshAllClientPortalSnapshots(): Promise<RefreshAllResult> {
  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (err) {
    console.error(
      `[client-portal-refresh] service-role client unavailable: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { ok: 0, failed: [] };
  }

  const { data: clients, error } = await admin
    .from("clients")
    .select("id")
    .neq("status", "archived");
  if (error) {
    console.error(
      `[client-portal-refresh] failed to enumerate clients: ${error.message}`,
    );
    return { ok: 0, failed: [] };
  }

  const clientIds = (clients ?? []).map((c) => c.id as string);
  console.error(
    `[client-portal-refresh] start clients=${clientIds.length}`,
  );

  let ok = 0;
  const failed: string[] = [];

  // SEQUENTIAL — never Promise.all (memory pressure on Nano).
  for (const clientId of clientIds) {
    const t0 = Date.now();
    try {
      // force=true → skip the snapshot read; always do a fresh live load so
      // the cron writes current data, never re-caches a stale snapshot.
      const portal = await withTimeout(
        loadClientPortalByClientId(clientId, { force: true }),
        CLIENT_PORTAL_REFRESH_TIMEOUT_MS,
        `loadClientPortalByClientId(${clientId})`,
      );
      // writeClientPortalSnapshot throws on a non-ok / incomplete payload —
      // that propagates into the catch below so a failed load never
      // overwrites the last-good snapshot.
      await writeClientPortalSnapshot(clientId, portal);
      ok += 1;
      console.error(
        `[client-portal-refresh] client=${clientId} ok dur_ms=${Date.now() - t0}`,
      );
    } catch (err) {
      failed.push(clientId);
      console.error(
        `[client-portal-refresh] client=${clientId} failed dur_ms=${Date.now() - t0} msg=${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // CONTINUE — one client's failure must not abort the batch.
    }
  }

  console.error(
    `[client-portal-refresh] done ok=${ok} failed=${failed.length}`,
  );
  return { ok, failed };
}
