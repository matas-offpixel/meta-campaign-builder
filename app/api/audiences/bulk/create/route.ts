import { NextResponse, type NextRequest } from "next/server";

import {
  audienceSourceRateLimitBody,
  isMetaAdAccountRateLimitError,
} from "@/lib/audiences/meta-rate-limit";
import {
  hasBulkStages,
  isBulkFunnelStage,
  isValidCustomStage,
  previewRowsToInserts,
  runBulkVideoPreview,
  type BulkCustomStage,
  type BulkFunnelStage,
} from "@/lib/audiences/bulk-video";
import { parseVideoIds, MAX_VIDEO_IDS } from "@/lib/audiences/parse-video-ids";
import { resolveAudienceSourceContext } from "@/lib/audiences/sources";
import { getVideoSourcesFromSnapshot } from "@/lib/audiences/snapshot-video-sources";
import { createAudienceDrafts } from "@/lib/db/meta-custom-audiences";
import {
  createMetaCustomAudienceBatch,
  metaAudienceWritesEnabled,
} from "@/lib/meta/audience-write";
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
    createOnMeta?: unknown;
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
  const createOnMeta = body?.createOnMeta === true;

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

    const { data: clientRow } = await supabase
      .from("clients")
      .select("slug, name")
      .eq("id", clientId)
      .maybeSingle();
    const clientSlug = (clientRow as { slug?: string | null } | null)?.slug ?? null;
    const clientName =
      (clientRow as { name?: string | null } | null)?.name ?? context.clientName;

    // Snapshot-cache resolver — mirrors the preview route. Cache
    // hits eliminate the per-event campaign walk on write paths
    // too, so creating audiences for a fully-cached batch makes
    // ZERO Meta calls during the preview/insert phase (Meta writes
    // for `createMetaCustomAudienceBatch` still happen — those are
    // the whole point of the create route).
    let resolveSnapshotSources:
      | Parameters<typeof runBulkVideoPreview>[0]["resolveSnapshotSources"]
      | undefined;
    try {
      const admin = createServiceRoleClient();
      resolveSnapshotSources = (eventIds) =>
        getVideoSourcesFromSnapshot(admin, eventIds);
    } catch (err) {
      console.warn(
        `[bulk/create] service-role client unavailable, cache disabled: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // Run preview (dry-run) to get structured results
    const previewRows = await runBulkVideoPreview({
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

    const skippedEvents = previewRows
      .filter((r) => r.skipped)
      .map((r) => ({ eventCode: r.eventCode, reason: r.skipReason ?? "" }));

    // Convert to DB insert inputs
    const inserts = previewRowsToInserts(previewRows, {
      userId: user.id,
      clientId,
      metaAdAccountId: context.metaAdAccountId,
    });

    if (inserts.length === 0) {
      return NextResponse.json({
        ok: true,
        draftIds: [],
        skippedEvents,
        writeResult: null,
      });
    }

    // Persist all drafts
    const drafts = await createAudienceDrafts(inserts);
    const draftIds = drafts.map((d) => d.id);

    // Optionally write to Meta
    if (createOnMeta && metaAudienceWritesEnabled()) {
      const writeResult = await createMetaCustomAudienceBatch(draftIds, {
        userId: user.id,
        supabase,
      });

      // Enrich write result with audience names for the progress UI
      const idToName = new Map(drafts.map((d) => [d.id, d.name]));
      return NextResponse.json({
        ok: true,
        draftIds,
        skippedEvents,
        writeResult: {
          successes: writeResult.successes.map((s) => ({
            ...s,
            name: idToName.get(s.audienceId) ?? s.audienceId,
          })),
          failures: writeResult.failures.map((f) => ({
            ...f,
            name: idToName.get(f.audienceId) ?? f.audienceId,
          })),
        },
      });
    }

    return NextResponse.json({
      ok: true,
      draftIds,
      skippedEvents,
      writeResult: null,
    });
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
    const message = err instanceof Error ? err.message : "Bulk create failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
