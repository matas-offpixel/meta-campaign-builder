/**
 * Import an artist's press pack (a shared Dropbox folder owned by the
 * artist's team) into the Creative Lab.
 *
 * Videos come only from the pack's Videos/ subfolder and go through
 * importArtistClips (same dedupe by file id and sha256, same 30 s trim,
 * rights_ref from the artist), as source 'presskit'. The artist's own
 * clip_folder_url and its synced/error state are not touched. Each
 * imported clip then gets the burned-in text check, stored on the clip's
 * overlay_check.
 *
 * Images come only from Press Pictures/ and Logo/. Each one is stored at
 * images/creative-lab/{artistId}/{sha256}.{ext} and registered as a
 * creative_assets row (media_kind 'image', aspect from the pixels, the
 * file's own name kept).
 *
 * planPresskit is the dry run and reads metadata only: the folder listing
 * and the rows already in Supabase. Nothing is downloaded.
 */

import { snapRatio } from "../clients/asset-queue/aspect-detect.ts";
import { MAX_SINGLE_FILE_BYTES } from "../clients/asset-queue/dropbox.ts";
import { fingerprintBytes, upsertRegisteredAsset, type RegistryAspect } from "../creatives/asset-registry.ts";
import {
  importArtistClips,
  type ClipFolderFile,
  type ClipFolderListing,
  type ClipImportFile,
  type ClipProbe,
  type ImportedClip,
} from "./clip-intake.ts";
import type { ServiceRoleDb } from "./load.ts";
import { frameSampleTimes, settleOverlayVerdict, type OverlayCheck, type OverlayFrame } from "./overlay-check.ts";
import { attachRenderProxy, renderAssetId, renderProxySize, type RenderProxyMaker } from "./render-proxy.ts";

type Row = Record<string, unknown>;

export const PRESSKIT_VIDEO_FOLDER = "Videos";
export const PRESSKIT_IMAGE_FOLDERS = [
  { group: "press", folder: "Press Pictures" },
  { group: "logo", folder: "Logo" },
] as const;
export type PresskitImageGroup = (typeof PRESSKIT_IMAGE_FOLDERS)[number]["group"];

export const DEFAULT_EXCLUDE = /b2b/i;
export const PRESSKIT_SOURCE = "presskit";
const BUCKET = "campaign-assets";
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm"]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const TRIM_SECONDS = 30;

/** A press pack, one subfolder at a time. `list` returns only the files under that subfolder. */
export type PresskitSource = {
  list(subfolder: string): Promise<ClipFolderFile[]>;
  download(file: ClipFolderFile): Promise<Buffer>;
};

export type PresskitMode = "all" | "videos" | "images";

export type PlanRow = {
  kind: "video" | "image";
  group: "videos" | PresskitImageGroup;
  name: string;
  size: number;
  action: "import" | "skip";
  reason: string | null;
};

/** `/b2b/i`, `b2b`, or `/x|y/` → a RegExp. A bare word is case-insensitive. */
export function parseExclude(value: string | undefined | null): RegExp {
  const raw = (value ?? "").trim();
  if (!raw) return DEFAULT_EXCLUDE;
  const literal = raw.match(/^\/(.+)\/([a-z]*)$/);
  if (literal) return new RegExp(literal[1]!, literal[2]);
  return new RegExp(raw, "i");
}

function extensionOf(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return /^[a-z0-9]{2,5}$/.test(ext) ? ext : "";
}

