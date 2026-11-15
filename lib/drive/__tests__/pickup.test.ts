import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fakeDb, type FakeDb } from "../../creative-lab/__tests__/fake-db.ts";
import { APP_ID_KEY, APP_TAG_KEY, DriveApiError, FOLDER_MIME } from "../client.ts";
import type { DriveDb, RowOf, TableName } from "../db.ts";
import { artistClipsKey, ensureArtistFolders, ensureEventTree } from "../folders.ts";
import { loadLineupArtists } from "../lineup.ts";
import { KILLED_RUN_LINE, PICKUP_MAX_ATTEMPTS, folderImport, runDrivePickup, venueImport, type ImportClip } from "../pickup.ts";
import { DRIVE_REFUSED, NO_FOLDER, shareEventFolder, stopSharingEventFolder } from "../share.ts";
import { runDriveTick } from "../tick.ts";
import { fortnightlyFrom } from "../tree.ts";
import { fakeDrive, type FakeDrive } from "./fake-drive.ts";

type TestDb = FakeDb & DriveDb;
const NOW = new Date("2026-11-17T10:00:00Z");
const EVENT = "Puzzle / 2026-12-27 Puzzle 4th Birthday [P26-BDAY]";

function seed(overrides: { client?: Record<string, unknown>; event?: Record<string, unknown> } = {}): TestDb {
  return fakeDb({
    clients: [{ id: "c1", user_id: "u1", name: "Puzzle", status: "active", created_at: "2026-11-10T00:00:00Z", drive_folder_id: null, ...overrides.client }],
    events: [
      {
        id: "e1",
        user_id: "u1",
        client_id: "c1",
        name: "Puzzle 4th Birthday",
        event_code: "P26-BDAY",
        event_date: "2026-12-27",
        status: "on_sale",
        general_sale_at: "2026-11-02T10:00:00Z",
        created_at: "2026-11-10T00:00:00Z",
        drive_folder_id: null,
        drive_folder_linked: false,
        drive_cancel_marked_at: null,
        drive_share_permission_id: null,
        ...overrides.event,
      },
    ],
    drive_folders: [],
    artists: [
      { id: "lib-enzo", name: "Enzo Siragusa" },
      { id: "lib-reeshy", name: "Reeshy" },
      { id: "lib-luke", name: "Luke Dean" },
      { id: "lib-copy", name: "Someone From Ad Copy" },
    ],
    event_artists: [
      { id: "ea1", event_id: "e1", artist_id: "lib-enzo", source: "lab", billing_order: 1 },
      { id: "ea2", event_id: "e1", artist_id: "lib-reeshy", source: "lab", billing_order: 2 },
      { id: "ea3", event_id: "e1", artist_id: "lib-copy", source: "ad_copy", billing_order: 3 },
    ],
    creative_lab_artists: [{ id: "lab-enzo", user_id: "u1", client_id: "c1", name: "Enzo Siragusa", artist_id: "lib-enzo", rights_doc_ref: "Promoter page", clip_source: "file" }],
    creative_lab_clips: [],
    creative_assets: [],
    creative_lab_renders: [],
    creative_lab_rounds: [],
    drive_change_cursors: [],
    drive_kit_audit_files: [],
    drive_artist_folder_misses: [],
  }) as unknown as TestDb;
}

const row = <T extends TableName>(db: FakeDb, table: T, id: string) => db.tables[table].find((r) => r.id === id)! as unknown as RowOf<T>;
const rows = (db: FakeDb, table: string) => db.tables[table] ?? [];

async function withTree(db: TestDb, drive: FakeDrive) {
  const event = row(db, "events", "e1");
  const client = row(db, "clients", "c1");
  await ensureEventTree(db, drive, event, client);
  await ensureArtistFolders(db, drive, event, client, await loadLineupArtists(db, "e1"));
}

function folderId(drive: FakeDrive, path: string): string {
  return [...drive.files.values()].find((file) => drive.pathOf(file.id) === path)!.id;
}

