/**
 * The upload folder, owner first (docs/design-record/2026-11-11-creative-lab-upload-owner.html,
 * U1–U6, HU1–HU5). Fake Drive and fake database: no real Drive, Storage or Lambda call.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fakeDb, type FakeDb } from "../../creative-lab/__tests__/fake-db.ts";
import { FOLDER_MIME } from "../client.ts";
import type { DriveDb, RowOf, TableName } from "../db.ts";
import { ensureCycleFolder, ensureEventTree } from "../folders.ts";
import { uploadOwnerOptions } from "../owner.ts";
import {
  CHOOSE_OWNER,
  CHOOSE_TYPE,
  FOLDER_NOT_IN_TREE,
  OWNER_NEEDED,
  TREE_NOT_MADE,
  anotherFolderChoice,
  creativesKey,
  creativesNote,
  isFinishedCreativeName,
  likelyArtistLine,
  makesFolderLine,
  otherFolderChoices,
  ownerFromName,
  preselectFolder,
  stageCreativesChoice,
  stageFolder,
  uploadReady,
  usualFolders,
  withKind,
  withOwner,
  type OwnerOption,
} from "../panel.ts";
import { parseCreativesKey, placeUploadedFile } from "../place-upload.ts";
import { addDays } from "../tree.ts";
import { fakeDrive, type FakeDrive } from "./fake-drive.ts";

const OWNERS: OwnerOption[] = [
  { ref: "artist:lab-enzo", name: "Enzo Siragusa", kind: "artist" },
  { ref: "artist:lab-luke", name: "Luke Dean", kind: "artist" },
  { ref: "library:lib-reeshy", name: "Reeshy", kind: "artist" },
  { ref: "library:lib-phill", name: "Phill de Janeiro", kind: "artist" },
  { ref: "library:lib-benji", name: "Benji King", kind: "artist" },
  { ref: "promoter", name: "Puzzle", kind: "promoter" },
];
/** CL fixture day: Tue 24 Nov 2026, on sale, cycle w/c 23 Nov (the code's payday calendar). */
const CTX = {
  artists: [{ id: "lab-enzo", name: "Enzo Siragusa" }, { id: "lab-luke", name: "Luke Dean" }],
  status: "on_sale",
  eventDate: "2026-12-27",
  today: "2026-11-24",
  owners: OWNERS,
  eventCode: "P26-BDAY",
};

describe("HU1 the creatives row", () => {
  it("on sale on 24 Nov it reads 03 Creatives / 3 On sale / w/c 23 Nov / … / …; at signup 1 Signup / Teaser; from 21 Dec 4 Show week", () => {
    const onSale = stageCreativesChoice(stageFolder(CTX), OWNERS, null);
    assert.equal(onSale.label, `03 Creatives / 3 On sale / w/c 23 Nov / ${CHOOSE_OWNER} / ${CHOOSE_TYPE}`);
    assert.equal(onSale.key, "03/3/wc/2026-11-23");
    assert.equal(stageFolder({ ...CTX, status: "upcoming", today: "2026-10-10" }).label, "03 Creatives / 1 Signup / Teaser");
    assert.equal(stageFolder({ ...CTX, today: "2026-12-21" }).label, "03 Creatives / 4 Show week");
  });

  it("files to D5's {stage}/owner/{artist:id|promoter}/{videos|statics}; /content is never returned", () => {
    const row = withKind(withOwner(stageCreativesChoice(stageFolder(CTX), OWNERS, null), "artist:lab-luke"), "static");
    assert.equal(row.key, "03/3/wc/2026-11-23/owner/artist:lab-luke/statics");
    assert.equal(withKind(withOwner(row, "promoter"), "video").key, "03/3/wc/2026-11-23/owner/promoter/videos");
    for (let day = "2026-10-01"; day <= "2026-12-31"; day = addDays(day, 1)) {
      for (const status of ["on_sale", "upcoming"]) {
        const stage = stageFolder({ ...CTX, status, today: day });
        assert.ok(!/content/i.test(stage.key) && !/Content/.test(stage.label), `${day} ${status} → ${stage.key}`);
      }
    }
  });

  it("the usual list drops … / Content and carries the creatives row", () => {
    const pdf = preselectFolder({ name: "Puzzle-4th-set-times-v3.pdf", mimeType: "application/pdf" }, CTX);
    const rows = usualFolders(CTX, pdf);
    assert.ok(!rows.some((row) => /Content/.test(row.label)));
    const creatives = rows.find((row) => row.creatives);
    assert.equal(creatives?.label, `03 Creatives / 3 On sale / w/c 23 Nov / ${CHOOSE_OWNER} / ${CHOOSE_TYPE}`);
  });
});

