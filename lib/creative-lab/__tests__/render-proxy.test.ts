import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

import { importArtistClips, type ClipFolderFile, type ImportedClip } from "../clip-intake.ts";
import type { ServiceRoleDb } from "../load.ts";
import { probeMp4Bytes, probeMp4File } from "../mp4-probe.ts";
import {
  makeColumnProxyFile,
  attachRenderProxy,
  ffmpegProxyArgs,
  makeRenderProxy,
  proxyStoragePath,
  renderAssetId,
  renderProxySize,
  type ProxySize,
} from "../render-proxy.ts";
import { renderCaptionOnClip } from "../render.ts";
import { styleVersion } from "../../../src/remotion/caption-style/profile.ts";
import { fakeDb, type FakeDb } from "./fake-db.ts";

const USER = "op";
const ARTIST = "luke";
const FOLDER = "https://www.dropbox.com/scl/fo/pack/x?rlkey=y";

const db = (fake: FakeDb) => fake as unknown as ServiceRoleDb;

describe("render proxy size", () => {
  it("scales portrait 4K to 1080×1920", () => {
    assert.deepEqual(renderProxySize(2160, 3840), { width: 1080, height: 1920 });
  });

  it("scales landscape 4K to 1920 high, keeping a full 1080-wide 9:16 crop (3414: H.264 wants an even width)", () => {
    assert.deepEqual(renderProxySize(3840, 2160), { width: 3414, height: 1920 });
  });

  it("leaves 1080 originals and anything smaller untouched", () => {
    assert.equal(renderProxySize(1080, 1920), null);
    assert.equal(renderProxySize(1920, 1080), null);
    assert.equal(renderProxySize(720, 1280), null);
    assert.equal(renderProxySize(3413, 1920), null);
  });

  it("scales a source narrower than 9:16 to 1080 wide", () => {
    assert.deepEqual(renderProxySize(1440, 3200), { width: 1080, height: 2400 });
  });

  it("gives nothing for a size it cannot read", () => {
    assert.equal(renderProxySize(0, 1920), null);
    assert.equal(renderProxySize(Number.NaN, 3840), null);
  });

  it("reads the proxy when there is one, else the original", () => {
    assert.equal(renderAssetId({ creative_asset_id: "orig", render_asset_id: "proxy" }), "proxy");
    assert.equal(renderAssetId({ creative_asset_id: "orig", render_asset_id: null }), "orig");
    assert.equal(renderAssetId({ creative_asset_id: "orig" }), "orig");
  });

  it("keeps the proxy beside the original, keyed on the original's hash", () => {
    assert.equal(proxyStoragePath("luke", "abc"), "videos/creative-lab/luke/proxy-1080/abc.mp4");
  });

  it("scales with ffmpeg to the given size and keeps audio optional", () => {
    const args = ffmpegProxyArgs("in", "out.mp4", { width: 1080, height: 1920 });
    assert.ok(args.includes("scale=1080:1920:flags=lanczos,setsar=1"));
    assert.ok(args.includes("16"));
    assert.ok(args.includes("0:a:0?"));
    assert.equal(args.at(-1), "out.mp4");
  });
});

function seedClip(over: Record<string, unknown> = {}): FakeDb {
  return fakeDb({
    creative_lab_clips: [{ id: "clip-4", user_id: USER, artist_id: ARTIST, creative_asset_id: "orig", render_asset_id: null, ...over }],
    creative_assets: [],
  });
}

