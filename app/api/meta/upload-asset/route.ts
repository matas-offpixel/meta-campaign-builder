import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { uploadToStorageBucket } from "@/lib/clients/asset-queue/storage-upload";
import {
  existingMetaResult,
  findExistingMetaChannelUpload,
  registerMetaUpload,
} from "@/lib/creatives/register-upload";
import {
  uploadImageAsset,
  uploadVideoAsset,
  MetaApiError,
} from "@/lib/meta/client";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { validateAssetFile, type AssetUploadType, type UploadAssetResult } from "@/lib/meta/upload";
import { uploadStoredVideoByUrl } from "@/lib/meta/storage-video-by-url";
import {
  META_STORAGE_FETCH_TTL_SECONDS,
  StorageVideoInputError,
  downloadSignedStorageObject,
  metaVideoUploadMode,
} from "@/lib/meta/video-file-url";

// file_url returns as soon as Meta accepts the URL, then this function
// polls status. The multipart path (the default) of a large file still
// needs the long budget. Vercel's default 10s (Hobby) / 60s (Pro) is too short.
export const maxDuration = 300;

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  // ── Service-role client for storage operations ────────────────────────────
  // The campaign-assets bucket has no SELECT RLS policy (intentional — prevents
  // cross-user path enumeration). createSignedUrl and object deletion therefore
  // must use the service-role client, which bypasses RLS. Auth is already
  // enforced above; storagePaths are UUIDs. The image path signs for 120 s.
  // A file_url video signs for 30 minutes so Meta can download it.
  const storage = createServiceRoleClient();

  // ── Resolve token ─────────────────────────────────────────────────────────
  let uploadToken: string | undefined;
  let uploadTokenSource = "META_ACCESS_TOKEN (env)";
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    uploadToken = resolved.token;
    uploadTokenSource = resolved.source;
  } catch {
    // Fall through — uploadImageAsset/uploadVideoAsset will use env-var fallback
    uploadToken = undefined;
  }
  console.info(`[upload-asset] token source=${uploadTokenSource}`);

  const contentType = req.headers.get("content-type") ?? "";

  // ── Storage-path path (videos, no raw payload) ────────────────────────────
  if (contentType.includes("application/json")) {
    let body: {
      storagePath?: string;
      storageBucket?: string;
      type?: string;
      adAccountId?: string;
      fileName?: string;
      aspectRatio?: string;
      contentHash?: string;
      byteSize?: number;
      contentType?: string;
    };
    try {
      body = (await req.json()) as typeof body;
    } catch (parseErr) {
      return NextResponse.json({ error: "Invalid JSON body", detail: String(parseErr) }, { status: 400 });
    }

    const {
      storagePath,
      storageBucket = "campaign-assets",
      type,
      adAccountId,
      fileName,
      aspectRatio,
      contentHash,
      byteSize,
      contentType,
    } = body;

    if (!storagePath) return NextResponse.json({ error: "Missing storagePath" }, { status: 400 });
    if (!adAccountId) return NextResponse.json({ error: "Missing adAccountId" }, { status: 400 });
    if (type !== "image" && type !== "video") {
      return NextResponse.json({ error: `Invalid type "${type ?? ""}" — must be "image" or "video"` }, { status: 400 });
    }

    console.log("[upload-asset] Storage-path route:", {
      storageBucket,
      storagePath,
      adAccountId,
      fileName,
      type,
      uploadPath: "Supabase Storage → Meta",
    });

    // file_url is opt-in. Unset keeps the download below.
    if (type === "video" && metaVideoUploadMode() === "file_url") {
      const token = uploadToken ?? process.env.META_ACCESS_TOKEN;
      if (!token) {
        return NextResponse.json(
          { error: "META_ACCESS_TOKEN is not configured. Add it to .env.local." },
          { status: 500 },
        );
      }
      const resolvedFileName = fileName ?? storagePath.split("/").pop() ?? "video.mp4";
      try {
        const result = await uploadStoredVideoByUrl({
          storagePath,
          storageBucket,
          fileName: resolvedFileName,
          adAccountId,
          token,
          contentHash,
          byteSize,
          contentType,
          aspectRatio,
          userId: user.id,
          supabase,
          createSignedUrl: async (bucket, path, ttlSeconds) => {
            const { data, error } = await storage.storage.from(bucket).createSignedUrl(path, ttlSeconds);
            if (error || !data?.signedUrl) return { error: error?.message ?? "unknown error" };
            return { signedUrl: data.signedUrl };
          },
          remove: async (bucket, path) => {
            await storage.storage.from(bucket).remove([path]).catch(() => {});
          },
          findExisting: async (client, input) => {
            const hit = await findExistingMetaChannelUpload(client, {
              userId: input.userId,
              identity: input.identity,
              adAccountId: input.adAccountId,
            });
            if (!hit) return null;
            const reused = existingMetaResult(hit, "video");
            return {
              videoId: reused.videoId ?? hit.platformId,
              previewUrl: reused.previewUrl ?? "",
              registryAssetId: reused.registryAssetId,
            };
          },
          register: async (input) =>
            registerMetaUpload({
              supabase: input.supabase,
              userId: input.userId,
              identity: input.identity,
              fileName: input.fileName,
              mediaKind: "video",
              adAccountId: input.adAccountId,
              storageBucket: input.storageBucket,
              storagePath: input.storagePath,
              result: input.result,
              slotHint: input.slotHint,
            }),
        });
        return NextResponse.json(result, { status: 201 });
      } catch (err) {
        if (err instanceof StorageVideoInputError) {
          return NextResponse.json({ error: err.message }, { status: 400 });
        }
        const message = err instanceof Error ? err.message : String(err);
        console.error("[upload-asset] file_url upload failed", message.slice(0, 200));
        return NextResponse.json({ error: message }, { status: 502 });
      }
    }

    // ── Step 1: create a signed URL so we can download the file ──────────────
    // Uses the service-role client so RLS on storage.objects doesn't block the
    // read. The bucket has no SELECT policy by design — adding one would allow
    // any authenticated user to enumerate other users' uploads by path. Auth is
    // already enforced above; the storagePath is a UUID; TTL is 120 s.
    console.error("[upload-asset] start", {
      storagePath,
      storageBucket,
      fileNameLen: fileName?.length,
    });

    const { data: signedData, error: signedError } = await storage.storage
      .from(storageBucket)
      .createSignedUrl(storagePath, META_STORAGE_FETCH_TTL_SECONDS);

    if (signedError || !signedData?.signedUrl) {
      console.error("[upload-asset] Failed to create signed URL:", signedError);
      return NextResponse.json(
        { error: `Failed to access stored file: ${signedError?.message ?? "unknown error"}` },
        { status: 500 },
      );
    }

    // Step 2: fetch the video from storage
    let videoBlob: Blob;
    try {
      videoBlob = await downloadSignedStorageObject(signedData.signedUrl);
    } catch (fetchErr) {
      console.error("[upload-asset] Failed to fetch from storage:", fetchErr);
      return NextResponse.json(
        { error: `Failed to fetch video from storage: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}` },
        { status: 500 },
      );
    }

    const resolvedFileName = fileName ?? storagePath.split("/").pop() ?? "video.mp4";
    const file = new File([videoBlob], resolvedFileName, { type: videoBlob.type || "video/mp4" });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const existing = await findExistingMetaChannelUpload(supabase, {
      userId: user.id,
      bytes,
      adAccountId,
    });
    if (existing) {
      await storage.storage.from(storageBucket).remove([storagePath]).catch(() => {});
      return NextResponse.json(existingMetaResult(existing, type), { status: 201 });
    }

    console.log("[upload-asset] Fetched from storage:", {
      sizeBytes: file.size,
      sizeMB: (file.size / 1024 / 1024).toFixed(2),
      mimeType: file.type,
    });

    // Step 3: validate
    const { isValid, error: validationError } = validateAssetFile(file, type);
    if (!isValid) {
      // Clean up storage
      await storage.storage.from(storageBucket).remove([storagePath]).catch(() => {});
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    // Step 4: upload to Meta
    const cleanup = () => storage.storage.from(storageBucket).remove([storagePath]).catch(() => {});

    if (type === "image") {
      try {
        const { hash, url } = await uploadImageAsset(adAccountId, file, resolvedFileName, uploadToken);
        const result: UploadAssetResult = { assetType: "image", url, hash, previewUrl: url };
        console.log("[upload-asset] ✓ Image uploaded to Meta via storage path:", { hash, url });
        result.registryAssetId = await registerMetaUpload({
          supabase,
          userId: user.id,
          bytes,
          fileName: resolvedFileName,
          mediaKind: type,
          adAccountId,
          storageBucket,
          storagePath,
          result,
          slotHint: aspectRatio,
        });
        return NextResponse.json(result, { status: 201 });
      } catch (err) {
        await cleanup();
        throw err;
      }
    }

    try {
      const { videoId, previewUrl } = await uploadVideoAsset(adAccountId, file, resolvedFileName, uploadToken);
      const result: UploadAssetResult = {
        assetType: "video",
        url: previewUrl ?? "",
        videoId,
        previewUrl,
      };
      console.log("[upload-asset] ✓ Video uploaded to Meta:", { videoId, previewUrl });
      result.registryAssetId = await registerMetaUpload({
        supabase,
        userId: user.id,
        bytes,
        fileName: resolvedFileName,
        mediaKind: type,
        adAccountId,
        storageBucket,
        storagePath,
        result,
        slotHint: aspectRatio,
      });
      return NextResponse.json(result, { status: 201 });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errName = err instanceof Error ? err.name : "unknown";
      console.error("[upload-asset] Meta upload threw", {
        name: errName,
        message: errMsg.slice(0, 200),
      });
      await cleanup();
      throw err;
    }
  }

  // ── FormData path (images) ────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (parseErr) {
    console.error("[upload-asset] req.formData() failed:", parseErr);
    return NextResponse.json(
      {
        error: "Failed to parse multipart form data",
        detail: String(parseErr),
        hint: "Body may exceed the server size limit — use the Supabase Storage upload path instead (send JSON with storagePath).",
      },
      { status: 400 },
    );
  }

  const receivedKeys = [...formData.keys()];
  console.log("[upload-asset] FormData keys:", receivedKeys);

  const file = formData.get("file") as File | null;
  const type = formData.get("type") as "image" | "video" | null;
  const adAccountId = formData.get("adAccountId") as string | null;
  const aspectRatio = (formData.get("aspectRatio") as string | null) ?? null;

  if (!file) return NextResponse.json({ error: "Missing required field: 'file'" }, { status: 400 });
  if (!type) return NextResponse.json({ error: "Missing required field: 'type'" }, { status: 400 });
  if (!adAccountId) return NextResponse.json({ error: "Missing required field: 'adAccountId'" }, { status: 400 });
  if (type !== "image" && type !== "video") {
    return NextResponse.json({ error: `Invalid type "${type}"` }, { status: 400 });
  }
  if (file.size === 0) return NextResponse.json({ error: "Uploaded file is empty (0 bytes)" }, { status: 400 });

  console.log("[upload-asset] FormData upload:", {
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    sizeMB: (file.size / 1024 / 1024).toFixed(2),
    type,
    adAccountId,
    uploadPath: "FormData → Meta (direct)",
  });

  const { isValid, error: validationError } = validateAssetFile(file, type);
  if (!isValid) {
    console.warn("[upload-asset] validation failed:", validationError);
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const existing = await findExistingMetaChannelUpload(supabase, {
    userId: user.id,
    bytes,
    adAccountId,
  });
  if (existing) {
    return NextResponse.json(existingMetaResult(existing, type), { status: 201 });
  }

  try {
    let result: UploadAssetResult;
    if (type === "image") {
      const { hash, url } = await uploadImageAsset(adAccountId, file, file.name, uploadToken);
      result = { assetType: "image", url, hash, previewUrl: url };
    } else {
      const { videoId, previewUrl } = await uploadVideoAsset(adAccountId, file, file.name, uploadToken);
      result = { assetType: "video", url: previewUrl ?? "", videoId, previewUrl };
    }
    const folder = type === "video" ? "videos" : "images";
    const ext = file.name.split(".").pop()?.toLowerCase() ?? (type === "video" ? "mp4" : "jpg");
    const storagePath = `${folder}/${crypto.randomUUID()}.${ext}`;
    const stored = await uploadToStorageBucket(
      storage,
      "campaign-assets",
      storagePath,
      Buffer.from(bytes),
      file.type || (type === "video" ? "video/mp4" : "image/jpeg"),
    );
    if (stored.error) {
      console.error("[upload-asset] registry persist failed:", stored.error);
    }
    result.registryAssetId = await registerMetaUpload({
      supabase,
      userId: user.id,
      bytes,
      fileName: file.name,
      mediaKind: type as AssetUploadType,
      adAccountId,
      storageBucket: "campaign-assets",
      storagePath,
      result,
      slotHint: aspectRatio,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof MetaApiError) {
      const payload = err.toJSON();
      console.error("[upload-asset] Meta API error:", JSON.stringify(payload, null, 2));
      return NextResponse.json(
        { error: payload.error ?? "Meta API error", code: payload.code, metaError: payload },
        { status: 502 },
      );
    }
    console.error("[upload-asset] Unexpected error:", err);
    return NextResponse.json({ error: `Unexpected error: ${String(err)}` }, { status: 500 });
  }
}
