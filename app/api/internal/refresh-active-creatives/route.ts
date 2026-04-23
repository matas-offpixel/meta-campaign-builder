import { NextResponse, type NextRequest } from "next/server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  markSnapshotStale,
  readActiveCreativesSnapshot,
  isSnapshotFresh,
} from "@/lib/db/active-creatives-snapshots";
import { refreshActiveCreativesForEvent } from "@/lib/reporting/active-creatives-refresh-runner";
import type { CustomDateRange, DatePreset } from "@/lib/insights/types";

/**
 * POST /api/internal/refresh-active-creatives
 *
 * Single-event, single-preset background refresh trigger. Sits
 * between the share-page render path and the cron — when a viewer
 * lands on a stale (or never-populated) `(event, preset)` tuple,
 * the page fires this route fire-and-forget so the next render
 * sees fresh data without coupling the current render to a Meta
 * round trip.
 *
 * This is the FIRST `/api/internal/*` path in the codebase; the
 * convention being established: routes that are called by other
 * server code (cron, RSC fetch-and-forget, internal job runners),
 * never directly by users, and that accept either CRON_SECRET
 * Bearer auth OR an authenticated session that owns the resource.
 *
 * Auth (one of):
 *   1. `Authorization: Bearer <CRON_SECRET>` — same shape as
 *      `/api/cron/*`. Used by the share page's `unstable_after`
 *      kick when CRON_SECRET is plumbed through the env.
 *   2. Authenticated Supabase session whose user_id matches
 *      `events.user_id` for the requested `event_id`. Used by
 *      the dashboard's "Refresh now" button (owners only).
 *
 * Idempotency
 *   The route is safe to call N times concurrently. The
 *   `is_stale` flag on the snapshot row acts as the
 *   in-flight marker:
 *
 *     - `is_stale=false` AND `expires_at > now` → return
 *       `{ ok: true, skipped: "fresh" }` without calling Meta.
 *       This is the hot path for the share-page kick when the
 *       cron just refreshed.
 *     - Otherwise → flip `is_stale=true` (claims the slot for
 *       observers), then run `refreshActiveCreativesForEvent`
 *       for the single (event, preset). The runner upserts
 *       `is_stale=false` on success per the
 *       refusal-to-overwrite contract in
 *       `writeActiveCreativesSnapshot`.
 *
 *   Concurrent callers may both pass the gate and both hit Meta;
 *   that's accepted because the alternative (a real lock) is
 *   complexity we don't need yet — the worst case is two Meta
 *   fetches inside a 5-minute window, not a wrong render.
 *
 * `maxDuration = 300`
 *   One event, one preset. The active-creatives fetcher caps
 *   itself well under a minute on a happy day; the ceiling is
 *   slack for a slow Meta day so the function doesn't
 *   prematurely 504 and leave the snapshot row stuck in
 *   `is_stale=true` until the next cron tick.
 */

export const maxDuration = 300;
export const dynamic = "force-dynamic";

interface RequestBody {
  event_id?: unknown;
  preset?: unknown;
  custom_range?: unknown;
}

const VALID_PRESETS: ReadonlySet<DatePreset> = new Set([
  "maximum",
  "last_30d",
  "last_14d",
  "last_7d",
  "last_3d",
  "yesterday",
  "today",
  "this_month",
  "custom",
]);

