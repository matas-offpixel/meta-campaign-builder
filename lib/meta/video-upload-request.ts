/**
 * lib/meta/video-upload-request.ts
 *
 * Pure request-building helpers for the video-thumbnail bypass fix
 * (task #90 follow-up). Lives outside `client.ts` — which declares
 * `MetaApiError` using TS parameter properties, a syntax Node's
 * `--experimental-strip-types` test runner rejects — so unit tests can
 * exercise the exact fields sent to Meta without dragging that class in.
 * Same rationale as `business-manager-grant-request.ts`.
 *
 * ─── Why this exists ────────────────────────────────────────────────────
 *
 * The app is stuck in App Review (task #90): `POST /{adAccountId}/adimages`
 * — used by `uploadImageFromUrl` to mint an `image_hash` for a video's
 * thumbnail — fails every call with Meta error code=3 "Application does
 * not have the capability to make this API call", regardless of which
 * token (system app or operator OAuth — see PR #766) is used. Escaping App
 * Review is a weeks-long unblock, so `buildVideoCreative` /
 * `buildSingleAssetFromVertical` (lib/meta/creative.ts) no longer call it
 * at all.
 *
 * Instead: `POST /{adAccountId}/advideos` (the video UPLOAD itself, a
 * different edge with its own — currently working — capability) accepts a
 * `thumb_offset` parameter: the millisecond offset from the start of the
 * video Meta should use as the video's OWN canonical thumbnail. Once set,
 * `GET /{videoId}?fields=picture` serves that exact frame forever after —
 * no per-creative `image_hash`/`image_url` write required. `video_data` in
 * the creative payload can simply omit both fields; Meta renders the
 * thumb_offset frame at ad-serving time. This also fixes task #603 (bulk-
 * attach video creatives failing with subcode=1443226 "missing
 * image_hash/image_url") — with thumb_offset, neither field is needed in
 * the first place.
 */

/** 1 second in — avoids Meta's first-frame-often-black default auto-pick. */
export const DEFAULT_THUMB_OFFSET_MS = 1000;

export interface VideoUploadFields {
  /** Sanitised filename — Meta rejects most special characters in the `source` field's filename. */
  safeFilename: string;
  /** Display title, derived from the filename with its extension stripped. */
  title: string;
  /**
   * Millisecond offset from the start of the video for Meta's auto-
   * generated thumbnail. Omitted from the returned fields (and thus never
   * sent to Meta) when resolved to `0` or below — Meta's own default
   * first-frame behaviour is the explicit choice when a caller passes `0`.
   */
  thumbOffsetMs?: number;
}

/**
 * Builds the `POST /{adAccountId}/advideos` request's non-binary fields —
 * the filename sanitisation Meta requires for the `source` field, the
 * display title, and (this fix) `thumb_offset`. `client.ts`'s
 * `uploadVideoAsset` uses this to populate its FormData; kept pure so
 * tests can byte-diff it without a live Meta call.
 *
 * `thumbOffsetMs` defaults to {@link DEFAULT_THUMB_OFFSET_MS} when
 * omitted/undefined — pass `0` explicitly to opt OUT and let Meta pick its
 * own default frame (rare; kept for callers migrating existing videos that
 * already have a known-good auto-thumbnail).
 */
export function buildVideoUploadFields(
  filename: string,
  thumbOffsetMs?: number,
): VideoUploadFields {
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_") || "upload.mp4";
  const title = safeFilename.replace(/\.[^.]+$/, "");

  const resolvedOffset = thumbOffsetMs ?? DEFAULT_THUMB_OFFSET_MS;
  return {
    safeFilename,
    title,
    ...(resolvedOffset > 0 ? { thumbOffsetMs: resolvedOffset } : {}),
  };
}

// ─── FIX 2 (fallback) — client-side frame override ─────────────────────────
//
// `POST /{videoId}/thumbnails` is a video-OBJECT write, a different edge
// (and, per Meta's docs, a different capability) from `/adimages`'s ad-
// ACCOUNT image write — unconfirmed against this app's live App Review
// status, hence "fallback for edge cases" rather than the primary fix.
// Lets an operator override Meta's thumb_offset auto-pick with an exact
// frame extracted client-side (lib/meta/video-frame-extract.ts), with zero
// dependency on FIX 1 succeeding or failing.

export interface VideoThumbnailOverrideRequest {
  /** `/{videoId}/thumbnails` — no leading BASE, matches the other builders' path-only convention. */
  path: string;
  /** Always `true` for this feature — the operator's explicit pick should win over Meta's auto-thumbnail. */
  isPreferred: true;
}

export function buildVideoThumbnailOverrideRequest(videoId: string): VideoThumbnailOverrideRequest {
  return { path: `/${videoId}/thumbnails`, isPreferred: true };
}
