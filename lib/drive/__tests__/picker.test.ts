/** The From Drive picker's server half (G1, G2, G6; HG1, HG2, HG6) on a fake Drive and a fake database. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fakeDb } from "../../creative-lab/__tests__/fake-db.ts";
import { FOLDER_MIME } from "../client.ts";
import { copyPickedFile, loadPickerView, type CopyProgress, type PickerEvent } from "../picker.ts";
import { PICKER_WORDS } from "../picker-model.ts";
import { fakeDrive, type FakeDrive } from "./fake-drive.ts";

const NOW = new Date("2026-11-12T12:00:00Z");
const EVENT: PickerEvent = { id: "e1", name: "Puzzle 4th Birthday", event_code: "P26-BDAY", status: "on_sale", event_date: "2026-12-27", drive_folder_id: null };
const STAGE = "03/3/wc/2026-11-09";
const ENZO = `${STAGE}/owner/artist:lab-enzo`;
const LUKE = `${STAGE}/owner/artist:lab-luke`;
const PUZZLE = `${STAGE}/owner/promoter`;

/** P26-BDAY's shape on 12 Nov: owners mapped in place under the hand-made w/c 9 Nov / Content. */
function tree() {
  const drive = fakeDrive("ROOT");
  const folder = (parent: string, name: string) => drive.drop(parent, name, { mimeType: FOLDER_MIME }).id;
  const event = folder("ROOT", "2026-12-27 Puzzle 4th Birthday [P26-BDAY]");
  const c03 = folder(event, "03 Creatives");
  const onSale = folder(c03, "3 On sale");
  const wc = folder(onSale, "w/c 9 Nov");
  const content = folder(wc, "Content");
  folder(wc, "UGC");
  folder(wc, "_Old");
  const enzo = folder(content, "Enzo Siragusa");
  const luke = folder(content, "Luke Dean");
  const puzzle = folder(content, "Puzzle");
  const enzoVideos = folder(enzo, "Videos");
  const enzoUgc = folder(enzoVideos, "UGC");
  folder(enzoVideos, "_drafts");
  const lukeVideos = folder(luke, "Videos");
  const lukeUgc = folder(lukeVideos, "UGC");
  const puzzleVideos = folder(puzzle, "Videos");
  const outside = folder("ROOT", "Another event");
  const ids = { event, c03, onSale, wc, content, enzo, luke, puzzle, enzoVideos, enzoUgc, lukeVideos, lukeUgc, puzzleVideos, outside };
  const map = [
    ["event", "2026-12-27 Puzzle 4th Birthday [P26-BDAY]", event],
    ["03", "03 Creatives", c03],
    ["03/3", "3 On sale", onSale],
    [STAGE, "w/c 9 Nov", wc],
    [`${STAGE}/content`, "Content", content],
    [ENZO, "Enzo Siragusa", enzo],
    [`${ENZO}/videos`, "Videos", enzoVideos],
    [LUKE, "Luke Dean", luke],
    [`${LUKE}/videos`, "Videos", lukeVideos],
    [PUZZLE, "Puzzle", puzzle],
    [`${PUZZLE}/videos`, "Videos", puzzleVideos],
  ].map(([key, name, id]) => ({ event_id: "e1", key, name, drive_folder_id: id }));
  const db = fakeDb({
    drive_folders: map,
    event_artists: [
      { id: "ea2", event_id: "e1", artist_id: "lib-luke", source: "lab", billing_order: 2 },
      { id: "ea1", event_id: "e1", artist_id: "lib-enzo", source: "lab", billing_order: 1 },
    ],
    artists: [
      { id: "lib-enzo", name: "Enzo Siragusa" },
      { id: "lib-luke", name: "Luke Dean" },
    ],
    creative_assets: [],
  });
  return { drive, db, ids, event: { ...EVENT, drive_folder_id: event } };
}

function clip(drive: FakeDrive, parent: string, name: string, meta: { width?: number; height?: number; durationMs?: number } = { width: 1080, height: 1920, durationMs: 21_800 }, bytes = new Uint8Array(64).fill(5)) {
  return drive.drop(parent, name, { bytes, size: bytes.byteLength, meta: { ...meta, thumbnailLink: "https://lh3.googleusercontent.com/t" } });
}

