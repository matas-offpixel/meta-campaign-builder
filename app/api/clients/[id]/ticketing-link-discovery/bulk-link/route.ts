import { after, NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { upsertEventLink } from "@/lib/db/ticketing";
import { runRollupSyncForEvent } from "@/lib/dashboard/rollup-sync-runner";

/**
 * POST /api/clients/[id]/ticketing-link-discovery/bulk-link
 *
 * Body:
 *   {
 *     selections: Array<{
 *       eventId: string,
 *       connectionId: string,
 *       externalEventId: string,
 *       externalEventUrl?: string | null,
 *     }>,
 *     syncAfterLink?: boolean,   // defaults true
 *   }
 *
 * Persists every valid selection via `upsertEventLink`, then triggers
 * rollup-sync for each linked event so ticket snapshots + daily
 * rollups populate without waiting for the cron. Sync failures are
 * reported per-event but don't block other links.
 *
 * Concurrency:
 *   - Links are inserted serially (fast, tiny DB churn).
 *   - Rollup syncs are scheduled after the response with a concurrency
 *     cap of 2 and a 500ms launch gap to respect 4thefans rate limits.
 */

interface Selection {
  eventId: string;
  connectionId: string;
  externalEventId: string;
  externalEventUrl: string | null;
}

interface BulkLinkResult {
  eventId: string;
  eventName: string | null;
  externalEventId: string | null;
  connectionProvider: string | null;
  ok: boolean;
  linkId: string | null;
  syncOk: boolean | null;
  syncError: string | null;
  linkError: string | null;
}

const DEFAULT_SYNC_CONCURRENCY = 2;
const SYNC_RETRY_DELAY_MS = 750;
const SYNC_LAUNCH_GAP_MS = 500;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function validateBody(body: unknown): {
  ok: true;
  selections: Selection[];
  syncAfterLink: boolean;
} | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;
  const raw = b.selections;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "selections must be a non-empty array" };
  }
  const selections: Selection[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: "Each selection must be an object" };
    }
    const i = item as Record<string, unknown>;
    if (
      !isNonEmptyString(i.eventId) ||
      !isNonEmptyString(i.connectionId) ||
      !isNonEmptyString(i.externalEventId)
    ) {
      return {
        ok: false,
        error:
          "selections[*] requires eventId, connectionId, externalEventId (all non-empty strings)",
      };
    }
    selections.push({
      eventId: i.eventId.trim(),
      connectionId: i.connectionId.trim(),
      externalEventId: i.externalEventId.trim(),
      externalEventUrl:
        typeof i.externalEventUrl === "string" &&
        i.externalEventUrl.trim().length > 0
          ? i.externalEventUrl.trim()
          : null,
    });
  }
  const syncAfterLink =
    typeof b.syncAfterLink === "boolean" ? b.syncAfterLink : true;
  return { ok: true, selections, syncAfterLink };
}

