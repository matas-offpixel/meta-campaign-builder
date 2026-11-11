/**
 * The one-off move to owner first, then type (D6, HD5 of
 * 2026-11-11-creative-lab-drive-owner-type).
 *
 * For each cycle of an event (03 Creatives / 3 On sale / w/c {d Mon}) that
 * still has its retired Content folder: every folder in Content named exactly
 * for an owner (a Lab artist under their lineup name, or the promoter under
 * the client's name / "{Client} (promoter)") is moved up under the cycle as
 * the folder itself, so its id and any link already shared still work. Inside
 * each owner folder, every loose file goes into Statics (an image) or Videos
 * (a video), the type folder made when the first file needs it. Both owner and
 * type folders are recorded in drive_folders under their D5 keys.
 *
 * Moves only: never a rename, a trash, a delete or a permission change. UGC,
 * Ticket warnings and the emptied Content stay. A folder in Content that names
 * no owner, and a file that is neither image nor video, are left and listed.
 * Safe to run twice: what is already in place is skipped, so a second run
 * moves nothing. Dry run (apply false) only lists — no Drive or database
 * write at all.
 */

import { FOLDER_MIME, type DriveApi, type DriveFile } from "./client.ts";
import { rowsWhere, type DriveDb, type RowOf } from "./db.ts";
import { labArtistFolderName } from "./owner.ts";
import { loadLineupArtists } from "./lineup.ts";
import { kindForFile, ownerFolderName, ownerKey, promoterOwner, typeKey, type DriveOwner, type FolderKey } from "./tree.ts";

type MapRow = RowOf<"drive_folders">;

export type OwnerMoveLine =
  | { op: "move-folder"; id: string; from: string; to: string }
  | { op: "make-folder"; path: string; key: FolderKey }
  | { op: "move-file"; id: string; from: string; to: string }
  | { op: "map"; key: FolderKey; path: string }
  | { op: "left"; path: string; why: string };

export type OwnerMoveResult = { apply: boolean; lines: OwnerMoveLine[]; folderMoves: number; fileMoves: number; made: number };

const CYCLE = /^03\/3\/wc\/(\d{4}-\d{2}-\d{2})$/;

/** Every owner this event can have, by the exact folder name D1 gives them. */
async function ownersByName(db: DriveDb, event: Pick<RowOf<"events">, "id">, client: Pick<RowOf<"clients">, "id" | "name">): Promise<Map<string, DriveOwner>> {
  const out = new Map<string, DriveOwner>();
  const lineup = (await loadLineupArtists(db, event.id)).map((artist) => artist.name);
  for (const lab of await rowsWhere(db, "creative_lab_artists", "client_id", client.id)) {
    const owner: DriveOwner = { kind: "artist", artistId: lab.id, name: await labArtistFolderName(db, lab) };
    if (!out.has(owner.name)) out.set(owner.name, owner);
  }
  const promoter = promoterOwner(client.name, lineup);
  out.set(ownerFolderName(promoter), promoter);
  return out;
}

