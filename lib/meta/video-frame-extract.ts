/**
 * lib/meta/video-frame-extract.ts
 *
 * FIX 2 (fallback for edge cases, task #90 follow-up) — extracts a single
 * frame from a local video File as a JPEG Blob, entirely client-side (an
 * offscreen `<video>` + `<canvas>` pair). Browser-only: needs
 * `HTMLVideoElement` / `CanvasRenderingContext2D` — never import from a
 * Server Component or API route.
 *
 * Lets an operator preview and re-pick the exact frame Meta will use as a
 * video's thumbnail, overriding the primary fix's `thumb_offset` auto-pick
 * (POST /{videoId}/thumbnails via `lib/meta/client.ts`'s
 * `uploadVideoThumbnail`) without ever touching the App-Review-blocked
 * `/adimages` write.
 */

export interface VideoFrameExtractionResult {
  blob: Blob;
  /** The actual timestamp the browser seeked to — may differ slightly from the requested value near clip boundaries. */
  atSeconds: number;
}

/** Small safety margin so we never seek exactly to (or past) the last frame, which some browsers refuse. */
const END_OF_CLIP_MARGIN_SECONDS = 0.05;

/** Clamps a requested seek target into `[0, duration - margin]`. Exported for unit testing without a DOM. */
export function clampSeekTarget(atSeconds: number, durationSeconds: number): number {
  if (!Number.isFinite(atSeconds) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return 0;
  }
  const upperBound = Math.max(durationSeconds - END_OF_CLIP_MARGIN_SECONDS, 0);
  return Math.min(Math.max(atSeconds, 0), upperBound);
}

/**
 * Extracts a single frame from a video reachable at `videoUrl` (a `blob:`
 * or `data:` URL — same-origin remote URLs work too, but a cross-origin
 * CDN URL will taint the canvas and make `toBlob` fail).
 *
 * Loads the URL into an offscreen `<video>` element (never attached to the
 * DOM), seeks to the clamped timestamp, then draws the current frame onto a
 * same-size `<canvas>` and reads it back as a JPEG Blob. Does NOT manage
 * the URL's lifecycle — the caller owns it (e.g. `creatives.tsx`'s
 * `blobUrlRegistry`, which already keeps a video's blob URL alive for the
 * whole editing session). See {@link extractVideoFrame} for a variant that
 * takes a `File` and manages its own temporary object URL.
 */
export function extractVideoFrameFromUrl(videoUrl: string, atSeconds: number): Promise<VideoFrameExtractionResult> {
  return new Promise((resolve, reject) => {
    const videoEl = document.createElement("video");
    videoEl.preload = "auto";
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.src = videoUrl;

    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    videoEl.onerror = () => fail(new Error("Failed to load video for frame extraction."));

    videoEl.onloadedmetadata = () => {
      videoEl.currentTime = clampSeekTarget(atSeconds, videoEl.duration);
    };

    videoEl.onseeked = () => {
      if (settled) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = videoEl.videoWidth;
        canvas.height = videoEl.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          fail(new Error("Canvas 2D context unavailable."));
          return;
        }
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            if (settled) return;
            if (!blob) {
              fail(new Error("Canvas failed to produce a frame blob."));
              return;
            }
            settled = true;
            resolve({ blob, atSeconds: videoEl.currentTime });
          },
          "image/jpeg",
          0.92,
        );
      } catch (err) {
        fail(err);
      }
    };
  });
}

/**
 * Extracts a single frame from `file` at `atSeconds` as a JPEG Blob.
 * Convenience wrapper over {@link extractVideoFrameFromUrl} for callers
 * that only have a `File` (not an already-live blob URL) — creates a
 * temporary object URL and always revokes it, on both success and failure
 * paths.
 */
export async function extractVideoFrame(file: File, atSeconds: number): Promise<VideoFrameExtractionResult> {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await extractVideoFrameFromUrl(objectUrl, atSeconds);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