describe("the tree (G1, HG1)", () => {
  it("no Drive folder is no_tree; no Drive is unreadable", async () => {
    const { db, event } = tree();
    assert.equal((await loadPickerView(db, fakeDrive(), { ...EVENT })).state, "no_tree");
    assert.equal((await loadPickerView(db, null, event)).state, "unreadable");
  });

  it("P26-BDAY opens at w/c 9 Nov's owners although they sit under Content: lineup order, then the promoter; other folders by name, _ hidden", async () => {
    const { db, drive, event } = tree();
    const view = await loadPickerView(db, drive, event, { now: NOW });
    assert.equal(view.state, "ok");
    if (view.state !== "ok") return;
    assert.deepEqual(view.owners.map((o) => o.name), ["Enzo Siragusa", "Luke Dean", "Puzzle"]);
    assert.deepEqual(view.crumbs.map((c) => [c.label, c.menu ?? null]), [["03 Creatives", null], ["3 On sale", null], ["w/c 9 Nov", "cycle"]]);
    assert.deepEqual(view.otherFolders.map((f) => f.name), ["Content", "UGC"]);
    assert.deepEqual(view.cycles.map((c) => c.label), ["w/c 9 Nov"]);
    assert.equal(view.owner, null);
  });

  it("Enzo Siragusa / Videos / UGC: the breadcrumb by stage and owner, folders below by name, and the same path under the other owners", async () => {
    const { db, drive, event, ids } = tree();
    clip(drive, ids.enzoUgc, "P26-BDAY_enzo-siragusa-1_quote-on-sale_r1_9x16.mp4");
    drive.drop(ids.enzoUgc, "notes.txt", { mimeType: "text/plain" });
    const view = await loadPickerView(db, drive, event, { folderId: ids.enzoUgc, now: NOW });
    assert.equal(view.state, "ok");
    if (view.state !== "ok") return;
    assert.deepEqual(view.crumbs.map((c) => c.label), ["03 Creatives", "3 On sale", "w/c 9 Nov", "Enzo Siragusa", "Videos", "UGC"]);
    assert.deepEqual(view.below, ["Videos", "UGC"]);
    assert.equal(view.owner?.name, "Enzo Siragusa");
    assert.deepEqual(view.files.map((f) => [f.name, f.width, f.height, f.durationMs]), [["P26-BDAY_enzo-siragusa-1_quote-on-sale_r1_9x16.mp4", 1080, 1920, 21_800]]);
    assert.deepEqual(view.sameFor.map((s) => [s.owner.name, s.folderId]), [["Luke Dean", ids.lukeUgc], ["Puzzle", null]]);
  });

  it("Videos hides _drafts; a folder outside the event's tree is not_in_tree", async () => {
    const { db, drive, event, ids } = tree();
    const videos = await loadPickerView(db, drive, event, { folderId: ids.enzoVideos, now: NOW });
    assert.equal(videos.state === "ok" && videos.folders.map((f) => f.name).join(), "UGC");
    assert.equal((await loadPickerView(db, drive, event, { folderId: ids.outside, now: NOW })).state, "not_in_tree");
  });
});