describe("attachRenderProxy", () => {
  it("makes, stores, registers and links one proxy, and a re-run makes no second one", async () => {
    const fake = seedClip();
    const made: ProxySize[] = [];
    const uploads: { path: string; type: string }[] = [];
    const make = async (_bytes: Buffer, size: ProxySize) => {
      made.push(size);
      return Buffer.from(`proxy ${size.width}x${size.height}`);
    };
    const upload = async (path: string, _bytes: Buffer, type: string) => {
      uploads.push({ path, type });
    };
    const args = { clipId: "clip-4", userId: USER, artistId: ARTIST, name: "clip 4.mp4", original: Buffer.from("4k original"), width: 2160, height: 3840, durationSeconds: 24.1, make, upload };

    const first = await attachRenderProxy(db(fake), args);
    assert.ok(first?.created);
    assert.deepEqual(made, [{ width: 1080, height: 1920 }]);
    assert.equal(uploads.length, 1);
    assert.match(uploads[0]!.path, /^videos\/creative-lab\/luke\/proxy-1080\/[0-9a-f]{64}\.mp4$/);
    assert.equal(uploads[0]!.type, "video/mp4");
    const clip = fake.tables.creative_lab_clips[0]!;
    assert.equal(clip.render_asset_id, first!.assetId);
    assert.equal(clip.creative_asset_id, "orig");
    const asset = fake.tables.creative_assets.find((row) => row.id === first!.assetId)!;
    assert.equal(asset.storage_path, uploads[0]!.path);
    assert.equal(asset.filename, "clip 4 (1080 proxy).mp4");
    assert.equal(asset.aspect_ratio, "9:16");

    const second = await attachRenderProxy(db(fake), args);
    assert.equal(second?.created, false);
    assert.equal(second?.assetId, first!.assetId);
    assert.equal(second?.storagePath, uploads[0]!.path);
    assert.equal(made.length, 1);
    assert.equal(uploads.length, 1);
    assert.equal(fake.tables.creative_assets.length, 1);
  });

  it("does nothing for a 1080 original", async () => {
    const fake = seedClip();
    let made = 0;
    const result = await attachRenderProxy(db(fake), {
      clipId: "clip-4", userId: USER, artistId: ARTIST, name: "LD.mp4", original: Buffer.from("x"), width: 1080, height: 1920, durationSeconds: 31,
      make: async () => { made += 1; return Buffer.from("never"); },
      upload: async () => undefined,
    });
    assert.equal(result, null);
    assert.equal(made, 0);
    assert.equal(fake.tables.creative_lab_clips[0]!.render_asset_id, null);
  });
});

describe("importArtistClips makes the proxy at import", () => {
  type Entry = ClipFolderFile & { bytes: Buffer };
  const files: Entry[] = [
    { sourceFileId: "f-4k", name: "clip 4.mp4", size: 8, bytes: Buffer.from("four-k!!") },
    { sourceFileId: "f-hd", name: "LD.mp4", size: 8, bytes: Buffer.from("ten-80!!") },
  ];
  const listing = {
    list: async () => files.map((entry) => ({ sourceFileId: entry.sourceFileId, name: entry.name, size: entry.size })),
    download: async (_url: string, file: ClipFolderFile) => files.find((entry) => entry.sourceFileId === file.sourceFileId)!.bytes,
  };
  const probe = (bytes: Buffer) => (bytes.toString() === "four-k!!"
    ? { width: 2160, height: 3840, durationInSeconds: 24.1 }
    : { width: 1080, height: 1920, durationInSeconds: 31 });

  function seed(): FakeDb {
    return fakeDb({
      creative_lab_artists: [{ id: ARTIST, user_id: USER, client_id: "puzzle", name: "Luke Dean", rights_doc_ref: "ok", clip_source: "file" }],
      creative_lab_clips: [],
      creative_assets: [],
    });
  }

  it("links a proxy for the 4K file only, hands the hook its path, and a re-run makes no second proxy", async () => {
    const fake = seed();
    const made: ProxySize[] = [];
    const seen: ImportedClip[] = [];
    const run = () => importArtistClips(db(fake), {
      artistId: ARTIST,
      folderUrl: FOLDER,
      listing,
      probe,
      upload: async () => undefined,
      renderProxy: async (_bytes, size) => {
        made.push(size);
        return Buffer.from("proxy");
      },
      onImported: async (clip) => {
        seen.push(clip);
      },
    });
    await run();
    assert.deepEqual(made, [{ width: 1080, height: 1920 }]);
    const [fourK, hd] = fake.tables.creative_lab_clips;
    assert.ok(fourK!.render_asset_id);
    assert.equal(hd!.render_asset_id, undefined);
    const proxyAsset = fake.tables.creative_assets.find((row) => row.id === fourK!.render_asset_id)!;
    assert.equal(seen.find((clip) => clip.name === "clip 4.mp4")?.renderStoragePath, proxyAsset.storage_path);
    assert.equal(seen.find((clip) => clip.name === "LD.mp4")?.renderStoragePath, null);

    await run();
    assert.equal(made.length, 1);
    assert.equal(fake.tables.creative_lab_clips.length, 2);
  });

  it("imports the 4K file on its original when the proxy fails", async () => {
    const fake = seed();
    const result = await importArtistClips(db(fake), {
      artistId: ARTIST,
      folderUrl: FOLDER,
      listing,
      probe,
      upload: async () => undefined,
      renderProxy: async () => {
        throw new Error("ffmpeg exited 1");
      },
    });
    assert.deepEqual(result.files.map((file) => file.outcome), ["imported", "imported"]);
    assert.deepEqual(result.files.map((file) => file.reason), [null, "trimmed to 30 s"]);
    assert.equal(fake.tables.creative_lab_clips[0]!.render_asset_id, undefined);
  });
});

