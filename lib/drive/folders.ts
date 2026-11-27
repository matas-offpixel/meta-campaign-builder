/**
 * Creates the client and event trees (S19, HS13) and keeps the folder map
 * (drive_folders, migration 218) in step with them.
 *
 * Idempotent: the map is read first; a key the map doesn't have is looked
 * up in Drive by exact name under its parent before anything is created, so
 * a rerun or a half-finished run never makes a second folder. Archived
 * clients get nothing new (S27). A cancelled event is marked, never deleted.
 *
 * One builder per key (27 Nov): find-before-create alone isn't safe against
 * a second run walking the same tree at the same time, because Drive's list
 * can miss a folder made under a second before. So a run claims the key in
 * drive_folder_claims (migration 278) before it looks the folder up; only the
 * run holding the claim may create it, and it writes drive_folders before it
 * lets the claim go. A run that loses waits and re-reads the map. A claim
 * older than claimTiming.ttlMs is a crashed run's and is taken over.
 *
 * Every folder the app makes is tagged (appProperties): the tree's with
 * offpixel_kind = tree and offpixel_id = {event or client id}:{key}.
 */

import { randomUUID } from "node:crypto";

import { isArchivedClientStatus } from "../db/client-status.ts";
import { APP_ID_KEY, APP_TAG_KEY, type DriveApi, type DriveFile } from "./client.ts";
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

/** offpixel_kind of a tree folder. */
export const TREE_TAG = "tree";

/** The tag on a tree folder: offpixel_kind = tree, offpixel_id = {event or client id}:{key}. */
export function treeTag(ownerId: string, key: FolderKey): Record<string, string> {
  return { [APP_TAG_KEY]: TREE_TAG, [APP_ID_KEY]: `${ownerId}:${key}` };
}

/** The tag on a folder made outside the map (an upload's artist folder, the artist library). */
export const FOLDER_TAG: Readonly<Record<string, string>> = { [APP_TAG_KEY]: "folder" };

/** A claim older than this is a crashed run's (migration 278). pollMs is a loser's wait between map reads. */
export const claimTiming = { ttlMs: 60_000, pollMs: 250 };

/**
 * When a claim never clears. Ruled by design 27 Nov: it reaches the event
 * page's Drive panel error slot, and Claude through upload_to_event_folder /
 * render_package. Pinned in lib/drive/__tests__/tree-lock.test.ts.
 */
export const TREE_BUSY = "Off/Pixel is already making this event’s Drive folders. Try again in a minute.";

type ClaimKey = { client_id: string; event_id: string | null; key: FolderKey };

async function readMapRow(db: DriveDb, k: ClaimKey): Promise<MapRow | null> {
  const query = db.from("drive_folders").select("client_id, event_id, key, name, drive_folder_id").eq("client_id", k.client_id).eq("key", k.key);
  const res = await (k.event_id ? query.eq("event_id", k.event_id) : query.is("event_id", null)).maybeSingle();
  if (res.error) throw new Error(`drive_folders: ${res.error.message}`);
  return (res.data as MapRow | null) ?? null;
}

/** Migration 278 not applied yet: PostgREST's missing-table answer (PGRST205) or Postgres's (42P01). */
function isMissingTable(error: { code?: string; message: string }): boolean {
  return error.code === "PGRST205" || error.code === "42P01" || /could not find the table|does not exist/i.test(error.message);
}

/**
 * Claim the key: insert, or take over a claim older than the TTL by its
 * token (so of two runs taking over the same stale claim, one wins).
 * "unclaimed": the claims table isn't there (before migration 278), so the
 * run goes on as before it existed, find-before-create only.
 */