/** Records what would be imported; the real folder import is tested on its own below. */
function recorder() {
  const calls: { labArtistId: string; eventId: string; name: string }[] = [];
  const importClip: ImportClip = async ({ labArtistId, eventId, file }) => {
    calls.push({ labArtistId, eventId, name: file.name });
    return { files: [{ name: file.name, outcome: "imported", reason: null }], folderError: null };
  };
  return { calls, importClip };
}

async function primed(db: TestDb, drive: FakeDrive) {
  await withTree(db, drive);
  const first = await runDrivePickup(db, drive, { now: NOW });
  assert.equal(first.firstRun, true);
}

describe("Artist clips/{artist} folders (S22)", () => {
  it("one per Lab lineup artist, named exactly, idempotent, renamed with the artist", async () => {
    const db = seed();
    const drive = fakeDrive();
    await withTree(db, drive);
    assert.deepEqual(drive.childrenNamed(`${EVENT} / 02 Source / Artist clips`), ["Enzo Siragusa", "Reeshy"]);
    assert.ok(rows(db, "drive_folders").some((r) => r.key === artistClipsKey("lib-enzo")));
    const size = drive.files.size;
    await withTree(db, drive);
    assert.equal(drive.files.size, size);
    row(db, "artists", "lib-reeshy").name = "Reeshy (live)";
    await withTree(db, drive);
    assert.deepEqual(drive.childrenNamed(`${EVENT} / 02 Source / Artist clips`), ["Enzo Siragusa", "Reeshy (live)"]);
    assert.equal(drive.files.size, size);
  });

  it("the tick adds a folder when the lineup changes", async () => {
    const db = seed();
    const drive = fakeDrive();
    await runDriveTick(db, drive, { download: async () => new Uint8Array(), now: NOW, calendar: fortnightlyFrom("2026-11-02") });
    assert.deepEqual(drive.childrenNamed(`${EVENT} / 02 Source / Artist clips`), ["Enzo Siragusa", "Reeshy"]);
    rows(db, "event_artists").push({ id: "ea4", event_id: "e1", artist_id: "lib-luke", source: "lab", billing_order: 4 });
    await runDriveTick(db, drive, { download: async () => new Uint8Array(), now: NOW, calendar: fortnightlyFrom("2026-11-02") });
    assert.deepEqual(drive.childrenNamed(`${EVENT} / 02 Source / Artist clips`), ["Enzo Siragusa", "Luke Dean", "Reeshy"]);
  });
});

