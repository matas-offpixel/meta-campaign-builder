/**
 * From Drive in the Meta launcher (docs/design-record/2026-11-12-launcher-drive-picker.html):
 * the server half. Reads an event's tree from its drive_folders map (G1),
 * lists a folder's media with Drive's measurements (G2), and copies a picked
 * file Drive → Storage (G6) through #1188's streamed path, deduped on the
 * creative_assets registry's drive_file_id (migration 228). Meta is not
 * called here: the step sends the copy through the existing draft upload
 * (POST /api/meta/upload-asset with a storagePath).
 *
 * Every folder and file id a request names is checked to sit under a folder
 * this event's map holds, by walking Drive parents up — a request can't read
 * another event's or client's files.
 */

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { probeMp4File } from "../creative-lab/mp4-probe.ts";
import { redactSecrets } from "../creative-lab/render-proxy.ts";
import { findAssetByFingerprint, upsertRegisteredAsset, type ContentIdentity } from "../creatives/asset-registry.ts";
import type { DriveApi, DriveFile, DriveMediaFile } from "./client.ts";
import type { DriveDb } from "./db.ts";
import { loadLineupArtists } from "./lineup.ts";
import {
  PICKER_MAX_IMAGE_BYTES,
  PICKER_MAX_VIDEO_BYTES,
  PICKER_WORDS,
  isNineSixteen,
  pickerKind,
  ratioOf,
  type Crumb,
  type PickerFile,
  type PickerKind,
  type PickerOwner,
  type PickerView,
} from "./picker-model.ts";

export type { Crumb, PickerView } from "./picker-model.ts";
import { londonToday, parseOwnerKey, renderStage, stageFor } from "./tree.ts";

const MAX_DEPTH = 8;
const CYCLE_KEY = /^03\/3\/wc\/\d{4}-\d{2}-\d{2}$/;
export const PICKER_BUCKET = "campaign-assets";

type MapRow = { key: string; name: string; drive_folder_id: string };
type Row = Record<string, unknown>;
/** The service-role handle, untyped where the generated types lag (drive_file_id, migration 228). */
type LooseDb = { from(table: string): any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export type PickerEvent = { id: string; drive_folder_id: string | null; status: string | null; event_date: string | null; event_code: string | null; name: string };

async function mapRows(db: LooseDb, eventId: string): Promise<MapRow[]> {
  const res = await db.from("drive_folders").select("key, name, drive_folder_id").eq("event_id", eventId);
  if (res.error) throw new Error(`drive_folders: ${res.error.message}`);
  return ((res.data ?? []) as MapRow[]).filter((row) => row.drive_folder_id);
}

/**
 * Walks up from a folder (or a file's parent) to the nearest folder in the
 * map. Returns that row and the Drive folders between it and the start
 * (top-down), or null when the walk leaves the tree.
 */
export async function locateInTree(
  drive: Pick<DriveApi, "getFile">,
  byDriveId: ReadonlyMap<string, MapRow>,
  startFolderId: string,
): Promise<{ row: MapRow; below: DriveFile[] } | null> {
  const below: DriveFile[] = [];
  let cursor: string | null = startFolderId;
  for (let depth = 0; cursor && depth < MAX_DEPTH; depth += 1) {
    const row = byDriveId.get(cursor);
    if (row) return { row, below: below.reverse() };
    const folder: DriveFile | null = await drive.getFile(cursor);
    if (!folder || folder.trashed) return null;
    below.push(folder);
    cursor = folder.parents?.[0] ?? null;
  }
  return null;
}

function toPickerFile(file: DriveMediaFile): PickerFile {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size ?? null,
    hasThumbnail: Boolean(file.thumbnailLink),
    width: file.width,
    height: file.height,
    rotation: file.rotation,
    durationMs: file.durationMs,
  };
}

const visible = (name: string) => !name.startsWith("_");

/** Owners of a stage from the map (never by position): the lineup in billing order, then the promoter (G1, U1). */
async function stageOwners(db: LooseDb, rows: readonly MapRow[], stageKey: string, eventId: string): Promise<PickerOwner[]> {
  const owners = rows
    .map((row) => ({ row, parsed: parseOwnerKey(row.key) }))
    .filter(({ parsed }) => parsed && parsed.stageKey === stageKey && parsed.type === null)
    .map(({ row, parsed }) => ({ key: row.key, name: row.name, folderId: row.drive_folder_id, promoter: parsed!.owner.kind === "promoter" }));
  let order: string[] = [];
  try {
    order = (await loadLineupArtists(db as unknown as DriveDb, eventId)).map((a) => a.name);
  } catch {
    order = [];
  }
  const rank = (o: { name: string; promoter: boolean }) => (o.promoter ? 10_000 : order.indexOf(o.name) >= 0 ? order.indexOf(o.name) : 5_000);
  return owners.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).map(({ key, name, folderId }) => ({ key, name, folderId }));
}

