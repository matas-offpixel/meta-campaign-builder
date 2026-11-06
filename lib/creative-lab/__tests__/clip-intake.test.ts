import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DriveFetchError } from "../../clients/asset-queue/drive.ts";
import {
  driveFolderShareMessage,
  importArtistClips,
  type ClipFolderFile,
  type ClipFolderListing,
  type ClipProbe,
} from "../clip-intake.ts";
import type { ServiceRoleDb } from "../load.ts";
import { fakeDb } from "./fake-db.ts";

const USER = "op";
const ARTIST = "artist-1";
const SHARE = driveFolderShareMessage("asset-queue@offpixel-drive.iam.gserviceaccount.com");

function artist(over: Record<string, unknown> = {}) {
  return fakeDb({
    creative_lab_artists: [
      {
        id: ARTIST,
        user_id: USER,
        client_id: "client-1",
        name: "Enzo Siragusa",
        rights_doc_ref: "rights-doc",
        approved_at: "2026-11-06T00:00:00Z",
        clip_folder_url: "https://drive.google.com/drive/folders/folder",
        clip_source: "instagram",
        ...over,
      },
    ],
    creative_lab_clips: [],
    creative_assets: [],
  });
}

function listing(files: ClipFolderFile[], download: (file: ClipFolderFile) => Buffer | Promise<Buffer>): ClipFolderListing & { downloads: string[] } {
  const downloads: string[] = [];
  return {
    downloads,
    async list() {
      return files;
    },
    async download(_url, file) {
      downloads.push(file.name);
      return download(file);
    },
  };
}

function probe(_bytes: Buffer, name: string): ClipProbe {
  if (name.includes("long")) return { width: 1080, height: 1920, durationInSeconds: 45.2 };
  if (name.includes("wide")) return { width: 1920, height: 1080, durationInSeconds: 12 };
  return { width: 1080, height: 1920, durationInSeconds: 12 };
}

