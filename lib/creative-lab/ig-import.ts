/**
 * Import one own-edge Instagram candidate.
 * Download, register, text check, then a clip. Clearance is not required.
 * Import anyway uses the stored file and does not download or check again.
 */

import { snapRatio } from "../clients/asset-queue/aspect-detect.ts";
import { fingerprintBytes, resolveRegistryAspect, upsertRegisteredAsset } from "../creatives/asset-registry.ts";
import type { ServiceRoleDb } from "./load.ts";
import { LOW_QUALITY_AFTER_CROP, cropWindow } from "../../src/remotion/caption-style/profile.ts";
import { ownerFromImport } from "./footage-owner.ts";
import { frameSampleTimes, settleOverlayVerdict, type OverlayCheck, type OverlayFrame } from "./overlay-check.ts";

type Row = Record<string, unknown>;

const TRIM_SECONDS = 30;
const BUCKET = "campaign-assets";

export type IgImportStep = "download" | "register" | "check" | "clip";

export type IgImportResult = {
  outcome: "imported" | "noop" | "skipped" | "review" | "refused";
  clipId: string | null;
  reason: string | null;
  steps: IgImportStep[];
  check: OverlayCheck | null;
};

function text(row: Row | null, key: string): string {
  return String(row?.[key] ?? "").trim();
}

export function igThumbObjectPath(artistId: string, igMediaId: string): string {
  const artist = artistId.replace(/[^a-zA-Z0-9-]/g, "");
  const media = igMediaId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `creative-lab/ig/${artist}/${media}.jpg`;
}

export function instagramRightsRef(note: string | null | undefined, username: string | null | undefined): string {
  const written = note?.trim();
  if (written) return written;
  const handle = username?.trim().replace(/^@/, "");
  return handle ? `Instagram @${handle}, own feed` : "Instagram, own feed";
}

