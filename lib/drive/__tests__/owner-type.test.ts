/**
 * Owner first, then type (docs/design-record/2026-11-11-creative-lab-drive-owner-type.html).
 * Fake Drive and fake database only: no real Drive, Storage or Lambda call.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fakeDb, type FakeDb } from "../../creative-lab/__tests__/fake-db.ts";
import { FOLDER_MIME } from "../client.ts";
import type { DriveDb, RowOf, TableName } from "../db.ts";
import { fileRender } from "../filing.ts";
import { ensureCycleFolder, ensureEventKey, ensureEventTree, ensureRouteFolder } from "../folders.ts";
import { stageFolder } from "../panel.ts";
import { formatOwnerMapLine, mapOwnerTypeInPlace } from "../owner-map.ts";
import { runDriveTick } from "../tick.ts";
import {
  ANNOUNCEMENT_KEY,
  PRESALE_LIVE_KEY,
  REMINDERS_KEY,
  SHOW_WEEK_KEY,
  TEASER_KEY,
  cycleKey,
  fortnightlyFrom,
  isFilingStage,
  kindForFile,
  ownerSpec,
  parseOwnerKey,
  promoterOwner,
  routeRender,
  typeSpec,
  type DriveKind,
  type DriveOwner,
} from "../tree.ts";
import { fakeDrive, type FakeDrive } from "./fake-drive.ts";

type TestDb = FakeDb & DriveDb;
const fortnightly = fortnightlyFrom("2026-11-02");
const NOW = new Date("2026-11-17T10:00:00Z");
const deps = { download: async () => new Uint8Array([1]), now: NOW, today: "2026-11-17", calendar: fortnightly };
const EVENT_PATH = "Puzzle / 2026-12-27 Puzzle 4th Birthday [P26-BDAY]";
const CREATIVES = `${EVENT_PATH} / 03 Creatives`;

const LUKE: DriveOwner = { kind: "artist", artistId: "lab-luke", name: "Luke Dean" };
const PUZZLE: DriveOwner = { kind: "promoter", clientName: "Puzzle", clash: false };

function seed(over: { event?: Record<string, unknown>; lineup?: { id: string; name: string }[] } = {}): TestDb {
  const lineup = over.lineup ?? [
    { id: "lib-enzo", name: "Enzo Siragusa" },
    { id: "lib-luke", name: "Luke Dean" },
  ];
  return fakeDb({
    clients: [{ id: "c1", user_id: "u1", name: "Puzzle", status: "active", created_at: "2026-11-10T00:00:00Z", drive_folder_id: null }],
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
        ...over.event,
      },
    ],
    drive_folders: [],
    artists: lineup.map((a) => ({ id: a.id, name: a.name })),
    event_artists: lineup.map((a, i) => ({ id: `ea-${a.id}`, event_id: "e1", artist_id: a.id, source: "lab", billing_order: i + 1 })),
    creative_lab_artists: [
      { id: "lab-enzo", client_id: "c1", name: "Enzo Siragusa", artist_id: "lib-enzo" },
      { id: "lab-luke", client_id: "c1", name: "Luke Dean", artist_id: "lib-luke" },
    ],
    creative_lab_clips: [
      { id: "k-enzo", artist_id: "lab-enzo", owner: "artist", clip_no: 1, event_id: "e1" },
      { id: "k-luke", artist_id: "lab-luke", owner: "artist", clip_no: 15, event_id: "e1" },
      // promoter footage featuring Luke (W8): still the promoter's
      { id: "k-crowd", artist_id: null, owner: "promoter", clip_no: 2, event_id: null, shown_on_event_id: "e1" },
    ],
    creative_lab_clip_features: [{ clip_id: "k-crowd", artist_id: "lab-luke" }],
    creative_lab_captions: [{ id: "cap1", event_id: "e1", style: "lineup", caption_no: 1, mode: "caption" }],
    creative_lab_rounds: [{ id: "r1", event_id: "e1", round_no: 1, status: "draft" }],
    creative_lab_round_ads: [
      { id: "ad1", round_id: "r1", render_id: "rd-enzo" },
      { id: "ad2", round_id: "r1", render_id: "rd-luke-tf" },
      { id: "ad3", round_id: "r1", render_id: "rd-crowd" },
      { id: "ad4", round_id: "r1", render_id: "rd-enzo-static" },
    ],
    creative_assets: [
      { id: "as1", storage_bucket: "campaign-assets", storage_path: "videos/creative-lab/rd-enzo-9x16.mp4" },
      { id: "as2", storage_bucket: "campaign-assets", storage_path: "videos/creative-lab/rd-luke-tf-9x16.mp4" },
      { id: "as3", storage_bucket: "campaign-assets", storage_path: "videos/creative-lab/rd-crowd-9x16.mp4" },
      { id: "as4", storage_bucket: "campaign-assets", storage_path: "images/creative-lab/rd-enzo-static-1x1.png" },
    ],
    creative_lab_renders: [
      { id: "rd-enzo", user_id: "u1", clip_id: "k-enzo", caption_id: "cap1", aspect: "9:16", kind: "video", status: "done", attempt: 1, creative_asset_id: "as1", drive_status: null, drive_attempts: 0 },
      // a triple-fit: one render on Luke's clip 15
      { id: "rd-luke-tf", user_id: "u1", clip_id: "k-luke", caption_id: "cap1", aspect: "9:16", kind: "video", status: "done", attempt: 1, creative_asset_id: "as2", drive_status: null, drive_attempts: 0 },
      { id: "rd-crowd", user_id: "u1", clip_id: "k-crowd", caption_id: "cap1", aspect: "9:16", kind: "video", status: "done", attempt: 1, creative_asset_id: "as3", drive_status: null, drive_attempts: 0 },
      { id: "rd-enzo-static", user_id: "u1", clip_id: "k-enzo", caption_id: "cap1", aspect: "1:1", kind: "static", status: "done", attempt: 1, creative_asset_id: "as4", drive_status: null, drive_attempts: 0 },
    ],
  }) as unknown as TestDb;
}

const row = <T extends TableName>(db: FakeDb, table: T, id: string) => db.tables[table].find((r) => r.id === id)! as unknown as RowOf<T>;

async function tree(db: TestDb, drive: FakeDrive) {
  await ensureEventTree(db, drive, row(db, "events", "e1"), row(db, "clients", "c1"));
}

function pathsUnder(drive: FakeDrive, prefix: string): string[] {
  return [...drive.files.values()].map((f) => drive.pathOf(f.id)).filter((p) => p.startsWith(prefix)).sort();
}

describe("routing: every D4 stage × owner × type", () => {
  const owners: DriveOwner[] = [LUKE, PUZZLE];
  const kinds: DriveKind[] = ["video", "static"];
  it("Lab renders: Teaser at signup, this cycle on sale, 4 Show week from its Monday", () => {
    const cases = [
      { stage: "signup" as const, today: "2026-10-10", stageKey: TEASER_KEY },
      { stage: "on-sale" as const, today: "2026-11-17", stageKey: cycleKey("2026-11-16") },
      { stage: "on-sale" as const, today: "2026-12-21", stageKey: SHOW_WEEK_KEY },
      { stage: "signup" as const, today: "2026-12-22", stageKey: SHOW_WEEK_KEY },
    ];
    for (const c of cases) {
      for (const owner of owners) {
        for (const kind of kinds) {
          const route = routeRender({ ...c, eventDate: "2026-12-27", calendar: fortnightly, owner, kind });
          const ownerPart = owner.kind === "artist" ? `artist:${owner.artistId}` : "promoter";
          assert.equal(route.key, `${c.stageKey}/owner/${ownerPart}/${kind === "video" ? "videos" : "statics"}`);
          assert.equal(route.owner.name, owner.kind === "artist" ? "Luke Dean" : "Puzzle");
          assert.equal(route.type.name, kind === "video" ? "Videos" : "Statics");
          assert.equal(route.owner.parent, c.stageKey);
          assert.equal(route.type.parent, route.owner.key);
        }
      }
    }
  });

  it("every D4 stage folder takes {owner} / {type}, made parent first under it; _Winners and 04 D2C stay flat", async () => {
    const db = seed();
    const drive = fakeDrive();
    await tree(db, drive);
    const stages = [
      [TEASER_KEY, "1 Signup / Teaser"],
      [ANNOUNCEMENT_KEY, "1 Signup / Announcement"],
      [PRESALE_LIVE_KEY, "2 Presale / Presale live"],
      [REMINDERS_KEY, "2 Presale / Reminders"],
      [cycleKey("2026-11-16"), "3 On sale / w/c 16 Nov"],
      [SHOW_WEEK_KEY, "4 Show week"],
    ] as const;
    for (const [stageKey, label] of stages) {
      assert.ok(isFilingStage(stageKey), stageKey);
      for (const owner of owners) {
        for (const kind of kinds) {
          const o = ownerSpec(stageKey, owner);
          const id = await ensureRouteFolder(db, drive, row(db, "events", "e1"), row(db, "clients", "c1"), { stageKey, owner: o, type: typeSpec(o.key, kind) });
          assert.equal(drive.pathOf(id), `${CREATIVES} / ${label} / ${o.name} / ${kind === "video" ? "Videos" : "Statics"}`);
          assert.ok(db.tables.drive_folders.some((r) => r.key === o.key && r.drive_folder_id === drive.files.get(id)!.parents![0]));
        }
      }
    }
    for (const flat of ["winners", "04", "02", "00", "01", "05", "06", "03/1", "03/2", "03/3"]) assert.equal(isFilingStage(flat), false, flat);
  });

  it("a non-render piece goes by its file: a video to Videos, an image to Statics", () => {
    assert.equal(kindForFile({ mimeType: "video/mp4" }), "video");
    assert.equal(kindForFile({ mimeType: "image/png" }), "static");
    assert.equal(kindForFile({ name: "warning-9x16.PNG" }), "static");
    assert.equal(kindForFile({ name: "t2.mov" }), "video");
    assert.equal(kindForFile({ mimeType: "application/pdf", name: "brief.pdf" }), null);
  });

  it("keys are stable and parse back (D5)", () => {
    assert.deepEqual(parseOwnerKey("03/3/wc/2026-11-09/owner/artist:abc/statics"), { stageKey: "03/3/wc/2026-11-09", owner: { kind: "artist", artistId: "abc" }, type: "static" });
    assert.deepEqual(parseOwnerKey("03/4/owner/promoter"), { stageKey: "03/4", owner: { kind: "promoter" }, type: null });
    assert.equal(parseOwnerKey("03/3/wc/2026-11-09/content"), null);
  });
});

describe("owners (D1, D2)", () => {
  it("the promoter is the client's name, or {Client} (promoter) when an artist has it exactly", () => {
    assert.equal(ownerSpec(TEASER_KEY, promoterOwner("Puzzle", ["Luke Dean"])).name, "Puzzle");
    assert.equal(ownerSpec(TEASER_KEY, promoterOwner("Puzzle", ["Luke Dean", "Puzzle"])).name, "Puzzle (promoter)");
    assert.equal(ownerSpec(TEASER_KEY, promoterOwner("Puzzle", ["puzzle"])).name, "Puzzle");
  });

  it("a promoter render on a clash files under {Client} (promoter), next to the artist's own folder", async () => {
    const db = seed({ lineup: [{ id: "lib-enzo", name: "Enzo Siragusa" }, { id: "lib-puzzle", name: "Puzzle" }] });
    const drive = fakeDrive();
    await tree(db, drive);
    await fileRender(db, drive, row(db, "creative_lab_renders", "rd-crowd"), deps);
    assert.deepEqual(drive.childrenNamed(`${CREATIVES} / 3 On sale / w/c 16 Nov`), ["Puzzle (promoter)"]);
  });

  it("a triple-fit is its one clip's owner; promoter footage featuring an artist stays the promoter's", async () => {
    const db = seed();
    const drive = fakeDrive();
    await tree(db, drive);
    await fileRender(db, drive, row(db, "creative_lab_renders", "rd-luke-tf"), deps);
    await fileRender(db, drive, row(db, "creative_lab_renders", "rd-crowd"), deps);
    const w = `${CREATIVES} / 3 On sale / w/c 16 Nov`;
    assert.deepEqual(drive.childrenNamed(`${w} / Luke Dean / Videos`), ["P26-BDAY_luke-dean-15_lineup1-on-sale_r1_9x16.mp4"]);
    assert.deepEqual(drive.childrenNamed(`${w} / Puzzle / Videos`), ["P26-BDAY_puzzle-2_lineup1-on-sale_r1_9x16.mp4"]);
    assert.deepEqual(drive.childrenNamed(w), ["Luke Dean", "Puzzle"]);
  });

  it("a b2b lineup entry is one owner under its exact name; there is no Lineup folder", async () => {
    const db = seed({ lineup: [{ id: "lib-b2b", name: "Locky b2b CW" }] });
    db.tables.creative_lab_artists.push({ id: "lab-b2b", client_id: "c1", name: "Locky B2B CW", artist_id: "lib-b2b" });
    db.tables.creative_lab_clips.push({ id: "k-b2b", artist_id: "lab-b2b", owner: "artist", clip_no: 1, event_id: "e1" });
    db.tables.creative_lab_round_ads.push({ id: "ad5", round_id: "r1", render_id: "rd-b2b" });
    db.tables.creative_lab_renders.push({ id: "rd-b2b", user_id: "u1", clip_id: "k-b2b", caption_id: "cap1", aspect: "9:16", kind: "video", status: "done", attempt: 1, creative_asset_id: "as1", drive_status: null, drive_attempts: 0 });
    const drive = fakeDrive();
    await tree(db, drive);
    await fileRender(db, drive, row(db, "creative_lab_renders", "rd-b2b"), deps);
    // The lineup's string, not the Lab row's casing.
    assert.deepEqual(drive.childrenNamed(`${CREATIVES} / 3 On sale / w/c 16 Nov`), ["Locky b2b CW"]);
    assert.ok(!pathsUnder(drive, CREATIVES).some((p) => /Lineup/.test(p)));
  });

  it("an owner corrected after filing moves nothing; the next filing follows the correction", async () => {
    const db = seed();
    const drive = fakeDrive();
    await tree(db, drive);
    await fileRender(db, drive, row(db, "creative_lab_renders", "rd-enzo"), deps);
    const first = drive.files.get(String(row(db, "creative_lab_renders", "rd-enzo").drive_file_id))!;
    Object.assign(row(db, "creative_lab_clips", "k-enzo"), { owner: "promoter", artist_id: null });
    await fileRender(db, drive, row(db, "creative_lab_renders", "rd-enzo-static"), deps);
    assert.equal(drive.pathOf(first.id), `${CREATIVES} / 3 On sale / w/c 16 Nov / Enzo Siragusa / Videos / ${first.name}`);
    assert.deepEqual(drive.childrenNamed(`${CREATIVES} / 3 On sale / w/c 16 Nov / Puzzle / Statics`), ["P26-BDAY_puzzle-1_lineup1-on-sale_r1_1x1.png"]);
  });
});

describe("made when first needed (D5) and renames by key", () => {
  it("a new tree and a new cycle have no owner or type folders; a filing makes only the ones it needs", async () => {
    const db = seed();
    const drive = fakeDrive();
    await tree(db, drive);
    await ensureCycleFolder(db, drive, row(db, "events", "e1"), row(db, "clients", "c1"), "2026-11-16");
    assert.deepEqual(drive.childrenNamed(`${CREATIVES} / 1 Signup / Teaser`), []);
    assert.deepEqual(drive.childrenNamed(`${CREATIVES} / 3 On sale / w/c 16 Nov`), []);
    assert.ok(!db.tables.drive_folders.some((r) => String(r.key).includes("/owner/")));
    await fileRender(db, drive, row(db, "creative_lab_renders", "rd-enzo"), deps);
    assert.deepEqual(drive.childrenNamed(`${CREATIVES} / 3 On sale / w/c 16 Nov / Enzo Siragusa`), ["Videos"]);
    await fileRender(db, drive, row(db, "creative_lab_renders", "rd-enzo-static"), deps);
    assert.deepEqual(drive.childrenNamed(`${CREATIVES} / 3 On sale / w/c 16 Nov / Enzo Siragusa`), ["Statics", "Videos"]);
    assert.deepEqual(drive.childrenNamed(`${CREATIVES} / 3 On sale / w/c 16 Nov / Enzo Siragusa / Statics`), ["P26-BDAY_enzo-siragusa-1_lineup1-on-sale_r1_1x1.png"]);
  });

  it("renaming Enzo Siragusa to Enzo renames both of his owner folders and no file", async () => {
    const db = seed();
    const drive = fakeDrive();
    await runDriveTick(db, drive, { download: deps.download, now: NOW, calendar: fortnightly });
    row(db, "events", "e1").status = "upcoming";
    await fileRender(db, drive, row(db, "creative_lab_renders", "rd-enzo-static"), { ...deps, today: "2026-10-10" });
    const before = [...drive.files.values()].filter((f) => f.mimeType !== FOLDER_MIME).map((f) => f.name).sort();
    assert.deepEqual(drive.childrenNamed(`${CREATIVES} / 1 Signup / Teaser`), ["Enzo Siragusa"]);
    assert.deepEqual(drive.childrenNamed(`${CREATIVES} / 3 On sale / w/c 16 Nov`), ["Enzo Siragusa", "Luke Dean", "Puzzle"]);
    row(db, "artists", "lib-enzo").name = "Enzo";
    await runDriveTick(db, drive, { download: deps.download, now: NOW, calendar: fortnightly });
    assert.deepEqual(drive.childrenNamed(`${CREATIVES} / 1 Signup / Teaser`), ["Enzo"]);
    assert.deepEqual(drive.childrenNamed(`${CREATIVES} / 3 On sale / w/c 16 Nov`), ["Enzo", "Luke Dean", "Puzzle"]);
    assert.deepEqual([...drive.files.values()].filter((f) => f.mimeType !== FOLDER_MIME).map((f) => f.name).sort(), before);
    // A client rename renames the promoter folder by its key too.
    row(db, "clients", "c1").name = "Puzzle Events";
    await runDriveTick(db, drive, { download: deps.download, now: NOW, calendar: fortnightly });
    assert.ok(drive.childrenNamed("Puzzle Events / 2026-12-27 Puzzle 4th Birthday [P26-BDAY] / 03 Creatives / 3 On sale / w/c 16 Nov").includes("Puzzle Events"));
  });
});

describe("D6 in place: map the client's Content / {owner} folders, move nothing", () => {
  /**
   * P26-BDAY's w/c 9 Nov as Ops left it on 11 Nov: the client holds the link to
   * Content, and Content / Puzzle, Luke Dean and Enzo Siragusa each have Videos
   * and Statics, with the cards in Statics (and one Luke card still loose).
   */
  async function p26(db: TestDb, drive: FakeDrive) {
    await tree(db, drive);
    const event = row(db, "events", "e1");
    const client = row(db, "clients", "c1");
    await ensureCycleFolder(db, drive, event, client, "2026-11-09");
    const cycle = db.tables.drive_folders.find((r) => r.key === cycleKey("2026-11-09"))!;
    const kids: Record<string, string> = {};
    for (const [name, slug] of [["UGC", "ugc"], ["Ticket warnings", "ticket-warnings"], ["Content", "content"]]) {
      kids[name] = (await drive.createFolder(String(cycle.drive_folder_id), name)).id;
      db.tables.drive_folders.push({ client_id: "c1", event_id: "e1", key: `${cycleKey("2026-11-09")}/${slug}`, name, drive_folder_id: kids[name] });
    }
    const owners: Record<string, { id: string; videos: string; statics: string }> = {};
    for (const name of ["Puzzle", "Luke Dean", "Enzo Siragusa"]) {
      const folder = await drive.createFolder(kids.Content, name);
      owners[name] = { id: folder.id, videos: (await drive.createFolder(folder.id, "Videos")).id, statics: (await drive.createFolder(folder.id, "Statics")).id };
    }
    for (const card of [1, 2]) for (const f of ["9x16", "4x5", "1x1"]) {
      const loose = card === 2 && f === "9x16";
      drive.drop(loose ? owners["Luke Dean"].id : owners["Luke Dean"].statics, `P26-BDAY_luke-dean_artist-card-${card}_on-sale_${f}_v3.png`, { mimeType: "image/png" });
    }
    for (const f of ["9x16", "4x5", "1x1"]) drive.drop(owners["Enzo Siragusa"].statics, `P26-BDAY_enzo-siragusa_artist-card-1_on-sale_${f}_v4.png`, { mimeType: "image/png" });
    return { cycle: String(cycle.drive_folder_id), kids, owners };
  }
  const W = `${CREATIVES} / 3 On sale / w/c 9 Nov`;
  const LUKE_KEY = "03/3/wc/2026-11-09/owner/artist:lab-luke";

  it("the dry run lists 9 mappings and 0 moves, checks the client's Content link, and writes nothing", async () => {
    const db = seed();
    const drive = fakeDrive();
    const ids = await p26(db, drive);
    const files = JSON.stringify([...drive.files.values()]);
    const mapBefore = JSON.stringify(db.tables.drive_folders);
    drive.calls.length = 0;
    const dry = await mapOwnerTypeInPlace(db, drive, row(db, "events", "e1"), row(db, "clients", "c1"), { apply: false });
    assert.equal(dry.mappings, 9);
    assert.equal(dry.moves, 0);
    const maps = dry.lines.filter((l) => l.op === "map");
    assert.deepEqual(maps.map((l) => (l as { key: string }).key).sort(), [
      "03/3/wc/2026-11-09/owner/artist:lab-enzo",
      "03/3/wc/2026-11-09/owner/artist:lab-enzo/statics",
      "03/3/wc/2026-11-09/owner/artist:lab-enzo/videos",
      LUKE_KEY,
      `${LUKE_KEY}/statics`,
      `${LUKE_KEY}/videos`,
      "03/3/wc/2026-11-09/owner/promoter",
      "03/3/wc/2026-11-09/owner/promoter/statics",
      "03/3/wc/2026-11-09/owner/promoter/videos",
    ]);
    assert.ok(maps.some((l) => l.op === "map" && l.key === LUKE_KEY && l.id === ids.owners["Luke Dean"].id));
    const content = dry.lines.find((l) => l.op === "content");
    assert.deepEqual(content && { ok: content.op === "content" && content.ok, id: content.op === "content" && content.id }, { ok: true, id: ids.kids.Content });
    assert.ok(dry.lines.some((l) => l.op === "left" && l.path.endsWith("Luke Dean / P26-BDAY_luke-dean_artist-card-2_on-sale_9x16_v3.png")));
    assert.ok(formatOwnerMapLine(maps[0]!).startsWith("map "));
    assert.equal(JSON.stringify([...drive.files.values()]), files);
    assert.equal(JSON.stringify(db.tables.drive_folders), mapBefore);
    assert.ok(!drive.calls.some((c) => !c.startsWith("list") && !c.startsWith("get")), drive.calls.join(", "));
  });

  it("--apply records the 9 folders where they are; later filings land inside the link; a second --apply records nothing new", async () => {
    const db = seed();
    const drive = fakeDrive();
    const ids = await p26(db, drive);
    const files = JSON.stringify([...drive.files.values()]);
    const out = await mapOwnerTypeInPlace(db, drive, row(db, "events", "e1"), row(db, "clients", "c1"), { apply: true });
    assert.equal(out.mappings, 9);
    assert.equal(JSON.stringify([...drive.files.values()]), files);
    assert.equal(db.tables.drive_folders.find((r) => r.key === LUKE_KEY)?.drive_folder_id, ids.owners["Luke Dean"].id);
    assert.equal(db.tables.drive_folders.find((r) => r.key === `${LUKE_KEY}/statics`)?.drive_folder_id, ids.owners["Luke Dean"].statics);
    assert.equal(db.tables.drive_folders.find((r) => r.key === "03/3/wc/2026-11-09/content")?.drive_folder_id, ids.kids.Content);

    const rows = db.tables.drive_folders.length;
    const again = await mapOwnerTypeInPlace(db, drive, row(db, "events", "e1"), row(db, "clients", "c1"), { apply: true });
    assert.equal(again.mappings, 0);
    assert.equal(again.lines.filter((l) => l.op === "mapped").length, 9);
    assert.equal(db.tables.drive_folders.length, rows);

    // A Lab filing for Luke on that cycle goes into Content / Luke Dean / Videos — inside the client's link.
    const filed = await fileRender(db, drive, row(db, "creative_lab_renders", "rd-luke-tf"), { ...deps, today: "2026-11-10", calendar: undefined });
    assert.equal(filed.ok, true);
    const file = drive.files.get((filed as { fileId: string }).fileId)!;
    assert.equal(file.parents![0], ids.owners["Luke Dean"].videos);
    assert.ok(drive.pathOf(file.id).startsWith(`${W} / Content / Luke Dean / Videos / `));
    assert.deepEqual(drive.childrenNamed(W), ["Content", "Ticket warnings", "UGC"]);
  });

  it("records nothing for a folder that is missing, moved or named differently, and never overwrites a key", async () => {
    const db = seed();
    const drive = fakeDrive();
    const ids = await p26(db, drive);
    drive.files.get(ids.owners["Enzo Siragusa"].id)!.name = "enzo siragusa";
    drive.files.get(ids.owners["Puzzle"].videos)!.name = "Video";
    drive.files.get(ids.owners["Luke Dean"].statics)!.parents = [ids.kids.UGC];
    db.tables.drive_folders.push({ client_id: "c1", event_id: "e1", key: `${LUKE_KEY}/videos`, name: "Videos", drive_folder_id: "somewhere-else" });
    const out = await mapOwnerTypeInPlace(db, drive, row(db, "events", "e1"), row(db, "clients", "c1"), { apply: true });
    const keys = db.tables.drive_folders.map((r) => r.key);
    assert.ok(!keys.some((k) => String(k).includes("artist:lab-enzo")));
    assert.ok(!keys.includes("03/3/wc/2026-11-09/owner/promoter/videos"));
    assert.ok(!keys.includes(`${LUKE_KEY}/statics`));
    assert.equal(db.tables.drive_folders.find((r) => r.key === `${LUKE_KEY}/videos`)?.drive_folder_id, "somewhere-else");
    assert.ok(out.lines.some((l) => l.op === "left" && l.path.endsWith("Content / enzo siragusa")));
    assert.ok(out.lines.some((l) => l.op === "left" && l.path.endsWith("Puzzle / Video")));
    assert.ok(out.lines.some((l) => l.op === "conflict" && l.key === `${LUKE_KEY}/videos`));
    assert.equal(out.mappings, 3); // Puzzle, Puzzle/Statics, Luke Dean
  });

  it("a Content row that no longer checks out maps nothing under it", async () => {
    const db = seed();
    const drive = fakeDrive();
    const ids = await p26(db, drive);
    drive.trash(ids.kids.Content);
    const out = await mapOwnerTypeInPlace(db, drive, row(db, "events", "e1"), row(db, "clients", "c1"), { apply: true });
    assert.equal(out.mappings, 0);
    assert.ok(out.lines.some((l) => l.op === "content" && !l.ok && /trash/.test(String(l.why))));
  });
});

describe("known gap: the upload preselect (follow-up, own record)", () => {
  // Matas, 11 Nov: "Follow-up, own record". lib/drive/panel.ts stageFolder still
  // preselects "3 On sale / w/c {d Mon} / Content" for an on-sale upload, drawn in
  // the 9 Nov record's CLS7 frame. D3 no longer makes Content, so from w/c 23 Nov
  // the upload fails ("unknown folder key"). The likely fix is the cycle folder
  // itself. Skipped until that record lands; run it to see the failure.
  it.skip("an on-sale upload into a new cycle reaches its preselected folder", async () => {
    const db = seed();
    const drive = fakeDrive();
    await tree(db, drive);
    const event = row(db, "events", "e1");
    await ensureCycleFolder(db, drive, event, row(db, "clients", "c1"), "2026-11-23");
    const target = stageFolder({ status: "on_sale", eventDate: "2026-12-27", today: "2026-11-24" });
    const id = await ensureEventKey(db, drive, event, row(db, "clients", "c1"), target.key);
    assert.ok(drive.pathOf(id).startsWith(`${CREATIVES} / 3 On sale / w/c 23 Nov`));
  });
});
