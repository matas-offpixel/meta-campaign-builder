/**
 * Import an artist's clips from a shared Drive or Dropbox folder.
 *
 * One file at a time: list, then download, register, and insert before
 * the next file starts. A file that fails does not stop the rest. The
 * folder URL and file ids are never logged.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { snapRatio } from "../clients/asset-queue/aspect-detect.ts";
import { DriveFetchError, downloadFile, isDriveFolderUrl, listFolderRecursive, parseFolderId } from "../clients/asset-queue/drive.ts";
import { loadServiceAccount } from "../clients/asset-queue/drive-auth.ts";
import { fetchDropboxFileContent, isDropboxFolderUrl, listDropboxFolderFiles } from "../clients/asset-queue/dropbox.ts";
import { uploadToStorageBucket } from "../clients/asset-queue/storage-upload.ts";
import { fingerprintBytes, resolveRegistryAspect, upsertRegisteredAsset, type RegistryAspect } from "../creatives/asset-registry.ts";
import type { ServiceRoleDb } from "./load.ts";
import { probeMp4Bytes } from "./mp4-probe.ts";
import { attachRenderProxy, type RenderProxyMaker } from "./render-proxy.ts";

const BUCKET = "campaign-assets";
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm"]);
const CLIP_SOURCES = new Set(["spark", "file", "instagram", "presskit"]);
const TRIM_SECONDS = 30;

type Row = Record<string, unknown>;

export class ClipIntakeError extends Error {
  readonly code: "rights_not_approved" | "no_folder";
  constructor(code: "rights_not_approved" | "no_folder", message: string) {
    super(message);
    this.name = "ClipIntakeError";
    this.code = code;
  }
}

export type ClipFolderFile = {
  sourceFileId: string;
  name: string;
  size: number;
};

export type ClipFolderListing = {
  list(url: string): Promise<ClipFolderFile[]>;
  download(url: string, file: ClipFolderFile): Promise<Buffer>;
};

export type ClipProbe = { width: number; height: number; durationInSeconds: number };

export type ClipImportFile = {
  name: string;
  outcome: "imported" | "skipped" | "failed";
  reason: string | null;
  /** Bytes as the folder listed them. */
  size?: number;
  /** Set when outcome is "imported". */
  clipId?: string;
};

/** A clip this run inserted, handed to `onImported` before the next file starts. */
export type ImportedClip = {
  clipId: string;
  name: string;
  storagePath: string;
  /** The 1080 render proxy's path when one was made, else null. Renders and the text check read it. */
  renderStoragePath: string | null;
  durationSeconds: number | null;
  inS: number | null;
  outS: number | null;
};

export type ClipImportResult = {
  files: ClipImportFile[];
  folderError: string | null;
};

export function driveFolderShareMessage(email: string): string {
  return `Share this folder with ${email.trim()} as Viewer`;
}

function text(row: Row | null | undefined, key: string): string {
  return String(row?.[key] ?? "").trim();
}

function extensionOf(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return /^[a-z0-9]{2,5}$/.test(ext) ? ext : "";
}

function contentType(ext: string): string {
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  return "video/mp4";
}

function plain(message: string): string {
  return message.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 500) || "Could not import this file.";
}

function shareMessageFromConfig(): string {
  try {
    const email = loadServiceAccount().client_email.trim();
    if (!email) return "Share this folder with the Drive service account as Viewer";
    return driveFolderShareMessage(email);
  } catch {
    return "Share this folder with the Drive service account as Viewer";
  }
}

function folderMessage(err: unknown, shareMessage: () => string): string {
  if (err instanceof DriveFetchError && (err.code === "forbidden" || err.code === "not_found")) return shareMessage();
  if (err instanceof ClipIntakeError) return err.message;
  return plain(err instanceof Error ? err.message : "Could not read the folder.");
}

/**
 * The Drive or Dropbox listing importArtistClips uses. `dropboxPath` lists one
 * subfolder of a Dropbox share (and what is under it) instead of the whole share.
 */
