import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fakeDb, type FakeDb } from "../../creative-lab/__tests__/fake-db.ts";
import { APP_TAG_KEY, SHORTCUT_MIME } from "../../drive/client.ts";
import type { DriveDb, RowOf } from "../../drive/db.ts";
import { ensureEventTree } from "../../drive/folders.ts";
import { runDrivePickup } from "../../drive/pickup.ts";
import { NO_FOLDER, shareEventFolder } from "../../drive/share.ts";
import { runDriveTick } from "../../drive/tick.ts";
import { fakeDrive, type FakeDrive } from "../../drive/__tests__/fake-drive.ts";
import { artistsDue, ensureLibraryFolders, isLibraryFolder, LIBRARY_SHORTCUT_TAG, syncRenderShortcuts } from "../library-drive.ts";
import { planShortcuts, renderShortcutName, type RankedRender } from "../library-tree.ts";

type TestDb = FakeDb & DriveDb;
const NOW = new Date("2026-11-25T10:00:00Z");
const ENZO = { id: "lib-enzo", name: "Enzo Siragusa" };

function seed(extra: Record<string, Record<string, unknown>[]> = {}): TestDb {
  return fakeDb({
    clients: [
      { id: "c-puzzle", user_id: "u1", name: "Puzzle", status: "active", created_at: "2026-11-10T00:00:00Z", drive_folder_id: null },
      { id: "c-old", user_id: "u1", name: "Old Promoter", status: "archived", created_at: "2026-11-10T00:00:00Z", drive_folder_id: null },
    ],
    events: [
      { id: "e-bday", user_id: "u1", client_id: "c-puzzle", name: "Puzzle 4th Birthday", event_code: "P26-BDAY", event_date: "2026-12-27", status: "on_sale", created_at: "2026-11-10T00:00:00Z", drive_folder_id: null, drive_folder_linked: false, drive_cancel_marked_at: null, drive_share_permission_id: null },
      { id: "e-past", user_id: "u1", client_id: "c-puzzle", name: "Old show", event_code: "P25-OLD", event_date: "2025-12-27", status: "on_sale", created_at: "2025-11-10T00:00:00Z", drive_folder_id: null, drive_folder_linked: false, drive_cancel_marked_at: null, drive_share_permission_id: null },
      { id: "e-arch", user_id: "u1", client_id: "c-old", name: "Archived", event_code: "OLD26", event_date: "2026-12-30", status: "on_sale", created_at: "2026-11-10T00:00:00Z", drive_folder_id: null, drive_folder_linked: false, drive_cancel_marked_at: null, drive_share_permission_id: null },
    ],
    artists: [ENZO, { id: "lib-luke", name: "Luke Dean" }, { id: "lib-arch", name: "Archived Act" }, { id: "lib-old", name: "past act" }],
    event_artists: [
      { id: "ea1", event_id: "e-bday", artist_id: "lib-enzo" },
      { id: "ea2", event_id: "e-bday", artist_id: "lib-luke" },
      { id: "ea3", event_id: "e-arch", artist_id: "lib-arch" },
      { id: "ea4", event_id: "e-past", artist_id: "lib-old" },
    ],
    artist_library_folders: [],
    artist_assets: [],
    drive_folders: [],
    drive_change_cursors: [],
    drive_kit_audit_files: [],
    drive_artist_folder_misses: [],
    creative_lab_renders: [],
    creative_lab_rounds: [],
    creative_lab_artists: [],
    ...extra,
  }) as unknown as TestDb;
}

const log = () => ({ created: [] as string[], found: [] as string[], renamed: [] as string[] });
const pathOf = (drive: FakeDrive, id: string) => drive.pathOf(id);

