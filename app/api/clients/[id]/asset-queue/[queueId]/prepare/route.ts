/**
 * POST /api/clients/[id]/asset-queue/[queueId]/prepare
 *
 * Downloads the Dropbox asset(s) server-side, uploads to Supabase Storage,
 * then generates AI ad copy via Claude Haiku 4.5. Writes results to DB and
 * transitions status: matched / matched_umbrella → pending.
 *
 * Two Dropbox URL types are handled:
 *   /scl/fi/  — single file → one upload → asset_blob_url + asset_blob_urls=[path]
 *   /scl/fo/  — shared folder → list media files, upload each →
 *               asset_blob_url (first file), asset_blob_urls (all), media_file_count
 *
 * In both cases: ONE Anthropic call using the highest-intent funnel from the row.
 *
 * On Dropbox 403/404/folder_too_large: sets status='error', returns 200 with code.
 * URLs are NEVER logged.
 *
 * maxDuration = 300 (Vercel Serverless — video downloads can be large)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getAssetQueueRow, updateQueueRowStatus, updateQueueRowPrepared } from "@/lib/db/asset-queue";
import { getAssetSheetConfig } from "@/lib/db/asset-sheet-config";
import {
  isDropboxFolderUrl,
  downloadDropboxAsset,
  downloadDropboxFolderFiles,
  DropboxFetchError,
} from "@/lib/clients/asset-queue/dropbox";
import { generateCopy } from "@/lib/clients/asset-queue/copy-generator";
import { resolveOrganiserDestinationUrl } from "@/lib/clients/asset-queue/destination-url";
import { buildQueueStoragePath } from "@/lib/clients/asset-queue/storage-filename";

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
    .select("id, user_id, slug")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (client.user_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // ── Load queue row ────────────────────────────────────────────────────────
  const row = await getAssetQueueRow(queueId);
  if (!row || row.client_id !== clientId) {
    return NextResponse.json({ error: "Queue row not found" }, { status: 404 });
  }
  if (row.status !== "matched" && row.status !== "matched_umbrella") {
    return NextResponse.json(
      { error: `Row status is '${row.status}' — only 'matched' or 'matched_umbrella' rows can be prepared` },
      { status: 400 },
    );
  }
  if (!row.dropbox_url) {
    await updateQueueRowStatus(queueId, "error", { error_message: "no_dropbox_url" });
    return NextResponse.json({ error: "Row has no Dropbox URL" }, { status: 400 });
  }

  const serviceClient = createServiceRoleClient();

  // ── Download from Dropbox + upload to Storage ─────────────────────────────
  let uploadedPaths: string[] = [];

  if (isDropboxFolderUrl(row.dropbox_url)) {
    // ── Folder branch: download all media files ───────────────────────────
    let folderFiles: Awaited<ReturnType<typeof downloadDropboxFolderFiles>>;
    try {
      folderFiles = await downloadDropboxFolderFiles(row.dropbox_url);
    } catch (err) {
      if (err instanceof DropboxFetchError) {
        console.error("[asset-queue/prepare] Dropbox folder error", {
          clientId,
          queueId,
          code: err.code,
        });
        await updateQueueRowStatus(queueId, "error", { error_message: err.code });
        return NextResponse.json({ error: err.message, code: err.code }, { status: 200 });
      }
      throw err;
    }

    const usedPaths = new Set<string>();
    for (const file of folderFiles) {
      const { buffer, name, extension } = file;
      const storagePath = buildQueueStoragePath(queueId, name, usedPaths);
      const { error: uploadError } = await serviceClient.storage
        .from("campaign-assets")
        .upload(storagePath, buffer, { contentType: mimeFor(extension), upsert: true });

      if (uploadError) {
        console.error("[asset-queue/prepare] Storage upload failed for folder file", {
          clientId,
          queueId,
          index: i,
          error: uploadError.message,
        });
        await updateQueueRowStatus(queueId, "error", { error_message: "storage_upload_failed" });
        return NextResponse.json({ error: "Asset upload failed" }, { status: 500 });
      }
      uploadedPaths.push(storagePath);
    }
  } else {
    // ── Single file branch ────────────────────────────────────────────────
    let buffer: Buffer;
    let extension: string;
    try {
      ({ buffer, extension } = await downloadDropboxAsset(row.dropbox_url));
    } catch (err) {
      if (err instanceof DropboxFetchError) {
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

    const storagePath = `queue/${queueId}.${extension}`;
    const { error: uploadError } = await serviceClient.storage
      .from("campaign-assets")
      .upload(storagePath, buffer, { contentType: mimeFor(extension), upsert: true });

    if (uploadError) {
      console.error("[asset-queue/prepare] Storage upload failed", {
        clientId,
        queueId,
        error: uploadError.message,
      });
      await updateQueueRowStatus(queueId, "error", { error_message: "storage_upload_failed" });
      return NextResponse.json({ error: "Asset upload failed" }, { status: 500 });
    }
    uploadedPaths = [storagePath];
  }

  if (uploadedPaths.length === 0) {
    await updateQueueRowStatus(queueId, "error", { error_message: "no_files_uploaded" });
    return NextResponse.json({ error: "No files were uploaded" }, { status: 500 });
  }

  // ── Load event info for copy generation + destination URL ─────────────────
  let eventName: string;
  let venueCity: string | null = null;
  if (row.resolved_event_codes_multi && row.resolved_event_codes_multi.length > 0) {
    const nation = row.nation ?? "All";
    eventName = `All ${nation} venues`;
  } else {
    eventName = row.resolved_event_code ?? row.location ?? "";
    if (row.resolved_event_id) {
      const { data: event } = await supabase
        .from("events")
        .select("name, event_code, venue_city")
        .eq("id", row.resolved_event_id)
        .maybeSingle();
      if (event) {
        eventName = event.name ?? event.event_code ?? eventName;
        venueCity = event.venue_city ?? null;
      }
    }
  }

  // ── Load sheet config for defaults ────────────────────────────────────────
  const config = await getAssetSheetConfig(clientId);
  const ctaDefaults  = (config?.cta_defaults        ?? {}) as Record<string, string>;
  const copyTemplates = (config?.copy_templates       ?? {}) as Record<string, string>;
  const urlPattern   = (config?.destination_url_pattern ?? {}) as Record<string, string>;

  // ── Single Anthropic call using highest-intent funnel ─────────────────────
  const generated = await generateCopy(
    {
      assetName: row.asset_name ?? "",
      mediaType: row.media_type ?? "",
      funnel: row.funnel ?? "MOFU",    // already highest-intent from sheet parser
      location: row.location ?? "",
      eventName,
      eventCode: row.resolved_event_code ?? "",
    },
    copyTemplates,
    ctaDefaults,
  );

  const patternUrl = urlPattern[row.funnel ?? ""]?.trim() ?? "";
  const generatedUrl =
    patternUrl ||
    resolveOrganiserDestinationUrl(client.slug, venueCity) ||
    "";

  // ── Persist results ───────────────────────────────────────────────────────
  const firstPath = uploadedPaths[0];
  await updateQueueRowPrepared(queueId, {
    assetBlobUrl: firstPath,
    assetBlobUrls: uploadedPaths,
    mediaFileCount: uploadedPaths.length,
    generatedCopy: generated.primaryText,
    generatedCta: generated.ctaValue,
    generatedUrl,
  });

  console.error("[asset-queue/prepare] complete", {
    clientId,
    queueId,
    fileCount: uploadedPaths.length,
    isFolder: isDropboxFolderUrl(row.dropbox_url),
    funnel: row.funnel,
    fromFallback: generated.fromFallback,
  });

  return NextResponse.json({
    ok: true,
    storagePath: firstPath,
    storagePaths: uploadedPaths,
    mediaFileCount: uploadedPaths.length,
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