describe("HU2 preselection (the record's acceptance cases)", () => {
  it("P26-BDAY_luke-dean_artist-card-3_on-sale_9x16_v1.png → creatives / Luke Dean / Statics", () => {
    const card = preselectFolder({ name: "P26-BDAY_luke-dean_artist-card-3_on-sale_9x16_v1.png", mimeType: "image/png" }, CTX);
    assert.equal(card.key, "03/3/wc/2026-11-23/owner/artist:lab-luke/statics");
    assert.equal(card.label, "03 Creatives / 3 On sale / w/c 23 Nov / Luke Dean / Statics");
    assert.equal(card.likely, 'likely — "luke dean" in the name');
    assert.equal(uploadReady(card), true);
  });

  it("enzo-boiler-room-2025.mp4 → Artist clips / Enzo Siragusa (S23, unchanged)", () => {
    const clip = preselectFolder({ name: "enzo-boiler-room-2025.mp4", mimeType: "video/mp4" }, { ...CTX, artists: [{ id: "lab-enzo", name: "Enzo" }] });
    assert.equal(clip.label, "02 Source / Artist clips / Enzo");
    assert.equal(clip.creatives, undefined);
  });

  it("IMG_4821.mov → creatives / unset / Videos, Upload disabled", () => {
    const mov = preselectFolder({ name: "IMG_4821.mov", mimeType: "video/quicktime" }, CTX);
    assert.equal(mov.creatives?.owner, null);
    assert.equal(mov.creatives?.kind, "video");
    assert.equal(mov.label, `03 Creatives / 3 On sale / w/c 23 Nov / ${CHOOSE_OWNER} / Videos`);
    assert.equal(uploadReady(mov), false);
    assert.equal(creativesNote(mov), OWNER_NEEDED);
  });

  it("a PDF chosen into creatives → type unset, Upload disabled", () => {
    const pdf = stageCreativesChoice(stageFolder(CTX), OWNERS, { name: "running-order.pdf", mimeType: "application/pdf" });
    assert.equal(pdf.creatives?.kind, null);
    assert.equal(uploadReady(withOwner(pdf, "promoter")), false);
    assert.equal(uploadReady(withKind(withOwner(pdf, "promoter"), "static")), true);
  });

  it("an S14 name goes to creatives ahead of S23's Artist clips rule; a render name too", () => {
    const render = preselectFolder({ name: "P26-BDAY_enzo-siragusa-1_lineup2-on-sale_r1_9x16.mp4", mimeType: "video/mp4" }, CTX);
    assert.equal(render.key, "03/3/wc/2026-11-23/owner/artist:lab-enzo/videos");
    assert.ok(isFinishedCreativeName("P26-BDAY_luke-dean-15_lineup1-on-sale_r1_9x16_winner.mp4", "P26-BDAY"));
    assert.ok(isFinishedCreativeName("P26-BDAY_puzzle_t2_4x5.png", "P26-BDAY"));
    assert.ok(!isFinishedCreativeName("luke-dean_artist-card_9x16.png", "P26-BDAY"));
    assert.ok(!isFinishedCreativeName("P26-BDAY_luke-dean-boiler-room.mp4", "P26-BDAY"));
    assert.ok(!isFinishedCreativeName("P26-BDAY_luke_9x16.png", null));
  });

  it("the owner is never guessed: no lineup name, two artists, or the promoter's name preselect nobody", () => {
    assert.equal(ownerFromName("IMG_4821.mov", OWNERS), null);
    assert.equal(ownerFromName("puzzle-flyer.png", OWNERS), null);
    assert.equal(ownerFromName("luke-dean-b2b-enzo-siragusa.mp4", OWNERS), null);
    // Longest wins over a name inside it.
    assert.equal(ownerFromName("enzo-siragusa-card.png", [...OWNERS, { ref: "artist:lab-e", name: "Enzo", kind: "artist" }])?.name, "Enzo Siragusa");
  });

  it("Announcement, Presale live, Reminders and older cycles take the same pickers through Another folder…; other folders don't", () => {
    const presale = anotherFolderChoice({ key: "03/2/presale-live", label: "03 Creatives / 2 Presale / Presale live" }, { owners: OWNERS, artists: CTX.artists }, { name: "warning.png", mimeType: "image/png" });
    assert.equal(presale.creatives?.folderName, "Presale live");
    assert.equal(withOwner(presale, "promoter").key, "03/2/presale-live/owner/promoter/statics");
    const reports = anotherFolderChoice({ key: "05", label: "05 Reports" }, { owners: OWNERS, artists: CTX.artists });
    assert.equal(reports.creatives, undefined);
    const others = otherFolderChoices({ folderKeys: ["03/3/wc/2026-11-09", "03/3/wc/2026-11-09/content", "03/3/wc/2026-11-23"], currentStageKey: "03/3/wc/2026-11-23" });
    assert.ok(others.some((row) => row.key === "03/3/wc/2026-11-09" && row.label === "03 Creatives / 3 On sale / w/c 9 Nov"));
    assert.ok(!others.some((row) => row.key === "03/3/wc/2026-11-23" || row.key.endsWith("/content")));
    assert.equal(anotherFolderChoice(others.find((row) => row.key === "03/3/wc/2026-11-09")!, { owners: OWNERS, artists: CTX.artists }).creatives?.folderName, "w/c 9 Nov");
  });
});

