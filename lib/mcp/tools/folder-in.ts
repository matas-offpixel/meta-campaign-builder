/**
 * lib/mcp/tools/folder-in.ts — upload_to_event_folder (M3d-c, scope
 * mcp:draft).
 *
 * One file into one folder of a show's own Drive tree, as the export's
 * service account: a shared-drive file is copied (files.copy, the original
 * untouched), or a Storage file already on one of the show's drafts is
 * uploaded. The target is one of five folders the show's drive_folders map
 * already holds (lib/mcp/folder-in/resolve.ts); a folder id is checked
 * against that map and again by walking its Drive parents to the show.
 *
 * Rights (lib/drive/file-owner.ts, as attach_drive_creatives): the show's
 * client's own files or the artist library, never another client's.
 * Never a permission, share, move, rename or delete; no folder is made.
 * The new file carries the connector's own marker (MCP_MARK_KEY), never
 * the export's skip tag, so the Drive pickup and the Snippet scan read it
 * in like a hand-dropped file (Matas, 26 Nov: "Yes, read them in."). A
 * retry finds the file it already placed (same source in the folder) and
 * places nothing.
 *
 * Writes only through ctx.folderIn (lib/mcp/folder-in-deps.ts).
 * Relative imports only (node:test).
 */
import { z } from "zod";
import { SCOPE_DRAFT } from "../config.ts";
import { scopeIncludes } from "../oauth/flow.ts";
import { mayUseFor, resolveDriveOwner } from "../../drive/file-owner.ts";
import { FOLDER_MIME, SHORTCUT_MIME } from "../../drive/client.ts";
import { loadLineupArtists } from "../../drive/lineup.ts";
import { PICKER_BUCKET } from "../../drive/picker.ts";
import { PICKER_MAX_IMAGE_BYTES, PICKER_MAX_VIDEO_BYTES } from "../../drive/picker-model.ts";
import { EVENT_WORDS } from "../meta/words.ts";
import { FOLDER_IN_DESCRIPTION, FOLDER_IN_WORDS as W } from "../folder-in/words.ts";
import { fileFits, resolveFolderId, resolveFolderPath, type MapRow, type Target } from "../folder-in/resolve.ts";
import { driveLink, placedFrom, placedProperties, sourceTag, type McpFolderDeps } from "../folder-in/place.ts";
import { ToolInputError, type Db, type McpTool, type ToolContext } from "../tool-types.ts";
import { loadEventByCode, normaliseCode } from "./shared.ts";

type EventLite = { id: string; user_id: string | null; client_id: string | null; event_code: string | null; drive_folder_id: string | null };

const EXT_MIME: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  webm: "video/webm",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aif: "audio/aiff",
  aiff: "audio/aiff",
  flac: "audio/flac",
  pdf: "application/pdf",
};

export function mimeFromName(name: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  return EXT_MIME[ext] ?? "application/octet-stream";
}

const baseName = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

function requireFolderIn(ctx: ToolContext): McpFolderDeps {
  if (!scopeIncludes(ctx.scope ?? "", SCOPE_DRAFT)) throw new ToolInputError(W.refusedScope, { refused: "insufficient_scope" });
  if (!ctx.folderIn) throw new Error("folder-in deps missing");
  return ctx.folderIn;
}

async function loadMap(db: Db, event: EventLite): Promise<MapRow[]> {
  const out: MapRow[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await db
      .from("drive_folders")
      .select("key, name, drive_folder_id, client_id, event_id")
      .eq("event_id", event.id)
      .order("key", { ascending: true })
      .range(from, from + 999);
    if (res.error) throw new ToolInputError(W.failed, { refused: "map_unreadable" });
    const rows = (res.data ?? []) as Array<MapRow & { client_id: string | null; event_id: string | null }>;
    // The show's own map only: its event and its client.
    out.push(...rows.filter((r) => r.event_id === event.id && (!event.client_id || r.client_id === event.client_id)));
    if (rows.length < 1000) break;
  }
  return out;
}