async function tryClaim(db: DriveDb, k: ClaimKey, token: string): Promise<boolean | "unclaimed"> {
  const now = Date.now();
  const claimedAt = new Date(now).toISOString();
  const ins = await db.from("drive_folder_claims").insert({ ...k, claim_token: token, claimed_at: claimedAt });
  if (!ins.error) return true;
  if (isMissingTable(ins.error)) return "unclaimed";
  if (ins.error.code !== "23505") throw new Error(`drive_folder_claims insert: ${ins.error.message}`);
  const read = db.from("drive_folder_claims").select("claim_token, claimed_at").eq("client_id", k.client_id).eq("key", k.key);
  const held = await (k.event_id ? read.eq("event_id", k.event_id) : read.is("event_id", null)).maybeSingle();
  if (held.error) throw new Error(`drive_folder_claims: ${held.error.message}`);
  // Gone since the insert (released): the caller re-reads the map and tries again.
  if (!held.data) return false;
  if (Date.parse(held.data.claimed_at) > now - claimTiming.ttlMs) return false;
  const take = db
    .from("drive_folder_claims")
    .update({ claim_token: token, claimed_at: claimedAt })
    .eq("client_id", k.client_id)
    .eq("key", k.key)
    .eq("claim_token", held.data.claim_token);
  const res = await (k.event_id ? take.eq("event_id", k.event_id) : take.is("event_id", null)).select("claim_token");
  if (res.error) throw new Error(`drive_folder_claims takeover: ${res.error.message}`);
  return (res.data ?? []).length === 1;
}

async function releaseClaim(db: DriveDb, k: ClaimKey, token: string): Promise<void> {
  const del = db.from("drive_folder_claims").delete().eq("client_id", k.client_id).eq("key", k.key).eq("claim_token", token);
  const res = await (k.event_id ? del.eq("event_id", k.event_id) : del.is("event_id", null));
  if (res.error) throw new Error(`drive_folder_claims delete: ${res.error.message}`);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Looked = { id: string; created: boolean; file: DriveFile };

async function lookUpOrCreate(drive: DriveApi, parentId: string, name: string, log: TreeLog, label: string, tag: Readonly<Record<string, string>>): Promise<Looked> {
  const existing = await drive.listChildren(parentId, { name, foldersOnly: true });
  if (existing[0]) {
    log.found.push(label);
    return { id: existing[0].id, created: false, file: existing[0] };
  }
  const made = await drive.createFolder(parentId, name, { ...tag });
  log.created.push(label);
  return { id: made.id, created: true, file: made };
}

/**
 * Find a folder by exact name under the parent, else create it (tagged).
 * No claim: for folders outside the map. A tree key goes through ensureSpec.
 */
export async function findOrCreateFolder(
  drive: DriveApi,
  parentId: string,
  name: string,
  log: TreeLog,
  label: string,
  tag: Readonly<Record<string, string>> = FOLDER_TAG,
): Promise<string> {
  return (await lookUpOrCreate(drive, parentId, name, log, label, tag)).id;
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
  /** Keys whose folder was found in Drive by name, untagged: made by hand, now adopted. */
  adopted?: Set<FolderKey>;
};

/**
 * A key the map doesn't have: claim it, then (holding the claim) re-read the
 * map, look the folder up by name, create it if it isn't there, and write the
 * map before the claim goes. A run that loses waits and re-reads the map.
 */
async function createUnderClaim(scope: Scope, spec: FolderSpec, parentId: string): Promise<string> {
  const k: ClaimKey = { client_id: scope.clientId, event_id: scope.eventId, key: spec.key };
  const token = randomUUID();
  const deadline = Date.now() + 2 * claimTiming.ttlMs;
  const takeMapped = (row: MapRow) => {
    scope.map.set(spec.key, row);
    scope.log.found.push(scope.label(spec));
    return row.drive_folder_id;
  };
  for (let first = true; ; first = false) {
    if (!first) {
      const row = await readMapRow(scope.db, k);
      if (row) return takeMapped(row);
    }
    const claim = await tryClaim(scope.db, k, token);
    if (claim) {
      try {
        // Another run may have made it and let its claim go since this run read the map.
        const again = await readMapRow(scope.db, k);
        if (again) return takeMapped(again);
        const got = await lookUpOrCreate(scope.drive, parentId, spec.name, scope.log, scope.label(spec), treeTag(scope.eventId ?? scope.clientId, spec.key));
        if (!got.created && got.file.appProperties?.[APP_TAG_KEY] !== TREE_TAG) scope.adopted?.add(spec.key);
        const row: MapRow = { client_id: scope.clientId, event_id: scope.eventId, key: spec.key, name: spec.name, drive_folder_id: got.id };
        await remember(scope.db, row);
        scope.map.set(spec.key, row);
        return got.id;
      } finally {
        // A release that fails leaves the claim to expire (claimTiming.ttlMs); the folder is made and mapped.
        if (claim === true) await releaseClaim(scope.db, k, token).catch(() => undefined);
      }
    }
    if (Date.now() > deadline) throw new Error(TREE_BUSY);
    await sleep(claimTiming.pollMs);
  }
}

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
  return createUnderClaim(scope, spec, parentId);
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

export type EnsureEventResult = {
  folderId: string | null;
  skipped: "archived_client" | "cancelled" | "no_client" | null;
  /**
   * The event folder was found in Drive by name, untagged (made by hand), not
   * made here or already known. The backfill links it (drive_folder_linked)
   * so a rename or re-date never renames it (S24).
   */
  adopted?: boolean;
};

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
    adopted: new Set(),
  };
  const ids = await ensureSpecs(scope, EVENT_TREE, EVENT_KEY, rootSpec);
  const folderId = ids.get(EVENT_KEY)!;
  if (event.drive_folder_id !== folderId) {
    const res = await db.from("events").update({ drive_folder_id: folderId }).eq("id", event.id);
    if (res.error) throw new Error(`events update: ${res.error.message}`);
    event.drive_folder_id = folderId;
  }
  return { folderId, skipped: null, adopted: scope.adopted!.has(EVENT_KEY) };
}