export function clipFolderListing(options: { dropboxPath?: string } = {}): ClipFolderListing {
  return {
    async list(url: string) {
      if (isDriveFolderUrl(url)) {
        const folderId = parseFolderId(url);
        if (!folderId) throw new DriveFetchError("not_found", "Could not parse a Google Drive folder id from the link.");
        const files: ClipFolderFile[] = [];
        for await (const entry of listFolderRecursive(folderId)) {
          files.push({ sourceFileId: entry.id, name: entry.name, size: entry.size });
        }
        return files;
      }
      if (isDropboxFolderUrl(url)) {
        const entries = await listDropboxFolderFiles(url, { path: options.dropboxPath });
        return entries.map((entry) => ({ sourceFileId: entry.path_lower, name: entry.name, size: entry.size }));
      }
      throw new ClipIntakeError("no_folder", "Paste a Drive or Dropbox folder link.");
    },
    async download(url: string, file: ClipFolderFile) {
      if (isDriveFolderUrl(url)) {
        const downloaded = await downloadFile(file.sourceFileId);
        return downloaded.buffer;
      }
      const downloaded = await fetchDropboxFileContent(url, { name: file.name, path_lower: file.sourceFileId });
      return downloaded.buffer;
    },
  };
}

function defaultProbe(bytes: Buffer): ClipProbe | null {
  try {
    const probe = probeMp4Bytes(bytes);
    return { width: probe.width, height: probe.height, durationInSeconds: probe.durationInSeconds };
  } catch {
    return null;
  }
}

async function defaultUpload(db: ServiceRoleDb, storagePath: string, bytes: Buffer, type: string): Promise<void> {
  const uploaded = await uploadToStorageBucket(db as unknown as SupabaseClient, BUCKET, storagePath, bytes, type);
  if (uploaded.error) throw new Error(uploaded.error.message ?? "Could not store the file.");
}

async function writeFolderState(db: ServiceRoleDb, artistId: string, userId: string, patch: Row): Promise<void> {
  const updated = await db.from("creative_lab_artists").update(patch).eq("id", artistId).eq("user_id", userId);
  if (updated.error) throw new Error(updated.error.message);
}

