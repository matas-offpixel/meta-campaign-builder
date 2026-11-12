/**
 * Creates the client and event trees (S19, HS13) and keeps the folder map
 * (drive_folders, migration 218) in step with them.
 *
 * Idempotent: the map is read first; a key the map doesn't have is looked
 * up in Drive by exact name under its parent before anything is created, so
 * a rerun or a half-finished run never makes a second folder. Archived
 * clients get nothing new (S27). A cancelled event is marked, never deleted.
 */

import { isArchivedClientStatus } from "../db/client-status.ts";
import type { DriveApi } from "./client.ts";
import type { DriveDb, RowOf } from "./db.ts";
import {
  ARTIST_CLIPS_KEY,
  CLIENT_KEY,
  EVENT_KEY,
  EVENT_TREE,
  clientFolderName,
  clientSpecs,
  cycleSpecs,
  eventFolderName,
  isCancelled,
  parseOwnerKey,
  specFor,
  type FolderKey,
  type FolderSpec,
} from "./tree.ts";

export type { DriveDb } from "./db.ts";

/** The client and event fields the tree reads and writes. */
export type ClientRow = Pick<RowOf<"clients">, "id" | "name" | "status" | "drive_folder_id">;
export type EventRow = Pick<
  RowOf<"events">,
  "id" | "client_id" | "name" | "event_code" | "event_date" | "status" | "drive_folder_id" | "drive_folder_linked" | "drive_cancel_marked_at"
>;

type MapRow = Pick<RowOf<"drive_folders">, "client_id" | "event_id" | "key" | "name" | "drive_folder_id">;

export type TreeLog = { created: string[]; found: string[]; renamed: string[] };

export function emptyLog(): TreeLog {
  return { created: [], found: [], renamed: [] };
}

async function loadMap(db: DriveDb, clientId: string, eventId: string | null): Promise<Map<FolderKey, MapRow>> {
  const query = db.from("drive_folders").select("client_id, event_id, key, name, drive_folder_id").eq("client_id", clientId);
  const res = await (eventId ? query.eq("event_id", eventId) : query);
  if (res.error) throw new Error(`drive_folders: ${res.error.message}`);
  const rows = ((res.data ?? []) as MapRow[]).filter((row) => (eventId ? row.event_id === eventId : row.event_id == null));
  return new Map(rows.map((row) => [row.key, row]));
}

async function remember(db: DriveDb, row: MapRow): Promise<void> {
  const res = await db.from("drive_folders").upsert(row, { onConflict: "client_id,event_id,key" });
  if (res.error) throw new Error(`drive_folders upsert: ${res.error.message}`);
}

/** Find a folder by exact name under the parent, else create it. */
export async function findOrCreateFolder(drive: DriveApi, parentId: string, name: string, log: TreeLog, label: string): Promise<string> {
  const existing = await drive.listChildren(parentId, { name, foldersOnly: true });
  if (existing[0]) {
    log.found.push(label);
    return existing[0].id;
  }
  const made = await drive.createFolder(parentId, name);
  log.created.push(label);
  return made.id;
}

type Scope = {
  db: DriveDb;
  drive: DriveApi;
  clientId: string;
  eventId: string | null;
  map: Map<FolderKey, MapRow>;
  log: TreeLog;
  /** id of the parent of the scope's root key (Shared Drive root, or the client folder). */
  rootParentId: string;
  label: (spec: FolderSpec) => string;
  /** Keys whose Drive name is never changed: a linked event folder (S24). */
  keepName?: ReadonlySet<FolderKey>;
};

async function ensureSpec(scope: Scope, spec: FolderSpec, parentId: string): Promise<string> {
  const known = scope.map.get(spec.key);
  if (known) {
    if (known.name !== spec.name && !scope.keepName?.has(spec.key)) {
      await scope.drive.update(known.drive_folder_id, { name: spec.name });
      scope.log.renamed.push(`${scope.label(spec)} (was ${known.name})`);
      const row = { ...known, name: spec.name };
      await remember(scope.db, row);
      scope.map.set(spec.key, row);
    }
    return known.drive_folder_id;
  }
  const id = await findOrCreateFolder(scope.drive, parentId, spec.name, scope.log, scope.label(spec));
  const row: MapRow = { client_id: scope.clientId, event_id: scope.eventId, key: spec.key, name: spec.name, drive_folder_id: id };
  await remember(scope.db, row);
  scope.map.set(spec.key, row);
  return id;
}