describe("importArtistClips", () => {
  it("imports a new video and keeps a second pass from downloading it again", async () => {
    const fake = artist();
    const files = listing(
      [
        { sourceFileId: "drive-1", name: "enzo.mp4", size: 100 },
        { sourceFileId: "drive-wide", name: "wide.mp4", size: 80 },
      ],
      (file) => Buffer.from(file.sourceFileId),
    );
    const first = await importArtistClips(fake as unknown as ServiceRoleDb, {
      artistId: ARTIST,
      listing: files,
      upload: async () => undefined,
      probe,
      shareMessage: () => SHARE,
    });
    assert.deepEqual(first.files.map((file) => file.outcome), ["imported", "imported"]);
    assert.equal(first.folderError, null);
    const clip = fake.tables.creative_lab_clips.find((row) => row.source_file_id === "drive-1");
    assert.equal(clip?.source, "instagram");
    assert.equal(clip?.rights_ref, "rights-doc");
    assert.equal(clip?.event_id, null);
    assert.equal(clip?.audio_status, "original");
    assert.equal(clip?.crop_focus_y, 0.5);
    assert.equal(clip?.in_s, null);
    assert.equal(clip?.clip_no, 1);
    const wide = fake.tables.creative_assets.find((row) => row.filename === "wide.mp4");
    assert.equal(wide?.aspect_ratio, "other");
    const again = listing([{ sourceFileId: "drive-1", name: "enzo.mp4", size: 100 }], () => Buffer.from("should-not-download"));
    const second = await importArtistClips(fake as unknown as ServiceRoleDb, {
      artistId: ARTIST,
      listing: again,
      upload: async () => undefined,
      probe,
    });
    assert.equal(second.files[0]?.outcome, "skipped");
    assert.equal(second.files[0]?.reason, "already imported");
    assert.deepEqual(again.downloads, []);
    assert.equal(fake.tables.creative_lab_clips.length, 2);
  });

  it("skips a second file whose bytes match a clip already imported", async () => {
    const fake = artist();
    const files = listing(
      [
        { sourceFileId: "drive-1", name: "enzo.mp4", size: 4 },
        { sourceFileId: "drive-2", name: "enzo-copy.mp4", size: 4 },
      ],
      () => Buffer.from("same"),
    );
    const result = await importArtistClips(fake as unknown as ServiceRoleDb, {
      artistId: ARTIST,
      listing: files,
      upload: async () => undefined,
      probe,
    });
    assert.deepEqual(result.files.map((file) => [file.outcome, file.reason]), [
      ["imported", null],
      ["skipped", "same video as a clip already imported"],
    ]);
    assert.equal(fake.tables.creative_lab_clips.length, 1);
  });

  it("trims a clip over 30 seconds instead of refusing it", async () => {
    const fake = artist();
    const result = await importArtistClips(fake as unknown as ServiceRoleDb, {
      artistId: ARTIST,
      listing: listing([{ sourceFileId: "drive-long", name: "long.mp4", size: 10 }], () => Buffer.from("long")),
      upload: async () => undefined,
      probe,
    });
    assert.equal(result.files[0]?.outcome, "imported");
    assert.equal(result.files[0]?.reason, "trimmed to 30 s");
    assert.equal(fake.tables.creative_lab_clips[0]?.in_s, 0);
    assert.equal(fake.tables.creative_lab_clips[0]?.out_s, 30);
    assert.equal(fake.tables.creative_assets[0]?.duration_seconds, 45.2);
  });

  it("skips a file that is not a video", async () => {
    const fake = artist();
    const files = listing(
      [
        { sourceFileId: "note", name: "notes.txt", size: 3 },
        { sourceFileId: "drive-1", name: "enzo.mp4", size: 10 },
      ],
      (file) => Buffer.from(file.name),
    );
    const result = await importArtistClips(fake as unknown as ServiceRoleDb, {
      artistId: ARTIST,
      listing: files,
      upload: async () => undefined,
      probe,
    });
    assert.equal(result.files[0]?.reason, "not a video");
    assert.deepEqual(files.downloads, ["enzo.mp4"]);
    assert.equal(fake.tables.creative_lab_clips.length, 1);
  });

  it("keeps going when one file fails", async () => {
    const fake = artist();
    const result = await importArtistClips(fake as unknown as ServiceRoleDb, {
      artistId: ARTIST,
      listing: listing(
        [
          { sourceFileId: "a", name: "a.mp4", size: 1 },
          { sourceFileId: "b", name: "b.mp4", size: 1 },
          { sourceFileId: "c", name: "c.mov", size: 1 },
        ],
        (file) => {
          if (file.name === "b.mp4") throw new Error("download failed https://drive.google.com/file/d/SECRET");
          return Buffer.from(file.name);
        },
      ),
      upload: async () => undefined,
      probe,
    });
    assert.deepEqual(result.files.map((file) => file.outcome), ["imported", "failed", "imported"]);
    assert.equal(result.files[1]?.reason?.includes("SECRET"), false);
    assert.equal(result.files[1]?.reason?.includes("http"), false);
    assert.equal(fake.tables.creative_lab_clips.length, 2);
    assert.equal(fake.tables.creative_lab_artists[0]?.clip_folder_last_error, null);
  });

  it("imports a folder for an artist who is not cleared", async () => {
    const fake = artist({ approved_at: null, rights_doc_ref: null });
    let listed = false;
    const result = await importArtistClips(fake as unknown as ServiceRoleDb, {
      artistId: ARTIST,
      listing: {
        async list() {
          listed = true;
          return [];
        },
        async download() {
          return Buffer.from("x");
        },
      },
    });
    assert.equal(listed, true);
    assert.equal(result.folderError, null);
    assert.equal(fake.tables.creative_lab_clips.length, 0);
  });

  it("turns a Drive forbidden or missing folder into the share instruction", async () => {
    for (const code of ["forbidden", "not_found"] as const) {
      const fake = artist();
      const result = await importArtistClips(fake as unknown as ServiceRoleDb, {
        artistId: ARTIST,
        shareMessage: () => SHARE,
        listing: {
          async list() {
            throw new DriveFetchError(code, "nope https://drive.google.com/drive/folders/SECRETID");
          },
          async download() {
            return Buffer.from("x");
          },
        },
      });
      assert.equal(result.folderError, SHARE);
      assert.equal(fake.tables.creative_lab_artists[0]?.clip_folder_last_error, SHARE);
      assert.equal(SHARE.includes("private_key"), false);
      assert.equal(String(result.folderError).includes("SECRETID"), false);
      assert.equal(fake.tables.creative_lab_clips.length, 0);
    }
  });
});
