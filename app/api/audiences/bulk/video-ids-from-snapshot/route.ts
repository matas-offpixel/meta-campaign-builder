/**
 * POST /api/audiences/bulk/video-ids-from-snapshot
 *
 * Returns video IDs from `active_creatives_snapshots` for all events
 * matching a given event-code prefix. Used by the bulk video-ID input
 * mode's "Pull from cache" button — zero Meta API calls.
 *
 * Post-#429 snapshots include `audience_video_sources` with
 * `context_page_id` per video (context_page_id lets the resolver skip the
 * live from.id lookup). Pre-#429 snapshots have `video_id` scattered
 * inside the `groups` tree; we walk recursively to collect them (no
 * context_page_id in that shape, so from.id resolution is still needed).
 *
 * Security:
 *   Events are fetched with the user-scoped Supabase client first
 *   (ownership gate). Snapshot reads use a service-role client and are
 *   limited to those pre-filtered eventIds. This matches the
 *   `userClient → eventIds → serviceClient → snapshots` pattern from #429.
 */
import { NextResponse, type NextRequest } from "next/server";

import { resolveAudienceSourceContext } from "@/lib/audiences/sources";
import { eventCodeMatchesPrefix } from "@/lib/audiences/event-code-prefix-scanner";
import { readActiveCreativesSnapshot } from "@/lib/db/active-creatives-snapshots";
import type { ShareActiveCreativesResult } from "@/lib/reporting/share-active-creatives";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 60;
export const runtime = "nodejs";

/**
 * Walk any JSON object and collect all string values of keys named
 * `video_id`. Works for both old-shape payloads (video_id buried inside
 * groups/concepts) and new-shape payloads (`audience_video_sources[].video_id`).
 * Deduplicates using `seen`; caller passes an empty Set and accumulates
 * across multiple snapshot payloads.
 */
function collectVideoIdsFromJson(obj: unknown, seen: Set<string>): string[] {
  if (!obj || typeof obj !== "object") return [];
  const collected: string[] = [];
  if (Array.isArray(obj)) {
    for (const item of obj) {
      collected.push(...collectVideoIdsFromJson(item, seen));
    }
    return collected;
  }
  const o = obj as Record<string, unknown>;
  if (typeof o.video_id === "string" && o.video_id && !seen.has(o.video_id)) {
    seen.add(o.video_id);
    collected.push(o.video_id);
  }
  for (const val of Object.values(o)) {
    collected.push(...collectVideoIdsFromJson(val, seen));
  }
  return collected;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    clientId?: unknown;
    eventCodePrefix?: unknown;
  } | null;

  const clientId =
    typeof body?.clientId === "string" ? body.clientId.trim() : null;
  const eventCodePrefix =
    typeof body?.eventCodePrefix === "string" ? body.eventCodePrefix.trim() : null;

  if (!clientId) {
    return NextResponse.json({ ok: false, error: "clientId is required" }, { status: 400 });
  }
  if (!eventCodePrefix) {
    return NextResponse.json(
      { ok: false, error: "eventCodePrefix is required" },
      { status: 400 },
    );
  }

  const context = await resolveAudienceSourceContext(supabase, user.id, clientId);
  if (!context) {
    return NextResponse.json({ ok: false, error: "Client not found" }, { status: 403 });
  }

  // 1. Ownership gate — fetch events with the user-scoped client.
  const { data: eventsData, error: eventsError } = await supabase
    .from("events")
    .select("id, event_code")
    .eq("client_id", clientId)
    .eq("user_id", user.id);

  if (eventsError) {
    return NextResponse.json({ ok: false, error: eventsError.message }, { status: 500 });
  }

  const events = (
    (eventsData ?? []) as { id: string; event_code: string | null }[]
  ).filter((e) => e.event_code && eventCodeMatchesPrefix(e.event_code, eventCodePrefix));

  if (events.length === 0) {
    return NextResponse.json({
      ok: true,
      videoIds: [],
      contextSources: null,
      fetchedAt: null,
      stale: false,
    });
  }

  // 2. Service-role reads — snapshot table is RLS-false for all roles.
  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Service role not configured: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }

  const seenVideoIds = new Set<string>();
  const videoIds: string[] = [];
  const contextSources: Array<{ videoId: string; contextPageId: string }> = [];
  let earliestFetchedAt: Date | null = null;
  let anyStale = false;

  for (const event of events) {
    try {
      const record = await readActiveCreativesSnapshot(admin, {
        eventId: event.id,
        datePreset: "maximum",
      });
      if (!record) continue;

      const payload = record.payload as ShareActiveCreativesResult;
      if (payload.kind !== "ok") continue;

      if (record.isStale || record.expiresAt.getTime() <= Date.now()) {
        anyStale = true;
      }
      if (!earliestFetchedAt || record.fetchedAt < earliestFetchedAt) {
        earliestFetchedAt = record.fetchedAt;
      }

      // Post-#429: `audience_video_sources` carries (video_id, context_page_id) pairs.
      // Prefer this shape — it lets the audience builder skip from.id resolution.
      if (payload.audience_video_sources && payload.audience_video_sources.length > 0) {
        for (const src of payload.audience_video_sources) {
          if (!src.video_id || seenVideoIds.has(src.video_id)) continue;
          seenVideoIds.add(src.video_id);
          videoIds.push(src.video_id);
          contextSources.push({ videoId: src.video_id, contextPageId: src.context_page_id });
        }
      } else {
        // Pre-#429: walk the payload JSON recursively to collect all `video_id` strings.
        // These won't have context_page_id — from.id resolution is still needed.
        const extracted = collectVideoIdsFromJson(payload, seenVideoIds);
        videoIds.push(...extracted);
      }
    } catch (err) {
      // Swallow per-event errors — best-effort across the batch.
      console.warn(
        `[video-ids-from-snapshot] event=${event.id} threw: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return NextResponse.json({
    ok: true,
    videoIds,
    // Only include contextSources when we actually have them (post-#429 shape).
    // A null value signals to the client that from.id resolution is still needed.
    contextSources: contextSources.length > 0 ? contextSources : null,
    fetchedAt: earliestFetchedAt?.toISOString() ?? null,
    stale: anyStale,
  });
}