describe("a Lab render reads the proxy", () => {
  async function renderWith(renderAssetIdValue: string | null) {
    const version = await styleVersion();
    const asset = (id: string, storagePath: string) => ({
      id, user_id: USER, content_hash: id, byte_size: 1, filename: id, media_kind: "video", aspect_ratio: "9:16",
      duration_seconds: 24.1, storage_bucket: "campaign-assets", storage_path: storagePath,
    });
    const fake = fakeDb({
      creative_lab_renders: [{ id: "r1", user_id: USER, clip_id: "clip-4", caption_id: "cap-1", style_version: version, aspect: "9:16", kind: "video", status: "queued" }],
      creative_lab_clips: [{
        id: "clip-4",
        creative_asset_id: "orig",
        render_asset_id: renderAssetIdValue,
        audio_status: "original",
        in_s: 0,
        out_s: 8,
        crop_focus_x: 0.5,
        crop_focus_y: 0.5,
        face_samples: {
          detector: "test",
          fps: 5,
          cropFocusX: 0.5,
          cropFocusY: 0.5,
          inS: 0,
          outS: 8,
          samples: [{ t: 0, faces: [] }, { t: 0.2, faces: [] }],
        },
      }],
      creative_lab_captions: [{ id: "cap-1", lines: ["Luke Dean joins", "our 4th Birthday"], style_version: version }],
      creative_assets: [asset("orig", "videos/creative-lab/luke/4k.mp4"), asset("proxy", "videos/creative-lab/luke/proxy-1080/4k.mp4")],
    });
    const signed: string[] = [];
    await renderCaptionOnClip(db(fake), {
      renderId: "r1",
      userId: USER,
      deps: {
        signUrl: async (_bucket: string, objectPath: string) => {
          signed.push(objectPath);
          return `https://signed.example/${objectPath}`;
        },
        probe: async () => ({ width: 1080, height: 1920, fps: 24, durationInSeconds: 24.1 }),
        renderToFile: async () => ({ bytes: new Uint8Array([1]), renderMs: 1 }),
        upload: async () => undefined,
      },
    });
    return signed;
  }

  it("signs the proxy when the clip has one", async () => {
    assert.deepEqual(await renderWith("proxy"), ["videos/creative-lab/luke/proxy-1080/4k.mp4"]);
  });

  it("signs the original when it has none", async () => {
    assert.deepEqual(await renderWith(null), ["videos/creative-lab/luke/4k.mp4"]);
  });
});

// The real binary, when ffmpeg-static has one for this platform (CI and the scripts).
const ffmpegPath = (() => {
  try {
    const resolved = createRequire(import.meta.url)("ffmpeg-static") as string | null;
    return resolved && existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
})();

describe("makeRenderProxy with ffmpeg-static", { skip: ffmpegPath ? false : "no ffmpeg-static binary" }, () => {
  it("turns a portrait 4K file into a 1080×1920 H.264 mp4", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "proxy-test-"));
    try {
      const file = path.join(dir, "4k.mp4");
      execFileSync(ffmpegPath!, [
        "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "testsrc2=size=2160x3840:rate=10:duration=0.5",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
        file,
      ]);
      const proxy = await makeRenderProxy(readFileSync(file), { width: 1080, height: 1920 });
      const probed = probeMp4Bytes(proxy);
      assert.equal(probed.width, 1080);
      assert.equal(probed.height, 1920);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("makeColumnProxyFile with ffmpeg-static (the Drive pickup's file-to-file copy)", { skip: ffmpegPath ? false : "no ffmpeg-static binary" }, () => {
  it("a landscape 4K file becomes a 1080 × 1920 file, and probeMp4File reads both from disk (moov after mdat in the source)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "column-file-test-"));
    try {
      const input = path.join(dir, "4k.mp4");
      execFileSync(ffmpegPath!, [
        "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "testsrc2=size=3840x2160:rate=10:duration=0.5",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
        input,
      ]);
      const source = await probeMp4File(input);
      assert.deepEqual([source.width, source.height], [3840, 2160]);
      const output = path.join(dir, "column.mp4");
      await makeColumnProxyFile(input, output, { width: 1080, height: 1920 });
      const column = await probeMp4File(output);
      assert.deepEqual([column.width, column.height], [1080, 1920]);
      assert.deepEqual(probeMp4Bytes(readFileSync(output)), column);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