describe("AL1 · the Drive library", () => {
  it("00 Artist Library / {artist} / the five folders, the name verbatim, made once", async () => {
    const db = seed();
    const drive = fakeDrive();
    const weird = { id: "lib-x", name: "  dj SoMeone b2b X " };
    const folders = (await ensureLibraryFolders(db, drive, weird, log()))!;
    assert.equal(pathOf(drive, folders.artist), "00 Artist Library /   dj SoMeone b2b X ");
    assert.deepEqual(drive.childrenNamed("00 Artist Library /   dj SoMeone b2b X "), ["Captions", "Clips", "Insights", "Renders", "Statics"]);
    const before = drive.files.size;
    await ensureLibraryFolders(db, drive, weird, log());
    assert.equal(drive.files.size, before, "a rerun makes nothing");
    assert.equal(db.tables.artist_library_folders.length, 7);
  });

  it("the tick makes the library for artists on an upcoming show only", async () => {
    const db = seed();
    const drive = fakeDrive();
    await runDriveTick(db, drive, { download: async () => new Uint8Array(), now: NOW });
    assert.deepEqual(drive.childrenNamed("00 Artist Library"), ["Enzo Siragusa", "Luke Dean"]);
    const quiet = drive.calls.length;
    await runDriveTick(db, drive, { download: async () => new Uint8Array(), now: NOW });
    assert.equal(drive.calls.filter((c, i) => i >= quiet && c.startsWith("createFolder")).length, 0, "a quiet tick makes no folder");
  });

  it("before migration 269 there is no map, and nothing is made", async () => {
    const db = seed();
    const broken = {
      ...db,
      from: (t: string) =>
        t === "artist_library_folders"
          ? { select: () => ({ order: () => ({ range: async () => ({ data: null, error: { message: 'relation "artist_library_folders" does not exist' } }) }) }) }
          : db.from(t),
    } as unknown as TestDb;
    assert.equal(await ensureLibraryFolders(broken, fakeDrive(), ENZO, log()), null);
  });

  it("artistsDue leaves out past, cancelled and archived-client shows", () => {
    const due = artistsDue({
      today: "2026-11-25",
      events: [
        { id: "a", client_id: "c1", event_date: "2026-12-01", status: "on_sale" },
        { id: "b", client_id: "c1", event_date: "2026-12-01", status: "cancelled" },
        { id: "c", client_id: "c2", event_date: "2026-12-01", status: "on_sale" },
        { id: "d", client_id: "c1", event_date: "2026-11-24", status: "on_sale" },
      ],
      clients: [{ id: "c1", status: "active" }, { id: "c2", status: "archived" }],
      links: [{ event_id: "a", artist_id: "x" }, { event_id: "b", artist_id: "y" }, { event_id: "c", artist_id: "z" }, { event_id: "d", artist_id: "w" }],
      artists: [{ id: "x", name: "X" }, { id: "y", name: "Y" }, { id: "z", name: "Z" }, { id: "w", name: "W" }],
    });
    assert.deepEqual(due.map((a) => a.id), ["x"]);
  });
});

describe("AL1 · Share with promoter can't reach the library", () => {
  async function eventOn(db: TestDb, drive: FakeDrive, folderId: string) {
    const ev = db.tables.events.find((e) => e.id === "e-bday")! as unknown as RowOf<"events">;
    ev.drive_folder_id = folderId;
    return shareEventFolder(db, drive, { eventId: "e-bday", email: "promoter@example.com", userId: "u1", now: NOW });
  }

  it("no folder under 00 Artist Library can be the target, mapped or made by hand", async () => {
    const db = seed();
    const drive = fakeDrive();
    const folders = (await ensureLibraryFolders(db, drive, ENZO, log()))!;
    const handMade = await drive.createFolder(folders.clips, "Someone's subfolder");
    for (const id of [folders.root, folders.artist, folders.clips, folders.statics, folders.renders, folders.captions, folders.insights, handMade.id]) {
      assert.deepEqual(await eventOn(db, drive, id), { ok: false, error: NO_FOLDER }, pathOf(drive, id));
    }
    // A library made by hand before the map knew it is refused by its name at the drive root.
    const db2 = seed();
    const drive2 = fakeDrive();
    const root = await drive2.createFolder(drive2.driveId, "00 Artist Library");
    const artist = await drive2.createFolder(root.id, "Enzo Siragusa");
    assert.deepEqual(await eventOn(db2, drive2, artist.id), { ok: false, error: NO_FOLDER });
    assert.equal(drive.permissions.size + drive2.permissions.size, 0, "no permission was ever made");
    assert.ok(!drive.calls.some((c) => c.startsWith("share ")));
  });

  it("an event's own folder still shares", async () => {
    const db = seed();
    const drive = fakeDrive();
    await ensureLibraryFolders(db, drive, ENZO, log());
    const ev = db.tables.events.find((e) => e.id === "e-bday")! as unknown as RowOf<"events">;
    const client = db.tables.clients.find((c) => c.id === "c-puzzle")! as unknown as RowOf<"clients">;
    await ensureEventTree(db, drive, ev, client);
    const res = await shareEventFolder(db, drive, { eventId: "e-bday", email: "promoter@example.com", userId: "u1", now: NOW });
    assert.equal(res.ok, true);
    assert.equal(await isLibraryFolder(db, drive, ev.drive_folder_id!), false);
  });
});

