/**
 * D6, done in place (Matas, 11 Nov 2026): record an event's existing
 * {owner} / Videos | Statics folders in the folder map, where they already
 * are, so later filings land inside them.
 *
 * Why in place, not a move: the client already holds the link to P26-BDAY's
 * w/c 9 Nov / Content, so Content / {owner} has to stay where it is for that
 * link to keep showing it. D6's intent — shared links survive — is kept by
 * mapping, not moving. Future cycles follow D1–D5 as built (no Content).
 *
 * For each cycle the map holds (03/3/wc/{date}) with a Content row: each
 * folder in Content named exactly for an owner (a Lab artist under their
 * lineup name, or the promoter under the client's name / "{Client}
 * (promoter)") is mapped to {cycle}/owner/{artist:id|promoter}, and its
 * Videos / Statics children to …/videos and …/statics. A mapping is recorded
 * only when the folder really is there: listed under the right parent, with
 * the expected name, not trashed. A key the map already holds for another
 * folder is reported and left. The Content row itself is checked and left.
 *
 * Map only: no move, no folder made, no rename, no trash, no permission. The
 * Drive client this takes has no move call at all. Dry run (apply false)
 * reads only. Safe to run twice: a mapping already recorded is not
 * recorded again.
 */

import { FOLDER_MIME, type DriveApi } from "./client.ts";
import { rowsWhere, type DriveDb, type RowOf } from "./db.ts";
import { loadLineupArtists } from "./lineup.ts";
import { labArtistFolderName } from "./owner.ts";
import { ownerFolderName, ownerKey, promoterOwner, typeKey, type DriveOwner, type FolderKey } from "./tree.ts";

type MapRow = RowOf<"drive_folders">;

export type OwnerMapLine =
  | { op: "map"; key: FolderKey; id: string; path: string }
  | { op: "mapped"; key: FolderKey; id: string; path: string }
  | { op: "content"; key: FolderKey; id: string; path: string; ok: boolean; why: string | null }
  | { op: "conflict"; key: FolderKey; id: string; mappedTo: string; path: string }
  | { op: "left"; path: string; why: string };

export type OwnerMapResult = { apply: boolean; lines: OwnerMapLine[]; mappings: number; moves: 0 };

const CYCLE = /^03\/3\/wc\/(\d{4}-\d{2}-\d{2})$/;

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

export async function mapOwnerTypeInPlace(
  db: DriveDb,
  drive: DriveApi,
  event: Pick<RowOf<"events">, "id">,
  client: Pick<RowOf<"clients">, "id" | "name">,
  opts: { apply: boolean },
): Promise<OwnerMapResult> {
  const result: OwnerMapResult = { apply: opts.apply, lines: [], mappings: 0, moves: 0 };
  const map = new Map((await rowsWhere(db, "drive_folders", "event_id", event.id)).map((row) => [row.key, row]));
  const byFolder = new Map([...map.values()].map((row) => [row.drive_folder_id, row]));
  const owners = await ownersByName(db, event, client);

  const record = async (key: FolderKey, id: string, name: string, path: string) => {
    const known = map.get(key);
    if (known && known.drive_folder_id === id) {
      result.lines.push({ op: "mapped", key, id, path });
      return;
    }
    if (known) {
      result.lines.push({ op: "conflict", key, id, mappedTo: known.drive_folder_id, path });
      return;
    }
    const other = byFolder.get(id);
    if (other) {
      result.lines.push({ op: "conflict", key, id, mappedTo: `${other.key} already holds this folder`, path });
      return;
    }
    result.lines.push({ op: "map", key, id, path });
    result.mappings += 1;
    if (!opts.apply) return;
    const row = { client_id: client.id, event_id: event.id, key, name, drive_folder_id: id };
    const res = await db.from("drive_folders").upsert(row, { onConflict: "client_id,event_id,key" });
    if (res.error) throw new Error(`drive_folders upsert: ${res.error.message}`);
    map.set(key, { ...(row as unknown as MapRow) });
    byFolder.set(id, row as unknown as MapRow);
  };

  const cycles = [...map.values()].filter((row) => CYCLE.test(row.key)).sort((a, b) => a.key.localeCompare(b.key));
  for (const cycle of cycles) {
    const cyclePath = `03 Creatives / 3 On sale / ${cycle.name}`;
    const contentKey = `${cycle.key}/content`;
    const content = map.get(contentKey);
    if (!content) continue;
    // The client's link: it must still be this cycle's Content, and it is left as it is.
    const live = await drive.getFile(content.drive_folder_id);
    const why = !live
      ? "the folder is gone or the export account can't see it"
      : live.trashed
        ? "the folder is in the trash"
        : !live.parents?.includes(cycle.drive_folder_id)
          ? "the folder is no longer inside this cycle"
          : live.name !== "Content"
            ? `the folder is named ${live.name}`
            : null;
    result.lines.push({ op: "content", key: contentKey, id: content.drive_folder_id, path: `${cyclePath} / Content`, ok: why === null, why });
    if (why) continue;

    for (const folder of await drive.listChildren(content.drive_folder_id, { foldersOnly: true })) {
      const ownerPath = `${cyclePath} / Content / ${folder.name}`;
      const owner = owners.get(folder.name);
      if (!owner) {
        result.lines.push({ op: "left", path: ownerPath, why: "names no owner exactly" });
        continue;
      }
      const oKey = ownerKey(cycle.key, owner);
      await record(oKey, folder.id, folder.name, ownerPath);
      const children = await drive.listChildren(folder.id);
      for (const child of children) {
        if (child.mimeType === FOLDER_MIME && (child.name === "Videos" || child.name === "Statics")) {
          await record(typeKey(oKey, child.name === "Videos" ? "video" : "static"), child.id, child.name, `${ownerPath} / ${child.name}`);
        } else if (child.mimeType === FOLDER_MIME) {
          result.lines.push({ op: "left", path: `${ownerPath} / ${child.name}`, why: "not Videos or Statics" });
        } else {
          result.lines.push({ op: "left", path: `${ownerPath} / ${child.name}`, why: "a file outside Videos / Statics — not moved" });
        }
      }
    }
  }
  return result;
}

export function formatOwnerMapLine(line: OwnerMapLine): string {
  switch (line.op) {
    case "map":
      return `map       ${line.key}  =  ${line.path}  (${line.id})`;
    case "mapped":
      return `mapped    ${line.key}  =  ${line.path}  (${line.id}, already recorded)`;
    case "content":
      return line.ok
        ? `content   ${line.key}  =  ${line.path}  (${line.id}, the client's link — left as it is)`
        : `content   ${line.key}  (${line.id}) NOT CHECKED OUT: ${line.why} — nothing mapped under it`;
    case "conflict":
      return `conflict  ${line.key}  =  ${line.path}  (${line.id}) — map has ${line.mappedTo}; not recorded`;
    case "left":
      return `left      ${line.path}  (${line.why})`;
  }
}
