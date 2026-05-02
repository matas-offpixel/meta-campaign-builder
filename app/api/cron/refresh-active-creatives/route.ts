import { NextResponse, type NextRequest } from "next/server";
import OpenAI from "openai";

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  autoTag,
  type AutoTagInput,
} from "@/lib/intelligence/auto-tagger";
import {
  bulkUpsertCreativeTagAssignments,
  listCreativeTagAssignments,
  listCreativeTags,
  type MotionCreativeTagRow,
} from "@/lib/db/creative-tags";
import {
  refreshActiveCreativesForEvent,
  type RefreshResult,
} from "@/lib/reporting/active-creatives-refresh-runner";
import type { ConceptGroupRow } from "@/lib/reporting/group-creatives";
import type { ShareActiveCreativesResult } from "@/lib/reporting/share-active-creatives";

/**
 * GET /api/cron/refresh-active-creatives
 *
 * Vercel Cron entry point. Walks every event with an active
 * ticketing connection AND `general_sale_at` within ±60 days, and
 * pre-populates `active_creatives_snapshots` for the share-page
 * presets (`maximum`, `last_30d`, `last_14d`, `last_7d`).
 *
 * The whole reason this cron exists: the public share report's
 * "Active creatives" section used to fan out to Meta on every
 * cache miss, which mapped 1:1 onto the user's traffic shape
 * (multi-tab + multi-timeframe = N parallel account-scoped Meta
 * calls). At ~300+ creatives per event, that produced 80004
 * account-wide rate-limit lockouts. By moving the fetch into a
 * scheduled, single-writer cron, share-page reads become pure
 * Postgres reads and the user-traffic → Meta-traffic coupling is
 * broken. Full architectural rationale lives in
 * `docs/META_INDEPENDENCE_RESEARCH.md`.
 *
 * Cadence: configured in `vercel.json` (`15 / every 6 hours` to
 * sit 15 minutes offset from the existing `rollup-sync-events`
 * cron at minute 30 — both call Meta and we don't want them
 * stepping on each other's per-account request budget). The
 * runner itself picks a tight 2h cadence per-event when
 * `event_date` is within 14 days, so show-week numbers stay
 * fresher than the cron interval.
 *
 * Auth: bearer header `Authorization: Bearer <CRON_SECRET>`.
 * Identical helper to `rollup-sync-events` so the bearer-vs-raw
 * tolerance stays consistent across crons.
 *
 * Eligibility: identical scaffold to `rollup-sync-events` —
 * `event_ticketing_links ∩ events.general_sale_at within ±60d`.
 * Even events on Meta-only clients show up because the cron is
 * walking the same set the rollup runner already covers; if a
 * client doesn't yet have a ticketing connection they don't
 * reach this cron OR the rollup one, which is correct (no Meta
 * leg to refresh either).
 *
 * Per-event isolation: each event runs inside its own try/catch
 * so one preset's Meta failure can't abort the whole batch.
 * Per-preset isolation lives one level deeper inside the runner.
 *
 * Service-role posture: no user session — service-role client.
 * The runner writes snapshot rows under each event's OWNING
 * `user_id`, never under a synthetic system user, so the table's
 * `user_id` column stays meaningful for ops queries.
 */

export const maxDuration = 800;
export const dynamic = "force-dynamic";

const AI_AUTOTAG_MODEL_VERSION = "gpt-4o-mini";
const AI_AUTOTAG_CONCURRENCY = 3;

interface EventToRefresh {
  id: string;
  user_id: string;
  event_code: string | null;
  event_date: string | null;
  client: { meta_ad_account_id: string | null } | null;
}

interface EventRefreshSummary {
  eventId: string;
  ok: boolean;
  presetsAttempted: number;
  presetsWritten: number;
  durationMs: number;
  presetResults: RefreshResult["presetResults"];
  aiAutoTag?: AutoTagCronSummary;
  error?: string;
}

interface CronResponse {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  eventsConsidered: number;
  eventsProcessed: number;
  totalPresetsRefreshed: number;
  results: EventRefreshSummary[];
}

interface AutoTagCronSummary {
  enabled: boolean;
  modelVersion: string;
  payloadsSeen: number;
  creativesConsidered: number;
  creativesSkippedExisting: number;
  creativesSkippedNoThumbnail: number;
  creativesTagged: number;
  assignmentsUpserted: number;
  errors: number;
}

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() === expected.trim();
  }
  return header.trim() === expected.trim();
}

function isAutoTagEnabled(): boolean {
  return process.env.ENABLE_AI_AUTOTAG === "1";
}