function imageContentType(ext: string): string {
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The reason a listed video is left out before download, or null to keep it. */
export function videoSkipReason(file: ClipFolderFile, exclude: RegExp): string | null {
  if (exclude.test(file.name)) return `name matches ${exclude}`;
  if (file.size > MAX_SINGLE_FILE_BYTES) return `${megabytes(file.size)} is over the 200 MB per-file limit`;
  return null;
}

/** The reason a listed image is left out before download, or null to keep it. */
export function imageSkipReason(file: ClipFolderFile, exclude: RegExp): string | null {
  if (exclude.test(file.name)) return `name matches ${exclude}`;
  if (!IMAGE_EXTENSIONS.has(extensionOf(file.name))) return "not a jpg, png or webp";
  if (file.size > MAX_SINGLE_FILE_BYTES) return `${megabytes(file.size)} is over the 200 MB per-file limit`;
  return null;
}

/** The Videos/ subfolder as the listing importArtistClips reads. Nothing else in the pack is listed. */
export function presskitVideoListing(source: PresskitSource): ClipFolderListing {
  return {
    list: () => source.list(PRESSKIT_VIDEO_FOLDER),
    download: (_url, file) => source.download(file),
  };
}

async function loadArtist(db: ServiceRoleDb, artistId: string): Promise<Row> {
  const res = await db.from("creative_lab_artists").select("*").eq("id", artistId).maybeSingle();
  if (res.error) throw new Error(res.error.message);
  const artist = res.data as Row | null;
  if (!artist) throw new Error("No artist with that id.");
  return artist;
}

async function knownClipFileIds(db: ServiceRoleDb, artistId: string): Promise<Set<string>> {
  const res = await db.from("creative_lab_clips").select("source_file_id").eq("artist_id", artistId);
  if (res.error) throw new Error(res.error.message);
  return new Set(((res.data ?? []) as Row[]).map((row) => String(row.source_file_id ?? "").trim()).filter(Boolean));
}

function imagePrefix(artistId: string): string {
  return `images/creative-lab/${artistId}/`;
}

/** An image already stored by this import: same name and bytes under the artist's images/ prefix. */
async function storedImage(db: ServiceRoleDb, userId: string, artistId: string, file: ClipFolderFile): Promise<Row | null> {
  const res = await db
    .from("creative_assets")
    .select("*")
    .eq("user_id", userId)
    .eq("media_kind", "image")
    .eq("filename", file.name.trim())
    .eq("byte_size", file.size);
  if (res.error) throw new Error(res.error.message);
  return ((res.data ?? []) as Row[]).find((row) => String(row.storage_path ?? "").startsWith(imagePrefix(artistId))) ?? null;
}

/**
 * The dry run: what --apply would do with each listed file. Metadata only.
 * A video whose bytes match a clip already imported is found only at
 * --apply, since that needs the download.
 */
export async function planPresskit(
  db: ServiceRoleDb,
  args: { artistId: string; source: PresskitSource; exclude?: RegExp; mode?: PresskitMode; max?: number },
): Promise<PlanRow[]> {
  const artist = await loadArtist(db, args.artistId);
  const userId = String(artist.user_id ?? "");
  const exclude = args.exclude ?? DEFAULT_EXCLUDE;
  const mode = args.mode ?? "all";
  const max = args.max ?? Number.POSITIVE_INFINITY;
  const out: PlanRow[] = [];

  if (mode !== "images") {
    const known = await knownClipFileIds(db, args.artistId);
    let kept = 0;
    for (const file of await presskitVideoListing(args.source).list("")) {
      const row = { kind: "video" as const, group: "videos" as const, name: file.name, size: file.size };
      const skip = videoSkipReason(file, exclude)
        ?? (!VIDEO_EXTENSIONS.has(extensionOf(file.name)) ? "not a video" : null)
        ?? (known.has(file.sourceFileId) ? "already imported" : null)
        ?? (kept >= max ? `over --max ${max}` : null);
      if (skip) {
        out.push({ ...row, action: "skip", reason: skip });
        continue;
      }
      kept += 1;
      out.push({ ...row, action: "import", reason: null });
    }
  }

  if (mode !== "videos") {
    let kept = 0;
    for (const { group, folder } of PRESSKIT_IMAGE_FOLDERS) {
      for (const file of await args.source.list(folder)) {
        const row = { kind: "image" as const, group, name: file.name, size: file.size };
        const skip = imageSkipReason(file, exclude)
          ?? ((await storedImage(db, userId, args.artistId, file)) ? "already stored" : null)
          ?? (kept >= max ? `over --max ${max}` : null);
        if (skip) {
          out.push({ ...row, action: "skip", reason: skip });
          continue;
        }
        kept += 1;
        out.push({ ...row, action: "import", reason: null });
      }
    }
  }
  return out;
}

export type OverlayJudge = (input: { src: string | null; times: number[]; thumbnail: Uint8Array | null }) => Promise<{
  verdict?: string;
  frames?: OverlayFrame[];
  reason?: string;
  unsure?: boolean;
}>;

/**
 * The burned-in text check on one press-kit clip, stored on the clip's
 * overlay_check. The frames are sampled from the window the tile plays
 * (the first 30 s of a longer file). A press kit has no thumbnail. It reads
 * the 1080 render proxy when the clip has one (a 4K original fails on Lambda).
 */
export async function checkClipOverlay(
  db: ServiceRoleDb,
  clip: Pick<ImportedClip, "clipId" | "storagePath" | "durationSeconds" | "outS"> & { renderStoragePath?: string | null },
  deps: { sign: (storagePath: string) => Promise<string | null>; judge: OverlayJudge; now?: Date },
): Promise<OverlayCheck> {
  const seconds = clip.outS ?? (clip.durationSeconds != null ? Math.min(clip.durationSeconds, TRIM_SECONDS) : 8);
  const src = await deps.sign(clip.renderStoragePath || clip.storagePath);
  const raw = await deps.judge({ src, times: frameSampleTimes(seconds), thumbnail: null });
  const check = settleOverlayVerdict(raw);
  const updated = await db.from("creative_lab_clips").update({ overlay_check: check }).eq("id", clip.clipId);
  if (updated.error) throw new Error(updated.error.message);
  return check;
}

export type VideoImportRow = ClipImportFile & { overlay: OverlayCheck | null };

/** --apply for videos. Imports the kept files, then checks each one for burned-in text as it lands. */
export async function importPresskitVideos(
  db: ServiceRoleDb,
  args: {
    artistId: string;
    folderUrl: string;
    source: PresskitSource;
    exclude?: RegExp;
    max?: number;
    sign: (storagePath: string) => Promise<string | null>;
    judge: OverlayJudge;
    upload?: (storagePath: string, bytes: Buffer, contentType: string) => Promise<void>;
    probe?: (bytes: Buffer, name: string) => ClipProbe | null;
    /** Clip numbers to check again even though they hold a verdict (a prompt or schema change). */
    recheckClipNos?: readonly number[];
    /** The 1080 render proxy maker (render-proxy.ts). Defaults to ffmpeg-static; false skips proxies. */
    renderProxy?: RenderProxyMaker | false;
    /**
     * Proxies for clips imported before render proxies existed: each press-kit
     * clip with no render_asset_id is probed, a 4K one is downloaded once and
     * proxied, and then checked again on the proxy. Needs upload.
     */
    backfill?: { probeUrl: (url: string) => Promise<{ width: number; height: number }>; download: (storagePath: string) => Promise<Buffer> };
  },
): Promise<{
  files: VideoImportRow[];
  folderError: string | null;
  rechecked: { clipId: string; check: OverlayCheck }[];
  proxied: { clipId: string; clipNo: number; width: number; height: number; storagePath: string }[];
}> {
  const exclude = args.exclude ?? DEFAULT_EXCLUDE;
  const checks = new Map<string, OverlayCheck>();
  const result = await importArtistClips(db, {
    artistId: args.artistId,
    folderUrl: args.folderUrl,
    eventId: null,
    source: PRESSKIT_SOURCE,
    listing: presskitVideoListing(args.source),
    filter: (file) => videoSkipReason(file, exclude),
    maxNew: args.max,
    upload: args.upload,
    probe: args.probe,
    renderProxy: args.renderProxy,
    onImported: async (clip) => {
      const check = await checkClipOverlay(db, clip, { sign: args.sign, judge: args.judge });
      checks.set(clip.clipId, check);
      return null;
    },
  });

  // A clip from an earlier run whose check never stored (the run stopped, or the check could not read the file),
  // any clip number the operator named with --recheck, and any clip that just got its render proxy.
  const rechecked: { clipId: string; check: OverlayCheck }[] = [];
  const pending = await db.from("creative_lab_clips").select("*").eq("artist_id", args.artistId).eq("source", PRESSKIT_SOURCE);
  if (pending.error) throw new Error(pending.error.message);
  const rows = (pending.data ?? []) as Row[];

  // A 4K clip from before render proxies: make its proxy now, then check it again on the proxy.
  const proxied: { clipId: string; clipNo: number; width: number; height: number; storagePath: string }[] = [];
  if (args.backfill && args.upload && args.renderProxy !== false) {
    for (const row of rows) {
      const id = String(row.id ?? "");
      if (!id || checks.has(id) || (typeof row.render_asset_id === "string" && row.render_asset_id)) continue;
      const original = await db.from("creative_assets").select("storage_path, duration_seconds, filename").eq("id", String(row.creative_asset_id ?? "")).maybeSingle();
      if (original.error) throw new Error(original.error.message);
      const storagePath = String((original.data as Row | null)?.storage_path ?? "");
      if (!storagePath) continue;
      const url = await args.sign(storagePath);
      if (!url) continue;
      const measured = await args.backfill.probeUrl(url);
      if (!renderProxySize(measured.width, measured.height)) continue;
      const duration = Number((original.data as Row | null)?.duration_seconds);
      const proxy = await attachRenderProxy(db, {
        clipId: id,
        userId: String(row.user_id ?? ""),
        artistId: args.artistId,
        name: String((original.data as Row | null)?.filename ?? "clip.mp4"),
        original: await args.backfill.download(storagePath),
        width: measured.width,
        height: measured.height,
        durationSeconds: Number.isFinite(duration) ? duration : null,
        make: args.renderProxy || undefined,
        upload: args.upload,
      });
      if (!proxy) continue;
      row.render_asset_id = proxy.assetId;
      proxied.push({ clipId: id, clipNo: Number(row.clip_no), width: proxy.size.width, height: proxy.size.height, storagePath: proxy.storagePath });
    }
  }

  for (const row of rows) {
    const id = String(row.id ?? "");
    if (!id || checks.has(id)) continue;
    const stored = row.overlay_check as OverlayCheck | null;
    const forced = (args.recheckClipNos ?? []).includes(Number(row.clip_no)) || proxied.some((item) => item.clipId === id);
    if (!forced && stored && stored.verdict && stored.verdict !== "check_by_eye") continue;
    // The proxy when the clip has one, else the original. Duration is the same either way.
    const asset = await db.from("creative_assets").select("storage_path, duration_seconds").eq("id", renderAssetId(row)).maybeSingle();
    if (asset.error) throw new Error(asset.error.message);
    const storagePath = String((asset.data as Row | null)?.storage_path ?? "");
    if (!storagePath) continue;
    const duration = Number((asset.data as Row | null)?.duration_seconds);
    const check = await checkClipOverlay(db, {
      clipId: id,
      storagePath,
      durationSeconds: Number.isFinite(duration) ? duration : null,
      outS: row.out_s == null ? null : Number(row.out_s),
    }, { sign: args.sign, judge: args.judge });
    rechecked.push({ clipId: id, check });
  }

  return {
    files: result.files.map((file) => ({ ...file, overlay: file.clipId ? checks.get(file.clipId) ?? null : null })),
    folderError: result.folderError,
    rechecked,
    proxied,
  };
}

export type ImageImportRow = {
  group: PresskitImageGroup;
  name: string;
  size: number;
  outcome: "imported" | "skipped" | "failed";
  reason: string | null;
  width: number | null;
  height: number | null;
  aspect: RegistryAspect | null;
  storagePath: string | null;
  assetId: string | null;
};

/** Width and height as shown, after the EXIF orientation. */
export type ImageMeasure = (bytes: Buffer) => Promise<{ width: number; height: number } | null>;

export async function defaultImageMeasure(bytes: Buffer): Promise<{ width: number; height: number } | null> {
  const { default: sharp } = await import("sharp");
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height) return null;
  const rotated = (meta.orientation ?? 1) >= 5;
  return rotated ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
}

