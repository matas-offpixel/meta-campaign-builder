/**
 * File mode of the clip import (listing.downloadToFile, the Drive pickup):
 * a 4K original the size of B3B12.mp4 (406,425,869 B, 11 Nov 2026) goes
 * from the download to disk, through the copy maker and the upload, and the
 * process never holds more than a few chunks of it.
 */

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdtempSync, rmSync } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { remoteOriginal, type FetchRange } from "../../creatives/remote-file.ts";
import { writeStreamToFile } from "../../creatives/stream-file.ts";
import { DRIVE_MASTER_LINES, importArtistClips, type ClipFolderFile, type ClipProbe } from "../clip-intake.ts";
import type { ServiceRoleDb } from "../load.ts";
import { FAILURE_REASON_MAX, ffmpegFailure, redactSecrets, type FileProxyMaker, type ProxySize } from "../render-proxy.ts";
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

// ─── Remote mode (SWEELY 1.mp4, 11 Nov 2026) ─────────────────────────────────

const SWEELY_BYTES = 449_059_415;
const TOKEN = "ya29.SWEELY-TEST-TOKEN";

/** A fake Drive origin of `total` bytes (byte i is block[i % CHUNK]), whole or by range, generated lazily. */
function lazyOrigin(total: number, block: Buffer, onChunk: () => void): FetchRange {
  return async (range) => {
    const m = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
    const start = m ? Number(m[1]) : 0;
    const end = m ? Math.min(m[2] ? Number(m[2]) : total - 1, total - 1) : total - 1;
    let at = start;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        onChunk();
        if (at > end) return controller.close();
        const offset = at % CHUNK;
        const n = Math.min(CHUNK - offset, end - at + 1);
        controller.enqueue(new Uint8Array(block.buffer, block.byteOffset + offset, n));
        at += n;
      },
    });
    const headers: Record<string, string> = { "content-length": String(end - start + 1) };
    if (m) headers["content-range"] = `bytes ${start}-${end}/${total}`;
    return new Response(body, { status: m ? 206 : 200, headers });
  };
}

async function duBytes(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) total += (await stat(path.join(entry.parentPath, entry.name))).size;
  }
  return total;
}

