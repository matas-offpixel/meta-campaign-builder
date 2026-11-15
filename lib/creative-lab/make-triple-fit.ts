/**
 * "Make a triple-fit" writes one new clip row for a landscape source.
 * The three-part picture is #1187's TripleFitOnClip. The rules live in
 * triple-fit.ts; this file only records the clip.
 */

import type { ServiceRoleDb } from "./load.ts";
import { sizesForClipFiles } from "./clip-preview.ts";
import { missingTripleFitColumn, tripleFitSource } from "./import-quality.ts";
import { showTripleFitOffer, type ClipForGroup } from "./surface.ts";

type Row = Record<string, unknown>;

function text(row: Row | null | undefined, key: string): string {
  return String(row?.[key] ?? "").trim();
}

function playableSeconds(row: Row, fileSeconds: number | null): number | null {
  const inn = row.in_s == null || row.in_s === "" ? null : Number(row.in_s);
  const out = row.out_s == null || row.out_s === "" ? null : Number(row.out_s);
  if (inn != null && out != null && Number.isFinite(inn) && Number.isFinite(out)) return Math.max(0, out - inn);
  return fileSeconds != null && Number.isFinite(fileSeconds) ? fileSeconds : null;
}

function asCard(row: Row, size: { width: number; height: number } | undefined, seconds: number | null): ClipForGroup {
  const owner = row.owner === "promoter" ? "promoter" : row.owner === "artist" ? "artist" : null;
  return {
    id: text(row, "id"),
    artistId: text(row, "artist_id") || null,
    artistName: "",
    clipNo: Number(row.clip_no) || 0,
    cleared: false,
    renderError: null,
    durationSeconds: seconds,
    judged: null,
    sourceWidth: size?.width ?? null,
    sourceHeight: size?.height ?? null,
    tripleFitSourceId: text(row, "triple_fit_source_id") || null,
    owner,
  };
}

/** One triple-fit for this landscape, when the offer would show. */
export async function makeTripleFit(
  db: ServiceRoleDb,
  args: { userId: string; clipId: string },
): Promise<{ clipId: string }> {
  const sourceRes = await db.from("creative_lab_clips").select("*").eq("id", args.clipId).eq("user_id", args.userId).maybeSingle();
  if (sourceRes.error) throw new Error(sourceRes.error.message);
  const source = sourceRes.data as Row | null;
  if (!source) throw new Error("This clip isn't on your Lab.");
  if (text(source, "triple_fit_source_id")) throw new Error("This clip is already a triple-fit.");
  if (source.owner === "promoter") throw new Error("A promoter clip isn't offered a triple-fit.");

  const existing = await db.from("creative_lab_clips").select("id").eq("triple_fit_source_id", args.clipId).maybeSingle();
  if (existing.error) {
    if (missingTripleFitColumn(existing.error.message)) throw new Error("The triple-fit column isn't on the database yet.");
    throw new Error(existing.error.message);
  }
  if (existing.data) throw new Error("This clip already has a triple-fit.");

  const artistId = text(source, "artist_id");
  if (!artistId) throw new Error("This clip has no artist.");
  const siblingsRes = await db.from("creative_lab_clips").select("*").eq("user_id", args.userId).eq("artist_id", artistId);
  if (siblingsRes.error) throw new Error(siblingsRes.error.message);
  const siblings = (siblingsRes.data ?? []) as Row[];
  const assetIds = [...new Set(siblings.map((row) => text(row, "creative_asset_id")).filter(Boolean))];
  const assetsRes = assetIds.length
    ? await db.from("creative_assets").select("id, storage_path, duration_seconds").in("id", assetIds)
    : { data: [] as Row[], error: null };
  if (assetsRes.error) throw new Error(assetsRes.error.message);
  const assetOf = new Map(((assetsRes.data ?? []) as Row[]).map((row) => [text(row, "id"), row]));
  const sizes = await sizesForClipFiles(siblings.map((row) => {
    const asset = assetOf.get(text(row, "creative_asset_id"));
    return {
      id: text(row, "id"),
      storagePath: text(asset, "storage_path") || null,
      width: Number(row.source_width) || null,
      height: Number(row.source_height) || null,
    };
  })).catch(() => new Map<string, { width: number; height: number }>());

  const cards = siblings.map((row) => {
    const asset = assetOf.get(text(row, "creative_asset_id"));
    const fileSeconds = asset?.duration_seconds == null ? null : Number(asset.duration_seconds);
    return asCard(row, sizes.get(text(row, "id")), playableSeconds(row, Number.isFinite(fileSeconds) ? fileSeconds : null));
  });
  const sourceCard = cards.find((clip) => clip.id === args.clipId);
  const size = sizes.get(args.clipId);
  if (!sourceCard || !size || !tripleFitSource(size)) throw new Error("This clip can't make a triple-fit.");
  if (!showTripleFitOffer(sourceCard, cards)) throw new Error("This artist already has 3 clips that can run in 9:16.");

  const nextNo = Math.max(0, ...siblings.map((row) => Number(row.clip_no) || 0)) + 1;
  const inserted = await db.from("creative_lab_clips").insert({
    user_id: args.userId,
    artist_id: artistId,
    owner: "artist",
    creative_asset_id: text(source, "creative_asset_id"),
    clip_no: nextNo,
    source: text(source, "source") || "file",
    rights_ref: text(source, "rights_ref"),
    event_id: text(source, "event_id") || null,
    audio_status: text(source, "audio_status") || "original",
    audio_match: source.audio_match === true ? true : source.audio_match === false ? false : null,
    crop_focus_x: source.crop_focus_x == null ? 0.5 : Number(source.crop_focus_x),
    crop_focus_y: source.crop_focus_y == null ? 0.5 : Number(source.crop_focus_y),
    in_s: source.in_s ?? null,
    out_s: source.out_s ?? null,
    triple_fit_source_id: args.clipId,
  }).select("id");
  if (inserted.error) {
    if (missingTripleFitColumn(inserted.error.message)) throw new Error("The triple-fit column isn't on the database yet.");
    if (/duplicate|unique/i.test(inserted.error.message)) throw new Error("This clip already has a triple-fit.");
    throw new Error(inserted.error.message);
  }
  const clipId = text(((inserted.data ?? []) as Row[])[0], "id");
  if (!clipId) throw new Error("The triple-fit clip was not saved.");
  return { clipId };
}