describe("the changes feed (HS14)", () => {
  it("the first run stores the start token and imports nothing already there", async () => {
    const db = seed();
    const drive = fakeDrive();
    await withTree(db, drive);
    drive.drop(folderId(drive, `${EVENT} / 02 Source / Artist clips / Enzo Siragusa`), "old.mp4");
    const { calls, importClip } = recorder();
    const result = await runDrivePickup(db, drive, { now: NOW, importClip });
    assert.equal(result.firstRun, true);
    assert.deepEqual(calls, []);
    assert.equal(rows(db, "drive_change_cursors")[0].page_token, String(drive.changeLog.length));
  });

  it("pages through the feed and stores where it stopped; the next run starts there", async () => {
    const db = seed();
    const drive = fakeDrive();
    await primed(db, drive);
    const enzo = folderId(drive, `${EVENT} / 02 Source / Artist clips / Enzo Siragusa`);
    for (let i = 1; i <= 5; i += 1) drive.drop(enzo, `clip-${i}.mp4`);
    drive.pageSize = 2;
    const { calls, importClip } = recorder();
    const result = await runDrivePickup(db, drive, { now: NOW, importClip });
    assert.equal(result.pages, 3);
    assert.equal(calls.length, 5);
    assert.equal(rows(db, "drive_change_cursors")[0].page_token, String(drive.changeLog.length));
    const again = await runDrivePickup(db, drive, { now: NOW, importClip });
    assert.equal(again.changes, 0);
    assert.equal(calls.length, 5);
  });

  it("stops at maxPages and carries on from the page it reached", async () => {
    const db = seed();
    const drive = fakeDrive();
    await primed(db, drive);
    const enzo = folderId(drive, `${EVENT} / 02 Source / Artist clips / Enzo Siragusa`);
    for (let i = 1; i <= 5; i += 1) drive.drop(enzo, `clip-${i}.mp4`);
    drive.pageSize = 2;
    const { calls, importClip } = recorder();
    await runDrivePickup(db, drive, { now: NOW, importClip, maxPages: 1 });
    assert.equal(calls.length, 2);
    await runDrivePickup(db, drive, { now: NOW, importClip });
    assert.equal(calls.length, 5);
  });

  it("an error mid-page leaves the token, so the page is read again", async () => {
    const db = seed();
    const drive = fakeDrive();
    await primed(db, drive);
    const before = rows(db, "drive_change_cursors")[0].page_token;
    drive.drop(folderId(drive, `${EVENT} / 02 Source / Artist clips / Enzo Siragusa`), "clip.mp4");
    let fail = true;
    const seen: string[] = [];
    const importClip: ImportClip = async ({ file }) => {
      if (fail) throw new Error("storage down");
      seen.push(file.name);
      return { files: [{ name: file.name, outcome: "imported", reason: null }], folderError: null };
    };
    const broken = await runDrivePickup(db, drive, { now: NOW, importClip });
    assert.match(broken.errors[0], /storage down/);
    assert.equal(rows(db, "drive_change_cursors")[0].page_token, before);
    fail = false;
    await runDrivePickup(db, drive, { now: NOW, importClip });
    assert.deepEqual(seen, ["clip.mp4"]);
  });
});

