/**
 * lib/dashboard/sync-button-helpers.ts
 *
 * Small surface shared by every "trigger rollup-sync" button on the
 * dashboard: the venue fan-out button, the client-wide "Sync all"
 * button, and the per-event compact button. Keeping these helpers
 * in one place means:
 *
 *   - `safeJson` behaves the same everywhere (important — all three
 *     buttons POST the same route and encounter the same HTML-auth-
 *     redirect failure mode, and the operator diagnostics need to
 *     read consistently in devtools).
 *   - `extractErrorMessage` applies the same precedence across
 *     buttons so the inline error chip text doesn't shift depending
 *     on where you clicked "Sync".
 *   - The shared `SyncResponseBody` type stays in sync with the
 *     server's `SyncSummary` shape without each button carrying its
 *     own copy.
 */

/**
 * Subset of `SyncSummary` from the server — only the fields the
 * buttons need to surface. Kept local to `/lib/dashboard` rather
 * than importing the runner types so the client bundle doesn't
 * drag the allocator diagnostic types into the browser payload.
 */
export interface SyncResponseBody {
  ok?: boolean;
  error?: string;
  eventsSynced?: number;
  eventsSkipped?: number;
  skippedReason?: string;
  message?: string;
  /** Rollup-sync route only — `after()` thumbnail warm was scheduled. */
  thumbnailWarmQueued?: boolean;
  summary?: {
    synced?: boolean;
    metaOk?: boolean;
    metaError?: string | null;
    metaReason?: string | null;
    metaRowsUpserted?: number;
    eventbriteOk?: boolean;
    eventbriteError?: string | null;
    eventbriteReason?: string | null;
    eventbriteRowsUpserted?: number;
    allocatorOk?: boolean | null;
    allocatorError?: string | null;
    allocatorReason?: string | null;
    allocatorClassErrors?: number;
    rowsUpserted?: number;
  };
}

export function syncedTicketEvents(body: SyncResponseBody): number {
  if (typeof body.eventsSynced === "number") return body.eventsSynced;
  return body.summary?.eventbriteOk ? 1 : 0;
}

export function skippedTicketEvents(body: SyncResponseBody): number {
  if (typeof body.eventsSkipped === "number") return body.eventsSkipped;
  return body.summary?.eventbriteReason === "not_linked" ? 1 : 0;
}

/**
 * Robust JSON parser — same pattern as PR #113's
 * `additional-spend-card.tsx` helper. Distinguishes empty bodies
 * (unexpected) from HTML auth redirects (middleware bounced us to
 * /login — surfaces the DOCTYPE clipping so operators can see
 * "session expired" without opening devtools) and from real JSON.
 */
export async function safeJson<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`HTTP ${res.status}: empty response body`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `HTTP ${res.status}: non-JSON response — ${text.slice(0, 160)}`,
    );
  }
}

/**
 * Pick the most actionable error string out of a rollup-sync
 * response body. Precedence walks from the primary leg (Meta)
 * outwards; allocator errors land last because they're never
 * fatal to the overall sync and would otherwise mask a real
 * leg failure.
 */
export function extractErrorMessage(body: SyncResponseBody): string {
  const s = body.summary;
  if (s) {
    if (s.metaError) return `Meta: ${s.metaError}`;
    if (s.eventbriteError && s.eventbriteReason !== "not_linked") {
      return `Eventbrite: ${s.eventbriteError}`;
    }
    if (s.allocatorError) return `Allocator: ${s.allocatorError}`;
  }
  if (typeof body.error === "string" && body.error.length > 0) {
    return body.error;
  }
  return "Sync failed (no error detail reported)";
}

/**
 * Consistent interpretation of "did this event successfully sync?"
 * across buttons. Pre-PR #121 servers only expose `body.ok` (strict
 * AND of every leg); post-PR #121 servers expose `summary.synced`
 * which treats expected terminal states (`not_linked`,
 * `no_event_code`, `no_ad_account`) as success. Prefer the new
 * signal, fall back to the legacy one so the UI doesn't regress
 * when running against an older backend.
 */
export function isSyncSuccessful(body: SyncResponseBody): boolean {
  if (typeof body.summary?.synced === "boolean") {
    return body.summary.synced;
  }
  return body.ok !== false;
}

/**
 * Run a list of async tasks with bounded concurrency. `concurrency`
 * caps how many in-flight promises exist at once; as each resolves,
 * the next task is started. Preserves input order in the output
 * array so callers can still zip results back to their source ids.
 *
 * Why not Promise.all in chunks: chunked `Promise.all` creates
 * concurrency waves (fast task in chunk 0 has to wait for slow task
 * in chunk 0 before chunk 1 starts). A sliding window keeps the
 * pipe full and finishes faster in the common case (1 slow event,
 * N fast events).
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (completed: number, total: number) => void,
): Promise<PromiseSettledResult<R>[]> {
  const cap = Math.max(1, Math.floor(concurrency));
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let completed = 0;
  let cursor = 0;

  async function drain(): Promise<void> {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        const value = await worker(items[i], i);
        results[i] = { status: "fulfilled", value };
      } catch (err) {
        results[i] = {
          status: "rejected",
          reason: err instanceof Error ? err : new Error(String(err)),
        };
      }
      completed++;
      onProgress?.(completed, items.length);
    }
  }

  const workers = Array.from({ length: Math.min(cap, items.length) }, () =>
    drain(),
  );
  await Promise.all(workers);
  return results;
}
