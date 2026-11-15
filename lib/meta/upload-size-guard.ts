import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from "./upload.ts";

/** Shown on the creatives slot before a 30–200 MB video upload starts. */
export const LARGE_VIDEO_NOTICE =
  "Large video — upload goes via Storage and may take a minute.";

export type CreativeUploadMediaType = "image" | "video";

export type CreativeUploadPlan =
  | { action: "refuse"; message: string }
  | { action: "upload"; notice?: string };

function megabytes(byteSize: number): string {
  return (byteSize / 1024 / 1024).toFixed(1);
}

function refuse(byteSize: number, limitLabel: string): CreativeUploadPlan {
  return {
    action: "refuse",
    message: `File too large (${megabytes(byteSize)} MB). Maximum is ${limitLabel}.`,
  };
}

/**
 * Client decision for one Creatives-slot file, before any network call.
 * Images over 30 MB and videos over 200 MB are refused. Videos over 30 MB
 * and at or under 200 MB upload with a notice and are not compressed.
 */
export function planCreativeUpload(input: {
  byteSize: number;
  mediaType: CreativeUploadMediaType;
}): CreativeUploadPlan {
  if (input.mediaType === "image") {
    if (input.byteSize > MAX_IMAGE_BYTES) return refuse(input.byteSize, "30 MB");
    return { action: "upload" };
  }

  if (input.byteSize > MAX_VIDEO_BYTES) return refuse(input.byteSize, "200 MB");
  if (input.byteSize > MAX_IMAGE_BYTES) {
    return { action: "upload", notice: LARGE_VIDEO_NOTICE };
  }
  return { action: "upload" };
}
