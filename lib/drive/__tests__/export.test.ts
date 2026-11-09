import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { fakeDb, type FakeDb } from "../../creative-lab/__tests__/fake-db.ts";
import type { DriveDb, RowOf, TableName } from "../db.ts";
import { APP_TAG_KEY, SHORTCUT_MIME, loadExportServiceAccount } from "../client.ts";
import { MAX_DRIVE_TRIES, fileRender, markWinners, retryDriveCopy } from "../filing.ts";
import { ensureClientTree, ensureCycleFolder, ensureEventTree, markCancelled } from "../folders.ts";
import { runDriveTick } from "../tick.ts";
import { EVENT_TREE, fortnightlyFrom } from "../tree.ts";
import { fakeDrive, type FakeDrive } from "./fake-drive.ts";

const fortnightly = fortnightlyFrom("2026-11-02");
const NOW = new Date("2026-11-17T10:00:00Z");
const EVENT_PATH = "Puzzle / 2026-12-27 Puzzle 4th Birthday [P26-BDAY]";

type TestDb = FakeDb & DriveDb;

function seed(overrides: { client?: Record<string, unknown>; event?: Record<string, unknown> } = {}): TestDb {
  const db = fakeDb({
    clients: [{ id: "c1", name: "Puzzle", status: "active", created_at: "2026-11-10T00:00:00Z", drive_folder_id: null, ...overrides.client }],
    events: [
      {
        id: "e1",
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
        ...overrides.event,
      },
    ],
    drive_folders: [],
    creative_lab_artists: [{ id: "a1", name: "Enzo Siragusa" }],
    creative_lab_clips: [
      { id: "k1", artist_id: "a1", clip_no: 1, event_id: "e1" },
      { id: "k2", artist_id: "a1", clip_no: 2, event_id: "e1" },
    ],
    creative_lab_captions: [
      { id: "cap1", event_id: "e1", style: "lineup", caption_no: 1, mode: "caption" },
      { id: "cap2", event_id: "e1", style: "lineup", caption_no: 2, mode: "caption" },
    ],
    creative_lab_rounds: [{ id: "r1", event_id: "e1", round_no: 1, status: "draft" }],
    creative_lab_round_ads: [
      { id: "ad1", round_id: "r1", render_id: "rd1", verdict: null },
      { id: "ad2", round_id: "r1", render_id: "rd2", verdict: null },
    ],
    creative_assets: [
      { id: "as1", storage_bucket: "campaign-assets", storage_path: "videos/creative-lab/rd1-9x16.mp4" },
      { id: "as2", storage_bucket: "campaign-assets", storage_path: "videos/creative-lab/rd2-9x16.mp4" },
      { id: "as3", storage_bucket: "campaign-assets", storage_path: "videos/creative-lab/rd3-9x16.mp4" },
    ],
    creative_lab_renders: [
      { id: "rd1", user_id: "u1", clip_id: "k1", caption_id: "cap2", aspect: "9:16", status: "done", attempt: 1, creative_asset_id: "as1", drive_status: null, drive_attempts: 0, created_at: "2026-11-17T09:00:00Z" },
      { id: "rd2", user_id: "u1", clip_id: "k2", caption_id: "cap1", aspect: "9:16", status: "done", attempt: 1, creative_asset_id: "as2", drive_status: null, drive_attempts: 0, created_at: "2026-11-17T09:01:00Z" },
      // a render no proposed round uses: never filed
      { id: "rd3", user_id: "u1", clip_id: "k1", caption_id: "cap1", aspect: "9:16", status: "done", attempt: 1, creative_asset_id: "as3", drive_status: null, drive_attempts: 0, created_at: "2026-11-17T09:02:00Z" },
    ],
  });
  return db as unknown as TestDb;
}

const row = <T extends TableName>(db: FakeDb, table: T, id: string) => db.tables[table].find((r) => r.id === id)! as unknown as RowOf<T>;
const download = async () => new Uint8Array([1, 2, 3]);
const deps = { download, now: NOW, today: "2026-11-17", calendar: fortnightly };

