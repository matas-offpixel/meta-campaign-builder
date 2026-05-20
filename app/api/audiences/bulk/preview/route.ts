import { NextResponse, type NextRequest } from "next/server";

import {
  audienceSourceRateLimitBody,
  isMetaAdAccountRateLimitError,
} from "@/lib/audiences/meta-rate-limit";
import {
  hasBulkStages,
  isBulkFunnelStage,
  isValidCustomStage,
  runBulkVideoPreview,
  type BulkCustomStage,
  type BulkFunnelStage,
} from "@/lib/audiences/bulk-video";
import { resolveAudienceSourceContext } from "@/lib/audiences/sources";
import { buildPrefixOptions } from "@/lib/audiences/event-code-prefix-scanner";
import { parseVideoIds, MAX_VIDEO_IDS } from "@/lib/audiences/parse-video-ids";
import { getVideoSourcesFromSnapshot } from "@/lib/audiences/snapshot-video-sources";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 300;
export const runtime = "nodejs";

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
    funnelStages?: unknown;
    customStages?: unknown;
    videoIds?: unknown;
  } | null;

  const clientId =
    typeof body?.clientId === "string" ? body.clientId.trim() : null;
  const eventCodePrefix =
    typeof body?.eventCodePrefix === "string" ? body.eventCodePrefix.trim() : null;
  const rawStages = Array.isArray(body?.funnelStages) ? body.funnelStages : null;
  const funnelStages: BulkFunnelStage[] = (rawStages ?? []).filter(isBulkFunnelStage);
  const rawCustom = Array.isArray(body?.customStages) ? body.customStages : null;
  const customStages: BulkCustomStage[] = (rawCustom ?? []).filter(isValidCustomStage);

  // Video-ID mode: optional array of video ID strings sent by the client.
  // When present, the campaign walk is bypassed; only from.id resolution runs.
  let videoIdOverride: string[] | undefined;
  if (Array.isArray(body?.videoIds) && (body.videoIds as unknown[]).length > 0) {
    const { ids, totalBeforeCap } = parseVideoIds(
      (body.videoIds as unknown[])
        .filter((v): v is string => typeof v === "string")
        .join(","),
    );
    if (totalBeforeCap > MAX_VIDEO_IDS) {
      return NextResponse.json(
        {
          ok: false,
          error: `Too many video IDs — maximum is ${MAX_VIDEO_IDS}, got ${totalBeforeCap} unique IDs.`,
        },
        { status: 400 },
      );
    }
    videoIdOverride = ids;
  }

  if (!clientId) {
    return NextResponse.json({ ok: false, error: "clientId is required" }, { status: 400 });
  }
  if (!eventCodePrefix) {
    return NextResponse.json({ ok: false, error: "eventCodePrefix is required" }, { status: 400 });
  }
  if (!hasBulkStages(funnelStages, customStages)) {
    return NextResponse.json(
      { ok: false, error: "Pick at least one stage to generate audiences" },
      { status: 400 },
    );
  }

  try {
    const context = await resolveAudienceSourceContext(supabase, user.id, clientId);
    if (!context) {
      return NextResponse.json({ ok: false, error: "Client not found" }, { status: 403 });
    }

    const { token } = await resolveServerMetaToken(supabase, user.id);

    // Resolve client slug for naming
    const { data: clientRow } = await supabase
      .from("clients")
      .select("slug, name")
      .eq("id", clientId)
      .maybeSingle();
    const clientSlug = (clientRow as { slug?: string | null } | null)?.slug ?? null;
    const clientName =
      (clientRow as { name?: string | null } | null)?.name ?? context.clientName;

    // Snapshot-cache resolver — `runBulkVideoPreview` will classify
    // each event as cache-hit / stale / miss and fall back to the
    // live walk per-event. Service-role client built once and
    // closed over; reads are gated by the user-scoped event lookup
    // performed inside `runBulkVideoPreview` (only user-owned
    // eventIds are ever passed to the snapshot read).
    // userClient → eventIds → serviceClient → snapshots.
    let resolveSnapshotSources:
      | Parameters<typeof runBulkVideoPreview>[0]["resolveSnapshotSources"]
      | undefined;
    try {
      const admin = createServiceRoleClient();
      resolveSnapshotSources = (eventIds) =>
        getVideoSourcesFromSnapshot(admin, eventIds);
    } catch (err) {
      // SUPABASE_SERVICE_ROLE_KEY not configured (e.g. local dev
      // without service role). Degrade silently to live walk —
      // runBulkVideoPreview handles `undefined` resolver by
      // treating every event as cache-disabled.
      console.warn(
        `[bulk/preview] service-role client unavailable, cache disabled: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const rows = await runBulkVideoPreview({
      supabase,
      userId: user.id,
      clientId,
      metaAdAccountId: context.metaAdAccountId,
      clientSlug,
      clientName,
      token,
      eventCodePrefix,
      funnelStages,
      customStages,
      resolveSnapshotSources,
      videoIdOverride,
    });

    const totalAudiences = rows.reduce(
      (sum, r) => sum + (r.skipped ? 0 : r.audiences.length),
      0,
    );

    return NextResponse.json({ ok: true, rows, totalAudiences });
  } catch (err) {
    if (isMetaAdAccountRateLimitError(err)) {
      return NextResponse.json(
        {
          ok: false,
          error: audienceSourceRateLimitBody(err).message,
        },
        { status: 429 },
      );
    }
    const message = err instanceof Error ? err.message : "Preview failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** GET helper — returns prefix options for a client's event codes. */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const clientId = req.nextUrl.searchParams.get("clientId")?.trim();
  if (!clientId) {
    return NextResponse.json({ ok: false, error: "clientId is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("events")
    .select("event_code")
    .eq("client_id", clientId)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const codes = ((data ?? []) as { event_code: string | null }[]).map(
    (e) => e.event_code,
  );
  const prefixOptions = buildPrefixOptions(codes);

  return NextResponse.json({ ok: true, prefixOptions });
}