/** The stage a picker opens at: show week, else this on-sale cycle (else the newest mapped one), else signup's teaser. */
export function defaultStageKey(event: Pick<PickerEvent, "status" | "event_date">, rows: readonly MapRow[], today: string): string {
  const keys = new Set(rows.map((row) => row.key));
  const picked = stageFor({ stage: renderStage(event.status), today, eventDate: event.event_date }).key;
  if (keys.has(picked)) return picked;
  const cycles = rows.map((row) => row.key).filter((key) => CYCLE_KEY.test(key)).sort().reverse();
  const current = cycles.find((key) => key.slice(-10) <= today) ?? cycles[0];
  return current ?? (keys.has("03") ? "03" : "event");
}

function keyChain(key: string, byKey: ReadonlyMap<string, MapRow>): MapRow[] {
  const parts = key.split("/");
  const chain: MapRow[] = [];
  for (let i = 1; i <= parts.length; i += 1) {
    const row = byKey.get(parts.slice(0, i).join("/"));
    if (row) chain.push(row);
  }
  return chain;
}

export async function loadPickerView(
  db: LooseDb,
  drive: DriveApi | null,
  event: PickerEvent,
  query: { folderId?: string | null; stageKey?: string | null; now?: Date } = {},
): Promise<PickerView> {
  if (!event.drive_folder_id) return { state: "no_tree" };
  const rows = await mapRows(db, event.id);
  if (!rows.some((row) => row.key === "event")) return { state: "no_tree" };
  if (!drive || !drive.listMedia) return { state: "unreadable" };
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const byDriveId = new Map(rows.map((row) => [row.drive_folder_id, row]));
  const today = londonToday(query.now ?? new Date());
  try {
    const stageKey = query.stageKey && byKey.has(query.stageKey) ? query.stageKey : defaultStageKey(event, rows, today);
    const targetId = query.folderId || byKey.get(stageKey)!.drive_folder_id;
    const located = await locateInTree(drive, byDriveId, targetId);
    if (!located) return { state: "not_in_tree" };

    const chain = keyChain(located.row.key, byKey).filter((row) => row.key !== "event");
    const crumbs: Crumb[] = chain.map((row) => ({ label: row.name, folderId: row.drive_folder_id, ...(CYCLE_KEY.test(row.key) ? { menu: "cycle" as const } : {}) }));
    crumbs.push(...located.below.map((folder) => ({ label: folder.name, folderId: folder.id })));

    const ownerRow = [...chain].reverse().find((row) => parseOwnerKey(row.key)?.type === null) ?? null;
    const ownerStage = ownerRow ? parseOwnerKey(ownerRow.key)!.stageKey : located.below.length === 0 ? located.row.key : null;
    const owners = ownerStage ? await stageOwners(db, rows, ownerStage, event.id) : [];
    const owner = ownerRow ? owners.find((o) => o.key === ownerRow.key) ?? { key: ownerRow.key, name: ownerRow.name, folderId: ownerRow.drive_folder_id } : null;
    const ownerIndex = ownerRow ? chain.findIndex((row) => row.key === ownerRow.key) : -1;
    const below = ownerRow ? [...chain.slice(ownerIndex + 1).map((row) => row.name), ...located.below.map((f) => f.name)] : [];

    const folderName = crumbs[crumbs.length - 1]?.label ?? located.row.name;
    const children = await drive.listChildren(targetId, { foldersOnly: true });
    const ownerIds = new Set(owners.map((o) => o.folderId));
    const atOwners = !ownerRow && owners.length > 0 && located.below.length === 0;
    const folders = children.filter((f) => visible(f.name) && !(atOwners && ownerIds.has(f.id))).map((f) => ({ id: f.id, name: f.name }));
    const media = (await drive.listMedia(targetId)).filter((f) => visible(f.name) && pickerKind(f.mimeType)).map(toPickerFile);

    const sameFor: { owner: PickerOwner; folderId: string | null }[] = [];
    if (owner && below.length > 0) {
      for (const other of owners) {
        if (other.key === owner.key) continue;
        let cursor: string | null = other.folderId;
        for (const name of below) {
          if (!cursor) break;
          const hit: DriveFile[] = await drive.listChildren(cursor, { name, foldersOnly: true });
          cursor = hit[0]?.id ?? null;
        }
        sameFor.push({ owner: other, folderId: cursor });
      }
    }

    const cycles = rows
      .filter((row) => CYCLE_KEY.test(row.key))
      .sort((a, b) => b.key.localeCompare(a.key))
      .map((row) => ({ key: row.key, label: row.name, folderId: row.drive_folder_id }));

    return {
      state: "ok",
      eventCode: event.event_code || event.name,
      stageKey,
      crumbs,
      cycles,
      owner,
      owners,
      below,
      folder: { id: targetId, name: folderName },
      folders: atOwners ? [] : folders,
      otherFolders: atOwners ? folders : [],
      files: media,
      sameFor,
    };
  } catch (err) {
    console.warn(JSON.stringify({ step: "drive_picker_view", error: redactSecrets(err instanceof Error ? err.message : String(err)).slice(0, 200) }));
    return { state: "unreadable" };
  }
}

