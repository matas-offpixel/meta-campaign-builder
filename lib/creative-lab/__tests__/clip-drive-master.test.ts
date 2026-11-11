import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { rowToCreativeAsset, upsertRegisteredAsset, fingerprintBytes } from "../../creatives/asset-registry.ts";
import { DRIVE_MASTER_LINES, MAX_STORED_BYTES, importArtistClips, type ClipFolderFile, type ClipProbe, type ImportedClip } from "../clip-intake.ts";
import type { ServiceRoleDb } from "../load.ts";
import type { ProxySize } from "../render-proxy.ts";
import { fakeDb } from "./fake-db.ts";

const USER = "op";
const EVENT = "event-1";

function promoterFake() {
  return fakeDb({ creative_lab_clips: [], creative_assets: [] });
}

function run(fake: ReturnType<typeof promoterFake>, files: ClipFolderFile[], opts: { probe: ClipProbe; drive?: boolean; made?: ProxySize[]; uploads?: string[]; onImported?: ImportedClip[]; renderProxy?: false }) {
  const bytes = Buffer.alloc(64, 7);
  return importArtistClips(fake as unknown as ServiceRoleDb, {
    asPromoter: { userId: USER, rightsRef: "Venue & crowd" },
    eventId: EVENT,
    source: "file",
    folderUrl: "drive-export:folder",
    maxStoredBytes: 32,
    listing: { list: async () => files, download: async () => bytes },
    probe: () => opts.probe,
    upload: async (path) => {
      opts.uploads?.push(path);
    },
    renderProxy: opts.renderProxy ?? (async (_b, size) => {
      opts.made?.push(size);
      return Buffer.from(`copy ${size.width}x${size.height}`);
    }),
    ...(opts.drive === false ? {} : { driveMaster: (f) => `drive-${f.sourceFileId}` }),
    onImported: async (c) => {
      opts.onImported?.push(c);
    },
  });
}