describe("AL4 · Renders are shortcuts, never copies", () => {
  const ranked = (target: string, file: string, cost: string, shareable = true): RankedRender => ({ targetId: target, fileName: file, code: "P26-BDAY", stage: "signup", cost, shareable });

  it("the shortcut name is al.drive.render exactly, rank two digits", () => {
    assert.equal(
      renderShortcutName({ rank: 1, code: "P26-BDAY", stage: "signup", cost: "£2.10 per signup", fileName: "Enzo Siragusa - UGC 2.mp4" }),
      "01 · P26-BDAY · Signup · £2.10 per signup · Enzo Siragusa - UGC 2",
    );
    assert.equal(
      renderShortcutName({ rank: 1, code: "P26-BDAY", stage: "on_sale", cost: "£6.80 per purchase", fileName: "Enzo Siragusa - UGC 3" }),
      "01 · P26-BDAY · On sale · £6.80 per purchase · Enzo Siragusa - UGC 3",
    );
  });

  it("top five shareable per stage, ranked among shareable only; a held render never gets one", () => {
    const signup = [ranked("held", "Lineup Push - Enzo", "£1.95 per signup", false), ...["a", "b", "c", "d", "e", "f"].map((t, i) => ranked(t, `R ${t}`, `£${i + 2}.00 per signup`))];
    const plan = planShortcuts({ signup, on_sale: [] }, []);
    assert.deepEqual(plan.create.map((c) => c.name.slice(0, 2)), ["01", "02", "03", "04", "05"]);
    assert.equal(plan.create[0]!.targetId, "a");
    assert.ok(!plan.create.some((c) => c.targetId === "held"));
  });

  it("made as shortcuts to the event file, renamed when the rank moves, a drop-out left in place with its target untouched", async () => {
    const db = seed();
    const drive = fakeDrive();
    const folders = (await ensureLibraryFolders(db, drive, ENZO, log()))!;
    const eventFolder = await drive.createFolder(drive.driveId, "Puzzle");
    const ugc1 = await drive.uploadFile({ parentId: eventFolder.id, name: "Enzo Siragusa - UGC 1.mp4", mimeType: "video/mp4", bytes: new Uint8Array([1]), appProperties: { [APP_TAG_KEY]: "render" } });
    const ugc2 = await drive.uploadFile({ parentId: eventFolder.id, name: "Enzo Siragusa - UGC 2.mp4", mimeType: "video/mp4", bytes: new Uint8Array([2]), appProperties: { [APP_TAG_KEY]: "render" } });
    const uploadsBefore = drive.calls.filter((c) => c.startsWith("upload")).length;

    await syncRenderShortcuts(drive, folders, { signup: [ranked(ugc2.id, ugc2.name, "£2.10 per signup"), ranked(ugc1.id, ugc1.name, "£3.05 per signup")], on_sale: [] });
    const made = [...drive.files.values()].filter((f) => f.parents?.includes(folders.renders));
    assert.deepEqual(made.map((f) => f.name).sort(), ["01 · P26-BDAY · Signup · £2.10 per signup · Enzo Siragusa - UGC 2", "02 · P26-BDAY · Signup · £3.05 per signup · Enzo Siragusa - UGC 1"]);
    for (const f of made) {
      assert.equal(f.mimeType, SHORTCUT_MIME);
      assert.equal(f.appProperties?.[APP_TAG_KEY], LIBRARY_SHORTCUT_TAG);
    }
    assert.deepEqual(made.map((f) => f.shortcutTargetId).sort(), [ugc1.id, ugc2.id].sort());
    assert.equal(drive.calls.filter((c) => c.startsWith("upload")).length, uploadsBefore, "no copy is uploaded");

    // UGC 1 overtakes UGC 2; then UGC 2 drops out.
    await syncRenderShortcuts(drive, folders, { signup: [ranked(ugc1.id, ugc1.name, "£1.90 per signup"), ranked(ugc2.id, ugc2.name, "£2.10 per signup")], on_sale: [] });
    assert.deepEqual(drive.childrenNamed("00 Artist Library / Enzo Siragusa / Renders"), ["01 · P26-BDAY · Signup · £1.90 per signup · Enzo Siragusa - UGC 1", "02 · P26-BDAY · Signup · £2.10 per signup · Enzo Siragusa - UGC 2"]);
    const plan = await syncRenderShortcuts(drive, folders, { signup: [ranked(ugc1.id, ugc1.name, "£1.90 per signup")], on_sale: [] });
    assert.equal(plan.dropped.length, 1);
    assert.equal(drive.files.get(ugc2.id)!.trashed, undefined, "the event-folder file is untouched");
    assert.deepEqual(drive.childrenNamed("Puzzle"), ["Enzo Siragusa - UGC 1.mp4", "Enzo Siragusa - UGC 2.mp4"]);
  });
});

describe("AL1 · the pickup files a drop into Clips / Statics as an artist asset", () => {
  it("Clips → clip, Statics → static, shareable artist rows, once each; Renders imports nothing", async () => {
    const db = seed();
    const drive = fakeDrive();
    const folders = (await ensureLibraryFolders(db, drive, ENZO, log()))!;
    await runDrivePickup(db, drive, { now: NOW }); // first run stores the token
    drive.drop(folders.clips, "Enzo - Raw 1.mp4");
    drive.drop(folders.statics, "Enzo Siragusa.jpg", { mimeType: "image/jpeg" });
    drive.drop(folders.captions, "notes.txt", { mimeType: "text/plain" });
    const res = await runDrivePickup(db, drive, { now: NOW });
    assert.equal(res.libraryFiles, 2);
    const rows = db.tables.artist_assets;
    assert.deepEqual(rows.map((r) => [r.kind, r.name, r.owner_kind, r.shareable, r.held_reason, r.artist_id]).sort(), [
      ["clip", "Enzo - Raw 1.mp4", "artist", true, null, "lib-enzo"],
      ["static", "Enzo Siragusa.jpg", "artist", true, null, "lib-enzo"],
    ]);
    assert.equal(res.clips.length, 0, "nothing goes through the Lab clip import");
    assert.ok(!drive.calls.some((c) => c.startsWith("download")), "nothing is copied into Storage");
  });
});
