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
import { DropboxFetchError } from "@/lib/clients/asset-queue/dropbox";
import { DriveFetchError } from "@/lib/clients/asset-queue/drive";
import { resolveQueueSourceProvider } from "@/lib/clients/asset-queue/queue-handoff";
import { generateCopy } from "@/lib/clients/asset-queue/copy-generator";
import { resolveOrganiserDestinationUrl, resolveUniversalClientUrl } from "@/lib/clients/asset-queue/destination-url";
import {
  loadResolvedEventContext,
  resolveQueueRowVenue,
} from "@/lib/clients/asset-queue/resolve-queue-venue";
import { buildQueueStoragePath } from "@/lib/clients/asset-queue/storage-filename";
import { uploadToStorageBucket, RESUMABLE_UPLOAD_THRESHOLD } from "@/lib/clients/asset-queue/storage-upload";

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

  // Re-resolve venue when event_code was cleared (SQL reset, legacy scrape, etc.)
  let resolvedEventCode = row.resolved_event_code;
  let resolvedEventId = row.resolved_event_id;
  let eventMatchAmbiguous = row.event_match_ambiguous ?? false;

  const isUmbrella = !!(row.resolved_event_codes_multi && row.resolved_event_codes_multi.length > 0);
  if (!isUmbrella && !resolvedEventCode) {
    const reResolved = await resolveQueueRowVenue(supabase, clientId, row);
    if (reResolved) {
      resolvedEventCode = reResolved.resolvedEventCode;
      resolvedEventId = reResolved.resolvedEventId;
      eventMatchAmbiguous = reResolved.eventMatchAmbiguous;
      console.error("[asset-queue/prepare] re-resolved venue from asset_name", {
        clientId,
        queueId,
        assetName: row.asset_name,
        resolvedEventCode,
        eventMatchAmbiguous,
      });
    } else {
      console.error("[asset-queue/prepare] could not re-resolve venue — proceeding with NULL event_code", {
        clientId,
        queueId,
        assetName: row.asset_name,
        location: row.location,
      });
    }
  }

  const serviceClient = createServiceRoleClient();

  // Load the sheet config once — its `source` field selects the download
  // provider (Dropbox vs Google Drive); reused later for copy defaults.
  const config = await getAssetSheetConfig(clientId);
  const provider = resolveQueueSourceProvider(row, config?.source ?? null);

  // ── Download from source (Dropbox / Drive) + upload to Storage ────────────
  let uploadedPaths: string[] = [];

  if (provider.isFolderUrl(row.dropbox_url)) {
    // ── Folder branch: download all media files ───────────────────────────
    let folderFiles: Awaited<ReturnType<typeof provider.downloadFolderFiles>>;
    try {
      folderFiles = await provider.downloadFolderFiles(row.dropbox_url);
    } catch (err) {
      const code = sourceFetchErrorCode(err);
      if (code) {
        console.error("[asset-queue/prepare] source folder error", {
          clientId,
          queueId,
          source: provider.source,
          code,
        });
        await updateQueueRowStatus(queueId, "error", { error_message: code });
        return NextResponse.json({ error: (err as Error).message, code }, { status: 200 });
      }
      throw err;
    }

    const usedPaths = new Set<string>();
    for (const file of folderFiles) {
      const { buffer, name, extension } = file;
      const storagePath = buildQueueStoragePath(queueId, name, usedPaths);
      const sizeMB = Math.round(buffer.byteLength / 1_048_576);
      if (buffer.byteLength > RESUMABLE_UPLOAD_THRESHOLD) {
        console.error("[asset-queue/prepare] Using resumable upload", { storagePath, sizeMB, queueId });
      }
      const { error: uploadError } = await uploadToStorageBucket(
        serviceClient,
        "campaign-assets",
        storagePath,
        buffer,
        mimeFor(extension),
      );

      if (uploadError) {
        console.error("[asset-queue/prepare] Storage upload failed for folder file", {
          clientId,
          queueId,
          storagePath,
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
    let originalName: string;
    try {
      ({ buffer, extension, name: originalName } = await provider.downloadSingleAsset(row.dropbox_url));
    } catch (err) {
      const code = sourceFetchErrorCode(err);
      if (code) {
        console.error("[asset-queue/prepare] source fetch error", {
          clientId,
          queueId,
          source: provider.source,
          code,
        });
        await updateQueueRowStatus(queueId, "error", { error_message: code });
        return NextResponse.json({ error: (err as Error).message, code }, { status: 200 });
      }
      throw err;
    }

    const usedPaths = new Set<string>();
    const storagePath = buildQueueStoragePath(
      queueId,
      originalName || row.asset_name || `asset.${extension}`,
      usedPaths,
    );
    const sizeMB = Math.round(buffer.byteLength / 1_048_576);
    if (buffer.byteLength > RESUMABLE_UPLOAD_THRESHOLD) {
      console.error("[asset-queue/prepare] Using resumable upload", { storagePath, sizeMB, queueId });
    }
    const { error: uploadError } = await uploadToStorageBucket(
      serviceClient,
      "campaign-assets",
      storagePath,
      buffer,
      mimeFor(extension),
    );

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
  let venueName: string | null = null;
  if (isUmbrella) {
    const nation = row.nation ?? "All";
    eventName = `All ${nation} venues`;
  } else {
    eventName = resolvedEventCode ?? row.location ?? "";
    const event = await loadResolvedEventContext(
      supabase,
      clientId,
      resolvedEventId,
      resolvedEventCode,
    );
    if (event) {
      eventName = event.name ?? event.event_code ?? eventName;
      venueName = event.venue_name ?? null;
      venueCity = event.venue_city ?? null;
      resolvedEventId = event.id;
      resolvedEventCode = event.event_code;
    }
  }

  // ── Sheet config defaults (config already loaded above for source) ────────
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
      eventCode: resolvedEventCode ?? "",
      venueName,
      venueCity,
      isUmbrella,
    },
    copyTemplates,
    ctaDefaults,
  );

  const patternUrl = urlPattern[row.funnel ?? ""]?.trim() ?? "";
  const organiserUrl = resolveOrganiserDestinationUrl(client.slug, venueCity);
  const universalUrl = resolveUniversalClientUrl(client.slug);
  const generatedUrl = isUmbrella
    ? patternUrl || universalUrl || ""
    : patternUrl || organiserUrl || "";

  if (!isUmbrella && !generatedUrl) {
    console.error("[asset-queue/prepare] destination URL empty after fallbacks", {
      clientId,
      queueId,
      clientSlug: client.slug,
      venueCity,
      resolvedEventCode,
      funnel: row.funnel,
      hadPatternUrl: !!patternUrl,
      hadOrganiserBase: !!organiserUrl || venueCity == null,
    });
  }

  // ── Persist results ───────────────────────────────────────────────────────
  const firstPath = uploadedPaths[0];
  await updateQueueRowPrepared(queueId, {
    assetBlobUrl: firstPath,
    assetBlobUrls: uploadedPaths,
    mediaFileCount: uploadedPaths.length,
    generatedCopy: generated.primaryText,
    generatedCta: generated.ctaValue,
    generatedUrl,
    resolvedEventId: isUmbrella ? row.resolved_event_id : resolvedEventId,
    resolvedEventCode: isUmbrella ? null : resolvedEventCode,
    eventMatchAmbiguous: isUmbrella ? false : eventMatchAmbiguous,
  });

  console.error("[asset-queue/prepare] complete", {
    clientId,
    queueId,
    fileCount: uploadedPaths.length,
    source: provider.source,
    isFolder: provider.isFolderUrl(row.dropbox_url),
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

/**
 * Returns the shared error `code` when `err` is a source-provider fetch error
 * (Dropbox or Drive — identical code unions), or null otherwise. Lets the
 * download branches map any provider error to a row status without logging URLs.
 */
function sourceFetchErrorCode(err: unknown): string | null {
  if (err instanceof DropboxFetchError || err instanceof DriveFetchError) {
    return err.code;
  }
  return null;
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