describe("remote mode · an original over the cap is read from Drive, so only its copy is on the temp disk", () => {
  it("SWEELY 1.mp4's 449,059,415 B: fingerprinted in one pass, read by ffmpeg through the loopback server, with the temp disk never holding more than the copy", async () => {
    const block = randomBytes(CHUNK);
    const COPY = 48 * CHUNK;
    // The fake disk: the function's /tmp, capped below original + copy (SWEELY's failure).
    const DISK_CAP = SWEELY_BYTES + COPY - 1;
    const disk = mkdtempSync(path.join(tmpdir(), "fake-tmp-"));
    const savedTmp = process.env.TMPDIR;
    process.env.TMPDIR = disk;
    const meter = memoryMeter();
    let diskPeak = 0;
    const sampleDisk = async () => {
      diskPeak = Math.max(diskPeak, await duBytes(disk));
      assert.ok(diskPeak <= DISK_CAP, "over the fake disk");
    };
    let chunks = 0;
    const fetchRange = lazyOrigin(SWEELY_BYTES, block, () => {
      chunks += 1;
      meter.sample();
    });
    const fake = fakeDb({ creative_lab_clips: [], creative_assets: [] });
    const uploads: { storagePath: string; bytes: number }[] = [];
    const readByMaker: { bytes: number; hash: string; input: string }[] = [];
    try {
      const res = await importArtistClips(fake as unknown as ServiceRoleDb, {
        asPromoter: { userId: USER, rightsRef: "Venue & crowd" },
        eventId: EVENT,
        source: "file",
        folderUrl: "drive-export:drive-sweely",
        maxNew: 1,
        listing: {
          list: async () => [{ sourceFileId: "drive-sweely", name: "SWEELY 1.mp4", size: SWEELY_BYTES }],
          download: async () => {
            throw new Error("remote mode must not read the original into memory");
          },
          downloadToFile: async () => {
            throw new Error("remote mode must not write the original to disk");
          },
          openRemote: () => remoteOriginal(fetchRange),
        },
        probeRemote: async (remote, size) => {
          assert.equal(size, SWEELY_BYTES);
          assert.equal((await remote.readRange(SWEELY_BYTES - 8, 8)).byteLength, 8);
          return { width: 3840, height: 2160, durationInSeconds: 56 };
        },
        // Stands in for ffmpeg: reads the input URL by range, as ffmpeg does, and writes the copy.
        renderProxyFile: async (input, output) => {
          assert.match(input, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}$/);
          assert.ok(!input.includes(TOKEN));
          const hash = createHash("sha256");
          let bytes = 0;
          const res = await fetch(input, { headers: { Range: "bytes=0-" } });
          assert.equal(res.status, 206);
          for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
            hash.update(chunk);
            bytes += chunk.byteLength;
            if (bytes % (64 * CHUNK) < chunk.byteLength) await sampleDisk();
            meter.sample();
          }
          readByMaker.push({ bytes, hash: hash.digest("hex"), input });
          await writeFile(output, Buffer.alloc(COPY, 2));
          await sampleDisk();
        },
        uploadFile: async (storagePath, filePath) => {
          await sampleDisk();
          uploads.push({ storagePath, bytes: await streamedLength(filePath, meter.sample) });
        },
        upload: async () => {
          throw new Error("remote mode uploads only the copy, from disk");
        },
        driveMaster: (f) => f.sourceFileId,
      });
      meter.sample();
      assert.equal(res.files[0]!.outcome, "imported", JSON.stringify(res.files));
      const hash = expectedHash(SWEELY_BYTES, block);
      assert.deepEqual(readByMaker.map((r) => [r.bytes, r.hash]), [[SWEELY_BYTES, hash]]);
      assert.equal(uploads.length, 1);
      assert.equal(uploads[0]!.bytes, COPY);
      assert.equal(uploads[0]!.storagePath, `videos/creative-lab/promoter/proxy-1080/${hash}.mp4`);
      assert.ok(diskPeak <= COPY, `temp disk peaked at ${diskPeak} B, more than the copy`);
      assert.ok(meter.peak < 64 * CHUNK, `peak array-buffer memory ${Math.round(meter.peak / CHUNK)} MB`);
      assert.ok(chunks > 0);
      const clip = fake.tables.creative_lab_clips[0]!;
      const master = fake.tables.creative_assets.find((a) => a.id === clip.creative_asset_id)!;
      const copy = fake.tables.creative_assets.find((a) => a.id === clip.render_asset_id)!;
      assert.equal(master.content_hash, hash);
      assert.equal(master.byte_size, SWEELY_BYTES);
      assert.equal(master.drive_file_id, "drive-sweely");
      assert.equal(master.storage_path, null);
      assert.equal(copy.byte_size, COPY);
      assert.equal(await duBytes(disk), 0, "the copy's temp folder is removed");
      assert.ok(!JSON.stringify({ res, rows: fake.tables }).includes(TOKEN));
    } finally {
      if (savedTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = savedTmp;
      rmSync(disk, { recursive: true, force: true });
    }
  });

  it("listed over the cap but under it when read: falls back to file mode, as before", async () => {
    const block = randomBytes(CHUNK);
    const total = 2 * CHUNK;
    const fake = fakeDb({ creative_lab_clips: [], creative_assets: [] });
    const uploads: string[] = [];
    const res = await importArtistClips(fake as unknown as ServiceRoleDb, {
      asPromoter: { userId: USER, rightsRef: "Venue & crowd" },
      eventId: EVENT,
      source: "file",
      folderUrl: "drive-export:x",
      maxNew: 1,
      maxStoredBytes: 3 * CHUNK,
      listing: {
        list: async () => [{ sourceFileId: "x", name: "small.mp4", size: 0 }],
        download: async () => {
          throw new Error("not this");
        },
        downloadToFile: (_u, _f, filePath) => writeStreamToFile(fakeDriveBody(total, block, () => {}), filePath),
        openRemote: () => remoteOriginal(lazyOrigin(total, block, () => {})),
      },
      probeFile: async () => ({ width: 1080, height: 1920, durationInSeconds: 10 }),
      uploadFile: async (storagePath) => {
        uploads.push(storagePath);
      },
      driveMaster: (f) => f.sourceFileId,
    });
    assert.equal(res.files[0]!.outcome, "imported", JSON.stringify(res.files));
    assert.equal(uploads.length, 1);
    assert.match(uploads[0]!, /promoter\/P26-BDAY\//);
  });
});