describe("migration 228 · an original over the storage cap stays in Drive; only its 1080 copy is stored", () => {
  it("a 3840 × 2160 original over the cap: no upload of the original, the copy at 3414 × 1920, the master by its Drive id, the clip on both", async () => {
    const fake = promoterFake();
    const made: ProxySize[] = [];
    const uploads: string[] = [];
    const imported: ImportedClip[] = [];
    const res = await run(fake, [{ sourceFileId: "b3b12", name: "B3B12.mp4", size: 406_000_000 }], { probe: { width: 3840, height: 2160, durationInSeconds: 51 }, made, uploads, onImported: imported });
    assert.equal(res.files[0]!.outcome, "imported", JSON.stringify(res.files));
    assert.deepEqual(made, [{ width: 3414, height: 1920 }]);
    assert.equal(uploads.length, 1);
    assert.match(uploads[0]!, /^videos\/creative-lab\/promoter\/proxy-1080\/[0-9a-f]{64}\.mp4$/);
    const clip = fake.tables.creative_lab_clips[0]!;
    const master = fake.tables.creative_assets.find((a) => a.id === clip.creative_asset_id)!;
    const copy = fake.tables.creative_assets.find((a) => a.id === clip.render_asset_id)!;
    assert.equal(master.storage_path, null);
    assert.equal(master.drive_file_id, "drive-b3b12");
    assert.equal(master.storage_bucket, "drive");
    assert.equal(master.filename, "B3B12.mp4");
    assert.equal(copy.storage_path, uploads[0]);
    assert.equal(copy.storage_bucket, "campaign-assets");
    assert.equal(copy.filename, "B3B12 (1080 proxy).mp4");
    assert.equal(clip.owner, "promoter");
    assert.equal(clip.shown_on_event_id, EVENT);
    assert.equal(clip.in_s, 0);
    assert.equal(clip.out_s, 30);
    assert.equal(imported[0]!.storagePath, "");
    assert.equal(imported[0]!.driveFileId, "drive-b3b12");
    assert.equal(imported[0]!.renderStoragePath, uploads[0]);
  });

  it("over the cap without a Drive file: it fails with the line, and nothing is stored or inserted", async () => {
    const fake = promoterFake();
    const uploads: string[] = [];
    const res = await run(fake, [{ sourceFileId: "x", name: "big.mp4", size: 300_000_000 }], { probe: { width: 3840, height: 2160, durationInSeconds: 40 }, drive: false, uploads });
    assert.deepEqual(res.files.map((f) => [f.outcome, f.reason]), [["failed", DRIVE_MASTER_LINES.notInDrive]]);
    assert.equal(uploads.length, 0);
    assert.equal(fake.tables.creative_lab_clips.length, 0);
    assert.equal(fake.tables.creative_assets.length, 0);
  });

  it("over the cap with no smaller copy to make (already 1080 × 1920), or the copy switched off: it fails, nothing stored", async () => {
    for (const [probe, renderProxy, line] of [
      [{ width: 1080, height: 1920, durationInSeconds: 600 }, undefined, DRIVE_MASTER_LINES.noCopy],
      [{ width: 3840, height: 2160, durationInSeconds: 40 }, false, DRIVE_MASTER_LINES.copyOff],
    ] as const) {
      const fake = promoterFake();
      const uploads: string[] = [];
      const res = await run(fake, [{ sourceFileId: "y", name: "long.mp4", size: 250_000_000 }], { probe, uploads, renderProxy });
      assert.deepEqual(res.files.map((f) => [f.outcome, f.reason]), [["failed", line]]);
      assert.equal(uploads.length, 0);
      assert.equal(fake.tables.creative_lab_clips.length, 0);
    }
  });

  it("a copy that fails leaves no clip row behind", async () => {
    const fake = promoterFake();
    const res = await importArtistClips(fake as unknown as ServiceRoleDb, {
      asPromoter: { userId: USER, rightsRef: "Venue & crowd" },
      eventId: EVENT,
      folderUrl: "drive-export:folder",
      maxStoredBytes: 32,
      listing: { list: async () => [{ sourceFileId: "z", name: "z.mp4", size: 1 }], download: async () => Buffer.alloc(64) },
      probe: () => ({ width: 3840, height: 2160, durationInSeconds: 20 }),
      upload: async () => undefined,
      renderProxy: async () => {
        throw new Error("ffmpeg died");
      },
      driveMaster: () => "drive-z",
    });
    assert.equal(res.files[0]!.outcome, "failed");
    assert.equal(fake.tables.creative_lab_clips.length, 0);
  });

  it("under the cap nothing changes: the original is uploaded and stored as before", async () => {
    const fake = promoterFake();
    const uploads: string[] = [];
    const res = await importArtistClips(fake as unknown as ServiceRoleDb, {
      asPromoter: { userId: USER, rightsRef: "Venue & crowd" },
      eventId: EVENT,
      folderUrl: "drive-export:folder",
      listing: { list: async () => [{ sourceFileId: "s", name: "small.mp4", size: 64 }], download: async () => Buffer.alloc(64, 3) },
      probe: () => ({ width: 1080, height: 1920, durationInSeconds: 20 }),
      upload: async (p) => {
        uploads.push(p);
      },
      driveMaster: () => "drive-s",
    });
    assert.equal(res.files[0]!.outcome, "imported");
    assert.equal(uploads.length, 1);
    const asset = fake.tables.creative_assets[0]!;
    assert.equal(asset.storage_path, uploads[0]);
    assert.equal(asset.drive_file_id ?? null, null);
    assert.equal(MAX_STORED_BYTES, 200 * 1024 * 1024);
  });

  it("the registry refuses a row with neither a storage path nor a Drive file, and reads a Drive master's path as \"\"", async () => {
    const fake = promoterFake();
    const r = await upsertRegisteredAsset(fake as unknown as ServiceRoleDb, { userId: USER, identity: fingerprintBytes(Buffer.from("a")), filename: "a.mp4", mediaKind: "video", aspectRatio: "9:16", storageBucket: "drive", storagePath: null });
    assert.equal(r.ok, false);
    const row = rowToCreativeAsset({ id: "m", user_id: USER, content_hash: "h", byte_size: 1, filename: "m.mp4", media_kind: "video", aspect_ratio: "16:9", storage_bucket: "drive", storage_path: null, drive_file_id: "drive-m" });
    assert.equal(row.storagePath, "");
    assert.equal(row.driveFileId, "drive-m");
  });

  it("the Drive pickup hands both of its imports the file's Drive id", () => {
    const src = readFileSync(join(process.cwd(), "lib/drive/pickup.ts"), "utf8");
    assert.equal(src.match(/driveMaster: \(\) => file\.id/g)?.length, 2);
  });

  it("the Clips section previews a Drive master through its render copy", () => {
    const src = readFileSync(join(process.cwd(), "lib/db/creative-lab.ts"), "utf8");
    assert.match(src, /const playable = text\(asset, "storage_path"\) \? asset : assetOf\.get\(text\(row, "render_asset_id"\)\)/);
    assert.match(src, /hasFile: Boolean\(text\(playable, "storage_path"\)\)/);
  });

  it("migration 228: drive_file_id, storage_path nullable only beside it, and nothing dropped", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/228_creative_assets_drive_master.sql"), "utf8");
    assert.match(sql, /add column if not exists drive_file_id text/);
    assert.match(sql, /alter column storage_path drop not null/);
    assert.match(sql, /check \(storage_path is not null or drive_file_id is not null\)/);
    assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /drop (table|column)|delete from|truncate/i);
  });
});