async function withTree(db: TestDb, drive: FakeDrive) {
  await ensureEventTree(db, drive, row(db, "events", "e1"), row(db, "clients", "c1"));
}

describe("trees (S19, HS13)", () => {
  it("creates the client folder, _Brand kit and the whole event tree, one map row per folder", async () => {
    const db = seed();
    const drive = fakeDrive();
    await withTree(db, drive);
    assert.deepEqual(drive.childrenNamed("Puzzle"), ["2026-12-27 Puzzle 4th Birthday [P26-BDAY]", "_Brand kit"]);
    assert.deepEqual(drive.childrenNamed(`${EVENT_PATH} / 03 Creatives / 1 Signup / Teaser`), ["Artist", "Experience", "Promoter"]);
    assert.deepEqual(drive.childrenNamed(`${EVENT_PATH} / 03 Creatives / 3 On sale`), []);
    assert.equal(db.tables.drive_folders.length, drive.files.size);
    assert.equal(drive.files.size, 2 + 1 + EVENT_TREE.length);
    assert.ok(row(db, "events", "e1").drive_folder_id);
    assert.ok(row(db, "clients", "c1").drive_folder_id);
  });

  it("is idempotent: a second run creates nothing, and a lost map finds the folders instead of duplicating", async () => {
    const db = seed();
    const drive = fakeDrive();
    await withTree(db, drive);
    const size = drive.files.size;
    await withTree(db, drive);
    assert.equal(drive.files.size, size);
    db.tables.drive_folders = [];
    row(db, "events", "e1").drive_folder_id = null;
    row(db, "clients", "c1").drive_folder_id = null;
    await withTree(db, drive);
    assert.equal(drive.files.size, size);
    assert.equal(db.tables.drive_folders.length, size);
  });

  it("an archived client gets nothing", async () => {
    const db = seed({ client: { status: "archived" } });
    const drive = fakeDrive();
    assert.equal(await ensureClientTree(db, drive, row(db, "clients", "c1")), null);
    const made = await ensureEventTree(db, drive, row(db, "events", "e1"), row(db, "clients", "c1"));
    assert.equal(made.skipped, "archived_client");
    assert.equal(drive.files.size, 0);
  });

  it("a cancelled event: no new tree; an existing folder is marked, nothing deleted", async () => {
    const db = seed({ event: { status: "cancelled" } });
    const drive = fakeDrive();
    const made = await ensureEventTree(db, drive, row(db, "events", "e1"), row(db, "clients", "c1"));
    assert.equal(made.skipped, "cancelled");
    assert.equal(drive.files.size, 0);

    const live = seed();
    const liveDrive = fakeDrive();
    await withTree(live, liveDrive);
    const size = liveDrive.files.size;
    const event = row(live, "events", "e1");
    event.status = "cancelled";
    assert.equal(await markCancelled(live, liveDrive, event), true);
    assert.equal(liveDrive.files.get(String(event.drive_folder_id))!.name, "2026-12-27 Puzzle 4th Birthday [P26-BDAY] (cancelled)");
    assert.equal(liveDrive.files.size, size);
    assert.ok(event.drive_cancel_marked_at);
    assert.equal(await markCancelled(live, liveDrive, event), false);
  });

  it("re-dated: the folder is renamed, its contents stay", async () => {
    const db = seed();
    const drive = fakeDrive();
    await withTree(db, drive);
    const size = drive.files.size;
    row(db, "events", "e1").event_date = "2026-12-28";
    await withTree(db, drive);
    assert.deepEqual(drive.childrenNamed("Puzzle"), ["2026-12-28 Puzzle 4th Birthday [P26-BDAY]", "_Brand kit"]);
    assert.equal(drive.files.size, size);
  });

  it("a linked folder keeps its name and files; the tree is added inside it", async () => {
    const db = seed();
    const drive = fakeDrive();
    await ensureClientTree(db, drive, row(db, "clients", "c1"));
    const linked = await drive.createFolder(String(row(db, "clients", "c1").drive_folder_id), "Puzzle Video");
    for (let i = 0; i < 46; i += 1) await drive.uploadFile({ parentId: linked.id, name: `clip-${i}.mp4`, mimeType: "video/mp4", bytes: new Uint8Array(), appProperties: {} });
    Object.assign(row(db, "events", "e1"), { drive_folder_id: linked.id, drive_folder_linked: true });
    await withTree(db, drive);
    assert.equal(drive.files.get(linked.id)!.name, "Puzzle Video");
    assert.equal(drive.childrenNamed("Puzzle / Puzzle Video").filter((name) => name.startsWith("clip-")).length, 46);
    assert.ok(drive.childrenNamed("Puzzle / Puzzle Video").includes("03 Creatives"));
  });

  it("w/c folder with UGC · Ticket warnings · Content", async () => {
    const db = seed();
    const drive = fakeDrive();
    await withTree(db, drive);
    await ensureCycleFolder(db, drive, row(db, "events", "e1"), row(db, "clients", "c1"), "2026-11-16");
    await ensureCycleFolder(db, drive, row(db, "events", "e1"), row(db, "clients", "c1"), "2026-11-16");
    assert.deepEqual(drive.childrenNamed(`${EVENT_PATH} / 03 Creatives / 3 On sale`), ["w/c 16 Nov"]);
    assert.deepEqual(drive.childrenNamed(`${EVENT_PATH} / 03 Creatives / 3 On sale / w/c 16 Nov`), ["Content", "Ticket warnings", "UGC"]);
  });
});