/** A file this event's tree holds, with Drive's measurements; null when it isn't in the tree. */
export async function fileInTree(db: LooseDb, drive: DriveApi, event: PickerEvent, fileId: string): Promise<DriveMediaFile | null> {
  if (!drive.getMediaFile) return null;
  const rows = await mapRows(db, event.id);
  const byDriveId = new Map(rows.map((row) => [row.drive_folder_id, row]));
  const file = await drive.getMediaFile(fileId);
  if (!file || file.trashed || !file.parents?.[0]) return null;
  return (await locateInTree(drive, byDriveId, file.parents[0])) ? file : null;
}

// ─── The copy (G6) ──────────────────────────────────────────────────────────

export type CopyProgress = { type: "progress"; pct: number } | { type: "registry" };

export type CopyResult =
  | {
      ok: true;
      /** A throwaway copy for the draft upload to send (the handler may remove it); the registry's own path is untouched. */
      storagePath: string;
      storageBucket: string;
      registryAssetId: string;
      mediaType: PickerKind;
      fileName: string;
      fromRegistry: boolean;
    }
  | { ok: false; code: "not_in_tree" | "too_large" | "not_916" | "copy_failed"; reason: string };

export type CopyDeps = {
  db: LooseDb;
  drive: DriveApi;
  userId: string;
  /** Upload a file on disk to the bucket (default: uploadFileToStorageBucket, streamed over 40 MB). */
  uploadFile: (storagePath: string, filePath: string, contentType: string) => Promise<void>;
  /** Server-side copy inside the bucket (Storage's own copy: no bytes through the function). */
  copyObject: (from: string, to: string) => Promise<void>;
  /** Width and height of a downloaded file Drive hadn't measured. Defaults: the moov probe for video, sharp for images. */
  measure?: (filePath: string, kind: PickerKind) => Promise<{ width: number; height: number } | null>;
  tempRoot?: string;
};

function extOf(file: Pick<DriveFile, "name" | "mimeType">, kind: PickerKind): string {
  const ext = /\.([a-z0-9]{2,5})$/i.exec(file.name)?.[1]?.toLowerCase();
  if (ext) return ext;
  return kind === "video" ? "mp4" : file.mimeType.includes("png") ? "png" : "jpg";
}