/**
 * The backfill's adopt (S24): an event folder ensureEventTree found in Drive
 * by name, untagged, becomes a linked folder (drive_folder_linked), as
 * linkEventFolder does, so a rename or re-date never renames it. Returns true
 * when it set the flag. Nothing for a folder the run made or already knew.
 */
export async function linkAdoptedEventFolder(db: DriveDb, event: Pick<EventRow, "id" | "drive_folder_linked">, made: EnsureEventResult): Promise<boolean> {
  if (!made.adopted || !made.folderId || event.drive_folder_linked) return false;
  const res = await db.from("events").update({ drive_folder_linked: true }).eq("id", event.id);
  if (res.error) throw new Error(`events update: ${res.error.message}`);
  event.drive_folder_linked = true;
  return true;
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

/** 02 Source / Audio (CT2): not in EVENT_TREE, so a tree never makes it ahead of need. */
export const AUDIO_KEY = "02/audio";

/** 02 Source / Audio / {artist}, keyed by the library artist id, named exactly as the Lab lineup (CT2). */
export function audioKey(libraryArtistId: string): FolderKey {
  return `${AUDIO_KEY}/${libraryArtistId}`;
}

/**
 * The act's 02 Source / Audio / {artist} folder, made on first need (CT2,
 * D5): map first, then found by exact name, then created. Returns null for a
 * cancelled event, an archived client, or an event with no tree yet.
 */
export async function ensureAudioFolder(
  db: DriveDb,
  drive: DriveApi,
  event: EventRow,
  client: ClientRow,
  artist: { libraryArtistId: string; name: string },
  log: TreeLog = emptyLog(),
): Promise<string | null> {
  if (isArchivedClientStatus(client.status) || isCancelled(event.status) || !event.drive_folder_id || !artist.name.trim()) return null;
  const sourceId = await ensureEventKey(db, drive, event, client, "02", log);
  const map = await loadMap(db, client.id, event.id);
  const name = eventFolderName({ ...event, status: null });
  const scope: Scope = {
    db,
    drive,
    clientId: client.id,
    eventId: event.id,
    map,
    log,
    rootParentId: sourceId,
    label: (spec) => labelFor([client.name, name], spec),
  };
  const audioId = await ensureSpec(scope, { key: AUDIO_KEY, parent: "02", name: "Audio", level: "event" }, sourceId);
  return ensureSpec(scope, { key: audioKey(artist.libraryArtistId), parent: AUDIO_KEY, name: artist.name, level: "event" }, audioId);
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