describe("routing by folder (S22)", () => {
  it("a clip in Artist clips/{artist} imports as that artist's clip on that event, nested folders included", async () => {
    const db = seed();
    const drive = fakeDrive();
    await primed(db, drive);
    const enzo = folderId(drive, `${EVENT} / 02 Source / Artist clips / Enzo Siragusa`);
    drive.drop(enzo, "boiler-room.mp4");
    const nested = await drive.createFolder(enzo, "2025 sets");
    drive.drop(nested.id, "fabric.mp4");
    const { calls, importClip } = recorder();
    const result = await runDrivePickup(db, drive, { now: NOW, importClip });
    assert.deepEqual(calls, [
      { labArtistId: "lab-enzo", eventId: "e1", name: "boiler-room.mp4" },
      { labArtistId: "lab-enzo", eventId: "e1", name: "fabric.mp4" },
    ]);
    assert.equal(result.skipped.folder, 1);
  });

  it("a lineup artist with no Lab row gets one, the way the Lab makes it", async () => {
    const db = seed();
    const drive = fakeDrive();
    await primed(db, drive);
    drive.drop(folderId(drive, `${EVENT} / 02 Source / Artist clips / Reeshy`), "reeshy.mp4");
    const { calls, importClip } = recorder();
    await runDrivePickup(db, drive, { now: NOW, importClip });
    const lab = rows(db, "creative_lab_artists").find((r) => r.artist_id === "lib-reeshy")!;
    assert.equal(lab.name, "Reeshy");
    assert.equal(lab.client_id, "c1");
    assert.deepEqual(calls, [{ labArtistId: lab.id, eventId: "e1", name: "reeshy.mp4" }]);
  });

  it("an operator's folder must match a lineup name exactly; a miss imports nothing and is recorded once", async () => {
    const db = seed();
    const drive = fakeDrive();
    await primed(db, drive);
    const clips = folderId(drive, `${EVENT} / 02 Source / Artist clips`);
    const wrong = await drive.createFolder(clips, "enzo siragusa");
    drive.drop(wrong.id, "a.mp4");
    drive.drop(wrong.id, "b.mp4");
    rows(db, "event_artists").push({ id: "ea4", event_id: "e1", artist_id: "lib-luke", source: "lab", billing_order: 4 });
    const luke = await drive.createFolder(clips, "Luke Dean");
    drive.drop(luke.id, "luke.mp4");
    const { calls, importClip } = recorder();
    const result = await runDrivePickup(db, drive, { now: NOW, importClip });
    assert.deepEqual(result.misses, ["enzo siragusa"]);
    assert.equal(rows(db, "drive_artist_folder_misses").length, 1);
    assert.equal(rows(db, "drive_artist_folder_misses")[0].folder_name, "enzo siragusa");
    assert.deepEqual(calls.map((c) => c.name), ["luke.mp4"]);
  });

  it("skips the export's own files, folders and trashed files", async () => {
    const db = seed();
    const drive = fakeDrive();
    await primed(db, drive);
    const enzo = folderId(drive, `${EVENT} / 02 Source / Artist clips / Enzo Siragusa`);
    drive.drop(enzo, "P26-BDAY_enzo-siragusa-1_lineup2-on-sale_r1_9x16.mp4", { appProperties: { [APP_TAG_KEY]: "lab_render", [APP_ID_KEY]: "rd1" } });
    const gone = drive.drop(enzo, "gone.mp4");
    drive.trash(gone.id);
    await drive.createFolder(enzo, "empty");
    const { calls, importClip } = recorder();
    const result = await runDrivePickup(db, drive, { now: NOW, importClip });
    assert.equal(result.skipped.ours, 1);
    assert.equal(result.skipped.trashed, 1);
    assert.equal(result.skipped.folder, 1);
    // gone.mp4's first sighting (before the trash) imports; the trash itself does not.
    assert.deepEqual(calls.map((c) => c.name), ["gone.mp4"]);
  });

  it("01 Open files and _Brand kit queue one kit-audit row per file", async () => {
    const db = seed();
    const drive = fakeDrive();
    await primed(db, drive);
    const open = folderId(drive, `${EVENT} / 01 Open files`);
    const psd = drive.drop(open, "artwork.psd", { mimeType: "image/vnd.adobe.photoshop" });
    const sub = await drive.createFolder(open, "Fonts");
    drive.drop(sub.id, "Druk.otf", { mimeType: "font/otf" });
    drive.drop(folderId(drive, "Puzzle / _Brand kit"), "logo.ai", { mimeType: "application/postscript" });
    drive.changeLog.push({ fileId: psd.id, removed: false, file: { ...psd } });
    const { calls, importClip } = recorder();
    const result = await runDrivePickup(db, drive, { now: NOW, importClip });
    assert.deepEqual(calls, []);
    const audit = rows(db, "drive_kit_audit_files");
    assert.deepEqual(audit.map((r) => [r.name, r.event_id, r.folder_key]).sort(), [
      ["Druk.otf", "e1", "01"],
      ["artwork.psd", "e1", "01"],
      ["logo.ai", null, "brand-kit"],
    ]);
    assert.equal(result.kitFiles, 4);
  });

  it("an archived client imports nothing", async () => {
    const db = seed();
    const drive = fakeDrive();
    await primed(db, drive);
    row(db, "clients", "c1").status = "archived";
    drive.drop(folderId(drive, `${EVENT} / 02 Source / Artist clips / Enzo Siragusa`), "x.mp4");
    drive.drop(folderId(drive, `${EVENT} / 01 Open files`), "x.psd");
    const { calls, importClip } = recorder();
    const result = await runDrivePickup(db, drive, { now: NOW, importClip });
    assert.deepEqual(calls, []);
    assert.equal(rows(db, "drive_kit_audit_files").length, 0);
    assert.equal(result.skipped.archived_client, 2);
  });
});

