/**
 * lib/mcp/folder-in/resolve.ts — which folder of a show's Drive tree
 * upload_to_event_folder means (M3d-c).
 *
 * Pure: the event's drive_folders rows (its own map: client_id and event_id
 * both the show's) and its Lab lineup go in; a mapped folder, or the reason
 * there is none, comes out. Five targets only, by the tree's own keys
 * (lib/drive/tree.ts, lib/drive/folders.ts):
 *   - 01 Open files                              → "01"
 *   - 3 On sale                                  → "03/3"
 *   - 02 Source / Artist clips / {artist}        → "02/artist-clips/{library artist id}"
 *   - 02 Source / Audio / {artist}               → "02/audio/{library artist id}"
 *   - w/c {d Mon} / {owner} / Videos | Statics   → "03/3/wc/{monday}/owner/{artist:id|promoter}/{videos|statics}"
 * A folder is only ever one the map already holds: nothing is made here, so
 * a write can never land outside the tree the export built.
 *
 * Relative imports only (node:test).
 */
import { cycleFolderName } from "../../drive/tree.ts";
import { FOLDER_IN_WORDS as W } from "./words.ts";

export interface MapRow {
  key: string;
  name: string | null;
  drive_folder_id: string;
}

export interface LineupName {
  libraryArtistId: string;
  name: string;
}

/** What a target folder takes. */
export type TargetKind = "any" | "video" | "static" | "audio";

export type Target = { ok: true; key: string; folderId: string; label: string; takes: TargetKind } | { ok: false; reason: string; refused: string };

const CYCLE_KEY = /^03\/3\/wc\/(\d{4}-\d{2}-\d{2})$/;
const OWNER_KEY = /^03\/3\/wc\/\d{4}-\d{2}-\d{2}\/owner\/(artist:[^/]+|promoter)$/;
const ARTIST_CLIPS = /^02\/artist-clips\/[^/]+$/;
const AUDIO = /^02\/audio\/[^/]+$/;
const TYPE_KEY = /^03\/3\/wc\/\d{4}-\d{2}-\d{2}\/owner\/(?:artist:[^/]+|promoter)\/(videos|statics)$/;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** "02 Source / Artist clips / X" → segments; "w/c" is kept whole. */
export function folderSegments(text: string): string[] {
  const guarded = text.replace(/\bw\/c\b/gi, "w∕c");
  return guarded
    .split(/\s*\/\s*/)
    .map((s) => s.replace(/∕/g, "/").trim())
    .filter(Boolean);
}

/** The keys a write may land in: the five targets' own folders. */
export function writableKey(key: string): TargetKind | null {
  if (key === "01" || key === "03/3") return "any";
  if (ARTIST_CLIPS.test(key)) return "video";
  if (AUDIO.test(key)) return "audio";
  const t = TYPE_KEY.exec(key);
  if (t) return t[1] === "videos" ? "video" : "static";
  return null;
}

function labelOf(key: string, rows: ReadonlyMap<string, MapRow>): string {
  if (key === "01") return "01 Open files";
  if (key === "03/3") return "3 On sale";
  if (ARTIST_CLIPS.test(key)) return `02 Source / Artist clips / ${rows.get(key)?.name ?? ""}`.trim();
  if (AUDIO.test(key)) return `02 Source / Audio / ${rows.get(key)?.name ?? ""}`.trim();
  const t = TYPE_KEY.exec(key);
  if (t) {
    const owner = key.slice(0, key.lastIndexOf("/"));
    const monday = /wc\/(\d{4}-\d{2}-\d{2})/.exec(key)![1]!;
    return `${cycleFolderName(monday)} / ${rows.get(owner)?.name ?? ""} / ${t[1] === "videos" ? "Videos" : "Statics"}`;
  }
  return key;
}

function hit(key: string, rows: ReadonlyMap<string, MapRow>, notMade: string): Target {
  const row = rows.get(key);
  if (!row) return { ok: false, reason: W.refusedNotMade(notMade), refused: "folder_not_made" };
  return { ok: true, key, folderId: row.drive_folder_id, label: labelOf(key, rows), takes: writableKey(key)! };
}