describe("the copy (G6, HG6)", () => {
  function deps(db: ReturnType<typeof fakeDb>, drive: FakeDrive) {
    const uploads: string[] = [];
    const copies: [string, string][] = [];
    return {
      uploads,
      copies,
      deps: {
        db,
        drive,
        userId: "u1",
        uploadFile: async (storagePath: string) => {
          uploads.push(storagePath);
        },
        copyObject: async (from: string, to: string) => {
          copies.push([from, to]);
        },
      },
    };
  }

  it("a miss streams Drive → Storage, registers with drive_file_id and hands a throwaway copy on; the next pick of the same file skips Drive", async () => {
    const { db, drive, event, ids } = tree();
    const file = clip(drive, ids.enzoUgc, "P26-BDAY_enzo-siragusa-1_quote-on-sale_r1_9x16.mp4");
    const d = deps(db, drive);
    const seen: CopyProgress[] = [];
    const first = await copyPickedFile(d.deps, event, { fileId: file.id }, (p) => seen.push(p));
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.fromRegistry, false);
    assert.match(d.uploads[0]!, /^videos\/drive\/[0-9a-f]{64}\.mp4$/);
    assert.deepEqual(d.copies[0]![0], d.uploads[0]);
    assert.match(first.storagePath, /^videos\/drive-send\/[0-9a-f-]{36}\.mp4$/);
    assert.ok(seen.some((p) => p.type === "progress" && p.pct === 100));
    const row = db.tables.creative_assets[0]!;
    assert.deepEqual([row.drive_file_id, row.storage_path, row.byte_size, row.id], [file.id, d.uploads[0], 64, first.registryAssetId]);

    const downloads = drive.calls.filter((c) => c.startsWith("downloadTo")).length;
    const again = await copyPickedFile(d.deps, event, { fileId: file.id }, (p) => seen.push(p));
    assert.equal(again.ok && again.fromRegistry, true);
    assert.equal(drive.calls.filter((c) => c.startsWith("downloadTo")).length, downloads);
    assert.equal(d.uploads.length, 1);
    assert.equal(seen[seen.length - 1]?.type, "registry");
  });

  it("refuses a file outside the tree, a measured landscape, an unmeasured clip that turns out not 9:16, and one over the limit — nothing uploaded", async () => {
    const { db, drive, event, ids } = tree();
    const outside = clip(drive, ids.outside, "x.mp4");
    const landscape = clip(drive, ids.enzoUgc, "terrace.mov", { width: 1920, height: 1080 });
    const unmeasured = clip(drive, ids.enzoUgc, "new.mp4", {});
    const big = clip(drive, ids.enzoUgc, "big.mp4");
    drive.files.get(big.id)!.size = 201 * 1024 * 1024;
    const d = deps(db, drive);
    const measure = async () => ({ width: 1920, height: 1080 });
    const results = [
      await copyPickedFile(d.deps, event, { fileId: outside.id }),
      await copyPickedFile(d.deps, event, { fileId: landscape.id }),
      await copyPickedFile({ ...d.deps, measure }, event, { fileId: unmeasured.id }),
      await copyPickedFile(d.deps, event, { fileId: big.id }),
    ];
    assert.deepEqual(results.map((r) => (r.ok ? "ok" : r.code)), ["not_in_tree", "not_916", "not_916", "too_large"]);
    assert.equal(!results[1]!.ok && results[1]!.reason, PICKER_WORDS.notNineSixteenVideo);
    assert.equal(!results[3]!.ok && results[3]!.reason, PICKER_WORDS.overVideo);
    assert.deepEqual(d.uploads, []);
    assert.equal(db.tables.creative_assets.length, 0);
  });

  it("a row the browser registered first (same bytes, no drive_file_id) gets this file's id, and its own path is used", async () => {
    const { db, drive, event, ids } = tree();
    const bytes = new Uint8Array(64).fill(5);
    const file = clip(drive, ids.enzoUgc, "P26-BDAY_enzo-siragusa-4_quote-on-sale_r1_9x16.mp4", undefined, bytes);
    const { createHash } = await import("node:crypto");
    db.tables.creative_assets.push({ id: "browser", user_id: "u1", content_hash: createHash("sha256").update(bytes).digest("hex"), byte_size: 64, filename: "x.mp4", media_kind: "video", aspect_ratio: "9:16", storage_bucket: "campaign-assets", storage_path: "videos/browser.mp4", drive_file_id: null });
    const d = deps(db, drive);
    const res = await copyPickedFile(d.deps, event, { fileId: file.id });
    assert.equal(res.ok && res.registryAssetId, "browser");
    assert.deepEqual(d.uploads, []);
    assert.deepEqual(d.copies[0]![0], "videos/browser.mp4");
    assert.equal(db.tables.creative_assets[0]!.drive_file_id, file.id);
  });
});
