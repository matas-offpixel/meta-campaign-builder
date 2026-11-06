/**
 * Writes for the Creative Lab card. creative_lab_* rows, plus a
 * creative_assets registry row when a new clip file has no row yet
 * (the clip's foreign key). No Meta calls.
 */

import { generateCaptions } from "./writer.ts";
import { judgeLabRound } from "./judge-round.ts";
import { approveRound } from "./launch.ts";
import { proposeRound, RoundBuildError } from "./propose.ts";
import { RoundRefusedError } from "./rounds.ts";
import type { ServiceRoleDb } from "./load.ts";
import { isCaptionStyle } from "./tags.ts";
import { headlinerError } from "../db/creative-lab.ts";
import type { SaleStage } from "./caption-facts.ts";

type Row = Record<string, unknown>;

function text(row: Row | null | undefined, key: string): string {
  return String(row?.[key] ?? "").trim();
}

export async function saveLabFacts(
  db: ServiceRoleDb,
  args: { userId: string; eventId: string; lineup: string[]; headliners: string[]; allowedDates: string[] },
): Promise<void> {
  const lineup = args.lineup.map((name) => name.trim()).filter(Boolean);
  const headliners = args.headliners.map((name) => name.trim()).filter(Boolean);
  const problem = headlinerError(lineup, headliners);
  if (problem) throw new Error(problem);
  const saved = await db.from("creative_lab_event_facts").upsert(
    {
      user_id: args.userId,
      event_id: args.eventId,
      lineup,
      headliners,
      allowed_dates: args.allowedDates.map((day) => day.slice(0, 10)).filter(Boolean),
    },
    { onConflict: "event_id" },
  );
  if (saved.error) throw new Error(saved.error.message);
}

export async function saveLabArtist(
  db: ServiceRoleDb,
  args: { userId: string; clientId: string; artistId?: string | null; name: string; rightsDocRef: string; startingCaption: string },
): Promise<string> {
  const name = args.name.trim();
  if (!name) throw new Error("An artist needs a name.");
  const payload = {
    user_id: args.userId,
    client_id: args.clientId,
    name,
    rights_doc_ref: args.rightsDocRef.trim() || null,
    starting_caption: args.startingCaption.trim() || null,
  };
  if (args.artistId) {
    const updated = await db.from("creative_lab_artists").update(payload).eq("id", args.artistId).eq("user_id", args.userId);
    if (updated.error) throw new Error(updated.error.message);
    return args.artistId;
  }
  const inserted = await db.from("creative_lab_artists").insert(payload).select("id").single();
  if (inserted.error || !inserted.data) throw new Error(inserted.error?.message || "artist insert failed");
  return String((inserted.data as Row).id);
}

export async function approveLabArtist(db: ServiceRoleDb, args: { userId: string; artistId: string; now?: Date }): Promise<void> {
  const res = await db.from("creative_lab_artists").select("*").eq("id", args.artistId).eq("user_id", args.userId).maybeSingle();
  if (res.error) throw new Error(res.error.message);
  const artist = res.data as Row | null;
  if (!artist) throw new Error("No artist with that id.");
  if (!text(artist, "rights_doc_ref")) throw new Error("A rights ref is required.");
  if (!text(artist, "starting_caption")) throw new Error("A starting caption is required.");
  const updated = await db
    .from("creative_lab_artists")
    .update({ approved_by: args.userId, approved_at: (args.now ?? new Date()).toISOString() })
    .eq("id", args.artistId)
    .eq("user_id", args.userId);
  if (updated.error) throw new Error(updated.error.message);
}