describe("the real folder import from a Drive pickup", () => {
  it("stores the clip on the event with its Drive file id, dedupes by file id and by sha256, leaves the artist's own folder state", async () => {
    const db = seed();
    const drive = fakeDrive();
    await primed(db, drive);
    const enzo = folderId(drive, `${EVENT} / 02 Source / Artist clips / Enzo Siragusa`);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const first = drive.drop(enzo, "boiler-room.mp4", { bytes });
    // The pickup streams to disk (file mode), so the fakes are the file-mode ones.
    const importClip = folderImport(db as never, {
      uploadFile: async () => undefined,
      probeFile: async () => ({ width: 1080, height: 1920, durationInSeconds: 42 }),
      now: NOW,
    });
    await runDrivePickup(db, drive, { now: NOW, importClip });
    const clips = rows(db, "creative_lab_clips");
    assert.equal(clips.length, 1);
    assert.equal(clips[0].event_id, "e1");
    assert.equal(clips[0].artist_id, "lab-enzo");
    assert.equal(clips[0].source_file_id, first.id);
    assert.equal(clips[0].out_s, 30);
    assert.equal(row(db, "creative_lab_artists", "lab-enzo").clip_folder_synced_at, undefined);

    drive.changeLog.push({ fileId: first.id, removed: false, file: { ...drive.files.get(first.id)! } });
    drive.drop(enzo, "same-bytes-other-name.mp4", { bytes });
    const again = await runDrivePickup(db, drive, { now: NOW, importClip });
    assert.equal(rows(db, "creative_lab_clips").length, 1);
    assert.deepEqual(again.clips.map((c) => c.reason), ["already imported", "same video as a clip already imported"]);
  });
});

describe("share with promoter (HS17)", () => {
  it("refuses with one sentence when the event has no folder", async () => {
    const db = seed();
    const drive = fakeDrive();
    assert.deepEqual(await shareEventFolder(db, drive, { eventId: "e1", email: "promoter@example.com", userId: "u1" }), { ok: false, error: NO_FOLDER });
    assert.equal(drive.permissions.size, 0);
  });

  it("grants view on the event folder only, records it, and stop removes that one permission", async () => {
    const db = seed();
    const drive = fakeDrive();
    await withTree(db, drive);
    const event = row(db, "events", "e1");
    const other = await drive.shareReader(String(event.drive_folder_id), "someone-else@example.com");
    const shared = await shareEventFolder(db, drive, { eventId: "e1", email: " promoter@example.com ", userId: "u1", now: NOW });
    assert.deepEqual(shared, { ok: true, sharedWith: "promoter@example.com", sharedAt: NOW.toISOString() });
    const grant = drive.permissions.get(String(event.drive_share_permission_id))!;
    assert.deepEqual(grant, { fileId: event.drive_folder_id, email: "promoter@example.com" });
    assert.equal(event.drive_shared_by, "u1");
    assert.equal(event.drive_shared_with, "promoter@example.com");
    assert.ok(![...drive.permissions.values()].some((p) => p.fileId === row(db, "clients", "c1").drive_folder_id));

    const twice = await shareEventFolder(db, drive, { eventId: "e1", email: "new@example.com", userId: "u1" });
    assert.equal(twice.ok, false);

    assert.deepEqual(await stopSharingEventFolder(db, drive, { eventId: "e1", userId: "u1" }), { ok: true, sharedWith: null, sharedAt: null });
    assert.deepEqual([...drive.permissions.keys()], [other]);
    assert.equal(event.drive_share_permission_id, null);
    assert.equal(event.drive_shared_at, null);
    assert.equal(event.drive_shared_with, null);
  });

  it("someone else's event, a bad email, and Drive refusing all change nothing", async () => {
    const db = seed();
    const drive = fakeDrive();
    await withTree(db, drive);
    assert.equal((await shareEventFolder(db, drive, { eventId: "e1", email: "promoter@example.com", userId: "u2" })).ok, false);
    assert.equal((await shareEventFolder(db, drive, { eventId: "e1", email: "not an email", userId: "u1" })).ok, false);
    drive.refuseShare = new DriveApiError(403, "shareOutNotPermitted", "Drive share failed: HTTP 403 shareOutNotPermitted");
    assert.deepEqual(await shareEventFolder(db, drive, { eventId: "e1", email: "promoter@example.com", userId: "u1" }), { ok: false, error: DRIVE_REFUSED });
    assert.equal(drive.permissions.size, 0);
    assert.equal(row(db, "events", "e1").drive_share_permission_id, null);
  });

  it("nothing shares without the action being called", async () => {
    const db = seed();
    const drive = fakeDrive();
    await runDriveTick(db, drive, { download: async () => new Uint8Array(), now: NOW, calendar: fortnightlyFrom("2026-11-02") });
    await runDrivePickup(db, drive, { now: NOW });
    await runDrivePickup(db, drive, { now: NOW, importClip: recorder().importClip });
    assert.equal(drive.permissions.size, 0);
    assert.ok(!drive.calls.some((call) => call.startsWith("share")));
    assert.equal(FOLDER_MIME, "application/vnd.google-apps.folder");
  });
});