function createAutoTagSummary(enabled: boolean): AutoTagCronSummary {
  return {
    enabled,
    modelVersion: AI_AUTOTAG_MODEL_VERSION,
    payloadsSeen: 0,
    creativesConsidered: 0,
    creativesSkippedExisting: 0,
    creativesSkippedNoThumbnail: 0,
    creativesTagged: 0,
    assignmentsUpserted: 0,
    errors: 0,
  };
}

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn(
      "[cron refresh-active-creatives] ENABLE_AI_AUTOTAG=1 but OPENAI_API_KEY is missing",
    );
    return null;
  }
  return new OpenAI({ apiKey });
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const startedAt = new Date().toISOString();
  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Service-role client unavailable",
      },
      { status: 500 },
    );
  }

  // Eligibility window mirrors rollup-sync-events so the same set
  // of events is refreshed across both crons. PostgREST doesn't
  // expose a clean OR across a join + a column, so we query
  // separately and intersect client-side. Both queries are small
  // (tens of rows) so the union is cheap.
  const nowMs = Date.now();
  const sinceMs = nowMs - 60 * 24 * 60 * 60 * 1000;
  const untilMs = nowMs + 60 * 24 * 60 * 60 * 1000;
  const sinceISO = new Date(sinceMs).toISOString();
  const untilISO = new Date(untilMs).toISOString();

  const { data: linkedRows, error: linkedErr } = await supabase
    .from("event_ticketing_links")
    .select("event_id");
  if (linkedErr) {
    return NextResponse.json(
      { ok: false, error: linkedErr.message },
      { status: 500 },
    );
  }
  const linkedIds = new Set<string>(
    (linkedRows ?? [])
      .map((r) => (r as { event_id: string | null }).event_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );

  const { data: dateRows, error: dateErr } = await supabase
    .from("events")
    .select("id")
    .gte("general_sale_at", sinceISO)
    .lte("general_sale_at", untilISO);
  if (dateErr) {
    return NextResponse.json(
      { ok: false, error: dateErr.message },
      { status: 500 },
    );
  }
  const dateIds = new Set<string>(
    (dateRows ?? [])
      .map((r) => (r as { id: string }).id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );

  const eligibleIds = Array.from(linkedIds).filter((id) => dateIds.has(id));

  if (eligibleIds.length === 0) {
    const finishedAt = new Date().toISOString();
    const empty: CronResponse = {
      ok: true,
      startedAt,
      finishedAt,
      eventsConsidered: 0,
      eventsProcessed: 0,
      totalPresetsRefreshed: 0,
      results: [],
    };
    console.log(
      `[cron refresh-active-creatives] no eligible events; window=${sinceISO}..${untilISO}`,
    );
    return NextResponse.json(empty);
  }

  // Hydrate the eligible event rows with the columns the runner
  // needs. `event_date` drives the tight-TTL branch inside the
  // runner; `client.meta_ad_account_id` is the other input that
  // can short-circuit a Meta-less client to `kind="skip"` without
  // a fetch. Same shape rollup-sync-events uses for its own
  // hydration.
  const { data: rawEvents, error: eventErr } = await supabase
    .from("events")
    .select(
      "id, user_id, event_code, event_date, client:clients ( meta_ad_account_id )",
    )
    .in("id", eligibleIds);
  if (eventErr) {
    return NextResponse.json(
      { ok: false, error: eventErr.message },
      { status: 500 },
    );
  }
  const events = (rawEvents ?? []) as unknown as EventToRefresh[];

  console.log(
    `[cron refresh-active-creatives] considering=${events.length} window=${sinceISO}..${untilISO}`,
  );

  const results: EventRefreshSummary[] = [];
  let totalPresetsRefreshed = 0;
  const autoTagEnabled = isAutoTagEnabled();
  const openai = autoTagEnabled ? getOpenAIClient() : null;

  for (const event of events) {
    const t0 = Date.now();
    const aiAutoTag = createAutoTagSummary(autoTagEnabled);
    try {
      const clientRel = event.client as
        | { meta_ad_account_id: string | null }
        | { meta_ad_account_id: string | null }[]
        | null;
      const adAccountId = Array.isArray(clientRel)
        ? (clientRel[0]?.meta_ad_account_id ?? null)
        : (clientRel?.meta_ad_account_id ?? null);

      const eventDate = event.event_date
        ? new Date(event.event_date)
        : null;

      const result = await refreshActiveCreativesForEvent({
        // The runner accepts SupabaseClient<Database>; the cast
        // is safe because `createServiceRoleClient()` returns a
        // typed-Database client.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase: supabase as any,
        eventId: event.id,
        userId: event.user_id,
        eventCode: event.event_code,
        adAccountId,
        eventDate,
        onSnapshotWritten:
          autoTagEnabled && openai
            ? async ({ payload }) => {
                await runAutoTagForSnapshot({
                  supabase,
                  userId: event.user_id,
                  eventId: event.id,
                  payload,
                  openai,
                  summary: aiAutoTag,
                });
              }
            : undefined,
      });

      const presetsWritten = result.presetResults.filter(
        (p) => p.wroteSnapshot,
      ).length;
      totalPresetsRefreshed += presetsWritten;
      results.push({
        eventId: event.id,
        ok: result.ok,
        presetsAttempted: result.presetResults.length,
        presetsWritten,
        durationMs: Date.now() - t0,
        presetResults: result.presetResults,
        ...(autoTagEnabled ? { aiAutoTag } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(
        `[cron refresh-active-creatives] event=${event.id} threw: ${message}`,
      );
      results.push({
        eventId: event.id,
        ok: false,
        presetsAttempted: 0,
        presetsWritten: 0,
        durationMs: Date.now() - t0,
        presetResults: [],
        ...(autoTagEnabled ? { aiAutoTag } : {}),
        error: message,
      });
    }
  }

  const finishedAt = new Date().toISOString();
  const allOk = results.every((r) => r.ok);
  const response: CronResponse = {
    ok: allOk,
    startedAt,
    finishedAt,
    eventsConsidered: events.length,
    eventsProcessed: results.length,
    totalPresetsRefreshed,
    results,
  };

  console.log(
    `[cron refresh-active-creatives] done events=${results.length} all_ok=${allOk} presets_written=${totalPresetsRefreshed}`,
  );

  return NextResponse.json(response, { status: allOk ? 200 : 207 });
}

async function runAutoTagForSnapshot(args: {
  supabase: ReturnType<typeof createServiceRoleClient>;
  userId: string;
  eventId: string;
  payload: Extract<ShareActiveCreativesResult, { kind: "ok" }>;
  openai: OpenAI;
  summary: AutoTagCronSummary;
}): Promise<void> {
  args.summary.payloadsSeen += 1;
  args.summary.creativesConsidered += args.payload.groups.length;

  let taxonomy: MotionCreativeTagRow[];
  let existingAiCreatives: Set<string>;
  try {
    taxonomy = (await listCreativeTags(args.supabase)).filter(
      (row) => row.user_id === args.userId,
    );
    const assignments = await listCreativeTagAssignments(
      args.supabase,
      args.eventId,
    );
    existingAiCreatives = new Set(
      assignments
        .filter(
          (row) =>
            row.source === "ai" &&
            row.model_version === AI_AUTOTAG_MODEL_VERSION,
        )
        .map((row) => row.creative_name),
    );
  } catch (err) {
    args.summary.errors += 1;
    console.error("[cron refresh-active-creatives] ai autotag preflight failed", {
      eventId: args.eventId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const taxonomyByKey = new Map(
    taxonomy.map((row) => [`${row.dimension}\u0000${row.value_key}`, row]),
  );
  const candidates: Array<{ group: ConceptGroupRow; creativeName: string }> = [];

  for (const group of args.payload.groups) {
    const creativeName = creativeNameForGroup(group);
    if (!creativeName) continue;
    if (existingAiCreatives.has(creativeName)) {
      args.summary.creativesSkippedExisting += 1;
      continue;
    }
    if (!group.representative_thumbnail) {
      args.summary.creativesSkippedNoThumbnail += 1;
      continue;
    }
    existingAiCreatives.add(creativeName);
    candidates.push({ group, creativeName });
  }

  await runWithConcurrency(candidates, AI_AUTOTAG_CONCURRENCY, async (item) => {
    const input: AutoTagInput = {
      thumbnailUrl: item.group.representative_thumbnail as string,
      headline: item.group.representative_headline,
      body: item.group.representative_body_preview,
    };

    try {
      const tags = await autoTag(input, {
        taxonomy,
        openai: args.openai,
        modelVersion: AI_AUTOTAG_MODEL_VERSION,
      });
      const assignments = tags
        .map((tag) => {
          const taxonomyRow = taxonomyByKey.get(
            `${tag.dimension}\u0000${tag.value_key}`,
          );
          if (!taxonomyRow) return null;
          return {
            userId: args.userId,
            eventId: args.eventId,
            creativeName: item.creativeName,
            tagId: taxonomyRow.id,
            source: "ai" as const,
            confidence: tag.confidence,
            modelVersion: AI_AUTOTAG_MODEL_VERSION,
          };
        })
        .filter((row): row is NonNullable<typeof row> => Boolean(row));

      if (assignments.length === 0) return;
      await bulkUpsertCreativeTagAssignments(args.supabase, assignments);
      args.summary.creativesTagged += 1;
      args.summary.assignmentsUpserted += assignments.length;
    } catch (err) {
      args.summary.errors += 1;
      console.error("[cron refresh-active-creatives] ai autotag failed", {
        eventId: args.eventId,
        creativeName: item.creativeName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

function creativeNameForGroup(group: ConceptGroupRow): string | null {
  return group.ad_names[0]?.trim() || group.display_name.trim() || null;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (index < items.length) {
        const item = items[index];
        index += 1;
        await worker(item);
      }
    },
  );
  await Promise.all(workers);
}