function isValidIso8601Date(value: unknown): value is string {
  if (typeof value !== "string") return false;
  // Match the Meta `time_range` shape — YYYY-MM-DD only, no time.
  // Anything wider (timestamps, timezone suffixes) is rejected so
  // we don't write garbage into the cache key columns which are
  // typed `date` in Postgres.
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

interface ParsedBody {
  eventId: string;
  preset: DatePreset;
  customRange?: CustomDateRange;
}

function parseBody(body: RequestBody): ParsedBody | { error: string } {
  if (typeof body.event_id !== "string" || body.event_id.length === 0) {
    return { error: "event_id is required" };
  }
  if (
    typeof body.preset !== "string" ||
    !VALID_PRESETS.has(body.preset as DatePreset)
  ) {
    return { error: "preset must be a valid DatePreset" };
  }
  const preset = body.preset as DatePreset;

  let customRange: CustomDateRange | undefined;
  if (preset === "custom") {
    const cr = body.custom_range as
      | { since?: unknown; until?: unknown }
      | null
      | undefined;
    if (
      !cr ||
      !isValidIso8601Date(cr.since) ||
      !isValidIso8601Date(cr.until)
    ) {
      return {
        error:
          'preset="custom" requires custom_range { since: "YYYY-MM-DD", until: "YYYY-MM-DD" }',
      };
    }
    customRange = { since: cr.since, until: cr.until };
  }

  return { eventId: body.event_id, preset, customRange };
}

function isCronAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() === expected.trim();
  }
  return header.trim() === expected.trim();
}

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = parseBody(body);
  if ("error" in parsed) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }
  const { eventId, preset, customRange } = parsed;

  // Auth — try CRON_SECRET first (cheaper, no DB round trip), fall
  // back to session-based ownership check.
  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
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

  const cronAuthed = isCronAuthorized(req);

  // Even when cron-authed we still need to load the event row to
  // resolve `user_id`, `event_code`, `event_date`, and ad account
  // id for the runner. Doing the load up-front also doubles as the
  // "event exists" check.
  const { data: rawEvent, error: eventErr } = await admin
    .from("events")
    .select(
      "id, user_id, event_code, event_date, client:clients ( meta_ad_account_id )",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (eventErr) {
    return NextResponse.json(
      { ok: false, error: eventErr.message },
      { status: 500 },
    );
  }
  if (!rawEvent) {
    return NextResponse.json(
      { ok: false, error: "Event not found" },
      { status: 404 },
    );
  }

  const event = rawEvent as unknown as {
    id: string;
    user_id: string;
    event_code: string | null;
    event_date: string | null;
    client:
      | { meta_ad_account_id: string | null }
      | { meta_ad_account_id: string | null }[]
      | null;
  };

  if (!cronAuthed) {
    // Fall back to authenticated-session ownership. Uses the
    // user-scoped client so RLS would block any cross-tenant read
    // even if we forgot the explicit check below.
    const userClient = await createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Not signed in" },
        { status: 401 },
      );
    }
    if (user.id !== event.user_id) {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 },
      );
    }
  }

  // Idempotency check — if the snapshot is fresh (clock + not
  // already mid-refresh) we short-circuit. This is the hot path
  // for the share-page kick when the cron just ran. Also
  // protects against accidental double-clicks on the dashboard
  // "Refresh now" button.
  const existing = await readActiveCreativesSnapshot(admin, {
    eventId,
    datePreset: preset,
    customRange,
  });
  if (existing && isSnapshotFresh(existing)) {
    return NextResponse.json({
      ok: true,
      skipped: "fresh",
      eventId,
      preset,
      fetchedAt: existing.fetchedAt.toISOString(),
      expiresAt: existing.expiresAt.toISOString(),
    });
  }

  // Claim the in-flight slot — concurrent share-page loads that
  // read after this point will see `isStale=true` and won't kick
  // their own refresh. Best-effort; failure (e.g. row not yet
  // present) is fine because the upsert downstream sets the row
  // explicitly.
  if (existing) {
    await markSnapshotStale(admin, {
      eventId,
      datePreset: preset,
      customRange,
    });
  }

  const clientRel = event.client;
  const adAccountId = Array.isArray(clientRel)
    ? (clientRel[0]?.meta_ad_account_id ?? null)
    : (clientRel?.meta_ad_account_id ?? null);

  const eventDate = event.event_date ? new Date(event.event_date) : null;

  const result = await refreshActiveCreativesForEvent({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: admin as any,
    eventId: event.id,
    userId: event.user_id,
    eventCode: event.event_code,
    adAccountId,
    eventDate,
    presets: [preset],
    customRange,
  });

  return NextResponse.json(
    {
      ok: result.ok,
      eventId,
      preset,
      result,
    },
    { status: result.ok ? 200 : 207 },
  );
}