describe("filing (S20, HS9)", () => {
  it("files Enzo #1 × caption 2 into this cycle's UGC under the S14 name, tagged", async () => {
    const db = seed();
    const drive = fakeDrive();
    await withTree(db, drive);
    const out = await fileRender(db, drive, row(db, "creative_lab_renders", "rd1"), deps);
    assert.equal(out.ok, true);
    const render = row(db, "creative_lab_renders", "rd1");
    assert.equal(render.drive_status, "copied");
    assert.equal(render.status, "done");
    assert.equal(render.drive_file_name, "P26-BDAY_enzo-siragusa-1_lineup2-on-sale_r1_9x16.mp4");
    const file = drive.files.get(String(render.drive_file_id))!;
    assert.equal(drive.pathOf(file.id), `${EVENT_PATH} / 03 Creatives / 3 On sale / w/c 16 Nov / UGC / P26-BDAY_enzo-siragusa-1_lineup2-on-sale_r1_9x16.mp4`);
    assert.equal(file.appProperties?.[APP_TAG_KEY], "lab_render");
  });

  it("signup + quote → Teaser/Artist; signup + lineup → Teaser/Promoter", async () => {
    const db = seed({ event: { status: "upcoming" } });
    const drive = fakeDrive();
    await withTree(db, drive);
    row(db, "creative_lab_captions", "cap2").mode = "quote";
    row(db, "creative_lab_captions", "cap2").style = "quote";
    await fileRender(db, drive, row(db, "creative_lab_renders", "rd1"), deps);
    await fileRender(db, drive, row(db, "creative_lab_renders", "rd2"), deps);
    assert.deepEqual(drive.childrenNamed(`${EVENT_PATH} / 03 Creatives / 1 Signup / Teaser / Artist`), ["P26-BDAY_enzo-siragusa-1_quote2-signup_r1_9x16.mp4"]);
    assert.deepEqual(drive.childrenNamed(`${EVENT_PATH} / 03 Creatives / 1 Signup / Teaser / Promoter`), ["P26-BDAY_enzo-siragusa-2_lineup1-signup_r1_9x16.mp4"]);
  });

  it("a re-render files again as _v2 and leaves the first copy", async () => {
    const db = seed();
    const drive = fakeDrive();
    await withTree(db, drive);
    await fileRender(db, drive, row(db, "creative_lab_renders", "rd1"), deps);
    const first = row(db, "creative_lab_renders", "rd1").drive_file_id;
    row(db, "creative_lab_renders", "rd1").attempt = 2;
    const result = await runDriveTick(db, drive, { download, now: NOW, calendar: fortnightly });
    assert.deepEqual(result.errors, []);
    assert.equal(row(db, "creative_lab_renders", "rd1").drive_file_name, "P26-BDAY_enzo-siragusa-1_lineup2-on-sale_r1_v2_9x16.mp4");
    assert.ok(drive.files.has(String(first)));
  });

  it("a render in no proposed round is never filed and nothing is written", async () => {
    const db = seed();
    const drive = fakeDrive();
    await withTree(db, drive);
    const out = await fileRender(db, drive, row(db, "creative_lab_renders", "rd3"), deps);
    assert.deepEqual(out, { ok: false, renderId: "rd3", skipped: "not_in_a_round" });
    assert.equal(row(db, "creative_lab_renders", "rd3").drive_status, null);
  });

  it("an event with no tree is left alone: drive_status stays null", async () => {
    const db = seed();
    const drive = fakeDrive();
    const out = await fileRender(db, drive, row(db, "creative_lab_renders", "rd1"), deps);
    assert.deepEqual(out, { ok: false, renderId: "rd1", skipped: "no_tree" });
    assert.equal(row(db, "creative_lab_renders", "rd1").drive_status, null);
  });

  it("a failed copy retries with backoff, then fails; the render stays Ready; retry re-queues", async () => {
    const db = seed();
    const drive = fakeDrive();
    await withTree(db, drive);
    drive.failUploads = 99;
    for (let i = 1; i <= MAX_DRIVE_TRIES; i += 1) {
      const out = await fileRender(db, drive, row(db, "creative_lab_renders", "rd1"), deps);
      assert.equal(out.ok, false);
      const render = row(db, "creative_lab_renders", "rd1");
      assert.equal(render.drive_attempts, i);
      assert.equal(render.drive_status, i < MAX_DRIVE_TRIES ? "pending" : "failed");
      assert.equal(render.status, "done");
    }
    const render = row(db, "creative_lab_renders", "rd1");
    assert.match(String(render.drive_error), /503/);
    assert.equal(render.drive_next_attempt_at, null);
    assert.deepEqual(await retryDriveCopy(db, { renderId: "rd1", userId: "someone-else" }), { ok: false, error: "That render isn't on this event." });
    assert.deepEqual(await retryDriveCopy(db, { renderId: "rd1", userId: "u1" }), { ok: true });
    assert.equal(render.drive_status, "pending");
    assert.equal(render.drive_attempts, 0);
    drive.failUploads = 0;
    await fileRender(db, drive, render, deps);
    assert.equal(render.drive_status, "copied");
  });

  it("a pending row waits out its backoff", async () => {
    const db = seed();
    const drive = fakeDrive();
    await withTree(db, drive);
    drive.failUploads = 1;
    await fileRender(db, drive, row(db, "creative_lab_renders", "rd1"), deps);
    const result = await runDriveTick(db, drive, { download, now: new Date(NOW.getTime() + 60_000), calendar: fortnightly, maxFiles: 10 });
    assert.ok(!result.filed.some((f) => f.renderId === "rd1"));
    const later = await runDriveTick(db, drive, { download, now: new Date(NOW.getTime() + 3 * 60_000), calendar: fortnightly, maxFiles: 10 });
    assert.ok(later.filed.some((f) => f.renderId === "rd1" && f.ok));
  });

  it("launch reads no Drive column", () => {
    const launch = readFileSync("lib/creative-lab/launch.ts", "utf8");
    assert.ok(!/drive_/.test(launch));
  });
});