describe("HU3 words (U4 verbatim)", () => {
  it("each sentence", () => {
    assert.equal(CHOOSE_OWNER, "choose who it's for");
    assert.equal(CHOOSE_TYPE, "choose Videos or Statics");
    assert.equal(OWNER_NEEDED, "Choose who it's for — the file goes in their folder for approval.");
    assert.equal(makesFolderLine("Luke Dean", "Statics", "w/c 23 Nov"), "Makes Luke Dean / Statics in w/c 23 Nov with this upload.");
    assert.equal(likelyArtistLine("luke dean"), 'likely — "luke dean" in the name');
  });

  it("Makes … is said once, under the row, only while that folder isn't made; Teaser and 4 Show week use the stage's own name", () => {
    const card = preselectFolder({ name: "P26-BDAY_luke-dean_artist-card-3_on-sale_9x16_v1.png", mimeType: "image/png" }, CTX);
    assert.equal(creativesNote(card, new Set()), "Makes Luke Dean / Statics in w/c 23 Nov with this upload.");
    assert.equal(creativesNote(card, new Set([creativesKey(card.creatives!)!])), null);
    const teaser = withKind(withOwner(stageCreativesChoice(stageFolder({ ...CTX, status: "upcoming", today: "2026-10-10" }), OWNERS, null), "promoter"), "video");
    assert.equal(creativesNote(teaser, new Set()), "Makes Puzzle / Videos in Teaser with this upload.");
    const show = withKind(withOwner(stageCreativesChoice(stageFolder({ ...CTX, today: "2026-12-22" }), OWNERS, null), "artist:lab-enzo"), "video");
    assert.equal(creativesNote(show, new Set()), "Makes Enzo Siragusa / Videos in 4 Show week with this upload.");
  });
});

// ─── The server side: the owner list, made on upload, the safety net ─────────

type TestDb = FakeDb & DriveDb;