type StorageAsset = { storagePath: string; storageBucket: string; fileName: string; driveFileId: string | null };

/** The Storage file, only when it is a slot on one of this show's drafts the caller owns. */
async function storageAssetOnEvent(db: Db, eventId: string, userId: string, path: string): Promise<StorageAsset | null> {
  for (let from = 0; ; from += 1000) {
    const res = await db.from("campaign_drafts").select("id, draft_json").eq("event_id", eventId).eq("user_id", userId).order("id", { ascending: true }).range(from, from + 999);
    if (res.error) throw new ToolInputError(W.failed, { refused: "drafts_unreadable" });
    const rows = (res.data ?? []) as Array<{ draft_json: { creatives?: Array<{ assetVariations?: Array<{ assets?: Array<Record<string, unknown>> }> }> } | null }>;
    for (const row of rows) {
      for (const c of row.draft_json?.creatives ?? []) {
        for (const v of c.assetVariations ?? []) {
          for (const a of v.assets ?? []) {
            if (a.storagePath === path) {
              return {
                storagePath: path,
                storageBucket: typeof a.storageBucket === "string" && a.storageBucket ? a.storageBucket : PICKER_BUCKET,
                fileName: typeof a.fileName === "string" && a.fileName ? a.fileName : baseName(path),
                driveFileId: typeof a.driveFileId === "string" && a.driveFileId ? a.driveFileId : null,
              };
            }
          }
        }
      }
    }
    if (rows.length < 1000) break;
  }
  return null;
}

/**
 * The folder's Drive parents, walked up to the shared drive's root, pass
 * through the show's own event folder: the map's word alone isn't enough.
 */
async function underEventFolder(drive: NonNullable<ReturnType<McpFolderDeps["readDrive"]>>, folderId: string, eventFolderId: string): Promise<boolean> {
  let seen = false;
  let cursor: string | null = folderId;
  for (let depth = 0; cursor && depth < 20; depth += 1) {
    if (cursor === drive.driveId) return seen;
    if (cursor === eventFolderId) seen = true;
    const f = await drive.getFile(cursor);
    if (!f || f.trashed) return false;
    cursor = f.parents?.[0] ?? null;
  }
  return false;
}

/** own | artist_library, or a refusal in the record's words. */
async function checkRights(
  db: Db,
  drive: NonNullable<ReturnType<McpFolderDeps["readDrive"]>>,
  parentId: string | null,
  name: string,
  clientId: string | null,
): Promise<{ owner: "own" | "artist_library" }> {
  const owner = parentId ? await resolveDriveOwner(db as never, drive, parentId) : null;
  if (!owner?.inSharedDrive) throw new ToolInputError(W.refusedOwnerUnknown(name), { refused: "owner_unknown" });
  const use = mayUseFor(owner, clientId);
  if (use === "own" || use === "artist_library") return { owner: use };
  if (use === "other_client") {
    const res = await db.from("clients").select("name").in("id", owner.clientIds).limit(1);
    const other = ((res.data ?? []) as Array<{ name: string | null }>)[0]?.name ?? null;
    throw new ToolInputError(other ? W.refusedOtherClient(name, other) : W.refusedOtherClientUnnamed(name), { refused: "other_client" });
  }
  throw new ToolInputError(W.refusedOwnerUnknown(name), { refused: "owner_unknown" });
}

/** What happens next to a clip or a track (the pickup and the Snippet scan read it in); other folders say nothing more. */
function readInLine(target: { key: string; label: string }): string | null {
  const artist = target.label.split(/\s*\/\s*/).at(-1) ?? "";
  if (target.key.startsWith("02/artist-clips/")) return W.readInClip(artist);
  if (target.key.startsWith("02/audio/")) return W.readInTrack(artist);
  return null;
}