export async function migrateOwnerType(
  db: DriveDb,
  drive: DriveApi,
  event: Pick<RowOf<"events">, "id">,
  client: Pick<RowOf<"clients">, "id" | "name">,
  opts: { apply: boolean },
): Promise<OwnerMoveResult> {
  if (opts.apply && !drive.moveFile) throw new Error("this Drive client cannot move files");
  const result: OwnerMoveResult = { apply: opts.apply, lines: [], folderMoves: 0, fileMoves: 0, made: 0 };
  const map = new Map((await rowsWhere(db, "drive_folders", "event_id", event.id)).map((row) => [row.key, row]));
  const owners = await ownersByName(db, event, client);
  const remember = async (row: Pick<MapRow, "key" | "name" | "drive_folder_id">, path: string) => {
    const known = map.get(row.key);
    if (known && known.drive_folder_id === row.drive_folder_id && known.name === row.name) return;
    result.lines.push({ op: "map", key: row.key, path });
    if (!opts.apply) return;
    const full = { client_id: client.id, event_id: event.id, ...row };
    const res = await db.from("drive_folders").upsert(full, { onConflict: "client_id,event_id,key" });
    if (res.error) throw new Error(`drive_folders upsert: ${res.error.message}`);
    map.set(row.key, { ...(known ?? ({} as MapRow)), ...full });
  };

  const cycles = [...map.values()].filter((row) => CYCLE.test(row.key)).sort((a, b) => a.key.localeCompare(b.key));
  for (const cycle of cycles) {
    const cyclePath = `03 Creatives / 3 On sale / ${cycle.name}`;
    const content = map.get(`${cycle.key}/content`);
    const inCycle = await drive.listChildren(cycle.drive_folder_id, { foldersOnly: true });

    // 1. Owner folders still in Content move up, as themselves.
    const ownerFolders: { folder: DriveFile; owner: DriveOwner; parentId: string }[] = [];
    if (content) {
      for (const folder of await drive.listChildren(content.drive_folder_id, { foldersOnly: true })) {
        const owner = owners.get(folder.name);
        if (!owner) {
          result.lines.push({ op: "left", path: `${cyclePath} / Content / ${folder.name}`, why: "names no owner exactly" });
          continue;
        }
        if (inCycle.some((other) => other.name === folder.name)) {
          result.lines.push({ op: "left", path: `${cyclePath} / Content / ${folder.name}`, why: `w/c already has a folder named ${folder.name}` });
          continue;
        }
        result.lines.push({ op: "move-folder", id: folder.id, from: `${cyclePath} / Content / ${folder.name}`, to: `${cyclePath} / ${folder.name}` });
        if (opts.apply) await drive.moveFile!(folder.id, content.drive_folder_id, cycle.drive_folder_id);
        result.folderMoves += 1;
        ownerFolders.push({ folder, owner, parentId: cycle.drive_folder_id });
      }
    }
    // A second run: the owner folders are already under the cycle.
    for (const folder of inCycle) {
      const owner = owners.get(folder.name);
      if (owner && !ownerFolders.some((entry) => entry.folder.id === folder.id)) ownerFolders.push({ folder, owner, parentId: cycle.drive_folder_id });
    }

    // 2. Loose files go into Statics or Videos inside their owner folder.
    for (const { folder, owner } of ownerFolders) {
      const ownerPath = `${cyclePath} / ${folder.name}`;
      const oKey = ownerKey(cycle.key, owner);
      await remember({ key: oKey, name: folder.name, drive_folder_id: folder.id }, ownerPath);
      const children = await drive.listChildren(folder.id);
      const typeFolders = new Map(children.filter((child) => child.mimeType === FOLDER_MIME).map((child) => [child.name, child.id]));
      for (const kind of ["static", "video"] as const) {
        const name = kind === "static" ? "Statics" : "Videos";
        const existing = typeFolders.get(name);
        if (existing) await remember({ key: typeKey(oKey, kind), name, drive_folder_id: existing }, `${ownerPath} / ${name}`);
      }
      for (const file of children.filter((child) => child.mimeType !== FOLDER_MIME)) {
        const kind = kindForFile(file);
        if (!kind) {
          result.lines.push({ op: "left", path: `${ownerPath} / ${file.name}`, why: `neither image nor video (${file.mimeType || "no type"})` });
          continue;
        }
        const name = kind === "static" ? "Statics" : "Videos";
        let typeId = typeFolders.get(name) ?? null;
        if (!typeId) {
          result.lines.push({ op: "make-folder", path: `${ownerPath} / ${name}`, key: typeKey(oKey, kind) });
          result.made += 1;
          typeId = opts.apply ? (await drive.createFolder(folder.id, name)).id : `new:${oKey}/${name}`;
          typeFolders.set(name, typeId);
          await remember({ key: typeKey(oKey, kind), name, drive_folder_id: typeId }, `${ownerPath} / ${name}`);
        }
        result.lines.push({ op: "move-file", id: file.id, from: `${ownerPath} / ${file.name}`, to: `${ownerPath} / ${name} / ${file.name}` });
        if (opts.apply) await drive.moveFile!(file.id, folder.id, typeId);
        result.fileMoves += 1;
      }
    }
  }
  return result;
}

export function formatOwnerMoveLine(line: OwnerMoveLine): string {
  switch (line.op) {
    case "move-folder":
      return `move folder  ${line.from}  →  ${line.to}  (id ${line.id}, unchanged)`;
    case "make-folder":
      return `make folder  ${line.path}  [${line.key}]`;
    case "move-file":
      return `move file    ${line.from}  →  ${line.to}`;
    case "map":
      return `map          ${line.key}  =  ${line.path}`;
    case "left":
      return `left         ${line.path}  (${line.why})`;
  }
}
