/**
 * POST /api/clients/[id]/asset-queue/[queueId]/prepare
 *
 * Downloads the Dropbox asset server-side, uploads to Supabase Storage, then
 * generates AI ad copy via Claude Haiku 4.5. Writes results to DB and
 * transitions status: matched → pending (ready for user confirm).
 *
 * maxDuration = 300 (Vercel Serverless — video downloads can be large)
 *
 * On Dropbox 403/404: updates row status='error', returns 200 with error detail
 * (NOT the URL in the log — safety requirement).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getAssetQueueRow, updateQueueRowStatus, updateQueueRowPrepared } from "@/lib/db/asset-queue";
import { getAssetSheetConfig } from "@/lib/db/asset-sheet-config";
import { downloadDropboxAsset, DropboxFetchError } from "@/lib/clients/asset-queue/dropbox";
import { generateCopy } from "@/lib/clients/asset-queue/copy-generator";

export const maxDuration = 300;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; queueId: string }> },
): Promise<NextResponse> {
  const { id: clientId, queueId } = await params;

  // ── Auth + ownership ──────────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: client } = await supabase
    .from("clients")
    .select("id, user_id")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (client.user_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // ── Load queue row ────────────────────────────────────────────────────────
  const row = await getAssetQueueRow(queueId);
  if (!row || row.client_id !== clientId) {
    return NextResponse.json({ error: "Queue row not found" }, { status: 404 });
  }
  if (row.status !== "matched") {
    return NextResponse.json(
      { error: `Row status is '${row.status}' — only 'matched' rows can be prepared` },
      { status: 400 },
    );
  }
  if (!row.dropbox_url) {
    await updateQueueRowStatus(queueId, "error", { error_message: "no_dropbox_url" });
    return NextResponse.json({ error: "Row has no Dropbox URL" }, { status: 400 });
  }

  // ── Download from Dropbox (server-side) ───────────────────────────────────
  let buffer: Buffer;
  let extension: string;
  try {
    ({ buffer, extension } = await downloadDropboxAsset(row.dropbox_url));
  } catch (err) {
    if (err instanceof DropboxFetchError) {
      // Safety: do NOT log the URL; log only the error code
      console.error("[asset-queue/prepare] Dropbox fetch error", {
        clientId,
        queueId,
        code: err.code,
      });
      await updateQueueRowStatus(queueId, "error", { error_message: err.code });
      return NextResponse.json({ error: err.message, code: err.code }, { status: 200 });
    }
    throw err;
  }

  // ── Upload to Supabase Storage ────────────────────────────────────────────
  const storagePath = `queue/${queueId}.${extension}`;
  const serviceClient = createServiceRoleClient();
  const { error: uploadError } = await serviceClient.storage
    .from("campaign-assets")
    .upload(storagePath, buffer, {
      contentType: mimeFor(extension),
      upsert: true,
    });

  if (uploadError) {
    console.error("[asset-queue/prepare] Storage upload failed", {
      clientId,
      queueId,
      error: uploadError.message,
    });
    await updateQueueRowStatus(queueId, "error", { error_message: "storage_upload_failed" });
    return NextResponse.json({ error: "Asset upload failed" }, { status: 500 });
  }

  // ── Load event info for copy generation ──────────────────────────────────
  let eventName = row.resolved_event_code ?? row.location ?? "";
  if (row.resolved_event_id) {
    const { data: event } = await supabase
      .from("events")
      .select("name, event_code")
      .eq("id", row.resolved_event_id)
      .maybeSingle();
    if (event) eventName = event.name ?? event.event_code ?? eventName;
  }

  // ── Load sheet config for defaults ────────────────────────────────────────
  const config = await getAssetSheetConfig(clientId);
  const ctaDefaults = (config?.cta_defaults ?? {}) as Record<string, string>;
  const copyTemplates = (config?.copy_templates ?? {}) as Record<string, string>;
  const urlPattern = (config?.destination_url_pattern ?? {}) as Record<string, string>;

  // ── Generate copy (never throws) ──────────────────────────────────────────
  const generated = await generateCopy(
    {
      assetName: row.asset_name ?? "",
      mediaType: row.media_type ?? "",
      funnel: row.funnel ?? "MOFU",
      location: row.location ?? "",
      eventName,
      eventCode: row.resolved_event_code ?? "",
    },
    copyTemplates,
    ctaDefaults,
  );

  // URL pattern is stored as-is; interpolation happens client-side at confirm step
  const generatedUrl = urlPattern[row.funnel ?? ""] ?? "";

  // ── Persist results ───────────────────────────────────────────────────────
  await updateQueueRowPrepared(queueId, {
    assetBlobUrl: storagePath,
    generatedCopy: generated.primaryText,
    generatedCta: generated.ctaValue,
    generatedUrl,
  });

  console.error("[asset-queue/prepare] complete", {
    clientId,
    queueId,
    extension,
    funnel: row.funnel,
    fromFallback: generated.fromFallback,
  });

  return NextResponse.json({
    ok: true,
    storagePath,
    generatedCopy: generated.primaryText,
    generatedCta: generated.ctaValue,
    generatedUrl,
    fromFallback: generated.fromFallback,
  });
}

function mimeFor(ext: string): string {
  const map: Record<string, string> = {
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
  };
  return map[ext.toLowerCase()] ?? "application/octet-stream";
}
