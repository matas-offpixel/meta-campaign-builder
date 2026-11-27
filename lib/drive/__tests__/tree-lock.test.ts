import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { fakeDb, type FakeDb } from "../../creative-lab/__tests__/fake-db.ts";
import { APP_TAG_KEY, FOLDER_MIME, type DriveFile } from "../client.ts";
import type { DriveDb } from "../db.ts";
import { findTreeDuplicates, readOnlyDrive } from "../duplicates.ts";
import { TREE_BUSY, claimTiming, ensureClientTree, ensureEventTree, linkAdoptedEventFolder, treeTag, type ClientRow, type EventRow } from "../folders.ts";
import { skipReason } from "../pickup.ts";
import { EVENT_TREE, eventFolderName } from "../tree.ts";
import { fakeDrive, type FakeDrive } from "./fake-drive.ts";

type TestDb = FakeDb & DriveDb;

const CLIENT: ClientRow = { id: "c1", name: "NX", status: "active", drive_folder_id: null };
const EVENT: EventRow = {
  id: "e1",
  client_id: "c1",
  name: "Rudimental",
  event_code: "NX26-RUDIMENTAL",
  event_date: "2026-12-12",
  status: "on_sale",
  drive_folder_id: null,
  drive_folder_linked: false,
  drive_cancel_marked_at: null,
};
const EVENT_PATH = `NX / ${eventFolderName(EVENT)}`;
/** client + _Brand kit + the event folder + EVENT_TREE */
const TREE_SIZE = 2 + 1 + EVENT_TREE.length;

function seed(claims: Record<string, unknown>[] = []): TestDb {
  return fakeDb(
    { clients: [{ ...CLIENT }], events: [{ ...EVENT }], drive_folders: [], drive_folder_claims: claims },
    { unique: { drive_folder_claims: ["client_id", "event_id", "key"], drive_folders: ["client_id", "event_id", "key"] } },
  ) as TestDb;
}

/** A Drive whose list misses a folder made since the last list call: the 27 Nov lag. */
function laggingDrive(): FakeDrive {
  const drive = fakeDrive();
  const hidden = new Set<string>();
  const list = drive.listChildren.bind(drive);
  const create = drive.createFolder.bind(drive);
  drive.createFolder = async (parentId, name, tag) => {
    const made = await create(parentId, name, tag);
    hidden.add(made.id);
    return made;
  };
  drive.listChildren = async (parentId, opts) => {
    const out = (await list(parentId, opts)).filter((file) => !hidden.has(file.id));
    hidden.clear();
    return out;
  };
  return drive;
}

function folders(drive: FakeDrive): DriveFile[] {
  return [...drive.files.values()].filter((file) => file.mimeType === FOLDER_MIME);
}

function samePlaceSameName(drive: FakeDrive): string[] {
  const seen = new Map<string, number>();
  for (const file of folders(drive)) {
    const where = `${file.parents?.[0]} / ${file.name}`;
    seen.set(where, (seen.get(where) ?? 0) + 1);
  }
  return [...seen].filter(([, n]) => n > 1).map(([where]) => where);
}