export async function importIgCandidate(
  db: ServiceRoleDb,
  args: {
    candidateId: string;
    userId: string;
    anyway?: boolean;
    now?: Date;
    eventId?: string | null;
    mediaUrl?: (igMediaId: string) => Promise<string>;
    download?: (url: string) => Promise<Uint8Array>;
    upload?: (storagePath: string, bytes: Uint8Array) => Promise<void>;
    probe?: (bytes: Uint8Array) => { width: number; height: number; durationInSeconds: number } | null;
    check?: (input: { bytes: Uint8Array; times: number[]; thumbnail: Uint8Array | null; storagePath: string | null }) => Promise<{ verdict?: string; frames?: OverlayFrame[]; reason?: string; unsure?: boolean }>;
    thumbnail?: (path: string) => Promise<Uint8Array | null>;
  },
): Promise<IgImportResult> {
  const steps: IgImportStep[] = [];
  const candidateRes = await db.from("creative_lab_ig_candidates").select("*").eq("id", args.candidateId).maybeSingle();
  if (candidateRes.error) throw new Error(candidateRes.error.message);
  const candidate = candidateRes.data as Row | null;
  if (!candidate) throw new Error("No clip with that id.");
  if (text(candidate, "user_id") !== args.userId) throw new Error("No clip with that id.");

  const existingClip = text(candidate, "clip_id");
  if (text(candidate, "status") === "imported" && existingClip) {
    return { outcome: "noop", clipId: existingClip, reason: null, steps, check: null };
  }
  if (candidate.has_file !== true || text(candidate, "file_source") === "none") {
    return { outcome: "refused", clipId: null, reason: "Request from team", steps, check: null };
  }
  if (args.anyway && text(candidate, "reason") === LOW_QUALITY_AFTER_CROP) {
    return { outcome: "skipped", clipId: null, reason: LOW_QUALITY_AFTER_CROP, steps, check: null };
  }

  const artistId = text(candidate, "artist_id");
  const promoterClientId = text(candidate, "client_id");
  let artist: Row | null = null;
  if (artistId) {
    const artistRes = await db.from("creative_lab_artists").select("*").eq("id", artistId).eq("user_id", args.userId).maybeSingle();
    if (artistRes.error) throw new Error(artistRes.error.message);
    artist = artistRes.data as Row | null;
  } else if (promoterClientId) {
    const clientRes = await db.from("clients").select("id, user_id, instagram_handle").eq("id", promoterClientId).maybeSingle();
    if (clientRes.error) throw new Error(clientRes.error.message);
    const client = clientRes.data as Row | null;
    if (!client || text(client, "user_id") !== args.userId) throw new Error("No client with that id.");
    artist = { id: promoterClientId, client_id: promoterClientId, user_id: args.userId, ig_username: text(client, "instagram_handle"), rights_doc_ref: "" };
  }
  if (!artist) throw new Error("No artist with that id.");

  let assetId = text(candidate, "asset_id");
  let bytes: Uint8Array | null = null;
  let measured: { width: number; height: number; durationInSeconds: number } | null = null;
  let storagePath: string | null = null;

  if (args.anyway) {
    if (!assetId) throw new Error("The file isn't stored yet.");
  } else if (!assetId) {
    const mediaId = text(candidate, "ig_media_id");
    if (!args.mediaUrl || !args.download || !args.upload || !args.probe) throw new Error("Import isn't available.");
    steps.push("download");
    const url = await args.mediaUrl(mediaId);
    bytes = await args.download(url);
    measured = args.probe(bytes);
    steps.push("register");
    const identity = fingerprintBytes(bytes);
    const dup = await existingClipForHash(db, text(artist, "id"), identity.contentHash, identity.byteSize);
    if (dup) {
      await markImported(db, args.candidateId, dup, assetId || null);
      return { outcome: "noop", clipId: dup, reason: null, steps, check: null };
    }
    const aspect = measured
      ? snapRatio(measured.width, measured.height)
      : resolveRegistryAspect({ filename: `${mediaId}.mp4`, probed: "other" });
    storagePath = `videos/creative-lab/${text(artist, "id")}/${identity.contentHash}.mp4`;
    await args.upload(storagePath, bytes);
    const registered = await upsertRegisteredAsset(db, {
      userId: args.userId,
      identity,
      filename: `${mediaId}.mp4`,
      mediaKind: "video",
      aspectRatio: aspect,
      durationSeconds: measured?.durationInSeconds ?? null,
      storageBucket: BUCKET,
      storagePath,
    });
    if (!registered.ok) throw new Error(registered.error);
    assetId = registered.asset.id;
    await db.from("creative_lab_ig_candidates").update({ asset_id: assetId }).eq("id", args.candidateId);
  }

  if (measured && cropWindow(measured.width, measured.height, 0.5).width < 540) {
    await db.from("creative_lab_ig_candidates").update({
      status: "skipped",
      reason: LOW_QUALITY_AFTER_CROP,
      asset_id: assetId || null,
    }).eq("id", args.candidateId);
    return { outcome: "skipped", clipId: null, reason: LOW_QUALITY_AFTER_CROP, steps, check: null };
  }

  let check: OverlayCheck | null = null;
  const stored = candidate.overlay_check as OverlayCheck | null;
  if (!args.anyway) {
    if (stored && stored.verdict) {
      check = stored;
    } else if (args.check && bytes) {
      steps.push("check");
      const times = frameSampleTimes(measured?.durationInSeconds ?? 8);
      const thumbPath = text(candidate, "thumbnail_path");
      const thumbnail = thumbPath && args.thumbnail ? await args.thumbnail(thumbPath) : null;
      const raw = await args.check({ bytes, times, thumbnail, storagePath });
      check = settleOverlayVerdict(raw);
    } else if (args.check && assetId) {
      steps.push("check");
      const asset = await db.from("creative_assets").select("storage_path").eq("id", assetId).maybeSingle();
      storagePath = text(asset.data as Row | null, "storage_path") || null;
      const thumbPath = text(candidate, "thumbnail_path");
      const thumbnail = thumbPath && args.thumbnail ? await args.thumbnail(thumbPath) : null;
      const raw = await args.check({ bytes: new Uint8Array(), times: frameSampleTimes(8), thumbnail, storagePath });
      check = settleOverlayVerdict(raw);
    }
    if (check && !(stored && stored.verdict)) {
      const now = (args.now ?? new Date()).toISOString();
      await db.from("creative_lab_ig_candidates").update({
        overlay_check: check,
        checked_at: now,
      }).eq("id", args.candidateId);
    }
    if (check?.verdict === "text_overlay") {
      await db.from("creative_lab_ig_candidates").update({
        status: "skipped",
        reason: check.reason,
        asset_id: assetId || null,
      }).eq("id", args.candidateId);
      return { outcome: "skipped", clipId: null, reason: check.reason, steps, check };
    }
    if (check?.verdict === "check_by_eye") {
      return { outcome: "review", clipId: null, reason: check.reason, steps, check };
    }
  }

  if (!assetId) throw new Error("The file isn't stored yet.");
  steps.push("clip");
  const clipId = await insertClip(db, {
    userId: args.userId,
    artist,
    candidate,
    assetId,
    duration: measured?.durationInSeconds ?? null,
    check: check ?? (candidate.overlay_check as OverlayCheck | null),
    now: args.now ?? new Date(),
    eventId: args.eventId ?? null,
  });
  await markImported(db, args.candidateId, clipId, assetId);
  return { outcome: "imported", clipId, reason: null, steps, check };
}

async function existingClipForHash(db: ServiceRoleDb, artistId: string, hash: string, byteSize: number): Promise<string | null> {
  const clips = await db.from("creative_lab_clips").select("id, creative_asset_id").eq("artist_id", artistId);
  if (clips.error) throw new Error(clips.error.message);
  const ids = ((clips.data ?? []) as Row[]).map((row) => text(row, "creative_asset_id")).filter(Boolean);
  if (ids.length === 0) return null;
  const assets = await db.from("creative_assets").select("id, content_hash, byte_size").in("id", ids);
  if (assets.error) throw new Error(assets.error.message);
  const match = ((assets.data ?? []) as Row[]).find((row) => text(row, "content_hash") === hash && Number(row.byte_size) === byteSize);
  if (!match) return null;
  const clip = ((clips.data ?? []) as Row[]).find((row) => text(row, "creative_asset_id") === text(match, "id"));
  return clip ? text(clip, "id") : null;
}

