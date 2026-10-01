import { compressUploadImage } from "./compress-upload-image.ts";
import { uploadStoredVideoByUrl } from "./storage-video-by-url.ts";
import {
  validateAssetFile,
  MAX_IMAGE_BYTES,
  type AssetUploadType,
  type UploadAssetResult,
} from "./upload.ts";
import {
  META_STORAGE_FETCH_TTL_SECONDS,
  StorageVideoInputError,
  metaVideoUploadMode,
} from "./video-file-url.ts";

/**
 * MetaApiError used to escape the storage-path image branch (`throw err`),
 * and Next turned that into an empty 500. The Creatives slot then showed
 * "HTTP 500" instead of Meta's message. Every failure from this handler is
 * JSON. Duck-typed so this module does not import lib/meta/client.ts
 * (parameter properties there cannot load under the node:test runner).
 */
export function uploadFailureResponse(err: unknown): Response {
  const meta = err as Error & {
    userMsg?: string;
    subcode?: number;
    toJSON?: () => Record<string, unknown>;
  };
  if (err instanceof Error && err.name === "MetaApiError" && typeof meta.toJSON === "function") {
    const payload = meta.toJSON();
    const message = meta.userMsg || meta.message || "Meta API error";
    console.error("[upload-asset] Meta API error:", JSON.stringify(payload, null, 2));
    return Response.json(
      { error: message, code: payload.code, error_subcode: meta.subcode, metaError: payload },
      { status: 502 },
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error("[upload-asset] Unexpected error:", err);
  return Response.json({ error: message }, { status: 500 });
}

type ExistingHit = {
  asset: { id: string; thumbnailUrl?: string | null };
  platformId: string;
};

export type UploadAssetHooks = {
  getUser: () => Promise<{ id: string } | null>;
  resolveToken: (userId: string) => Promise<{ token?: string; source: string }>;
  supabase: unknown;
  storage: {
    createSignedUrl: (
      bucket: string,
      path: string,
      ttlSeconds: number,
    ) => Promise<{ signedUrl?: string; error?: string }>;
    remove: (bucket: string, paths: string[]) => Promise<void>;
  };
  download: (signedUrl: string) => Promise<Blob>;
  findExisting: (input: {
    userId: string;
    bytes: Uint8Array;
    adAccountId: string;
  }) => Promise<ExistingHit | null>;
  uploadImage: (
    adAccountId: string,
    file: Blob,
    filename: string,
    token?: string,
  ) => Promise<{ hash?: string; url: string }>;
  uploadVideo: (
    adAccountId: string,
    file: Blob,
    filename: string,
    token?: string,
  ) => Promise<{ videoId?: string; previewUrl?: string }>;
  register: (input: {
    userId: string;
    bytes?: Uint8Array;
    identity?: { contentHash: string; byteSize: number };
    fileName: string;
    mediaKind: AssetUploadType;
    adAccountId: string;
    storageBucket: string;
    storagePath: string;
    result: UploadAssetResult;
    slotHint?: string | null;
  }) => Promise<string | undefined>;
  persist: (
    storagePath: string,
    bytes: Buffer,
    contentType: string,
  ) => Promise<{ error: { message: string } | Error | null }>;
};

function resultFromExisting(hit: ExistingHit, mediaKind: AssetUploadType): UploadAssetResult {
  const preview = hit.asset.thumbnailUrl ?? "";
  if (mediaKind === "image") {
    return {
      assetType: "image",
      url: preview,
      hash: hit.platformId,
      previewUrl: preview,
      registryAssetId: hit.asset.id,
    };
  }
  return {
    assetType: "video",
    url: preview,
    videoId: hit.platformId,
    previewUrl: preview,
    registryAssetId: hit.asset.id,
  };
}

export async function handleUploadAsset(req: Request, hooks?: UploadAssetHooks): Promise<Response> {
  try {
    const h = hooks ?? (await defaultHooks());
    return await runUploadAsset(req, h);
  } catch (err) {
    return uploadFailureResponse(err);
  }
}

async function runUploadAsset(req: Request, h: UploadAssetHooks): Promise<Response> {
  const user = await h.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  let uploadToken: string | undefined;
  let uploadTokenSource = "META_ACCESS_TOKEN (env)";
  try {
    const resolved = await h.resolveToken(user.id);
    uploadToken = resolved.token;
    uploadTokenSource = resolved.source;
  } catch {
    uploadToken = undefined;
  }
  console.info(`[upload-asset] token source=${uploadTokenSource}`);

  const contentType = req.headers.get("content-type") ?? "";

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
      return Response.json({ error: "Invalid JSON body", detail: String(parseErr) }, { status: 400 });
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
      contentType: objectContentType,
    } = body;

    if (!storagePath) return Response.json({ error: "Missing storagePath" }, { status: 400 });
    if (!adAccountId) return Response.json({ error: "Missing adAccountId" }, { status: 400 });
    if (type !== "image" && type !== "video") {
      return Response.json({ error: `Invalid type "${type ?? ""}" — must be "image" or "video"` }, { status: 400 });
    }

    console.log("[upload-asset] Storage-path route:", {
      storageBucket,
      storagePath,
      adAccountId,
      fileName,
      type,
      uploadPath: "Supabase Storage → Meta",
    });

    if (type === "video" && metaVideoUploadMode() === "file_url") {
      const token = uploadToken ?? process.env.META_ACCESS_TOKEN;
      if (!token) {
        return Response.json(
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
          contentType: objectContentType,
          aspectRatio,
          userId: user.id,
          supabase: h.supabase,
          createSignedUrl: (bucket, path, ttlSeconds) => h.storage.createSignedUrl(bucket, path, ttlSeconds),
          remove: async (bucket, path) => {
            await h.storage.remove(bucket, [path]);
          },
          findExisting: async (_client, input) => {
            const { findExistingMetaChannelUpload, existingMetaResult } = await import(
              "../creatives/register-upload.ts"
            );
            const hit = await findExistingMetaChannelUpload(h.supabase, {
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
          register: async (input) => {
            const { registerMetaUpload } = await import("../creatives/register-upload.ts");
            return registerMetaUpload({
              supabase: h.supabase,
              userId: input.userId,
              identity: input.identity,
              fileName: input.fileName,
              mediaKind: "video",
              adAccountId: input.adAccountId,
              storageBucket: input.storageBucket,
              storagePath: input.storagePath,
              result: input.result,
              slotHint: input.slotHint,
            });
          },
        });
        return Response.json(result, { status: 201 });
      } catch (err) {
        if (err instanceof StorageVideoInputError) {
          return Response.json({ error: err.message }, { status: 400 });
        }
        if (err instanceof Error && err.name === "MetaApiError") {
          return uploadFailureResponse(err);
        }
        const message = err instanceof Error ? err.message : String(err);
        console.error("[upload-asset] file_url upload failed", message.slice(0, 200));
        return Response.json({ error: message }, { status: 502 });
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

    const signedData = await h.storage.createSignedUrl(
      storageBucket,
      storagePath,
      META_STORAGE_FETCH_TTL_SECONDS,
    );

    if (signedData.error || !signedData.signedUrl) {
      console.error("[upload-asset] Failed to create signed URL:", signedData.error);
      return Response.json(
        { error: `Failed to access stored file: ${signedData.error ?? "unknown error"}` },
        { status: 500 },
      );
    }

    let videoBlob: Blob;
    try {
      videoBlob = await h.download(signedData.signedUrl);
    } catch (fetchErr) {
      console.error("[upload-asset] Failed to fetch from storage:", fetchErr);
      return Response.json(
        {
          error: `Failed to fetch video from storage: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
        },
        { status: 500 },
      );
    }

    const resolvedFileName = fileName ?? storagePath.split("/").pop() ?? "video.mp4";
    const file = new File([videoBlob], resolvedFileName, { type: videoBlob.type || "video/mp4" });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const existing = await h.findExisting({
      userId: user.id,
      bytes,
      adAccountId,
    });
    if (existing) {
      await h.storage.remove(storageBucket, [storagePath]);
      return Response.json(resultFromExisting(existing, type), { status: 201 });
    }

    console.log("[upload-asset] Fetched from storage:", {
      sizeBytes: file.size,
      sizeMB: (file.size / 1024 / 1024).toFixed(2),
      mimeType: file.type,
    });

    const { isValid, error: validationError } = validateAssetFile(
      file,
      type,
      type === "image" ? { skipByteLimit: true } : undefined,
    );
    if (!isValid) {
      await h.storage.remove(storageBucket, [storagePath]);
      return Response.json({ error: validationError }, { status: 400 });
    }

    const cleanup = () => h.storage.remove(storageBucket, [storagePath]);

    if (type === "image") {
      try {
        let imageFile = file;
        let compressedBytes: number | undefined;
        if (imageFile.size > MAX_IMAGE_BYTES) {
          const compressed = await compressUploadImage(bytes);
          compressedBytes = compressed.byteLength;
          const baseName = imageFile.name.replace(/\.[^.]+$/, "") || "upload";
          imageFile = new File([compressed.bytes], `${baseName}.jpg`, { type: "image/jpeg" });
        }
        const { hash, url } = await h.uploadImage(adAccountId, imageFile, imageFile.name, uploadToken);
        const result: UploadAssetResult = {
          assetType: "image",
          url,
          hash,
          previewUrl: url,
          ...(compressedBytes !== undefined ? { compressedBytes } : {}),
        };
        console.log("[upload-asset] ✓ Image uploaded to Meta via storage path:", { hash, url });
        result.registryAssetId = await h.register({
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
        return Response.json(result, { status: 201 });
      } catch (err) {
        await cleanup();
        return uploadFailureResponse(err);
      }
    }

    try {
      const { videoId, previewUrl } = await h.uploadVideo(adAccountId, file, resolvedFileName, uploadToken);
      const result: UploadAssetResult = {
        assetType: "video",
        url: previewUrl ?? "",
        videoId,
        previewUrl,
      };
      console.log("[upload-asset] ✓ Video uploaded to Meta:", { videoId, previewUrl });
      result.registryAssetId = await h.register({
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
      return Response.json(result, { status: 201 });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errName = err instanceof Error ? err.name : "unknown";
      console.error("[upload-asset] Meta upload threw", {
        name: errName,
        message: errMsg.slice(0, 200),
      });
      await cleanup();
      return uploadFailureResponse(err);
    }
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (parseErr) {
    console.error("[upload-asset] req.formData() failed:", parseErr);
    return Response.json(
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

  if (!file) return Response.json({ error: "Missing required field: 'file'" }, { status: 400 });
  if (!type) return Response.json({ error: "Missing required field: 'type'" }, { status: 400 });
  if (!adAccountId) return Response.json({ error: "Missing required field: 'adAccountId'" }, { status: 400 });
  if (type !== "image" && type !== "video") {
    return Response.json({ error: `Invalid type "${type}"` }, { status: 400 });
  }
  if (file.size === 0) return Response.json({ error: "Uploaded file is empty (0 bytes)" }, { status: 400 });

  console.log("[upload-asset] FormData upload:", {
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    sizeMB: (file.size / 1024 / 1024).toFixed(2),
    type,
    adAccountId,
    uploadPath: "FormData → Meta (direct)",
  });

  const { isValid, error: validationError } = validateAssetFile(
    file,
    type,
    type === "image" ? { skipByteLimit: true } : undefined,
  );
  if (!isValid) {
    console.warn("[upload-asset] validation failed:", validationError);
    return Response.json({ error: validationError }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const existing = await h.findExisting({
    userId: user.id,
    bytes,
    adAccountId,
  });
  if (existing) {
    return Response.json(resultFromExisting(existing, type), { status: 201 });
  }

  try {
    let result: UploadAssetResult;
    if (type === "image") {
      let imageFile = file;
      let compressedBytes: number | undefined;
      if (imageFile.size > MAX_IMAGE_BYTES) {
        const compressed = await compressUploadImage(bytes);
        compressedBytes = compressed.byteLength;
        const baseName = imageFile.name.replace(/\.[^.]+$/, "") || "upload";
        imageFile = new File([compressed.bytes], `${baseName}.jpg`, { type: "image/jpeg" });
      }
      const { hash, url } = await h.uploadImage(adAccountId, imageFile, imageFile.name, uploadToken);
      result = {
        assetType: "image",
        url,
        hash,
        previewUrl: url,
        ...(compressedBytes !== undefined ? { compressedBytes } : {}),
      };
    } else {
      const { videoId, previewUrl } = await h.uploadVideo(adAccountId, file, file.name, uploadToken);
      result = { assetType: "video", url: previewUrl ?? "", videoId, previewUrl };
    }
    const folder = type === "video" ? "videos" : "images";
    const ext = file.name.split(".").pop()?.toLowerCase() ?? (type === "video" ? "mp4" : "jpg");
    const storagePath = `${folder}/${crypto.randomUUID()}.${ext}`;
    const stored = await h.persist(
      storagePath,
      Buffer.from(bytes),
      file.type || (type === "video" ? "video/mp4" : "image/jpeg"),
    );
    if (stored.error) {
      console.error("[upload-asset] registry persist failed:", stored.error);
    }
    result.registryAssetId = await h.register({
      userId: user.id,
      bytes,
      fileName: file.name,
      mediaKind: type,
      adAccountId,
      storageBucket: "campaign-assets",
      storagePath,
      result,
      slotHint: aspectRatio,
    });
    return Response.json(result, { status: 201 });
  } catch (err) {
    return uploadFailureResponse(err);
  }
}

async function defaultHooks(): Promise<UploadAssetHooks> {
  const { createClient, createServiceRoleClient } = await import("../supabase/server.ts");
  const { resolveServerMetaToken } = await import("./server-token.ts");
  const { uploadImageAsset, uploadVideoAsset } = await import("./client.ts");
  const { findExistingMetaChannelUpload, registerMetaUpload } = await import("../creatives/register-upload.ts");
  const { downloadSignedStorageObject } = await import("./video-file-url.ts");
  const { uploadToStorageBucket } = await import("../clients/asset-queue/storage-upload.ts");

  const supabase = await createClient();
  const storage = createServiceRoleClient();

  return {
    getUser: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user ? { id: user.id } : null;
    },
    resolveToken: async (userId) => {
      const resolved = await resolveServerMetaToken(supabase, userId);
      return { token: resolved.token, source: resolved.source };
    },
    supabase,
    storage: {
      createSignedUrl: async (bucket, path, ttlSeconds) => {
        const { data, error } = await storage.storage.from(bucket).createSignedUrl(path, ttlSeconds);
        if (error || !data?.signedUrl) return { error: error?.message ?? "unknown error" };
        return { signedUrl: data.signedUrl };
      },
      remove: async (bucket, paths) => {
        await storage.storage.from(bucket).remove(paths).catch(() => {});
      },
    },
    download: (signedUrl) => downloadSignedStorageObject(signedUrl),
    findExisting: (input) => findExistingMetaChannelUpload(supabase, input),
    uploadImage: (adAccountId, file, filename, token) => uploadImageAsset(adAccountId, file, filename, token),
    uploadVideo: (adAccountId, file, filename, token) => uploadVideoAsset(adAccountId, file, filename, token),
    register: (input) => registerMetaUpload({ supabase, ...input }),
    persist: (storagePath, bytes, contentType) =>
      uploadToStorageBucket(storage, "campaign-assets", storagePath, bytes, contentType),
  };
}
