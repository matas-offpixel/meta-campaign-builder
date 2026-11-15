import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fakeDb, type FakeDb } from "../../creative-lab/__tests__/fake-db.ts";
import type { DriveDb } from "../db.ts";
import { FOLDER_MIME } from "../client.ts";
import {
  artistFolderMissSentence,
  finishedLabRenders,
  nextSharePhase,
  panelNowLine,
  preselectFolder,
  stageFolder,
} from "../panel.ts";
import { linkEventFolder, parseDriveFolderId, resolveDriveFolder } from "../setup.ts";
import { fortnightlyFrom } from "../tree.ts";
import { fakeDrive } from "./fake-drive.ts";

const calendar = fortnightlyFrom("2026-11-02");
const today = "2026-11-17";
const ctx = {
  artists: [{ id: "enzo", name: "Enzo Siragusa" }],
  status: "on_sale",
  eventDate: "2026-12-27",
  today,
  calendar,
};

describe("drive panel", () => {
  it("files the on-sale cycle the fixture is in", () => {
    assert.equal(panelNowLine({ status: "on_sale", eventDate: "2026-12-27", today, calendar }), "now: 3 On sale / w/c 16 Nov");
    // U1 (2026-11-11 upload-owner record): the stage itself, never "/ Content".
    assert.equal(stageFolder(ctx).label, "03 Creatives / 3 On sale / w/c 16 Nov");
    assert.equal(stageFolder(ctx).key, "03/3/wc/2026-11-16");
  });

  it("preselects the folder from the file", () => {
    assert.equal(preselectFolder({ name: "Puzzle-4th-set-times-v3.pdf" }, ctx).key, "00");
    assert.equal(preselectFolder({ name: "Puzzle-4th-set-times-v3.pdf" }, ctx).likely, 'likely — "set times" in the name');
    assert.equal(preselectFolder({ name: "lineup.psd" }, ctx).key, "01");
    const clip = preselectFolder({ name: "enzo-boiler-room-2025.mp4", fromClips: true }, ctx);
    assert.equal(clip.label, "02 Source / Artist clips / Enzo Siragusa");
    assert.equal(clip.artistName, "Enzo Siragusa");
  });

  it("asks before it shares", () => {
    const asked = nextSharePhase("idle", "share");
    assert.equal(asked.call, null);
    assert.equal(asked.phase, "asking");
    assert.equal(nextSharePhase("asking", "share").call, "share");
    assert.equal(nextSharePhase("asking", "dismiss").call, null);
    assert.equal(nextSharePhase("idle", "stop").call, "stop");
  });

  it("says a folder matched no lineup name", () => {
    assert.equal(
      artistFolderMissSentence("enzo siragusa"),
      "A folder in Artist clips matches no artist: 'enzo siragusa' — rename it to the artist's name.",
    );
  });

  it("lists this event's finished renders, including a failed Drive copy", () => {
    const rows = finishedLabRenders("e1", [
      { id: "a", eventId: "e1", status: "done", driveStatus: "copied", roundNo: 1, createdAt: "2026-11-17T09:00:00Z" },
      { id: "b", eventId: "e1", status: "done", driveStatus: "failed", roundNo: 1, createdAt: "2026-11-17T10:00:00Z" },
      { id: "c", eventId: "e1", status: "rendering", driveStatus: null, roundNo: 1, createdAt: "2026-11-17T11:00:00Z" },
      { id: "d", eventId: "other", status: "done", driveStatus: "copied", roundNo: 2, createdAt: "2026-11-17T12:00:00Z" },
    ]);
    assert.deepEqual(rows.map((row) => row.id), ["b", "a"]);
  });
});

describe("link a folder", () => {
  it("reads a Drive folder link", () => {
    assert.equal(parseDriveFolderId("https://drive.google.com/drive/folders/1kPzVabc"), "1kPzVabc");
    assert.equal(parseDriveFolderId("not a link"), null);
  });

  it("leaves the folder's files where they were and adds the tree's empty folders", async () => {
    const drive = fakeDrive("ROOT");
    const puzzle = await drive.createFolder(drive.driveId, "Puzzle");
    const video = await drive.createFolder(puzzle.id, "Puzzle Video");
    const ids: string[] = [];
    for (let n = 0; n < 46; n += 1) ids.push(drive.drop(video.id, `clip-${n}.mp4`).id);
    const resolved = await resolveDriveFolder(drive, video.id);
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.name, "Puzzle Video");
    assert.equal(resolved.fileCount, 46);
    assert.equal(resolved.place, "Off / Pixel › Puzzle");

    const db = fakeDb({
      clients: [{ id: "c1", name: "Puzzle", status: "active", drive_folder_id: null }],
      events: [{
        id: "e1",
        client_id: "c1",
        name: "Puzzle 4th Birthday",
        event_code: "P26-BDAY",
        event_date: "2026-12-27",
        status: "on_sale",
        drive_folder_id: null,
        drive_folder_linked: false,
        drive_cancel_marked_at: null,
      }],
      drive_folders: [],
    }) as unknown as FakeDb & DriveDb;
    const event = db.tables.events[0]!;
    const client = db.tables.clients[0]!;
    await linkEventFolder(db, drive, event as never, client as never, video.id);
    for (const id of ids) {
      assert.deepEqual(drive.files.get(id)?.parents, [video.id]);
    }
    assert.equal(drive.files.get(video.id)?.name, "Puzzle Video");
    const children = await drive.listChildren(video.id);
    assert.equal(children.filter((child) => child.mimeType !== FOLDER_MIME).length, 46);
    assert.ok(children.some((child) => child.name === "00 Brief & admin"));
    assert.ok(children.some((child) => child.name === "_Winners"));
    assert.equal(event.drive_folder_id, video.id);
    assert.equal(event.drive_folder_linked, true);
  });

  it("refuses a folder the export account cannot open", async () => {
    const drive = fakeDrive("ROOT");
    const resolved = await resolveDriveFolder(drive, "missing");
    assert.deepEqual(resolved, {
      ok: false,
      error: "Can't open that folder — share it with the export account or move it into Off / Pixel, then link it again.",
    });
  });
});