export async function importArtistClips(
  db: ServiceRoleDb,
  args: {
    artistId?: string;
    /** Venue & crowd, or an upload whose S23 answer is that folder. */
    asPromoter?: { userId: string; rightsRef: string };
    maxNew?: number;
    now?: Date;
    listing?: ClipFolderListing;
    upload?: (storagePath: string, bytes: Buffer, contentType: string) => Promise<void>;
    probe?: (bytes: Buffer, name: string) => ClipProbe | null;
    shareMessage?: () => string;
    /**
     * A folder other than the artist's own clip_folder_url (the Drive export's
     * Artist clips/{artist}, read by lib/drive/pickup.ts). The artist's folder
     * link and its synced/error state are then left as they are.
     */
    folderUrl?: string;
    /** The event the clips were filed under. Null (the default) for the artist's own folder. */
    eventId?: string | null;
    /**
     * Leaves a listed file out before anything is downloaded. Returns the
     * reason it is skipped, or null to keep it.
     */
    filter?: (file: ClipFolderFile) => string | null;
    /** The clip's source. Defaults to the artist's clip_source. */
    source?: string;
    /** Runs after each clip row is inserted, before the next file. A throw is reported on that file, not the run. */
    onImported?: (clip: ImportedClip) => Promise<string | null | void>;
    /**
     * Makes the 1080 render proxy for an original whose 9:16 crop is larger
     * than 1080×1920 (render-proxy.ts). Defaults to ffmpeg-static. false
     * skips it. A failure leaves the clip imported on its original.
     */
    renderProxy?: RenderProxyMaker | false;
  },
): Promise<ClipImportResult> {
  const promoter = args.asPromoter ?? null;
  if (!promoter && !args.artistId) throw new Error("A clip needs an artist.");
  const artistRes = promoter
    ? { data: { user_id: promoter.userId, clip_folder_url: "", rights_doc_ref: promoter.rightsRef, clip_source: args.source ?? "file" } as Row, error: null }
    : await db.from("creative_lab_artists").select("*").eq("id", args.artistId!).maybeSingle();
  if (artistRes.error) throw new Error(artistRes.error.message);
  const artist = artistRes.data as Row | null;
  if (!artist) throw new Error("No artist with that id.");
  const userId = text(artist, "user_id");
  const shareMessage = args.shareMessage ?? shareMessageFromConfig;
  const ownFolder = !args.folderUrl;
  const folderUrl = args.folderUrl ?? text(artist, "clip_folder_url");
  if (!folderUrl) {
    const message = "Add a Drive or Dropbox folder link first.";
    if (args.artistId) await writeFolderState(db, args.artistId, userId, { clip_folder_last_error: message });
    throw new ClipIntakeError("no_folder", message);
  }
  const rightsRef = text(artist, "rights_doc_ref") || "Promoter page";
  const source = args.source && CLIP_SOURCES.has(args.source)
    ? args.source
    : CLIP_SOURCES.has(text(artist, "clip_source")) ? text(artist, "clip_source") : "file";
  const listing = args.listing ?? clipFolderListing();
  const upload = args.upload ?? ((storagePath: string, bytes: Buffer, type: string) => defaultUpload(db, storagePath, bytes, type));
  const probe = args.probe ?? ((bytes: Buffer) => defaultProbe(bytes));
  const now = (args.now ?? new Date()).toISOString();

  let listed: ClipFolderFile[];
  try {
    listed = await listing.list(folderUrl);
  } catch (err) {
    const message = folderMessage(err, shareMessage);
    if (ownFolder && args.artistId) await writeFolderState(db, args.artistId, userId, { clip_folder_last_error: message });
    return { files: [], folderError: message };
  }

  const clipRes = promoter && args.eventId
    ? await db.from("creative_lab_clips").select("*").eq("shown_on_event_id", args.eventId).eq("owner", "promoter")
    : await db.from("creative_lab_clips").select("*").eq("artist_id", args.artistId!);
  if (clipRes.error) throw new Error(clipRes.error.message);
  const clips = (clipRes.data ?? []) as Row[];
  const knownIds = new Set(clips.map((row) => text(row, "source_file_id")).filter(Boolean));
  const clipAssetIds = new Set(clips.map((row) => text(row, "creative_asset_id")).filter(Boolean));
  // Only this artist's clip assets: a user's whole creative_assets table runs past PostgREST's 1,000-row cap.
  const assets: Row[] = [];
  const assetIds = [...clipAssetIds];
  for (let i = 0; i < assetIds.length; i += 100) {
    const assetRes = await db.from("creative_assets").select("*").eq("user_id", userId).in("id", assetIds.slice(i, i + 100));
    if (assetRes.error) throw new Error(assetRes.error.message);
    assets.push(...((assetRes.data ?? []) as Row[]));
  }
  const knownHashes = new Set(
    assets.filter((row) => clipAssetIds.has(text(row, "id"))).map((row) => `${text(row, "content_hash")}:${Number(row.byte_size) || 0}`),
  );
  let nextNo = Math.max(0, ...clips.map((row) => Number(row.clip_no) || 0));
  const cap = args.maxNew ?? Number.POSITIVE_INFINITY;
  let imported = 0;
  const files: ClipImportFile[] = [];

  for (const file of listed) {
    const name = file.name.trim() || "clip";
    const size = file.size;
    const ext = extensionOf(name);
    const filtered = args.filter ? args.filter(file) : null;
    if (filtered) {
      files.push({ name, size, outcome: "skipped", reason: filtered });
      continue;
    }
    if (!VIDEO_EXTENSIONS.has(ext)) {
      files.push({ name, size, outcome: "skipped", reason: "not a video" });
      continue;
    }
    if (file.sourceFileId && knownIds.has(file.sourceFileId)) {
      files.push({ name, size, outcome: "skipped", reason: "already imported" });
      continue;
    }
    if (imported >= cap) break;
    try {
      const bytes = await listing.download(folderUrl, file);
      const identity = fingerprintBytes(bytes);
      const hashKey = `${identity.contentHash}:${identity.byteSize}`;
      if (knownHashes.has(hashKey)) {
        files.push({ name, size, outcome: "skipped", reason: "same video as a clip already imported" });
        continue;
      }
      const measured = probe(bytes, name);
      const duration = measured ? Math.round(measured.durationInSeconds * 1000) / 1000 : null;
      const aspect: RegistryAspect = measured
        ? snapRatio(measured.width, measured.height)
        : resolveRegistryAspect({ filename: name, probed: "other" });
      const storagePath = `videos/creative-lab/${promoter ? `promoter/${args.eventId ?? "event"}` : args.artistId}/${identity.contentHash}.${ext}`;
      await upload(storagePath, bytes, contentType(ext));
      const registered = await upsertRegisteredAsset(db, {
        userId,
        identity,
        filename: name,
        mediaKind: "video",
        aspectRatio: aspect,
        durationSeconds: duration,
        storageBucket: BUCKET,
        storagePath,
      });
      if (!registered.ok) throw new Error(registered.error);
      const trimmed = duration != null && duration > TRIM_SECONDS;
      nextNo += 1;
      const inserted = await db.from("creative_lab_clips").insert({
        user_id: userId,
        artist_id: promoter ? null : args.artistId,
        owner: promoter ? "promoter" : "artist",
        shown_on_event_id: promoter ? args.eventId ?? null : null,
        creative_asset_id: registered.asset.id,
        clip_no: nextNo,
        source,
        rights_ref: rightsRef,
        event_id: args.eventId ?? null,
        audio_status: "original",
        crop_focus_y: 0.5,
        source_file_id: file.sourceFileId,
        in_s: trimmed ? 0 : null,
        out_s: trimmed ? TRIM_SECONDS : null,
      }).select("id");
      if (inserted.error) {
        if (/duplicate|unique/i.test(inserted.error.message)) {
          files.push({ name, size, outcome: "skipped", reason: "already imported" });
          continue;
        }
        throw new Error(inserted.error.message);
      }
      knownIds.add(file.sourceFileId);
      knownHashes.add(hashKey);
      clipAssetIds.add(registered.asset.id);
      imported += 1;
      const clipId = text(((inserted.data ?? []) as Row[])[0], "id");
      const notes: string[] = trimmed ? ["trimmed to 30 s"] : [];
      let renderStoragePath: string | null = null;
      if (args.renderProxy !== false && clipId && measured) {
        try {
          const proxy = await attachRenderProxy(db, {
            clipId,
            userId,
            artistId: args.artistId ?? "promoter",
            name,
            original: bytes,
            width: measured.width,
            height: measured.height,
            durationSeconds: duration,
            make: args.renderProxy || undefined,
            upload,
          });
          // No note on the file: the import's words are unchanged.
          if (proxy) renderStoragePath = proxy.storagePath;
        } catch (err) {
          // The clip stays on its original; the import of this file still counts.
          console.warn(JSON.stringify({ step: "render_proxy", clipId, errorClass: plain(err instanceof Error ? err.message : String(err)).slice(0, 160) }));
        }
      }
      if (args.onImported && clipId) {
        try {
          const note = await args.onImported({
            clipId,
            name,
            storagePath,
            renderStoragePath,
            durationSeconds: duration,
            inS: trimmed ? 0 : null,
            outS: trimmed ? TRIM_SECONDS : null,
          });
          if (note) notes.push(note);
        } catch (err) {
          notes.push(plain(err instanceof Error ? err.message : "The after-import step failed."));
        }
      }
      files.push({ name, size, outcome: "imported", reason: notes.length ? notes.join("; ") : null, ...(clipId ? { clipId } : {}) });
    } catch (err) {
      if (err instanceof ClipIntakeError) throw err;
      files.push({ name, size, outcome: "failed", reason: plain(err instanceof Error ? err.message : "Could not import this file.") });
    }
  }

  if (ownFolder && args.artistId) await writeFolderState(db, args.artistId, userId, { clip_folder_synced_at: now, clip_folder_last_error: null });
  return { files, folderError: null };
}
