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
import { resolveAudienceSourceContext } from "@/lib/audiences/sources";
import { createAudienceDrafts } from "@/lib/db/meta-custom-audiences";
import {
  createMetaCustomAudienceBatch,
  metaAudienceWritesEnabled,
} from "@/lib/meta/audience-write";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { createClient } from "@/lib/supabase/server";

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