/**
 * Sliding-window concurrency runner. Avoids pulling p-limit just for
 * the rollup fan-out. Mirrors the helper that ships alongside the
 * dashboard's "Sync all" button so the cap semantics (max N
 * in-flight) stay identical.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners: Promise<void>[] = [];
  const workerCount = Math.max(1, Math.min(limit, items.length));
  for (let w = 0; w < workerCount; w++) {
    runners.push(
      (async () => {
        while (true) {
          const idx = cursor++;
          if (idx >= items.length) return;
          results[idx] = await worker(items[idx]);
        }
      })(),
    );
  }
  await Promise.all(runners);
  return results;
}

function createLaunchGapper(gapMs: number): () => Promise<void> {
  let nextStartAt = Date.now();
  return async () => {
    const now = Date.now();
    const waitMs = Math.max(0, nextStartAt - now);
    nextStartAt = Math.max(now, nextStartAt) + gapMs;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, meta_ad_account_id, tiktok_account_id, google_ads_account_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (clientErr) {
    return NextResponse.json(
      { ok: false, error: clientErr.message },
      { status: 500 },
    );
  }
  if (!client) {
    return NextResponse.json(
      { ok: false, error: "Client not found" },
      { status: 404 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }
  const validated = validateBody(body);
  if (!validated.ok) {
    return NextResponse.json(
      { ok: false, error: validated.error },
      { status: 400 },
    );
  }
  const { selections, syncAfterLink } = validated;

  // Resolve every event + connection once up-front so we can reject
  // the whole batch with a clear error before writing anything.
  // Tiny savings compared to the N sequential fetches we'd do anyway,
  // but the batch-reject semantics make the client UX simpler.
  const eventIds = [...new Set(selections.map((s) => s.eventId))];
  const connectionIds = [...new Set(selections.map((s) => s.connectionId))];

  const [{ data: events, error: eventsErr }, { data: connections, error: connErr }] = await Promise.all([
    supabase
      .from("events")
      .select("id, name, user_id, client_id, event_code, event_timezone, event_date, tiktok_account_id, google_ads_account_id")
      .in("id", eventIds),
    supabase
      .from("client_ticketing_connections")
      .select("id, user_id, client_id, provider")
      .in("id", connectionIds),
  ]);

  if (eventsErr) {
    return NextResponse.json(
      { ok: false, error: eventsErr.message },
      { status: 500 },
    );
  }
  if (connErr) {
    return NextResponse.json(
      { ok: false, error: connErr.message },
      { status: 500 },
    );
  }

  const eventById = new Map(
    (events ?? []).map((e) => [
      (e as { id: string }).id,
      e as {
        id: string;
        name: string;
        user_id: string;
        client_id: string | null;
        event_code: string | null;
        event_timezone: string | null;
        event_date: string | null;
      },
    ]),
  );
  const connById = new Map(
    (connections ?? []).map((c) => [
      (c as { id: string }).id,
      c as {
        id: string;
        user_id: string;
        client_id: string | null;
        provider: string;
      },
    ]),
  );

  // Validate each selection. Collect errors per-row rather than
  // aborting so a single typo doesn't kill a 60-row batch.
  const preValidated: Array<
    | { ok: true; selection: Selection }
    | { ok: false; selection: Selection; error: string }
  > = selections.map((sel) => {
    const ev = eventById.get(sel.eventId);
    const conn = connById.get(sel.connectionId);
    if (!ev) {
      return { ok: false, selection: sel, error: "Event not found" };
    }
    if (!conn) {
      return { ok: false, selection: sel, error: "Connection not found" };
    }
    if (ev.user_id !== user.id || conn.user_id !== user.id) {
      return { ok: false, selection: sel, error: "Forbidden" };
    }
    if (ev.client_id !== id) {
      return {
        ok: false,
        selection: sel,
        error: "Event belongs to a different client",
      };
    }
    if (conn.client_id !== id) {
      return {
        ok: false,
        selection: sel,
        error: "Connection belongs to a different client",
      };
    }
    return { ok: true, selection: sel };
  });

  const results: BulkLinkResult[] = [];

  for (const p of preValidated) {
    if (!p.ok) {
      results.push({
        eventId: p.selection.eventId,
        eventName: eventById.get(p.selection.eventId)?.name ?? null,
        externalEventId: p.selection.externalEventId,
        connectionProvider: connById.get(p.selection.connectionId)?.provider ?? null,
        ok: false,
        linkId: null,
        linkError: p.error,
        syncOk: null,
        syncError: null,
      });
      continue;
    }
    try {
      const connection = connById.get(p.selection.connectionId);
      console.info(
        `[ticketing-link-discovery] upsert attempt client_id=${id} event_id=${p.selection.eventId} connection_id=${p.selection.connectionId} provider=${connection?.provider ?? "<unknown>"} external_event_id=${p.selection.externalEventId}`,
      );
      const link = await upsertEventLink(supabase, {
        userId: user.id,
        eventId: p.selection.eventId,
        connectionId: p.selection.connectionId,
        externalEventId: p.selection.externalEventId,
        externalEventUrl: p.selection.externalEventUrl,
      });
      if (!link) {
        results.push({
          eventId: p.selection.eventId,
          eventName: eventById.get(p.selection.eventId)?.name ?? null,
          externalEventId: p.selection.externalEventId,
          connectionProvider: connection?.provider ?? null,
          ok: false,
          linkId: null,
          linkError: "Failed to persist the link",
          syncOk: null,
          syncError: null,
        });
        continue;
      }
      console.info(
        `[ticketing-link-discovery] upsert ok link_id=${(link as { id: string }).id} event_id=${p.selection.eventId} connection_id=${p.selection.connectionId} external_event_id=${p.selection.externalEventId}`,
      );
      results.push({
        eventId: p.selection.eventId,
        eventName: eventById.get(p.selection.eventId)?.name ?? null,
        externalEventId: p.selection.externalEventId,
        connectionProvider: connection?.provider ?? null,
        ok: true,
        linkId: (link as { id: string }).id,
        linkError: null,
        syncOk: null,
        syncError: null,
      });
    } catch (err) {
      console.warn(
        `[ticketing-link-discovery] upsert failed event_id=${p.selection.eventId} connection_id=${p.selection.connectionId} external_event_id=${p.selection.externalEventId}: ${
          err instanceof Error ? err.message : "Unknown error"
        }`,
      );
      results.push({
        eventId: p.selection.eventId,
        eventName: eventById.get(p.selection.eventId)?.name ?? null,
        externalEventId: p.selection.externalEventId,
        connectionProvider: connById.get(p.selection.connectionId)?.provider ?? null,
        ok: false,
        linkId: null,
        linkError: err instanceof Error ? err.message : "Unknown error",
        syncOk: null,
        syncError: null,
      });
    }
  }

  // Optional post-link rollup-sync fan-out. Schedule after the JSON
  // response so link persistence stays fast and 4thefans backoff doesn't
  // make the operator wait on every event.
  let syncQueuedCount = 0;
  if (syncAfterLink) {
    const toSync = results
      .map((r, idx) => ({ r, idx }))
      .filter(({ r }) => r.ok && r.linkId != null);
    syncQueuedCount = toSync.length;

    const adAccountId = (client as { meta_ad_account_id: string | null })
      .meta_ad_account_id;
    const clientTikTokAccountId = (client as { tiktok_account_id: string | null })
      .tiktok_account_id;
    const clientGoogleAdsAccountId = (client as { google_ads_account_id: string | null })
      .google_ads_account_id;

    after(async () => {
      const waitForLaunchGap = createLaunchGapper(SYNC_LAUNCH_GAP_MS);
      await runWithConcurrency(toSync, DEFAULT_SYNC_CONCURRENCY, async ({ r, idx }) => {
        await waitForLaunchGap();
        const ev = eventById.get(r.eventId);
        if (!ev) {
          results[idx] = {
            ...r,
            syncOk: false,
            syncError: "Event not found post-link",
          };
          console.warn(
            `[bulk-link] event_id=${r.eventId} status=error reason=${JSON.stringify(results[idx].syncError)}`,
          );
          return;
        }
        try {
          const sync = await runSyncWithRetry({
            supabase,
            eventId: ev.id,
            userId: user.id,
            eventCode: ev.event_code,
            eventTimezone: ev.event_timezone,
            adAccountId,
            clientId: ev.client_id,
            eventDate: ev.event_date,
            eventTikTokAccountId:
              (ev as typeof ev & { tiktok_account_id: string | null })
                .tiktok_account_id,
            clientTikTokAccountId,
            eventGoogleAdsAccountId:
              (ev as typeof ev & { google_ads_account_id: string | null })
                .google_ads_account_id,
            clientGoogleAdsAccountId,
          });
          const syncOk = sync.summary.synced;
          const syncError = syncOk ? null : syncFailureReason(sync);
          results[idx] = {
            ...r,
            syncOk,
            syncError,
          };
          console.info(
            `[bulk-link] event_id=${ev.id} status=${syncOk ? "ok" : "error"} reason=${JSON.stringify(syncError)} provider=${r.connectionProvider ?? "<unknown>"} external_event_id=${r.externalEventId ?? "<null>"}`,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown sync error";
          results[idx] = {
            ...r,
            syncOk: false,
            syncError: message,
          };
          console.warn(
            `[bulk-link] event_id=${ev.id} status=error reason=${JSON.stringify(message)} provider=${r.connectionProvider ?? "<unknown>"} external_event_id=${r.externalEventId ?? "<null>"}`,
          );
        }
      });
      const backgroundWarnings = results.filter(
        (r) => r.ok && r.syncOk === false,
      ).length;
      console.info(
        `[bulk-link] background_sync_complete client_id=${id} synced=${syncQueuedCount - backgroundWarnings} warnings=${backgroundWarnings}`,
      );
    });
  }

  const linkedCount = results.filter((r) => r.ok).length;
  const failedCount = results.length - linkedCount;
  const syncWarningCount = results.filter(
    (r) => r.ok && r.syncOk === false,
  ).length;
  const syncWarningsByReason = results
    .filter((r) => r.ok && r.syncOk === false)
    .reduce<Record<string, number>>((acc, result) => {
      const reason = result.syncError ?? "unknown";
      acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {});

  console.info(
    `[bulk-link] complete client_id=${id} linked=${linkedCount} failed=${failedCount} sync_warnings=${syncWarningCount} sync_warning_reasons=${JSON.stringify(syncWarningsByReason)}`,
  );

  return NextResponse.json({
    ok: failedCount === 0,
    linkedCount,
    failedCount,
    syncQueuedCount,
    throttled: syncQueuedCount > 0,
    syncWarningCount,
    results,
  });
}

async function runSyncWithRetry(
  input: Parameters<typeof runRollupSyncForEvent>[0],
): Promise<Awaited<ReturnType<typeof runRollupSyncForEvent>>> {
  const first = await runRollupSyncForEvent(input);
  if (first.summary.synced) return first;
  const reason = syncFailureReason(first);
  console.warn(
    `[bulk-link] event_id=${input.eventId} status=error reason=${JSON.stringify(reason)} retrying_after_ms=${SYNC_RETRY_DELAY_MS}`,
  );
  await new Promise((resolve) => setTimeout(resolve, SYNC_RETRY_DELAY_MS));
  return runRollupSyncForEvent(input);
}

function syncFailureReason(
  sync: Awaited<ReturnType<typeof runRollupSyncForEvent>>,
): string {
  const summary = sync.summary;
  return (
    summary.eventbriteError ??
    summary.metaError ??
    summary.tiktokError ??
    summary.googleAdsError ??
    summary.allocatorError ??
    summary.eventbriteReason ??
    summary.metaReason ??
    summary.tiktokReason ??
    summary.googleAdsReason ??
    summary.allocatorReason ??
    "Sync completed with errors"
  );
}
