/**
 * File mode of the clip import (listing.downloadToFile, the Drive pickup):
 * a 4K original the size of B3B12.mp4 (406,425,869 B, 11 Nov 2026) goes
 * from the download to disk, through the copy maker and the upload, and the
 * process never holds more than a few chunks of it.
 */

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import { writeStreamToFile } from "../../creatives/stream-file.ts";
import { DRIVE_MASTER_LINES, importArtistClips, type ClipFolderFile, type ClipProbe } from "../clip-intake.ts";
import type { ServiceRoleDb } from "../load.ts";
import type { FileProxyMaker, ProxySize } from "../render-proxy.ts";
import { fakeDb } from "./fake-db.ts";

const B3B12_BYTES = 406_425_869;
const CHUNK = 1024 * 1024;
const USER = "op";
const EVENT = "P26-BDAY";

/** Array-buffer memory above where the test started (Buffers live there). */
function memoryMeter() {
  const base = process.memoryUsage().arrayBuffers;
  let peak = 0;
  return {
    sample() {
      peak = Math.max(peak, process.memoryUsage().arrayBuffers - base);
    },
    get peak() {
      return peak;
    },
  };
}

/** A fake Drive body: `total` bytes in 1 MiB chunks of one random block, never the whole file. */
async function* fakeDriveBody(total: number, block: Buffer, onChunk: () => void): AsyncGenerator<Uint8Array> {
  let sent = 0;
  while (sent < total) {
    const n = Math.min(CHUNK, total - sent);
    sent += n;
    onChunk();
    yield n === CHUNK ? block : block.subarray(0, n);
  }
}

function expectedHash(total: number, block: Buffer): string {
  const hash = createHash("sha256");
  for (let sent = 0; sent < total; sent += CHUNK) hash.update(block.subarray(0, Math.min(CHUNK, total - sent)));
  return hash.digest("hex");
}

async function streamedLength(filePath: string, onChunk: () => void): Promise<number> {
  let n = 0;
  for await (const chunk of createReadStream(filePath)) {
    n += (chunk as Buffer).byteLength;
    onChunk();
  }
  return n;
}

type Seen = { uploads: { storagePath: string; bytes: number }[]; made: ProxySize[]; tempPaths: string[]; probedBytes: number[] };

function run(opts: {
  total: number;
  block: Buffer;
  probe: ClipProbe;
  meter: ReturnType<typeof memoryMeter>;
  seen: Seen;
  maxStoredBytes?: number;
  copyBytes?: number;
  fake?: ReturnType<typeof fakeDb>;
}) {
  const fake = opts.fake ?? fakeDb({ creative_lab_clips: [], creative_assets: [] });
  const file: ClipFolderFile = { sourceFileId: "drive-b3b12", name: "B3B12.mp4", size: opts.total };
  const make: FileProxyMaker = async (input, output, size) => {
    opts.seen.made.push(size);
    // The maker reads the original from disk, as ffmpeg does.
    assert.equal(await streamedLength(input, opts.meter.sample), opts.total);
    await writeFile(output, Buffer.alloc(opts.copyBytes ?? 4096, 1));
  };
  const promise = importArtistClips(fake as unknown as ServiceRoleDb, {
    asPromoter: { userId: USER, rightsRef: "Venue & crowd" },
    eventId: EVENT,
    source: "file",
    folderUrl: "drive-export:drive-b3b12",
    maxNew: 1,
    ...(opts.maxStoredBytes != null ? { maxStoredBytes: opts.maxStoredBytes } : {}),
    listing: {
      list: async () => [file],
      download: async () => {
        throw new Error("file mode must not read the original into memory");
      },
      downloadToFile: async (_url, _file, filePath) => {
        opts.seen.tempPaths.push(filePath);
        return writeStreamToFile(fakeDriveBody(opts.total, opts.block, opts.meter.sample), filePath);
      },
    },
    probe: () => {
      throw new Error("file mode probes the file, not bytes");
    },
    probeFile: async (filePath) => {
      opts.seen.probedBytes.push((await stat(filePath)).size);
      return opts.probe;
    },
    upload: async () => {
      throw new Error("file mode uploads from disk");
    },
    uploadFile: async (storagePath, filePath) => {
      opts.seen.uploads.push({ storagePath, bytes: await streamedLength(filePath, opts.meter.sample) });
    },
    renderProxyFile: make,
    driveMaster: (f) => f.sourceFileId,
  });
  return { fake, promise };
}

const newSeen = (): Seen => ({ uploads: [], made: [], tempPaths: [], probedBytes: [] });