export async function addLabClip(
  db: ServiceRoleDb,
  args: {
    userId: string;
    artistId: string;
    source: string;
    rightsRef: string;
    filmedEventId?: string | null;
    durationSeconds?: number | null;
    creativeAssetId?: string | null;
    newAsset?: { filename: string; storagePath: string; contentHash: string; byteSize: number; durationSeconds?: number | null };
  },
): Promise<void> {
  if (!args.source.trim()) throw new Error("A clip needs a source.");
  if (!args.rightsRef.trim()) throw new Error("A clip needs a rights ref.");
  const seconds = args.durationSeconds ?? args.newAsset?.durationSeconds ?? null;
  if (seconds != null && seconds > 30) throw new Error("Clips over 30 seconds are refused.");
  let assetId = args.creativeAssetId?.trim() || "";
  if (!assetId && args.newAsset) {
    const existing = await db
      .from("creative_assets")
      .select("id")
      .eq("user_id", args.userId)
      .eq("content_hash", args.newAsset.contentHash)
      .eq("byte_size", args.newAsset.byteSize)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    assetId = text(existing.data as Row | null, "id");
    if (!assetId) {
      const inserted = await db
        .from("creative_assets")
        .insert({
          user_id: args.userId,
          content_hash: args.newAsset.contentHash,
          byte_size: args.newAsset.byteSize,
          filename: args.newAsset.filename,
          media_kind: "video",
          aspect_ratio: "9:16",
          duration_seconds: seconds,
          storage_bucket: "campaign-assets",
          storage_path: args.newAsset.storagePath,
        })
        .select("id")
        .single();
      if (inserted.error || !inserted.data) throw new Error(inserted.error?.message || "asset insert failed");
      assetId = String((inserted.data as Row).id);
    }
  }
  if (!assetId) throw new Error("Pick a video or upload one.");
  const clips = await db.from("creative_lab_clips").select("clip_no").eq("artist_id", args.artistId);
  if (clips.error) throw new Error(clips.error.message);
  const next = Math.max(0, ...((clips.data ?? []) as Row[]).map((row) => Number(row.clip_no) || 0)) + 1;
  const inserted = await db.from("creative_lab_clips").insert({
    user_id: args.userId,
    artist_id: args.artistId,
    creative_asset_id: assetId,
    clip_no: next,
    source: args.source.trim(),
    rights_ref: args.rightsRef.trim(),
    event_id: args.filmedEventId || null,
    out_s: seconds,
  });
  if (inserted.error) throw new Error(inserted.error.message);
}

export async function generateLabCaptions(
  db: ServiceRoleDb,
  args: { eventId: string; style: string; n: number; clipId?: string | null; stageOverride?: SaleStage | null; artistId?: string | null },
) {
  if (!isCaptionStyle(args.style)) throw new Error("Unknown caption style.");
  return generateCaptions(db, {
    eventId: args.eventId,
    style: args.style,
    n: args.n,
    clipId: args.clipId || undefined,
    stageOverride: args.stageOverride || undefined,
    artistId: args.artistId || undefined,
  });
}

export async function setLabCaptionStatus(
  db: ServiceRoleDb,
  args: { userId: string; captionId: string; status: "approved" | "rejected" },
): Promise<void> {
  const updated = await db
    .from("creative_lab_captions")
    .update({ status: args.status })
    .eq("id", args.captionId)
    .eq("user_id", args.userId)
    .eq("status", "proposed");
  if (updated.error) throw new Error(updated.error.message);
}

export async function proposeLabRound(
  db: ServiceRoleDb,
  args: { userId: string; eventId: string; artistId: string; adsetMetaId: string },
): Promise<{ refused?: string; roundId?: string }> {
  try {
    const result = await proposeRound(db, args);
    return { roundId: result.roundId };
  } catch (err) {
    if (err instanceof RoundRefusedError || err instanceof RoundBuildError) return { refused: err.message };
    throw err;
  }
}

export async function approveLabRound(db: ServiceRoleDb, args: { userId: string; roundId: string }) {
  return approveRound(db, args);
}

export async function judgeLabCard(db: ServiceRoleDb, args: { userId: string; roundId: string; apply: boolean }) {
  return judgeLabRound(db, args);
}