describe("winners (S21, HS19)", () => {
  it("judging a round with two winners renames two files and makes two shortcuts; nothing moves; idempotent", async () => {
    const db = seed();
    const drive = fakeDrive();
    await withTree(db, drive);
    await fileRender(db, drive, row(db, "creative_lab_renders", "rd1"), deps);
    await fileRender(db, drive, row(db, "creative_lab_renders", "rd2"), deps);
    const parents = ["rd1", "rd2"].map((id) => drive.files.get(String(row(db, "creative_lab_renders", id).drive_file_id))!.parents![0]);
    for (const ad of db.tables.creative_lab_round_ads) ad.verdict = "winner";
    const round = row(db, "creative_lab_rounds", "r1");
    round.status = "judged";
    const won = await markWinners(db, drive, round);
    assert.equal(won.length, 2);
    assert.deepEqual(drive.childrenNamed(`${EVENT_PATH} / _Winners`), [
      "P26-BDAY_enzo-siragusa-1_lineup2-on-sale_r1_9x16_winner.mp4",
      "P26-BDAY_enzo-siragusa-2_lineup1-on-sale_r1_9x16_winner.mp4",
    ]);
    const shortcuts = [...drive.files.values()].filter((f) => f.mimeType === SHORTCUT_MIME);
    assert.equal(shortcuts.length, 2);
    ["rd1", "rd2"].forEach((id, i) => {
      const file = drive.files.get(String(row(db, "creative_lab_renders", id).drive_file_id))!;
      assert.ok(file.name.endsWith("_9x16_winner.mp4"));
      assert.equal(file.parents![0], parents[i]);
    });
    assert.deepEqual(await markWinners(db, drive, round), []);
    assert.equal([...drive.files.values()].filter((f) => f.mimeType === SHORTCUT_MIME).length, 2);
  });
});

