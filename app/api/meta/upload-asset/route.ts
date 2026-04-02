import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  uploadImageAsset,
  uploadVideoAsset,
  MetaApiError,
} from "@/lib/meta/client";
import { validateAssetFile, type UploadAssetResult } from "@/lib/meta/upload";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  // ── Parse multipart form data ─────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (parseErr) {
    // Log the real error so it's visible in the server console.
    console.error("[upload-asset] req.formData() failed:", parseErr);
    return NextResponse.json(
      {
        error: "Failed to parse multipart form data",
        detail: String(parseErr),
        hint: "Body may exceed the server size limit — check next.config.ts serverActions.bodySizeLimit, or the file may be corrupted.",
      },
      { status: 400 },
    );
  }

  // ── Debug: log all received field names ──────────────────────────────────
  const receivedKeys = [...formData.keys()];
  console.log("[upload-asset] received form keys:", receivedKeys);

  const file = formData.get("file") as File | null;
  const type = formData.get("type") as "image" | "video" | null;
  const adAccountId = formData.get("adAccountId") as string | null;

  if (!file) {
    return NextResponse.json(
      { error: "Missing required field: 'file'" },
      { status: 400 },
    );
  }
  if (!type) {
    return NextResponse.json(
      { error: "Missing required field: 'type'" },
      { status: 400 },
    );
  }
  if (!adAccountId) {
    return NextResponse.json(
      { error: "Missing required field: 'adAccountId'" },
      { status: 400 },
    );
  }
  if (type !== "image" && type !== "video") {
    return NextResponse.json(
      { error: `Invalid type "${type}" — must be "image" or "video"` },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json(
      { error: "Uploaded file is empty (0 bytes)" },
      { status: 400 },
    );
  }

  // ── Debug logging ─────────────────────────────────────────────────────────
  console.log("[upload-asset] incoming file:", {
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    sizeMB: (file.size / 1024 / 1024).toFixed(2),
    type,
    adAccountId,
    token_present: !!process.env.META_ACCESS_TOKEN,
  });

  // ── Validate ──────────────────────────────────────────────────────────────
  const { isValid, error: validationError } = validateAssetFile(file, type);
  if (!isValid) {
    console.warn("[upload-asset] validation failed:", validationError);
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  // ── Upload to Meta ────────────────────────────────────────────────────────
  try {
    if (type === "image") {
      const { hash, url } = await uploadImageAsset(adAccountId, file, file.name);
      const result: UploadAssetResult = {
        assetType: "image",
        url,
        hash,
        previewUrl: url,
      };
      return NextResponse.json(result, { status: 201 });
    } else {
      const { videoId, previewUrl } = await uploadVideoAsset(
        adAccountId,
        file,
        file.name,
      );
      const result: UploadAssetResult = {
        assetType: "video",
        url: previewUrl ?? "",      // preview thumbnail as the displayable URL
        videoId,
        previewUrl,
      };
      return NextResponse.json(result, { status: 201 });
    }
  } catch (err) {
    if (err instanceof MetaApiError) {
      const payload = err.toJSON();
      console.error("[upload-asset] Meta API error:", JSON.stringify(payload, null, 2));
      return NextResponse.json(
        {
          error: payload.error ?? "Meta API error",
          code: payload.code,
          metaError: payload,
        },
        { status: 502 },
      );
    }
    console.error("[upload-asset] Unexpected error:", err);
    return NextResponse.json(
      { error: `Unexpected error: ${String(err)}` },
      { status: 500 },
    );
  }
}