describe("file mode · a 4K original streams to disk, never into memory", () => {
  it("B3B12's 406 MB: imported with its Drive master and the 1080 × 1920 column copy, under 64 MB of buffers at any point", async () => {
    const block = randomBytes(CHUNK);
    const meter = memoryMeter();
    const seen = newSeen();
    const { fake, promise } = run({ total: B3B12_BYTES, block, probe: { width: 3840, height: 2160, durationInSeconds: 51 }, meter, seen });
    const res = await promise;
    meter.sample();

    assert.equal(res.files[0]!.outcome, "imported", JSON.stringify(res.files));
    assert.ok(meter.peak < 64 * 1024 * 1024, `peak array-buffer memory ${Math.round(meter.peak / 1024 / 1024)} MB`);
    assert.ok(meter.peak < B3B12_BYTES / 6);
    assert.deepEqual(seen.probedBytes, [B3B12_BYTES]);
    assert.deepEqual(seen.made, [{ width: 1080, height: 1920 }]);
    // Over the 200 MB cap: only the copy is uploaded.
    assert.equal(seen.uploads.length, 1);
    assert.match(seen.uploads[0]!.storagePath, /^videos\/creative-lab\/promoter\/proxy-1080\/[0-9a-f]{64}\.mp4$/);
    assert.equal(seen.uploads[0]!.bytes, 4096);

    const clip = fake.tables.creative_lab_clips[0]!;
    const master = fake.tables.creative_assets.find((a) => a.id === clip.creative_asset_id)!;
    const copy = fake.tables.creative_assets.find((a) => a.id === clip.render_asset_id)!;
    const hash = expectedHash(B3B12_BYTES, block);
    assert.equal(master.content_hash, hash);
    assert.equal(master.byte_size, B3B12_BYTES);
    assert.equal(master.drive_file_id, "drive-b3b12");
    assert.equal(master.storage_path, null);
    assert.equal(copy.storage_path, `videos/creative-lab/promoter/proxy-1080/${hash}.mp4`);
    assert.equal(copy.byte_size, 4096);
    // The temp folder is gone.
    assert.equal(seen.tempPaths.length, 1);
    assert.equal(existsSync(path.dirname(seen.tempPaths[0]!)), false);
  });

  it("the copy over the cap is refused from its size on disk: nothing uploaded, nothing inserted, the temp folder gone", async () => {
    const meter = memoryMeter();
    const seen = newSeen();
    const { fake, promise } = run({ total: 5 * CHUNK, block: randomBytes(CHUNK), probe: { width: 3840, height: 2160, durationInSeconds: 40 }, meter, seen, maxStoredBytes: CHUNK, copyBytes: 2 * CHUNK });
    const res = await promise;
    assert.deepEqual(res.files.map((f) => [f.outcome, f.reason]), [["failed", DRIVE_MASTER_LINES.copyTooBig(2)]]);
    assert.equal(seen.uploads.length, 0);
    assert.equal(fake.tables.creative_lab_clips.length, 0);
    assert.equal(fake.tables.creative_assets.length, 0);
    assert.equal(existsSync(path.dirname(seen.tempPaths[0]!)), false);
  });

  it("under the cap: the original is uploaded from disk, and a portrait 4K still gets its 1080 render proxy file to file", async () => {
    const meter = memoryMeter();
    const seen = newSeen();
    const total = 3 * CHUNK + 17;
    const { fake, promise } = run({ total, block: randomBytes(CHUNK), probe: { width: 2160, height: 3840, durationInSeconds: 12 }, meter, seen });
    const res = await promise;
    assert.equal(res.files[0]!.outcome, "imported", JSON.stringify(res.files));
    assert.deepEqual(seen.uploads.map((u) => u.bytes), [total, 4096]);
    assert.match(seen.uploads[0]!.storagePath, /^videos\/creative-lab\/promoter\/P26-BDAY\/[0-9a-f]{64}\.mp4$/);
    assert.match(seen.uploads[1]!.storagePath, /proxy-1080/);
    assert.deepEqual(seen.made, [{ width: 1080, height: 1920 }]);
    const clip = fake.tables.creative_lab_clips[0]!;
    assert.ok(clip.render_asset_id);
    const master = fake.tables.creative_assets.find((a) => a.id === clip.creative_asset_id)!;
    assert.equal(master.storage_path, seen.uploads[0]!.storagePath);
    assert.equal(master.drive_file_id ?? null, null);
  });

  it("a second run over the same file dedupes by Drive file id without downloading it", async () => {
    const meter = memoryMeter();
    const seen = newSeen();
    const block = randomBytes(CHUNK);
    const first = run({ total: 2 * CHUNK, block, probe: { width: 1080, height: 1920, durationInSeconds: 10 }, meter, seen });
    await first.promise;
    const again = run({ total: 2 * CHUNK, block, probe: { width: 1080, height: 1920, durationInSeconds: 10 }, meter, seen, fake: first.fake });
    const res = await again.promise;
    assert.deepEqual(res.files.map((f) => f.reason), ["already imported"]);
    assert.equal(seen.tempPaths.length, 1);
  });
});