async function ensureSpecs(scope: Scope, specs: readonly FolderSpec[], rootKey: FolderKey, rootSpec: FolderSpec): Promise<Map<FolderKey, string>> {
  const ids = new Map<FolderKey, string>();
  ids.set(rootKey, await ensureSpec(scope, rootSpec, scope.rootParentId));
  for (const spec of specs) {
    const parentId = spec.parent ? ids.get(spec.parent) ?? scope.map.get(spec.parent)?.drive_folder_id : undefined;
    if (!parentId) throw new Error(`folder ${spec.key} has no parent ${spec.parent}`);
    ids.set(spec.key, await ensureSpec(scope, spec, parentId));
  }
  return ids;
}

/**
 * {Client}/ and _Brand kit. Returns the client folder id, or null for an
 * archived client (no folder is ever created for one; existing ones stay).
 */
export async function ensureClientTree(db: DriveDb, drive: DriveApi, client: ClientRow, log: TreeLog = emptyLog()): Promise<string | null> {
  if (isArchivedClientStatus(client.status)) return client.drive_folder_id ?? null;
  const map = await loadMap(db, client.id, null);
  if (client.drive_folder_id && !map.has(CLIENT_KEY)) {
    map.set(CLIENT_KEY, { client_id: client.id, event_id: null, key: CLIENT_KEY, name: clientFolderName(client), drive_folder_id: client.drive_folder_id });
  }
  const [root, ...rest] = clientSpecs(client);
  const scope: Scope = { db, drive, clientId: client.id, eventId: null, map, log, rootParentId: drive.driveId, label: (spec) => (spec.key === CLIENT_KEY ? spec.name : labelFor([client.name], spec)) };
  const ids = await ensureSpecs(scope, rest, CLIENT_KEY, root);
  const folderId = ids.get(CLIENT_KEY)!;
  if (client.drive_folder_id !== folderId) {
    const res = await db.from("clients").update({ drive_folder_id: folderId }).eq("id", client.id);
    if (res.error) throw new Error(`clients update: ${res.error.message}`);
    client.drive_folder_id = folderId;
  }
  return folderId;
}

/** The folder's full path under the Shared Drive, for logs and the backfill printout. */
function labelFor(prefix: string[], spec: FolderSpec): string {
  const names = [spec.name];
  for (let parent = spec.parent; parent && parent !== EVENT_KEY && parent !== CLIENT_KEY; ) {
    const up = specFor(parent);
    if (!up) break;
    names.unshift(up.name);
    parent = up.parent;
  }
  return [...prefix, ...names].join(" / ");
}

export type EnsureEventResult = { folderId: string | null; skipped: "archived_client" | "cancelled" | "no_client" | null };

/**
 * The event folder and every folder but the w/c ones (S19). A linked folder
 * (drive_folder_linked) is used as it is: the tree's folders are added inside
 * it, nothing is renamed or moved (S24). A cancelled event gets no new tree.
 */
export async function ensureEventTree(
  db: DriveDb,
  drive: DriveApi,
  event: EventRow,
  client: ClientRow | null,
  log: TreeLog = emptyLog(),
): Promise<EnsureEventResult> {
  if (!client || !event.client_id) return { folderId: null, skipped: "no_client" };
  if (isArchivedClientStatus(client.status)) return { folderId: event.drive_folder_id ?? null, skipped: "archived_client" };
  // A cancelled event gets no new folders; an existing one only gets the mark (markCancelled).
  if (isCancelled(event.status)) return { folderId: event.drive_folder_id ?? null, skipped: "cancelled" };
  const clientFolder = await ensureClientTree(db, drive, client, log);
  if (!clientFolder) return { folderId: null, skipped: "archived_client" };

  const map = await loadMap(db, client.id, event.id);
  const name = eventFolderName({ ...event, status: null });
  if (event.drive_folder_id && !map.has(EVENT_KEY)) {
    // Linked, or created before the map: seed the map with the folder as it is.
    map.set(EVENT_KEY, { client_id: client.id, event_id: event.id, key: EVENT_KEY, name, drive_folder_id: event.drive_folder_id });
  }
  const rootSpec: FolderSpec = { key: EVENT_KEY, parent: null, name, level: "event" };
  const scope: Scope = {
    db,
    drive,
    clientId: client.id,
    eventId: event.id,
    map,
    log,
    rootParentId: clientFolder,
    label: (spec) => labelFor(spec.key === EVENT_KEY ? [client.name] : [client.name, name], spec),
    keepName: event.drive_folder_linked ? new Set([EVENT_KEY]) : undefined,
  };
  const ids = await ensureSpecs(scope, EVENT_TREE, EVENT_KEY, rootSpec);
  const folderId = ids.get(EVENT_KEY)!;
  if (event.drive_folder_id !== folderId) {
    const res = await db.from("events").update({ drive_folder_id: folderId }).eq("id", event.id);
    if (res.error) throw new Error(`events update: ${res.error.message}`);
    event.drive_folder_id = folderId;
  }
  return { folderId, skipped: null };
}