function seed(lineup: { id: string; name: string }[] = [
  { id: "lib-enzo", name: "Enzo Siragusa" },
  { id: "lib-luke", name: "Luke Dean" },
  { id: "lib-reeshy", name: "Reeshy" },
]): TestDb {
  return fakeDb({
    clients: [{ id: "c1", user_id: "u1", name: "Puzzle", status: "active", drive_folder_id: null }],
    events: [{ id: "e1", user_id: "u1", client_id: "c1", name: "Puzzle 4th Birthday", event_code: "P26-BDAY", event_date: "2026-12-27", status: "on_sale", drive_folder_id: null, drive_folder_linked: false }],
    drive_folders: [],
    artists: [...lineup, { id: "lib-gone", name: "Off The Lineup" }],
    event_artists: [
      ...lineup.map((a, i) => ({ id: `ea-${a.id}`, event_id: "e1", artist_id: a.id, source: "lab", billing_order: i + 1 })),
      { id: "ea-copy", event_id: "e1", artist_id: "lib-gone", source: "ad_copy", billing_order: 9 },
    ],
    creative_lab_artists: [
      { id: "lab-enzo", user_id: "u1", client_id: "c1", name: "Enzo Siragusa", artist_id: "lib-enzo" },
      { id: "lab-luke", user_id: "u1", client_id: "c1", name: "Luke Dean", artist_id: "lib-luke" },
      { id: "lab-gone", user_id: "u1", client_id: "c1", name: "Off The Lineup", artist_id: "lib-gone" },
    ],
    drive_kit_audit_files: [],
  }) as unknown as TestDb;
}
const row = <T extends TableName>(db: FakeDb, table: T, id: string) => db.tables[table].find((r) => r.id === id)! as unknown as RowOf<T>;
const W = "Puzzle / 2026-12-27 Puzzle 4th Birthday [P26-BDAY] / 03 Creatives / 3 On sale / w/c 23 Nov";

async function setup(db: TestDb, drive: FakeDrive) {
  await ensureEventTree(db, drive, row(db, "events", "e1"), row(db, "clients", "c1"));
  await ensureCycleFolder(db, drive, row(db, "events", "e1"), row(db, "clients", "c1"), "2026-11-23");
}
async function upload(db: TestDb, drive: FakeDrive, key: string, name = "P26-BDAY_luke-dean_artist-card-3_on-sale_9x16_v1.png") {
  return placeUploadedFile(db, drive, {
    event: row(db, "events", "e1"),
    client: row(db, "clients", "c1"),
    userId: "u1",
    choice: { key, artistName: null },
    name,
    mimeType: "image/png",
    bytes: new Uint8Array([1, 2]),
  });
}
const folders = (drive: FakeDrive) => [...drive.files.values()].filter((f) => f.mimeType === FOLDER_MIME).length;

describe("HU2 / HU3 the owner list", () => {
  it("the Lab lineup in billing order under today's names, then the promoter; someone off the lineup isn't offered", async () => {
    const db = seed();
    row(db, "artists", "lib-luke").name = "Luke Dean (live)";
    const owners = await uploadOwnerOptions(db, row(db, "events", "e1"), row(db, "clients", "c1"));
    assert.deepEqual(owners, [
      { ref: "artist:lab-enzo", name: "Enzo Siragusa", kind: "artist" },
      { ref: "artist:lab-luke", name: "Luke Dean (live)", kind: "artist" },
      { ref: "library:lib-reeshy", name: "Reeshy", kind: "artist" },
      { ref: "promoter", name: "Puzzle", kind: "promoter" },
    ]);
  });

  it("{Client} (promoter) on a clash", async () => {
    const db = seed([{ id: "lib-enzo", name: "Enzo Siragusa" }, { id: "lib-puzzle", name: "Puzzle" }]);
    const owners = await uploadOwnerOptions(db, row(db, "events", "e1"), row(db, "clients", "c1"));
    assert.deepEqual(owners.at(-1), { ref: "promoter", name: "Puzzle (promoter)", kind: "promoter" });
  });
});