/** A folder given by its Drive id: one of the show's own five kinds, or refused. */
export function resolveFolderId(folderId: string, map: readonly MapRow[], code: string): Target {
  const rows = new Map(map.map((r) => [r.key, r]));
  const row = map.find((r) => r.drive_folder_id === folderId);
  if (!row) return { ok: false, reason: W.refusedOutsideTree(code), refused: "outside_tree" };
  const takes = writableKey(row.key);
  if (!takes) return { ok: false, reason: W.refusedFolder, refused: "not_a_target" };
  return { ok: true, key: row.key, folderId: row.drive_folder_id, label: labelOf(row.key, rows), takes };
}

/** A folder given as its path in the tree. */
export function resolveFolderPath(text: string, map: readonly MapRow[], lineup: readonly LineupName[]): Target {
  const rows = new Map(map.map((r) => [r.key, r]));
  let seg = folderSegments(text);
  // An optional "03 Creatives" / "3 On sale" in front of a w/c path.
  if (seg.length > 1 && same(seg[0]!, "03 Creatives")) seg = seg.slice(1);
  if (seg.length === 1 && same(seg[0]!, "3 On sale")) return hit("03/3", rows, "3 On sale");
  if (seg.length > 1 && same(seg[0]!, "3 On sale")) seg = seg.slice(1);
  if (seg.length === 1 && same(seg[0]!, "01 Open files")) return hit("01", rows, "01 Open files");

  if (seg.length === 3 && same(seg[0]!, "02 Source") && (same(seg[1]!, "Artist clips") || same(seg[1]!, "Audio"))) {
    const artist = lineup.find((a) => a.name === seg[2]) ?? lineup.find((a) => same(a.name, seg[2]!));
    if (!artist) return { ok: false, reason: W.refusedArtist(seg[2]!, lineup.map((a) => a.name).join(", ")), refused: "artist_not_on_lineup" };
    const audio = same(seg[1]!, "Audio");
    const key = `${audio ? "02/audio" : "02/artist-clips"}/${artist.libraryArtistId}`;
    return hit(key, rows, `02 Source / ${audio ? "Audio" : "Artist clips"} / ${artist.name}`);
  }

  if (seg.length === 3 && /^w\/c\s/i.test(seg[0]!) && (same(seg[2]!, "Videos") || same(seg[2]!, "Statics"))) {
    const cycleText = seg[0]!;
    const iso = /^w\/c\s+(\d{4}-\d{2}-\d{2})$/i.exec(cycleText)?.[1];
    const cycles = map
      .map((r) => ({ row: r, monday: CYCLE_KEY.exec(r.key)?.[1] }))
      .filter((c): c is { row: MapRow; monday: string } => Boolean(c.monday))
      .filter((c) => (iso ? c.monday === iso : same(cycleFolderName(c.monday), cycleText)));
    if (cycles.length === 0) return { ok: false, reason: W.refusedCycle(cycleText), refused: "cycle_not_found" };
    if (cycles.length > 1) return { ok: false, reason: W.refusedCycleTwice(cycleText), refused: "cycle_ambiguous" };
    const cycleKey = cycles[0]!.row.key;
    const owners = map.filter((r) => r.key.startsWith(`${cycleKey}/owner/`) && OWNER_KEY.test(r.key));
    const owner = owners.find((r) => r.name === seg[1]) ?? owners.find((r) => same(r.name ?? "", seg[1]!));
    if (!owner) return { ok: false, reason: W.refusedOwner(seg[1]!, cycleText, owners.map((r) => r.name).filter(Boolean).join(", ")), refused: "owner_not_found" };
    const key = `${owner.key}/${same(seg[2]!, "Videos") ? "videos" : "statics"}`;
    return hit(key, rows, `${cycleText} / ${owner.name} / ${same(seg[2]!, "Videos") ? "Videos" : "Statics"}`);
  }
  return { ok: false, reason: W.refusedFolder, refused: "folder_unrecognised" };
}

/** Whether a file fits the folder: Videos takes video, Statics photos, Audio audio, Artist clips video. */
export function fileFits(takes: TargetKind, mimeType: string): boolean {
  if (takes === "any") return true;
  if (takes === "audio") return mimeType.startsWith("audio/");
  if (takes === "video") return mimeType.startsWith("video/");
  return mimeType.startsWith("image/");
}
