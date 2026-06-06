/**
 * POST /api/clients/[id]/asset-queue/[queueId]/upload-to-meta
 *
 * Downloads prepared queue assets from Supabase Storage and uploads each to
 * Meta. Returns aspect + media metadata for the bulk-attach wizard auto-bind.
 */

import { NextRequest, NextResponse } from "next/server";

import { getAssetQueueRow } from "@/lib/db/asset-queue";
import {
  mergeAspectHints,
  parseAspectFromFilename,
  probeAspectFromBuffer,
} from "@/lib/clients/asset-queue/aspect-detect";
import { MAX_QUEUE_META_UPLOAD } from "@/lib/clients/asset-queue/queue-creative-bind";
import {
  uploadImageAsset,
  uploadVideoAsset,
  MetaApiError,
} from "@/lib/meta/client";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { validateAssetFile } from "@/lib/meta/upload";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 300;

const STORAGE_BUCKET = "campaign-assets";

interface UploadResultAsset {
  fileName: string;
  aspect: string;
  mediaType: "image" | "video";
  metaAssetId: string;
  url: string;
  previewUrl?: string;
  hash?: string;
  videoId?: string;
}

function mimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
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
  return map[ext] ?? "application/octet-stream";
}

function mediaTypeFromMime(mime: string): "image" | "video" {
  return mime.startsWith("video/") ? "video" : "image";
}

function aspectPriority(aspect: string): number {
  if (aspect === "4:5") return 0;
  if (aspect === "9:16") return 1;
  if (aspect === "1:1") return 2;
  return 3;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; queueId: string }> },
): Promise<NextResponse> {
  const { id: clientId, queueId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: client } = await supabase
    .from("clients")
    .select("id, user_id, meta_ad_account_id")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (client.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { adAccountId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const adAccountId = body.adAccountId?.trim() || client.meta_ad_account_id;
  if (!adAccountId) {
    return NextResponse.json({ error: "Missing adAccountId" }, { status: 400 });
  }

  const row = await getAssetQueueRow(queueId);
  if (!row || row.client_id !== clientId) {
    return NextResponse.json({ error: "Queue row not found" }, { status: 404 });
  }
  if (row.status !== "pending") {
    return NextResponse.json(
      { error: `Row status is '${row.status}' — only pending rows can upload` },
      { status: 400 },
    );
  }

  const paths = row.asset_blob_urls?.length
    ? row.asset_blob_urls
    : row.asset_blob_url
      ? [row.asset_blob_url]
      : [];
  if (paths.length === 0) {
    return NextResponse.json({ error: "No prepared assets on queue row" }, { status: 400 });
  }

  let uploadToken: string | undefined;
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    uploadToken = resolved.token;
  } catch {
    uploadToken = undefined;
  }

  const storage = createServiceRoleClient();
  const assets: UploadResultAsset[] = [];
  const errors: { fileName: string; error: string }[] = [];

  const trimmedPaths =
    paths.length > MAX_QUEUE_META_UPLOAD
      ? [...paths]
          .map((path, index) => ({
            path,
            index,
            fileName: path.split("/").pop() ?? path,
            hint: parseAspectFromFilename(path.split("/").pop() ?? path),
          }))
          .sort((a, b) => {
            const ap = aspectPriority(a.hint ?? "other");
            const bp = aspectPriority(b.hint ?? "other");
            if (ap !== bp) return ap - bp;
            return a.index - b.index;
          })
          .slice(0, MAX_QUEUE_META_UPLOAD)
          .map((entry) => entry.path)
      : paths;

  const truncated = paths.length > trimmedPaths.length;

  for (const storagePath of trimmedPaths) {
    const fileName = storagePath.split("/").pop() ?? storagePath;
    const mime = mimeFromPath(storagePath);
    const type = mediaTypeFromMime(mime);

    const { data: blob, error: downloadError } = await storage.storage
      .from(STORAGE_BUCKET)
      .download(storagePath);

    if (downloadError || !blob) {
      errors.push({
        fileName,
        error: downloadError?.message ?? "Download failed",
      });
      continue;
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    const file = new File([buffer], fileName, { type: mime || blob.type });

    const { isValid, error: validationError } = validateAssetFile(file, type);
    if (!isValid) {
      errors.push({ fileName, error: validationError ?? "Validation failed" });
      continue;
    }

    const fromFilename = parseAspectFromFilename(fileName);
    const fromProbe =
      type === "image" ? await probeAspectFromBuffer(buffer, mime) : "other";
    const aspect = mergeAspectHints(fromFilename, fromProbe);

    try {
      if (type === "image") {
        const { hash, url } = await uploadImageAsset(
          adAccountId,
          file,
          fileName,
          uploadToken,
        );
        if (!hash) {
          errors.push({ fileName, error: "Meta image upload returned no hash" });
          continue;
        }
        assets.push({
          fileName,
          aspect,
          mediaType: "image",
          metaAssetId: hash,
          url,
          previewUrl: url,
          hash,
        });
      } else {
        const { videoId, previewUrl } = await uploadVideoAsset(
          adAccountId,
          file,
          fileName,
          uploadToken,
        );
        if (!videoId) {
          errors.push({ fileName, error: "Meta video upload returned no video id" });
          continue;
        }
        assets.push({
          fileName,
          aspect,
          mediaType: "video",
          metaAssetId: videoId,
          url: previewUrl ?? "",
          previewUrl,
          videoId,
        });
      }
    } catch (err) {
      const message =
        err instanceof MetaApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      errors.push({ fileName, error: message });
    }
  }

  return NextResponse.json({
    assets,
    errors,
    truncated,
    totalPrepared: paths.length,
    metaLimit: MAX_QUEUE_META_UPLOAD,
  });
}