/** A db whose claims table isn't there (before migration 278): PostgREST's PGRST205. */
function withoutClaimsTable(db: TestDb): DriveDb {
  const missing = { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.drive_folder_claims' in the schema cache" } };
  const chain: Record<string, unknown> = {};
  for (const method of ["insert", "select", "update", "delete", "eq", "is", "maybeSingle"]) chain[method] = () => chain;
  chain.then = (resolve: (value: typeof missing) => unknown) => resolve(missing);
  return { from: ((table: string) => (table === "drive_folder_claims" ? chain : db.from(table))) as DriveDb["from"] };
}

const timing = { ...claimTiming };
beforeEach(() => {
  claimTiming.pollMs = 1;
});
afterEach(() => {
  Object.assign(claimTiming, timing);
});

describe("one builder per key (27 Nov duplicates)", () => {
  it("the lagging Drive reproduces the race when there's no claim: two runs make duplicates", async () => {
    const db = seed();
    const drive = laggingDrive();
    const unclaimed = withoutClaimsTable(db);
    await Promise.all([ensureEventTree(unclaimed, drive, { ...EVENT }, { ...CLIENT }), ensureEventTree(unclaimed, drive, { ...EVENT }, { ...CLIENT })]);
    assert.ok(samePlaceSameName(drive).length > 0, "without a claim both runs create");
  });

  it("two concurrent ensureEventTree runs on one event create each folder once", async () => {
    const db = seed();
    const drive = laggingDrive();
    const [a, b] = await Promise.all([ensureEventTree(db, drive, { ...EVENT }, { ...CLIENT }), ensureEventTree(db, drive, { ...EVENT }, { ...CLIENT })]);
    assert.deepEqual(samePlaceSameName(drive), []);
    assert.equal(folders(drive).length, TREE_SIZE);
    assert.equal(drive.calls.filter((call) => call.startsWith("createFolder")).length, TREE_SIZE);
    assert.equal(a.folderId, b.folderId);
    assert.equal(db.tables.drive_folders.length, TREE_SIZE);
    for (const row of db.tables.drive_folders) assert.ok(drive.files.has(String(row.drive_folder_id)), `${row.key} maps to a folder that exists`);
    assert.deepEqual(db.tables.drive_folder_claims, [], "every claim was let go");
  });

  it("three runs at once, one of them a client-only walk, still make one of each", async () => {
    const db = seed();
    const drive = laggingDrive();
    await Promise.all([
      ensureEventTree(db, drive, { ...EVENT }, { ...CLIENT }),
      ensureClientTree(db, drive, { ...CLIENT }),
      ensureEventTree(db, drive, { ...EVENT }, { ...CLIENT }),
    ]);
    assert.deepEqual(samePlaceSameName(drive), []);
    assert.equal(folders(drive).length, TREE_SIZE);
  });

  it("a stale claim (a crashed run's) is taken over and let go", async () => {
    const old = new Date(Date.now() - 2 * claimTiming.ttlMs).toISOString();
    const db = seed([{ client_id: "c1", event_id: null, key: "client", claim_token: "dead-run", claimed_at: old }]);
    const drive = fakeDrive();
    const id = await ensureClientTree(db, drive, { ...CLIENT });
    assert.ok(id && drive.files.has(id));
    assert.equal(drive.pathOf(id), "NX");
    assert.deepEqual(db.tables.drive_folder_claims, []);
  });

  it("a live claim makes the run wait, then use the folder the other run mapped", async () => {
    const db = seed([{ client_id: "c1", event_id: null, key: "client", claim_token: "other-run", claimed_at: new Date().toISOString() }]);
    const drive = fakeDrive();
    const theirs = await drive.createFolder(drive.driveId, "NX");
    setTimeout(() => {
      db.tables.drive_folders.push({ client_id: "c1", event_id: null, key: "client", name: "NX", drive_folder_id: theirs.id });
      db.tables.drive_folder_claims = [];
    }, 15);
    const id = await ensureClientTree(db, drive, { ...CLIENT });
    assert.equal(id, theirs.id);
    assert.equal(drive.calls.filter((call) => call === "createFolder NX").length, 1, "only the other run made it");
  });

  it("a claim that never clears ends in the ruled sentence (design, 27 Nov)", async () => {
    assert.equal(TREE_BUSY, "Off/Pixel is already making this event’s Drive folders. Try again in a minute.");
    claimTiming.ttlMs = 20;
    const db = seed();
    // Every claim insert collides and the held claim is renewed each read, so it never goes stale.
    const busy: DriveDb = {
      from: ((table: string) => {
        if (table !== "drive_folder_claims") return db.from(table);
        const fresh = { data: { claim_token: "other-run", claimed_at: new Date().toISOString() }, error: null };
        const chain: Record<string, unknown> = {};
        let inserting = false;
        for (const method of ["select", "update", "delete", "eq", "is"]) chain[method] = () => chain;
        chain.insert = () => ((inserting = true), chain);
        chain.maybeSingle = async () => ({ ...fresh, data: { ...fresh.data, claimed_at: new Date().toISOString() } });
        chain.then = (resolve: (value: unknown) => unknown) => resolve(inserting ? { data: null, error: { code: "23505", message: "duplicate key" } } : { data: [], error: null });
        return chain;
      }) as DriveDb["from"],
    };
    await assert.rejects(ensureClientTree(busy, fakeDrive(), { ...CLIENT }), (err: Error) => err.message === TREE_BUSY);
  });

  it("before migration 278 the run goes on unclaimed, as it did", async () => {
    const db = seed();
    const drive = fakeDrive();
    const made = await ensureEventTree(withoutClaimsTable(db), drive, { ...EVENT }, { ...CLIENT });
    assert.ok(made.folderId);
    assert.equal(folders(drive).length, TREE_SIZE);
  });
});

describe("every folder the app makes is tagged", () => {
  it("tree folders carry offpixel_kind = tree and {event or client id}:{key}, and pickup skips them", async () => {
    const db = seed();
    const drive = fakeDrive();
    await ensureEventTree(db, drive, { ...EVENT }, { ...CLIENT });
    for (const row of db.tables.drive_folders) {
      const file = drive.files.get(String(row.drive_folder_id))!;
      assert.deepEqual(file.appProperties, treeTag(String(row.event_id ?? row.client_id), String(row.key)), String(row.key));
      assert.equal(skipReason({ fileId: file.id, removed: false, file }), "folder");
    }
    assert.deepEqual(drive.files.get(String(db.tables.drive_folders.find((row) => row.key === "03")!.drive_folder_id))!.appProperties, {
      offpixel_kind: "tree",
      offpixel_id: "e1:03",
    });
    assert.equal(drive.files.get(String(db.tables.drive_folders.find((row) => row.key === "client")!.drive_folder_id))!.appProperties?.offpixel_id, "c1:client");
  });
});

describe("the backfill links an adopted event folder", () => {
  it("a folder the run made is not linked", async () => {
    const db = seed();
    const drive = fakeDrive();
    const event = { ...EVENT };
    const made = await ensureEventTree(db, drive, event, { ...CLIENT });
    assert.equal(made.adopted, false);
    assert.equal(await linkAdoptedEventFolder(db, event, made), false);
    assert.equal(db.tables.events[0]!.drive_folder_linked, false);
  });

  it("a hand-made folder found by name is linked, and a later rename leaves its name alone", async () => {
    const db = seed();
    const drive = fakeDrive();
    const client = { ...CLIENT };
    const clientFolder = (await ensureClientTree(db, drive, client))!;
    const byHand = drive.drop(clientFolder, eventFolderName(EVENT), { mimeType: FOLDER_MIME });
    const event = { ...EVENT };
    const made = await ensureEventTree(db, drive, event, client);
    assert.equal(made.folderId, byHand.id);
    assert.equal(made.adopted, true);
    assert.equal(await linkAdoptedEventFolder(db, event, made), true);
    assert.equal(db.tables.events[0]!.drive_folder_linked, true);
    assert.equal(event.drive_folder_linked, true);
    // Re-dated: a linked folder keeps the name it was given by hand.
    await ensureEventTree(db, drive, { ...event, event_date: "2026-12-13" }, client);
    assert.equal(drive.files.get(byHand.id)!.name, eventFolderName(EVENT));
    // Already linked: nothing more to set.
    assert.equal(await linkAdoptedEventFolder(db, event, { ...made }), false);
  });

  it("a found folder that carries the tree tag (another run's) is not adopted", async () => {
    const db = seed();
    const drive = fakeDrive();
    const client = { ...CLIENT };
    const clientFolder = (await ensureClientTree(db, drive, client))!;
    drive.drop(clientFolder, eventFolderName(EVENT), { mimeType: FOLDER_MIME, appProperties: treeTag("e1", "event") });
    const made = await ensureEventTree(db, drive, { ...EVENT }, client);
    assert.equal(made.adopted, false);
  });
});

describe("the duplicate finder", () => {
  it("lists an unmapped folder named like a mapped sibling, empty or not, and nothing else", async () => {
    const db = seed();
    const drive = fakeDrive();
    const event = { ...EVENT };
    const made = await ensureEventTree(db, drive, event, { ...CLIENT });
    const eventFolder = made.folderId!;
    const mapped03 = String(db.tables.drive_folders.find((row) => row.key === "03")!.drive_folder_id);
    const dup03 = drive.drop(eventFolder, "03 Creatives", { mimeType: FOLDER_MIME });
    const dupSignup = drive.drop(dup03.id, "1 Signup", { mimeType: FOLDER_MIME });
    drive.drop(dupSignup.id, "Teaser", { mimeType: FOLDER_MIME });
    const dupWinners = drive.drop(eventFolder, "_Winners", { mimeType: FOLDER_MIME });
    drive.drop(dupWinners.id, "a.mp4");
    drive.drop(eventFolder, "Misc", { mimeType: FOLDER_MIME });
    const clientFolder = drive.files.get(eventFolder)!.parents![0]!;
    const dupEvent = drive.drop(clientFolder, eventFolderName(EVENT), { mimeType: FOLDER_MIME });
    drive.drop(clientFolder, "Another show", { mimeType: FOLDER_MIME });

    const calls = drive.calls.length;
    const scan = await findTreeDuplicates(db, readOnlyDrive(drive), event);
    assert.ok(drive.calls.slice(calls).every((call) => call.startsWith("list ") || call.startsWith("get ")), "reads only");
    const byId = new Map(scan.duplicates.map((dup) => [dup.id, dup]));
    assert.deepEqual([...byId.keys()].sort(), [dup03.id, dupWinners.id, dupEvent.id].sort());
    assert.equal(byId.get(dup03.id)!.name, "03 Creatives");
    assert.equal(byId.get(dup03.id)!.empty, false);
    assert.deepEqual([byId.get(dup03.id)!.folders, byId.get(dup03.id)!.files], [2, 0], "its own sub-folders, no files");
    assert.equal(byId.get(dup03.id)!.mapped.id, mapped03);
    assert.equal(byId.get(dup03.id)!.mapped.key, "03");
    assert.equal(byId.get(dupWinners.id)!.empty, false);
    assert.equal(byId.get(dupWinners.id)!.files, 1);
    assert.equal(byId.get(dupWinners.id)!.folders, 0);
    assert.equal(scan.eventFolder?.id, eventFolder);
    assert.equal(scan.eventFolder?.tagged, true);
    assert.equal(byId.get(dupEvent.id)!.mapped.key, "event");
    assert.equal(drive.pathOf(dup03.id), `${EVENT_PATH} / 03 Creatives`);
  });

  it("a clean tree has none, and the read-only handle refuses writes", async () => {
    const db = seed();
    const drive = fakeDrive();
    const event = { ...EVENT };
    await ensureEventTree(db, drive, event, { ...CLIENT });
    const ro = readOnlyDrive(drive);
    assert.deepEqual((await findTreeDuplicates(db, ro, event)).duplicates, []);
    await assert.rejects(ro.createFolder(drive.driveId, "x"), /never writes/);
    await assert.rejects(ro.update("f1", { name: "x" }), /never writes/);
    assert.equal(skipReason({ fileId: "x", removed: false, file: { id: "x", name: "x", mimeType: "video/mp4", appProperties: { [APP_TAG_KEY]: "tree" } } }), "ours");
  });
});