/** Waits (bounded) until the pickup has written this file's id on the cursor row: the run is now inside that file's import. */
async function untilInflight(db: TestDb, fileId: string, attempts: number) {
  for (let i = 0; i < 1000; i += 1) {
    const cursor = rows(db, "drive_change_cursors")[0];
    if (cursor?.inflight_file_id === fileId && cursor.inflight_attempts === attempts) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`no inflight marker for ${fileId} at attempt ${attempts}`);
}

describe("a run killed on one file (11 Nov 2026: B3B12.mp4, SWEELY 1.mp4)", () => {
  it("dies twice on the file, then records it as failed and moves past it; the next file and the cursor carry on", async () => {
    const db = seed();
    const drive = fakeDrive();
    await primed(db, drive);
    const before = rows(db, "drive_change_cursors")[0].page_token;
    const enzo = folderId(drive, `${EVENT} / 02 Source / Artist clips / Enzo Siragusa`);
    const bad = drive.drop(enzo, "SWEELY 1.mp4");
    drive.drop(enzo, "R21.mp4");
    const imported: string[] = [];
    let killing = true;
    // A killed run never returns from the import: no catch, no finally, nothing saved.
    const importClip: ImportClip = async ({ file }) => {
      if (file.id === bad.id && killing) return new Promise<never>(() => {});
      imported.push(file.name);
      return { files: [{ name: file.name, outcome: "imported", reason: null }], folderError: null };
    };

    for (let attempt = 1; attempt <= PICKUP_MAX_ATTEMPTS; attempt += 1) {
      void runDrivePickup(db, drive, { now: NOW, importClip });
      await untilInflight(db, bad.id, attempt);
      assert.equal(rows(db, "drive_change_cursors")[0].page_token, before, "a killed run saves no cursor");
    }
    assert.deepEqual(imported, []);

    const third = await runDrivePickup(db, drive, { now: NOW, importClip });
    assert.deepEqual(third.clips.map((c) => [c.name, c.outcome, c.reason]), [
      ["SWEELY 1.mp4", "failed", KILLED_RUN_LINE],
      ["R21.mp4", "imported", null],
    ]);
    const cursor = rows(db, "drive_change_cursors")[0];
    assert.equal(cursor.page_token, String(drive.changeLog.length));
    assert.equal(cursor.inflight_file_id, null);
    assert.equal(cursor.inflight_attempts, 0);

    // The feed has moved on: nothing replays.
    const fourth = await runDrivePickup(db, drive, { now: NOW, importClip });
    assert.deepEqual(fourth.clips, []);
    assert.deepEqual(imported, ["R21.mp4"]);

    // Moved out and back once the import can take it: a new change, a fresh count, imported.
    killing = false;
    drive.changeLog.push({ fileId: bad.id, removed: false, file: { ...drive.files.get(bad.id)! } });
    const fifth = await runDrivePickup(db, drive, { now: NOW, importClip });
    assert.deepEqual(fifth.clips.map((c) => [c.name, c.outcome]), [["SWEELY 1.mp4", "imported"]]);
  });

  it("an import that returns or throws clears the marker: only a killed run counts", async () => {
    const db = seed();
    const drive = fakeDrive();
    await primed(db, drive);
    const enzo = folderId(drive, `${EVENT} / 02 Source / Artist clips / Enzo Siragusa`);
    drive.drop(enzo, "clip.mp4");
    let fail = true;
    const importClip: ImportClip = async ({ file }) => {
      if (fail) throw new Error("storage down");
      return { files: [{ name: file.name, outcome: "imported", reason: null }], folderError: null };
    };
    for (let i = 0; i < PICKUP_MAX_ATTEMPTS + 1; i += 1) {
      const res = await runDrivePickup(db, drive, { now: NOW, importClip });
      assert.match(res.errors[0], /storage down/);
      assert.equal(rows(db, "drive_change_cursors")[0].inflight_file_id, null);
    }
    fail = false;
    const ok = await runDrivePickup(db, drive, { now: NOW, importClip });
    assert.deepEqual(ok.clips.map((c) => c.outcome), ["imported"]);
  });

  it("a marker for a file this run never meets (moved away) is cleared when the run finishes", async () => {
    const db = seed();
    const drive = fakeDrive();
    await primed(db, drive);
    Object.assign(rows(db, "drive_change_cursors")[0], { inflight_file_id: "moved-away", inflight_attempts: 1 });
    const { importClip } = recorder();
    await runDrivePickup(db, drive, { now: NOW, importClip });
    assert.equal(rows(db, "drive_change_cursors")[0].inflight_file_id, null);
  });

  it("before migration 230 is applied (no inflight columns) the run works as it did", async () => {
    const inner = seed();
    const drive = fakeDrive();
    await primed(inner, drive);
    const missing = { message: 'column drive_change_cursors.inflight_file_id does not exist' };
    const db = {
      ...inner,
      from(table: string) {
        const builder = inner.from(table) as Record<string, (...args: unknown[]) => unknown>;
        if (table !== "drive_change_cursors") return builder;
        return {
          ...builder,
          select: (columns: string) =>
            columns.includes("inflight") ? { eq: () => ({ maybeSingle: async () => ({ data: null, error: missing }) }) } : builder.select(columns),
          update: (patch: Record<string, unknown>) => ("inflight_file_id" in patch ? { eq: async () => ({ error: missing }) } : builder.update(patch)),
        };
      },
    } as unknown as TestDb;
    drive.drop(folderId(drive, `${EVENT} / 02 Source / Artist clips / Enzo Siragusa`), "clip.mp4");
    const { calls, importClip } = recorder();
    const res = await runDrivePickup(db, drive, { now: NOW, importClip });
    assert.deepEqual(res.errors, []);
    assert.equal(calls.length, 1);
    assert.equal(rows(inner, "drive_change_cursors")[0].page_token, String(drive.changeLog.length));
  });
});