describe("a full temp disk is the temp-disk line, and a stored reason is short and useful", () => {
  // The 13:45 UTC run's line, as execFile reported it (the token and URL are added here to prove they go).
  const SWEELY_ERROR = Object.assign(
    new Error(
      "Command failed: /var/task/node_modules/ffmpeg-static/ffmpeg -hide_banner -loglevel error -y -headers Authorization: Bearer " +
        TOKEN +
        " -i https://www.googleapis.com/drive/v3/files/1DBD5m2pncLPtxHNwASXyTI4E9GyIygd4?alt=media&access_token=" +
        TOKEN +
        " -map 0:v:0 -map 0:a:0? -vf crop='trunc(min(iw,ih*9/16)/2)*2':'trunc(min(ih,iw*16/9)/2)*2',scale=1080:1920:flags=lanczos,setsar=1 -c:v libx264 -preset veryfast -crf 16 /tmp/lab-proxy-0XIR9j/proxy.mp4\n" +
        "[vost#0:0/libx264 @ 0x3435f740] Error submitting a packet to the muxer: No space left on device\n" +
        "[out#0/mp4 @ 0x3436a1c0] Error writing trailer: No space left on device\n",
    ),
    { code: 1, signal: null },
  );

  it("ffmpegFailure: ffmpeg's own words first, no command line, no URL, no token, under 300 characters", () => {
    const failed = ffmpegFailure(SWEELY_ERROR);
    assert.equal(failed.noSpace, true);
    assert.match(failed.message, /^ffmpeg: Error submitting a packet to the muxer: No space left on device/);
    assert.ok(failed.message.length <= FAILURE_REASON_MAX);
    for (const leaked of [TOKEN, "googleapis", "Command failed", "-vf", "/tmp/"]) assert.ok(!failed.message.includes(leaked), leaked);
  });

  it("redactSecrets takes out bearer tokens, Authorization values, URLs and token query values", () => {
    const text = redactSecrets(`Authorization: Bearer ${TOKEN} then bearer ${TOKEN} at https://x.test/a?b=1 and ?access_token=${TOKEN}&x=1`);
    assert.ok(!text.includes(TOKEN));
    assert.ok(!text.includes("x.test"));
  });

  async function failWith(err: unknown) {
    const fake = fakeDb({ creative_lab_clips: [], creative_assets: [] });
    const res = await importArtistClips(fake as unknown as ServiceRoleDb, {
      asPromoter: { userId: USER, rightsRef: "Venue & crowd" },
      eventId: EVENT,
      source: "file",
      folderUrl: "drive-export:x",
      maxNew: 1,
      maxStoredBytes: 16,
      listing: {
        list: async () => [{ sourceFileId: "x", name: "big.mp4", size: 64 }],
        download: async () => Buffer.alloc(64, 1),
        openRemote: () => remoteOriginal(lazyOrigin(64, randomBytes(CHUNK), () => {})),
      },
      probeRemote: async () => ({ width: 3840, height: 2160, durationInSeconds: 20 }),
      renderProxyFile: async () => {
        throw err;
      },
      uploadFile: async () => undefined,
      driveMaster: (f) => f.sourceFileId,
    });
    assert.equal(fake.tables.creative_lab_clips.length, 0);
    return res.files[0]!;
  }

  it("ffmpeg's 'Error submitting a packet', an ENOSPC errno and 'No space left on device' all store the temp-disk line", async () => {
    for (const err of [ffmpegFailure(SWEELY_ERROR), Object.assign(new Error("write ENOSPC"), { code: "ENOSPC" }), new Error("No space left on device")]) {
      const file = await failWith(err);
      assert.deepEqual([file.outcome, file.reason], ["failed", "Not enough temporary disk to import this file — nothing was stored"]);
    }
  });

  it("any other ffmpeg failure stores ffmpeg's line first, redacted, under 300 characters", async () => {
    const other = Object.assign(new Error(`Command failed: ffmpeg -headers Authorization: Bearer ${TOKEN} -i http://127.0.0.1:5555/abc\n${"x".repeat(400)}\n[in#0 @ 0x1] Invalid data found when processing input`), { code: 1 });
    const file = await failWith(ffmpegFailure(other));
    assert.equal(file.outcome, "failed");
    assert.match(file.reason!, /Invalid data found when processing input/);
    assert.ok(file.reason!.length <= FAILURE_REASON_MAX);
    assert.ok(!file.reason!.includes(TOKEN));
  });
});