/** The file's length. Import anyway does not probe again, so the registered asset is the source. */
async function sourceDuration(db: ServiceRoleDb, assetId: string, given: number | null): Promise<number | null> {
  if (given != null && Number.isFinite(given)) return given;
  const asset = await db.from("creative_assets").select("duration_seconds").eq("id", assetId).maybeSingle();
  if (asset.error || !asset.data) return null;
  const value = Number((asset.data as Row).duration_seconds);
  return Number.isFinite(value) ? value : null;
}

async function insertClip(
  db: ServiceRoleDb,
  args: { userId: string; artist: Row; candidate: Row; assetId: string; duration: number | null; check: OverlayCheck | null; now: Date; eventId?: string | null },
): Promise<string> {
  const artistId = text(args.artist, "id");
  const clientId = text(args.artist, "client_id");
  const client = clientId
    ? await db.from("clients").select("instagram_handle").eq("id", clientId).maybeSingle()
    : { data: null, error: null };
  if (client.error) throw new Error(client.error.message);
  const derived = ownerFromImport({
    kind: "instagram",
    handle: text(args.candidate, "username") || text(args.artist, "ig_username"),
    clientHandle: text(client.data as Row | null, "instagram_handle"),
    artistId,
  });
  const clips = derived.owner === "promoter"
    ? await db.from("creative_lab_clips").select("clip_no").eq("owner", "promoter").is("artist_id", null)
    : await db.from("creative_lab_clips").select("clip_no").eq("artist_id", artistId);
  if (clips.error) throw new Error(clips.error.message);
  const nextNo = Math.max(0, ...((clips.data ?? []) as Row[]).map((row) => Number(row.clip_no) || 0)) + 1;
  const duration = await sourceDuration(db, args.assetId, args.duration);
  const trimmed = duration != null && duration > TRIM_SECONDS;
  const inserted = await db.from("creative_lab_clips").insert({
    user_id: args.userId,
    artist_id: derived.artistId,
    owner: derived.owner,
    creative_asset_id: args.assetId,
    clip_no: nextNo,
    source: "instagram",
    external_id: text(args.candidate, "ig_media_id"),
    source_file_id: text(args.candidate, "ig_media_id"),
    permalink: text(args.candidate, "permalink") || null,
    ig_like_count: args.candidate.likes ?? null,
    ig_comments_count: args.candidate.comments ?? null,
    ig_followers_at_fetch: args.candidate.followers_at_fetch ?? null,
    ig_posted_at: args.candidate.posted_at ?? null,
    fetched_at: args.now.toISOString(),
    audio_match: args.candidate.audio_match === true ? true : args.candidate.audio_match === false ? false : null,
    rights_ref: instagramRightsRef(text(args.artist, "rights_doc_ref"), text(args.artist, "ig_username")),
    audio_status: "original",
    crop_focus_y: 0.5,
    crop_focus_x: 0.5,
    in_s: trimmed ? 0 : null,
    out_s: trimmed ? TRIM_SECONDS : null,
    overlay_check: args.check,
    ...(derived.owner === "promoter" && args.eventId ? { shown_on_event_id: args.eventId } : {}),
  }).select("id");
  if (inserted.error) throw new Error(inserted.error.message);
  const id = text((inserted.data as Row[] | null)?.[0] ?? null, "id");
  if (!id) throw new Error("The clip was not saved.");
  return id;
}

async function markImported(db: ServiceRoleDb, candidateId: string, clipId: string, assetId: string | null): Promise<void> {
  const updated = await db.from("creative_lab_ig_candidates").update({
    status: "imported",
    clip_id: clipId,
    ...(assetId ? { asset_id: assetId } : {}),
    reason: null,
  }).eq("id", candidateId);
  if (updated.error) throw new Error(updated.error.message);
}

/** Done and queued renders for this clip go back to the queue. A running render finishes. */
export async function requeueClipOnFocusChange(db: ServiceRoleDb, args: { clipId: string; userId: string; cropFocusX: number }): Promise<number> {
  const focus = Math.min(1, Math.max(0, args.cropFocusX));
  const clip = await db.from("creative_lab_clips").update({ crop_focus_x: focus }).eq("id", args.clipId).eq("user_id", args.userId).select("id");
  if (clip.error) throw new Error(clip.error.message);
  if (!((clip.data ?? []) as unknown[]).length) throw new Error("No clip with that id.");
  const renders = await db.from("creative_lab_renders").select("id, status").eq("clip_id", args.clipId);
  if (renders.error) throw new Error(renders.error.message);
  let queued = 0;
  for (const row of (renders.data ?? []) as Row[]) {
    if (text(row, "status") === "rendering") continue;
    const update = await db.from("creative_lab_renders").update({ status: "queued", error: null }).eq("id", text(row, "id"));
    if (update.error) throw new Error(update.error.message);
    queued += 1;
  }
  return queued;
}