describe("Venue & crowd from a Drive pickup streams the file to disk", () => {
  it("download() is never called; an over-cap original is kept in Drive with its 1080 column copy stored", async () => {
    const db = seed();
    const drive = fakeDrive();
    await primed(db, drive);
    const venue = folderId(drive, `${EVENT} / 02 Source / Venue & crowd`);
    const file = drive.drop(venue, "B3B12.mp4", { bytes: new Uint8Array(4096).fill(3) });
    const uploads: string[] = [];
    const importVenueClip = venueImport(db as never, {
      maxStoredBytes: 1024,
      probeFile: async () => ({ width: 3840, height: 2160, durationInSeconds: 51 }),
      renderProxyFile: async (_input, output) => {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(output, Buffer.alloc(512, 1));
      },
      uploadFile: async (storagePath) => {
        uploads.push(storagePath);
      },
    });
    const res = await runDrivePickup(db, drive, { now: NOW, importClip: recorder().importClip, importVenueClip });
    assert.deepEqual(res.clips.map((c) => [c.name, c.artist, c.outcome]), [["B3B12.mp4", "promoter", "imported"]]);
    assert.ok(drive.calls.includes(`downloadTo ${file.id}`));
    assert.ok(!drive.calls.includes(`download ${file.id}`));
    assert.equal(uploads.length, 1);
    assert.match(uploads[0]!, /proxy-1080/);
    const clip = rows(db, "creative_lab_clips")[0];
    assert.equal(clip.owner, "promoter");
    const master = rows(db, "creative_assets").find((a) => a.id === clip.creative_asset_id)!;
    assert.equal(master.drive_file_id, file.id);
    assert.equal(master.storage_path, null);
  });
});

