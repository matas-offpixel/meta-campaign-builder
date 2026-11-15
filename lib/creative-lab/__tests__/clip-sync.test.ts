import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clipSyncShouldRecord, runClipSync } from "../clip-sync.ts";
import type { ServiceRoleDb } from "../load.ts";
import { fakeDb, type FakeDb } from "./fake-db.ts";

const USER = "op";

function db(): FakeDb {
  return fakeDb({
    creative_lab_artists: [
      {
        id: "live",
        user_id: USER,
        client_id: "client-live",
        approved_at: "2026-11-06T00:00:00Z",
        clip_folder_url: "https://drive.google.com/drive/folders/live",
        rights_doc_ref: "rights",
        clip_source: "file",
      },
      {
        id: "archived",
        user_id: USER,
        client_id: "client-archived",
        approved_at: "2026-11-06T00:00:00Z",
        clip_folder_url: "https://drive.google.com/drive/folders/archived",
        rights_doc_ref: "rights",
        clip_source: "file",
      },
      {
        id: "unapproved",
        user_id: USER,
        client_id: "client-live",
        approved_at: null,
        clip_folder_url: "https://drive.google.com/drive/folders/wait",
      },
    ],
    creative_lab_clips: [],
    creative_assets: [],
  });
}

describe("creative lab clip sync", () => {
  it("skips an archived client's artist", async () => {
    const fake = db();
    const called: string[] = [];
    const result = await runClipSync(fake as unknown as ServiceRoleDb, {
      archivedClientIds: new Set(["client-archived"]),
      importClips: async (artistId) => {
        called.push(artistId);
        return { files: [], folderError: null };
      },
    });
    assert.deepEqual(called, ["live", "unapproved"]);
    assert.equal(result.skippedArchived, 1);
    assert.equal(clipSyncShouldRecord(result), false);
    assert.equal(clipSyncShouldRecord({ imported: 1, failed: 0 }), true);
    assert.equal(clipSyncShouldRecord({ imported: 0, failed: 1 }), true);
  });

  it("imports at most 10 new files for an artist", async () => {
    const fake = db();
    fake.tables.creative_lab_artists.find((row) => row.id === "unapproved")!.clip_folder_url = null;
    const files = Array.from({ length: 12 }, (_, index) => ({
      sourceFileId: `file-${index}`,
      name: `clip-${index}.mp4`,
      size: 10,
    }));
    const downloaded: string[] = [];
    const result = await runClipSync(fake as unknown as ServiceRoleDb, {
      archivedClientIds: new Set(["client-archived"]),
      upload: async () => undefined,
      probe: () => ({ width: 1080, height: 1920, durationInSeconds: 8 }),
      listing: {
        async list() {
          return files;
        },
        async download(_url, file) {
          downloaded.push(file.name);
          return Buffer.from(file.sourceFileId);
        },
      },
    });
    assert.equal(result.imported, 10);
    assert.equal(result.failed, 0);
    assert.equal(downloaded.length, 10);
    assert.equal(fake.tables.creative_lab_clips.length, 10);
    assert.equal(clipSyncShouldRecord(result), true);
  });
});