/** --apply for images. Press Pictures/ and Logo/ only, in that order. */
export async function importPresskitImages(
  db: ServiceRoleDb,
  args: {
    artistId: string;
    source: PresskitSource;
    upload: (storagePath: string, bytes: Buffer, contentType: string) => Promise<void>;
    measure?: ImageMeasure;
    exclude?: RegExp;
    max?: number;
  },
): Promise<ImageImportRow[]> {
  const artist = await loadArtist(db, args.artistId);
  const userId = String(artist.user_id ?? "");
  const exclude = args.exclude ?? DEFAULT_EXCLUDE;
  const measure = args.measure ?? defaultImageMeasure;
  const max = args.max ?? Number.POSITIVE_INFINITY;
  const out: ImageImportRow[] = [];
  let imported = 0;

  for (const { group, folder } of PRESSKIT_IMAGE_FOLDERS) {
    for (const file of await args.source.list(folder)) {
      const name = file.name.trim();
      const base = { group, name, size: file.size, width: null, height: null, aspect: null, storagePath: null, assetId: null };
      const skip = imageSkipReason(file, exclude);
      if (skip) {
        out.push({ ...base, outcome: "skipped", reason: skip });
        continue;
      }
      const stored = await storedImage(db, userId, args.artistId, file);
      if (stored) {
        out.push({ ...base, outcome: "skipped", reason: "already stored", storagePath: String(stored.storage_path ?? ""), assetId: String(stored.id ?? "") });
        continue;
      }
      if (imported >= max) break;
      try {
        const bytes = await args.source.download(file);
        const size = await measure(bytes);
        if (!size) throw new Error("Could not read the image's size.");
        const identity = fingerprintBytes(bytes);
        const ext = extensionOf(name);
        const storagePath = `${imagePrefix(args.artistId)}${identity.contentHash}.${ext}`;
        const aspect = snapRatio(size.width, size.height);
        await args.upload(storagePath, bytes, imageContentType(ext));
        const registered = await upsertRegisteredAsset(db, {
          userId,
          identity,
          filename: name,
          mediaKind: "image",
          aspectRatio: aspect,
          storageBucket: BUCKET,
          storagePath,
        });
        if (!registered.ok) throw new Error(registered.error);
        imported += 1;
        out.push({
          ...base,
          outcome: registered.created ? "imported" : "skipped",
          reason: registered.created ? null : "same image already registered",
          width: size.width,
          height: size.height,
          aspect,
          storagePath: registered.asset.storagePath ?? storagePath,
          assetId: registered.asset.id,
        });
      } catch (err) {
        out.push({ ...base, outcome: "failed", reason: err instanceof Error ? err.message.slice(0, 300) : "Could not import this image." });
      }
    }
  }
  return out;
}