describe("the tick", () => {
  it("a new event gets its tree, this cycle's folder and its renders filed", async () => {
    const db = seed();
    const drive = fakeDrive();
    const result = await runDriveTick(db, drive, { download, now: NOW, calendar: fortnightly });
    assert.deepEqual(result.errors, []);
    assert.equal(result.trees.events, 1);
    assert.deepEqual(result.cycles, ["P26-BDAY w/c 2026-11-16"]);
    assert.equal(result.filed.filter((f) => f.ok).length, 2);
    assert.deepEqual(drive.childrenNamed(`${EVENT_PATH} / 03 Creatives / 3 On sale / w/c 16 Nov / UGC`).length, 2);
    const again = await runDriveTick(db, drive, { download, now: NOW, calendar: fortnightly });
    assert.deepEqual(again.created, []);
    assert.deepEqual(again.filed, []);
  });

  it("an archived client's new event creates nothing and files nothing", async () => {
    const db = seed({ client: { status: "archived" } });
    const drive = fakeDrive();
    const result = await runDriveTick(db, drive, { download, now: NOW, calendar: fortnightly });
    assert.equal(drive.files.size, 0);
    assert.deepEqual(result.filed, []);
  });

  it("an event made before the cutover gets no tree automatically", async () => {
    const db = seed({ event: { created_at: "2026-10-20T17:39:07Z" }, client: { created_at: "2025-01-01T00:00:00Z" } });
    const drive = fakeDrive();
    await runDriveTick(db, drive, { download, now: NOW, calendar: fortnightly });
    assert.equal(drive.files.size, 0);
  });
});

describe("export account", () => {
  it("reads a service account whose quotes were stripped on paste", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n";
    const sa = loadExportServiceAccount(`{type: service_account, private_key: ${pem}, client_email: x@y.iam.gserviceaccount.com, client_id: 1}`);
    assert.equal(sa.client_email, "x@y.iam.gserviceaccount.com");
    assert.ok(sa.private_key.startsWith("-----BEGIN PRIVATE KEY-----"));
  });
});