export const uploadToEventFolderTool: McpTool = {
  name: "upload_to_event_folder",
  title: "Put a file in a show's Drive folder",
  kind: "draft",
  readOnly: false,
  idempotent: true,
  failedText: W.failed,
  description: FOLDER_IN_DESCRIPTION,
  inputSchema: {
    event_code: z.string().min(2).max(40).describe('The event code, e.g. "ES27-ENZOSIRAGUSA".'),
    folder: z
      .string()
      .max(300)
      .optional()
      .describe('The folder in the show\'s tree: "01 Open files", "3 On sale", "02 Source / Artist clips / {artist}", "02 Source / Audio / {artist}" or "w/c {d Mon} / {owner} / Videos" (or Statics).'),
    folder_id: z.string().max(100).optional().describe("Or the folder's Drive id, when you have it from get_event or list_drive_creatives."),
    drive_file_id: z.string().max(100).optional().describe("A file in the Off/Pixel shared drive, copied in (the original stays where it is)."),
    storage_path: z.string().max(500).optional().describe("Or a Storage path of a file on one of this show's drafts (get_draft shows it)."),
    name: z.string().max(200).optional().describe("The new file's name; defaults to the source's."),
  },
  async run(ctx, args) {
    const deps = requireFolderIn(ctx);
    let code: string;
    try {
      code = normaliseCode(args.event_code);
    } catch {
      throw new ToolInputError(EVENT_WORDS.refusedCode, { refused: "bad_code" });
    }
    const driveFileId = typeof args.drive_file_id === "string" && args.drive_file_id.trim() ? args.drive_file_id.trim() : null;
    const storagePath = typeof args.storage_path === "string" && args.storage_path.trim() ? args.storage_path.trim() : null;
    if ((driveFileId ? 1 : 0) + (storagePath ? 1 : 0) !== 1) throw new ToolInputError(W.refusedSource, { code, refused: "source" });
    const folderText = typeof args.folder === "string" && args.folder.trim() ? args.folder.trim() : null;
    const folderId = typeof args.folder_id === "string" && args.folder_id.trim() ? args.folder_id.trim() : null;
    if ((folderText ? 1 : 0) + (folderId ? 1 : 0) !== 1) throw new ToolInputError(W.refusedFolder, { code, refused: "folder" });

    const found = await loadEventByCode(ctx.db, code);
    if (!found) throw new ToolInputError(EVENT_WORDS.refusedUnknown(code), { code, refused: "event_not_found" });
    const evRes = await ctx.db.from("events").select("id, user_id, client_id, event_code, drive_folder_id").eq("id", found.primary.id).maybeSingle();
    const event = evRes.data as EventLite | null;
    if (evRes.error || !event) throw new ToolInputError(EVENT_WORDS.refusedUnknown(code), { code, refused: "event_not_found" });
    if (event.user_id !== ctx.userId) throw new ToolInputError(EVENT_WORDS.refusedOtherAccount, { code, refused: "not_owner" });
    if (!event.drive_folder_id) throw new ToolInputError(W.refusedNoTree(code), { code, refused: "no_tree" });

    const drive = deps.readDrive();
    if (!drive) throw new ToolInputError(W.refusedNoDrive, { code, refused: "no_drive" });

    // ── The folder: the show's own map, then its Drive parents lead to the show ──
    const map = await loadMap(ctx.db, event);
    let target: Target;
    if (folderId) target = resolveFolderId(folderId, map, code);
    else {
      const lineup = await loadLineupArtists(ctx.db as never, event.id);
      target = resolveFolderPath(folderText!, map, lineup);
    }
    if (!target.ok) throw new ToolInputError(target.reason, { code, refused: target.refused });
    if (!(await underEventFolder(drive, target.folderId, event.drive_folder_id))) {
      throw new ToolInputError(W.refusedOutsideTree(code), { code, refused: "outside_tree", key: target.key });
    }

    // ── The source ──
    let name: string;
    let mimeType: string;
    let source: string;
    let rights: "own" | "artist_library";
    let storage: StorageAsset | null = null;
    if (driveFileId) {
      const file = await drive.getFile(driveFileId);
      if (!file || file.trashed) throw new ToolInputError(W.refusedSourceOutside(driveFileId), { code, refused: "source_outside" });
      if (file.mimeType === FOLDER_MIME || file.mimeType === SHORTCUT_MIME) throw new ToolInputError(W.refusedSourceFolder(driveFileId), { code, refused: "source_folder" });
      name = file.name;
      mimeType = file.mimeType;
      rights = (await checkRights(ctx.db, drive, file.parents?.[0] ?? null, file.name, event.client_id)).owner;
      source = sourceTag({ driveFileId });
    } else {
      storage = await storageAssetOnEvent(ctx.db, event.id, ctx.userId, storagePath!);
      if (!storage) throw new ToolInputError(W.refusedStorage, { code, refused: "storage_not_on_event" });
      name = storage.fileName;
      mimeType = mimeFromName(storage.fileName);
      if (storage.driveFileId) {
        // Copied in from Drive once: whose it was decides, as for a Drive file.
        const original = await drive.getFile(storage.driveFileId);
        rights = (await checkRights(ctx.db, drive, original?.parents?.[0] ?? null, name, event.client_id)).owner;
      } else rights = "own"; // uploaded onto this show's own draft
      source = sourceTag({ storagePath: storage.storagePath });
    }
    if (!fileFits(target.takes, mimeType)) {
      throw new ToolInputError(W.refusedKind(name, target.label, W.want[target.takes === "static" ? "static" : target.takes] ?? ""), { code, refused: "kind", takes: target.takes });
    }
    const newName = typeof args.name === "string" && args.name.trim() ? args.name.trim() : name;

    // ── A retry places nothing: the folder already holds this source's copy ──
    const already = (await drive.listChildren(target.folderId, { name: newName })).find(
      (f) => placedFrom(f, source),
    );
    if (already) {
      return {
        data: { event: code, folder: target.label, fileId: already.id, link: driveLink(already), placed: false, message: W.already(newName, target.label, driveLink(already)) },
        eventId: event.id,
        clientId: event.client_id,
        summary: { code, key: target.key, fileId: already.id, placed: false, from: driveFileId ? "drive" : "storage", rights },
      };
    }

    const appProperties = placedProperties(event.id, source);
    let placed;
    try {
      if (driveFileId) {
        placed = await deps.copyInto({ fileId: driveFileId, parentId: target.folderId, name: newName, appProperties });
      } else {
        const bytes = await deps.downloadStorage(storage!.storageBucket, storage!.storagePath);
        const cap = mimeType.startsWith("image/") ? PICKER_MAX_IMAGE_BYTES : PICKER_MAX_VIDEO_BYTES;
        if (bytes.byteLength > cap) throw new ToolInputError(W.refusedTooLarge(newName, Math.round(cap / (1024 * 1024))), { code, refused: "too_large" });
        placed = await deps.uploadInto({ parentId: target.folderId, name: newName, mimeType, bytes, appProperties });
      }
    } catch (e) {
      if (e instanceof ToolInputError) throw e;
      throw new ToolInputError(W.failed, { code, refused: "write_failed", key: target.key, error: e instanceof Error ? e.message.slice(0, 200) : "error" });
    }
    return {
      data: {
        event: code,
        folder: target.label,
        fileId: placed.id,
        link: driveLink(placed),
        placed: true,
        message: [W.done(newName, target.label, driveLink(placed)), readInLine(target)].filter(Boolean).join(" "),
      },
      eventId: event.id,
      clientId: event.client_id,
      summary: { code, key: target.key, fileId: placed.id, placed: true, from: driveFileId ? "drive" : "storage", rights },
    };
  },
};