describe("HU4 made on upload", () => {
  it("a new Luke Dean / Statics: both folders made once and recorded; a second upload reuses them", async () => {
    const db = seed();
    const drive = fakeDrive();
    await setup(db, drive);
    const before = folders(drive);
    const first = await upload(db, drive, "03/3/wc/2026-11-23/owner/artist:lab-luke/statics");
    assert.equal(drive.pathOf(first.fileId), `${W} / Luke Dean / Statics / P26-BDAY_luke-dean_artist-card-3_on-sale_9x16_v1.png`);
    assert.equal(folders(drive), before + 2);
    assert.ok(db.tables.drive_folders.some((r) => r.key === "03/3/wc/2026-11-23/owner/artist:lab-luke"));
    assert.ok(db.tables.drive_folders.some((r) => r.key === "03/3/wc/2026-11-23/owner/artist:lab-luke/statics"));
    const second = await upload(db, drive, "03/3/wc/2026-11-23/owner/artist:lab-luke/statics", "P26-BDAY_luke-dean_artist-card-3_on-sale_4x5_v1.png");
    assert.equal(folders(drive), before + 2);
    assert.equal(drive.files.get(second.fileId)!.parents![0], drive.files.get(first.fileId)!.parents![0]);
  });

  it("a renamed artist still files by key, into their own folder", async () => {
    const db = seed();
    const drive = fakeDrive();
    await setup(db, drive);
    const first = await upload(db, drive, "03/3/wc/2026-11-23/owner/artist:lab-luke/statics");
    row(db, "artists", "lib-luke").name = "Luke Dean (live)";
    const second = await upload(db, drive, "03/3/wc/2026-11-23/owner/artist:lab-luke/statics", "b.png");
    assert.equal(drive.files.get(second.fileId)!.parents![0], drive.files.get(first.fileId)!.parents![0]);
  });

  it("a lineup artist with no Lab row gets one, the Lab's way, and a folder under the lineup name", async () => {
    const db = seed();
    const drive = fakeDrive();
    await setup(db, drive);
    const placed = await upload(db, drive, "03/3/wc/2026-11-23/owner/library:lib-reeshy/statics", "reeshy.png");
    assert.equal(drive.pathOf(placed.fileId), `${W} / Reeshy / Statics / reeshy.png`);
    const lab = db.tables.creative_lab_artists.find((r) => r.artist_id === "lib-reeshy")!;
    assert.ok(db.tables.drive_folders.some((r) => r.key === `03/3/wc/2026-11-23/owner/artist:${lab.id}/statics`));
  });

  it("a failure refuses with the panel's existing sentence", async () => {
    const db = seed();
    const drive = fakeDrive();
    await setup(db, drive);
    drive.createFolder = async () => {
      throw new Error("Drive create folder failed: HTTP 403 insufficientFilePermissions");
    };
    await assert.rejects(upload(db, drive, "03/3/wc/2026-11-23/owner/promoter/videos"), { message: TREE_NOT_MADE });
  });
});

describe("HU5 the safety net", () => {
  it("a stale client posting 03/3/wc/2026-11-23/content is refused and no folder is created; nothing named Content is made", async () => {
    const db = seed();
    const drive = fakeDrive();
    await setup(db, drive);
    const before = folders(drive);
    await assert.rejects(upload(db, drive, "03/3/wc/2026-11-23/content", "x.png"), { message: FOLDER_NOT_IN_TREE });
    assert.equal(folders(drive), before);
    assert.ok(![...drive.files.values()].some((f) => f.name === "Content"));
  });

  it("a stage folder never takes the file itself; an owner not on this client is refused", async () => {
    const db = seed();
    const drive = fakeDrive();
    await setup(db, drive);
    await assert.rejects(upload(db, drive, "03/3/wc/2026-11-23", "x.png"), { message: FOLDER_NOT_IN_TREE });
    await assert.rejects(upload(db, drive, "03/1/teaser", "x.png"), { message: FOLDER_NOT_IN_TREE });
    await assert.rejects(upload(db, drive, "03/3/wc/2026-11-23/owner/artist:someone-else/statics", "x.png"), { message: FOLDER_NOT_IN_TREE });
    await assert.rejects(upload(db, drive, "03/3/wc/2026-11-23/owner/library:lib-gone/statics", "x.png"), { message: FOLDER_NOT_IN_TREE });
  });

  it("an old cycle's mapped Content still takes a file chosen by hand; the creatives key parses only under a filing stage", async () => {
    const db = seed();
    const drive = fakeDrive();
    await setup(db, drive);
    const old = await drive.createFolder(String(row(db, "events", "e1").drive_folder_id), "Content");
    db.tables.drive_folders.push({ client_id: "c1", event_id: "e1", key: "03/3/wc/2026-11-09/content", name: "Content", drive_folder_id: old.id });
    const placed = await upload(db, drive, "03/3/wc/2026-11-09/content", "hand.png");
    assert.equal(drive.files.get(placed.fileId)!.parents![0], old.id);
    assert.deepEqual(parseCreativesKey("03/2/presale-live/owner/promoter/statics"), { stageKey: "03/2/presale-live", owner: "promoter", id: null, kind: "static" });
    assert.equal(parseCreativesKey("04/owner/promoter/statics"), null);
    assert.equal(parseCreativesKey("03/3/wc/2026-11-23/owner/promoter:x/statics"), null);
    assert.equal(parseCreativesKey("03/3/wc/2026-11-23/owner/artist/statics"), null);
  });
});