/** The folder id for a key, creating it (and its w/c parent) when the tree has none. */
export async function ensureEventKey(
  db: DriveDb,
  drive: DriveApi,
  event: EventRow,
  client: ClientRow,
  key: FolderKey,
  log: TreeLog = emptyLog(),
): Promise<string> {
  const map = await loadMap(db, client.id, event.id);
  const hit = map.get(key);
  if (hit) return hit.drive_folder_id;
  const spec = specFor(key);
  if (!spec) throw new Error(`unknown folder key ${key}`);
  const chain: FolderSpec[] = [];
  for (let cursor: FolderSpec | null = spec; cursor && !map.has(cursor.key); cursor = cursor.parent && cursor.parent !== EVENT_KEY ? specFor(cursor.parent) : null) {
    chain.unshift(cursor);
  }
  const eventFolder = map.get(EVENT_KEY)?.drive_folder_id ?? event.drive_folder_id;
  if (!eventFolder) throw new Error("the event has no Drive folder");
  const name = eventFolderName({ ...event, status: null });
  const scope: Scope = {
    db,
    drive,
    clientId: client.id,
    eventId: event.id,
    map,
    log,
    rootParentId: eventFolder,
    label: (s) => labelFor([client.name, name], s),
  };
  let id = "";
  for (const link of chain) {
    const parentId = link.parent === EVENT_KEY ? eventFolder : map.get(link.parent!)?.drive_folder_id;
    if (!parentId) throw new Error(`folder ${link.key} has no parent ${link.parent}`);
    id = await ensureSpec(scope, link, parentId);
  }
  return id;
}

/** 02 Source / Artist clips / {artist}, keyed by the library artist id so a rename keeps the key. */
export function artistClipsKey(libraryArtistId: string): FolderKey {
  return `${ARTIST_CLIPS_KEY}/${libraryArtistId}`;
}

/**
 * One Artist clips/{artist} folder per lineup artist, named as the lineup
 * writes the name (S22 matches folder names exactly). Map-first: a folder the
 * map already holds costs no Drive call; a renamed artist renames its folder.
 * A removed artist's folder stays. Nothing for a cancelled event or an
 * archived client, or before the event has a tree.
 */
export async function ensureArtistFolders(
  db: DriveDb,
  drive: DriveApi,
  event: EventRow,
  client: ClientRow,
  artists: readonly { libraryArtistId: string; name: string }[],
  log: TreeLog = emptyLog(),
): Promise<string[]> {
  if (isArchivedClientStatus(client.status) || isCancelled(event.status) || !event.drive_folder_id || !artists.length) return [];
  const parentId = await ensureEventKey(db, drive, event, client, ARTIST_CLIPS_KEY, log);
  const map = await loadMap(db, client.id, event.id);
  const name = eventFolderName({ ...event, status: null });
  const scope: Scope = {
    db,
    drive,
    clientId: client.id,
    eventId: event.id,
    map,
    log,
    rootParentId: event.drive_folder_id,
    label: (spec) => labelFor([client.name, name], spec),
  };
  const ids: string[] = [];
  for (const artist of artists) {
    const folderName = artist.name;
    if (!folderName.trim()) continue;
    const spec: FolderSpec = { key: artistClipsKey(artist.libraryArtistId), parent: ARTIST_CLIPS_KEY, name: folderName, level: "event" };
    ids.push(await ensureSpec(scope, spec, parentId));
  }
  return ids;
}