async function defaultMeasure(filePath: string, kind: PickerKind): Promise<{ width: number; height: number } | null> {
  try {
    if (kind === "video") {
      const probe = await probeMp4File(filePath);
      return { width: probe.width, height: probe.height };
    }
    const sharp = (await import("sharp")).default;
    const meta = await sharp(filePath).metadata();
    if (!meta.width || !meta.height) return null;
    // EXIF orientations 5–8 are quarter turns.
    const turned = (meta.orientation ?? 1) >= 5;
    return turned ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}

async function registryByDriveId(db: LooseDb, userId: string, fileId: string): Promise<Row | null> {
  const res = await db.from("creative_assets").select("*").eq("user_id", userId).eq("drive_file_id", fileId).not("storage_path", "is", null).limit(1);
  if (res.error) throw new Error(`creative_assets: ${res.error.message}`);
  return ((res.data ?? []) as Row[])[0] ?? null;
}

/**
 * Drive → Storage for one picked file. The registry first (drive_file_id):
 * a hit skips the Drive read. Otherwise the file is streamed to the temp
 * disk (never into memory), measured when Drive hadn't, uploaded to the
 * registry's stable path and registered with its drive_file_id. Either way
 * a throwaway copy is made for the draft upload, which removes its input on
 * a duplicate or a failure.
 */
export async function copyPickedFile(
  deps: CopyDeps,
  event: PickerEvent,
  input: { fileId: string; role?: "9:16" | "4:5" | "1:1" },
  onProgress: (p: CopyProgress) => void = () => {},
): Promise<CopyResult> {
  const fail = (code: Exclude<CopyResult, { ok: true }>["code"], reason: string): CopyResult => ({ ok: false, code, reason });
  let temp: string | null = null;
  try {
    const file = await fileInTree(deps.db, deps.drive, event, input.fileId);
    if (!file) return fail("not_in_tree", PICKER_WORDS.copyFailed);
    const kind = pickerKind(file.mimeType);
    if (!kind) return fail("copy_failed", PICKER_WORDS.copyFailed);
    const limit = kind === "video" ? PICKER_MAX_VIDEO_BYTES : PICKER_MAX_IMAGE_BYTES;
    if (file.size != null && file.size > limit) return fail("too_large", kind === "video" ? PICKER_WORDS.overVideo : PICKER_WORDS.overImage);
    const role = input.role ?? "9:16";
    const measured = ratioOf(file);
    const notNineSixteen = kind === "video" ? PICKER_WORDS.notNineSixteenVideo : PICKER_WORDS.notNineSixteenStatic;
    if (measured && measured !== role) return fail("not_916", notNineSixteen);

    const ext = extOf(file, kind);
    const folder = kind === "video" ? "videos" : "images";
    let stable: string;
    let assetId: string;
    let fromRegistry = false;
    const hit = await registryByDriveId(deps.db, deps.userId, file.id);
    if (hit) {
      onProgress({ type: "registry" });
      stable = String(hit.storage_path);
      assetId = String(hit.id);
      fromRegistry = true;
    } else {
      temp = await mkdtemp(path.join(deps.tempRoot ?? tmpdir(), "drive-pick-"));
      const local = path.join(temp, `original.${ext}`);
      if (!deps.drive.downloadTo) return fail("copy_failed", PICKER_WORDS.copyFailed);
      const total = file.size ?? 0;
      let last = -1;
      const identity: ContentIdentity = await deps.drive.downloadTo(file.id, local, {
        onBytes: (written) => {
          if (!total) return;
          const pct = Math.floor((written / total) * 100);
          if (pct !== last) {
            last = pct;
            onProgress({ type: "progress", pct });
          }
        },
      });
      if (identity.byteSize > limit) return fail("too_large", kind === "video" ? PICKER_WORDS.overVideo : PICKER_WORDS.overImage);
      if (!measured) {
        const size = await (deps.measure ?? defaultMeasure)(local, kind);
        const fits = size ? (role === "9:16" ? isNineSixteen(size.width, size.height) : ratioOf({ ...size, rotation: 0 }) === role) : false;
        if (!fits) return fail("not_916", notNineSixteen);
      }
      const known = await findAssetByFingerprint(deps.db, deps.userId, identity);
      const knownRow = known.ok ? known.asset : null;
      stable = knownRow?.storagePath || `${folder}/drive/${identity.contentHash}.${ext}`;
      if (!knownRow?.storagePath) await deps.uploadFile(stable, local, file.mimeType || (kind === "video" ? "video/mp4" : "image/jpeg"));
      const registered = await upsertRegisteredAsset(deps.db, {
        userId: deps.userId,
        identity,
        filename: file.name,
        mediaKind: kind === "video" ? "video" : "image",
        aspectRatio: role,
        durationSeconds: file.durationMs != null ? file.durationMs / 1000 : null,
        storageBucket: PICKER_BUCKET,
        storagePath: stable,
        driveFileId: file.id,
      });
      if (!registered.ok) return fail("copy_failed", PICKER_WORDS.copyFailed);
      assetId = registered.asset.id;
      // A row the browser registered first has no drive_file_id: give it this one, so the next pick skips Drive.
      if (!registered.asset.driveFileId) {
        await deps.db.from("creative_assets").update({ drive_file_id: file.id }).eq("id", assetId).is("drive_file_id", null);
      }
      if (registered.asset.storagePath && registered.asset.storagePath !== stable) stable = registered.asset.storagePath;
    }
    const send = `${folder}/drive-send/${randomUUID()}.${ext}`;
    await deps.copyObject(stable, send);
    return { ok: true, storagePath: send, storageBucket: PICKER_BUCKET, registryAssetId: assetId, mediaType: kind, fileName: file.name, fromRegistry };
  } catch (err) {
    console.warn(JSON.stringify({ step: "drive_picker_copy", error: redactSecrets(err instanceof Error ? err.message : String(err)).slice(0, 200) }));
    return fail("copy_failed", PICKER_WORDS.copyFailed);
  } finally {
    if (temp) await rm(temp, { recursive: true, force: true });
  }
}
