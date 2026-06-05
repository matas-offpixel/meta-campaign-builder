/**
 * POST /api/clients/[id]/asset-queue/[queueId]/override-urls
 *
 * Manual escape hatch for queue rows whose Dropbox folder listing failed.
 * The user pastes direct /scl/fi/ file URLs; this route downloads each,
 * uploads to Storage, and resets the row to status='matched' so the normal
 * Prepare flow can run and generate AI copy.
 *
 * Accepts: { urls: string[] }  — up to 20 /scl/fi/ Dropbox file URLs
 * Refuses:  any /scl/fo/ folder URL (use the folder flow instead)
 *
 * Does NOT generate AI copy — that still happens on the Prepare step.
 *
 * maxDuration = 120 (downloads can be slow for large video files)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getAssetQueueRow } from "@/lib/db/asset-queue";
import {
  isDropboxFolderUrl,
  downloadDropboxAsset,
  DropboxFetchError,
} from "@/lib/clients/asset-queue/dropbox";

export const maxDuration = 120;

const MAX_URLS = 20;

export async function POST(
  req: NextRequest,
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
  if (row.status !== "error") {
    return NextResponse.json(
      { error: `Row status is '${row.status}' — only error rows can be overridden` },
      { status: 400 },
    );
  }

  // ── Parse + validate request body ────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = (body as Record<string, unknown>)?.urls;
  if (!Array.isArray(raw) || raw.length === 0) {
    return NextResponse.json({ error: "urls must be a non-empty array" }, { status: 400 });
  }
  if (raw.length > MAX_URLS) {
    return NextResponse.json({ error: `Too many URLs — maximum ${MAX_URLS}` }, { status: 400 });
  }

  const urls: string[] = raw.map(String).map((u) => u.trim()).filter(Boolean);
  if (urls.length === 0) {
    return NextResponse.json({ error: "No valid URLs provided" }, { status: 400 });
  }

  // Refuse /scl/fo/ folder URLs — the override is for individual file links only
  const folderUrls = urls.filter(isDropboxFolderUrl);
  if (folderUrls.length > 0) {
    return NextResponse.json(
      {
        error:
          "Folder URLs are not allowed in override — paste direct file links (format: dropbox.com/scl/fi/...).",
        hint: "Open the failing Dropbox folder in your browser, click each file, then copy its individual share link.",
      },
      { status: 400 },
    );
  }

  // Basic URL sanity check — must look like a Dropbox link
  const nonDropbox = urls.filter((u) => !u.includes("dropbox.com") && !u.includes("dropboxusercontent.com"));
  if (nonDropbox.length > 0) {
    return NextResponse.json(
      { error: "All URLs must be Dropbox links (dropbox.com or dropboxusercontent.com)" },
      { status: 400 },
    );
  }

  // ── Download each file + upload to Storage ────────────────────────────────
  const serviceClient = createServiceRoleClient();
  const uploadedPaths: string[] = [];

  for (let i = 0; i < urls.length; i++) {
    let buffer: Buffer;
    let extension: string;

    try {
      ({ buffer, extension } = await downloadDropboxAsset(urls[i]));
    } catch (err) {
      if (err instanceof DropboxFetchError) {
        // Do NOT include the URL in the response
        console.error("[asset-queue/override-urls] Dropbox fetch error", {
          clientId,
          queueId,
          index: i,
          code: err.code,
        });
        return NextResponse.json(
          { error: `File ${i + 1} download failed: ${err.message}`, code: err.code },
          { status: 422 },
        );
      }
      throw err;
    }

    const storagePath = `queue/${queueId}/override-${i}.${extension}`;
    const { error: uploadError } = await serviceClient.storage
      .from("campaign-assets")
      .upload(storagePath, buffer, {
        contentType: mimeFor(extension),
        upsert: true,
      });

    if (uploadError) {
      console.error("[asset-queue/override-urls] Storage upload failed", {
        clientId,
        queueId,
        index: i,
        error: uploadError.message,
      });
      return NextResponse.json({ error: "Asset upload failed" }, { status: 500 });
    }

    uploadedPaths.push(storagePath);
  }

  // ── Reset row to matched so the normal Prepare flow can run ──────────────
  // We clear the error, store the override files, and drop back to 'matched'
  // so the user's next click of Prepare generates AI copy as usual.
  const { error: updateError } = await serviceClient
    .from("client_asset_queue")
    .update({
      status: "matched",
      error_message: null,
      dropbox_url: urls[0],                   // update to the first override URL
      asset_blob_url: null,                   // cleared — Prepare will fill this
      asset_blob_urls: uploadedPaths,         // pre-uploaded paths for Prepare to use
      media_file_count: uploadedPaths.length,
      updated_at: new Date().toISOString(),
    })
    .eq("id", queueId);

  if (updateError) {
    console.error("[asset-queue/override-urls] DB update failed", {
      clientId,
      queueId,
      error: updateError.message,
    });
    return NextResponse.json({ error: "Database update failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, fileCount: uploadedPaths.length });
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