/**
 * The stage, owner and type folders a filing needs (D5): the stage through
 * the tree, then {owner} and {Videos | Statics} under it, parent first, each
 * recorded in the map under its stable key. Map-first, then found by exact
 * name, then created — never ahead of a filing. A known owner folder whose
 * name the record now gives differently (a Lab or client rename) is renamed.
 */
export async function ensureRouteFolder(
  db: DriveDb,
  drive: DriveApi,
  event: EventRow,
  client: ClientRow,
  route: { stageKey: FolderKey; owner: FolderSpec; type: FolderSpec },
  log: TreeLog = emptyLog(),
): Promise<string> {
  const stageId = await ensureEventKey(db, drive, event, client, route.stageKey, log);
  const map = await loadMap(db, client.id, event.id);
  const stageLabel = labelFor([client.name, eventFolderName({ ...event, status: null })], specFor(route.stageKey)!);
  const scope: Scope = {
    db,
    drive,
    clientId: client.id,
    eventId: event.id,
    map,
    log,
    rootParentId: stageId,
    label: (spec) => (spec.key === route.owner.key ? `${stageLabel} / ${route.owner.name}` : `${stageLabel} / ${route.owner.name} / ${spec.name}`),
  };
  const ownerId = await ensureSpec(scope, route.owner, stageId);
  return ensureSpec(scope, route.type, ownerId);
}

/**
 * Renames follow (D5): every owner folder of the event, in every stage and
 * cycle, takes the name its key's owner has today. Type folders and files
 * never change. An owner whose name can't be read today (an artist off the
 * lineup) keeps the folder as it is. Reads the map only; Drive is called just
 * for a folder whose name changed.
 */
export async function renameOwnerFolders(
  db: DriveDb,
  drive: DriveApi,
  event: EventRow,
  client: ClientRow,
  nameOf: (owner: { kind: "artist"; artistId: string } | { kind: "promoter" }) => Promise<string | null>,
  log: TreeLog = emptyLog(),
): Promise<number> {
  const map = await loadMap(db, client.id, event.id);
  let renamed = 0;
  for (const row of map.values()) {
    const parts = parseOwnerKey(row.key);
    if (!parts || parts.type) continue;
    const name = await nameOf(parts.owner);
    if (!name || name === row.name) continue;
    await drive.update(row.drive_folder_id, { name });
    await remember(db, { ...row, name });
    log.renamed.push(`${name} (was ${row.name})`);
    renamed += 1;
  }
  return renamed;
}

/** w/c {d Mon}, made empty: its owner folders come with its first filing (D3, D5). */
export async function ensureCycleFolder(
  db: DriveDb,
  drive: DriveApi,
  event: EventRow,
  client: ClientRow,
  monday: string,
  log: TreeLog = emptyLog(),
): Promise<void> {
  for (const spec of cycleSpecs(monday)) await ensureEventKey(db, drive, event, client, spec.key, log);
}

/**
 * A cancelled event's folder gains " (cancelled)" once; nothing is deleted
 * (S27). Returns true when it renamed. A linked folder is marked too: the
 * mark is the one rename S27 asks for.
 */
export async function markCancelled(db: DriveDb, drive: DriveApi, event: EventRow, log: TreeLog = emptyLog()): Promise<boolean> {
  if (!isCancelled(event.status) || !event.drive_folder_id || event.drive_cancel_marked_at) return false;
  const marked = eventFolderName(event);
  await drive.update(event.drive_folder_id, { name: marked, description: "Cancelled. Filing into this folder has stopped. Nothing was deleted." });
  if (event.client_id) {
    const map = await loadMap(db, event.client_id, event.id);
    const row = map.get(EVENT_KEY);
    if (row) await remember(db, { ...row, name: marked });
  }
  const res = await db.from("events").update({ drive_cancel_marked_at: new Date().toISOString() }).eq("id", event.id);
  if (res.error) throw new Error(`events update: ${res.error.message}`);
  log.renamed.push(`${marked} (cancelled)`);
  return true;
}