describe("an over-cap Venue & crowd file is read from Drive by range, never written to disk (SWEELY 1.mp4)", () => {
  const TOKEN = "ya29.PICKUP-TEST-TOKEN";

  function sweely(db: TestDb, drive: FakeDrive) {
    const venue = folderId(drive, `${EVENT} / 02 Source / Venue & crowd`);
    const bytes = new Uint8Array(4096).map((_, i) => i % 256);
    return drive.drop(venue, "SWEELY 1.mp4", { bytes, size: bytes.byteLength });
  }

  function venueDeps(made: string[], uploads: string[]) {
    return {
      maxStoredBytes: 1024,
      probeRemote: async () => ({ width: 3840, height: 2160, durationInSeconds: 56 }),
      renderProxyFile: async (input: string, output: string) => {
        made.push(input);
        const res = await fetch(input, { headers: { Range: "bytes=0-" } });
        assert.equal((await res.arrayBuffer()).byteLength, 4096);
        const { writeFile } = await import("node:fs/promises");
        await writeFile(output, Buffer.alloc(512, 1));
      },
      uploadFile: async (storagePath: string) => {
        uploads.push(storagePath);
      },
    };
  }

  it("fetchMedia only (no downloadTo, no download), ffmpeg's input a loopback URL; the master stays in Drive", async () => {
    const db = seed();
    const drive = fakeDrive();
    await primed(db, drive);
    const file = sweely(db, drive);
    const made: string[] = [];
    const uploads: string[] = [];
    const res = await runDrivePickup(db, drive, { now: NOW, importClip: recorder().importClip, importVenueClip: venueImport(db as never, venueDeps(made, uploads)) });
    assert.deepEqual(res.clips.map((c) => [c.name, c.outcome]), [["SWEELY 1.mp4", "imported"]]);
    assert.ok(drive.calls.some((c) => c.startsWith(`fetchMedia ${file.id}`)));
    assert.ok(!drive.calls.includes(`downloadTo ${file.id}`));
    assert.ok(!drive.calls.includes(`download ${file.id}`));
    assert.match(made[0]!, /^http:\/\/127\.0\.0\.1:\d+\//);
    assert.equal(uploads.length, 1);
    const clip = rows(db, "creative_lab_clips")[0];
    const master = rows(db, "creative_assets").find((a) => a.id === clip.creative_asset_id)!;
    assert.equal(master.drive_file_id, file.id);
    assert.equal(master.storage_path, null);
    assert.equal(master.byte_size, 4096);
    assert.equal(rows(db, "drive_change_cursors")[0].inflight_file_id, null);
  });

  it("a Drive error that carries a token and URL is stored without either, and the run moves on", async () => {
    const db = seed();
    const drive = fakeDrive();
    await primed(db, drive);
    sweely(db, drive);
    drive.failMedia = new Error(`fetch failed: Authorization: Bearer ${TOKEN} https://www.googleapis.com/drive/v3/files/abc?alt=media&access_token=${TOKEN}`);
    const res = await runDrivePickup(db, drive, { now: NOW, importClip: recorder().importClip, importVenueClip: venueImport(db as never, venueDeps([], [])) });
    assert.deepEqual(res.clips.map((c) => c.outcome), ["failed"]);
    assert.ok(res.clips[0]!.reason!.length <= 300);
    const stored = JSON.stringify({ res, cursors: rows(db, "drive_change_cursors") });
    assert.ok(!stored.includes(TOKEN));
    assert.ok(!stored.includes("googleapis"));
    assert.equal(rows(db, "drive_change_cursors")[0].page_token, String(drive.changeLog.length));
  });
});
