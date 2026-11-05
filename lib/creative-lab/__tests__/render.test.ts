import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { before, describe, it } from "node:test";

import { styleVersion } from "../../../src/remotion/caption-style/profile.ts";
import type { ServiceRoleDb } from "../load.ts";
import { audioMode, renderCaptionOnClip, type CaptionRenderRequest } from "../render.ts";
import { fakeDb, type FakeDb } from "./fake-db.ts";

const LINES = ["Luke Dean joins", "Enzo Siragusa for", "our 4th Birthday", "You in?"];
let version = "";

before(async () => {
  version = await styleVersion();
});

function seed(over: { aspect?: string; lines?: string[]; style?: string; audio?: string; userId?: string; focus?: number } = {}): FakeDb {
  return fakeDb({
    creative_lab_renders: [
      {
        id: "render-1",
        user_id: over.userId ?? "op",
        clip_id: "clip-1",
        caption_id: "cap-1",
        style_version: over.style ?? version,
        aspect: over.aspect ?? "9:16",
        status: "queued",
      },
    ],
    creative_lab_clips: [
      {
        id: "clip-1",
        creative_asset_id: "asset-src",
        audio_status: over.audio ?? "original",
        in_s: null,
        out_s: null,
        crop_focus_y: over.focus ?? 0.5,
      },
    ],
    creative_lab_captions: [{ id: "cap-1", lines: over.lines ?? LINES, style_version: over.style ?? version }],
    creative_assets: [
      {
        id: "asset-src",
        user_id: "op",
        content_hash: "source",
        byte_size: 10,
        filename: "Luke Dean - UGC 1.mp4",
        media_kind: "video",
        aspect_ratio: "other",
        duration_seconds: null,
        storage_bucket: "campaign-assets",
        storage_path: "videos/ugc1.mp4",
      },
    ],
  });
}

function deps(renderToFile: CaptionRenderRequest extends never ? never : (req: CaptionRenderRequest) => Promise<{ bytes: Uint8Array; renderMs: number }>) {
  const uploaded: { path: string; bytes: Uint8Array }[] = [];
  return {
    uploaded,
    deps: {
      signUrl: async () => "https://signed.example/ugc1.mp4",
      probe: async () => ({ width: 720, height: 1280, fps: 30, durationInSeconds: 19.7 }),
      renderToFile,
      upload: async (path: string, bytes: Uint8Array) => {
        uploaded.push({ path, bytes });
      },
    },
  };
}

const db = (fake: FakeDb) => fake as unknown as ServiceRoleDb;

describe("renderCaptionOnClip", () => {
  it("renders 9:16, registers the asset and marks the row done", async () => {
    const seen: CaptionRenderRequest[] = [];
    const fake = seed();
    const { uploaded, deps: d } = deps(async (req) => {
      seen.push(req);
      return { bytes: new Uint8Array([1, 2, 3, 4]), renderMs: 1234 };
    });
    const result = await renderCaptionOnClip(db(fake), { renderId: "render-1", userId: "op", deps: d });

    assert.equal(result.renderMs, 1234);
    assert.deepEqual([result.width, result.height, result.aspect], [720, 1280, "9:16"]);
    assert.equal(result.durationSeconds, 19.7);
    assert.equal(seen[0].muted, false);
    assert.equal(seen[0].props.audio, "original");
    assert.equal(seen[0].props.plate, "video");
    assert.deepEqual(seen[0].props.lines, LINES);
    assert.equal(uploaded.length, 1);

    const row = fake.tables.creative_lab_renders[0];
    assert.equal(row.status, "done");
    assert.equal(row.render_ms, 1234);
    assert.equal(row.creative_asset_id, result.creativeAssetId);
    assert.equal(row.error, null);

    const asset = fake.tables.creative_assets.find((a) => a.id === result.creativeAssetId);
    assert.ok(asset);
    assert.equal(asset.aspect_ratio, "9:16");
    assert.equal(asset.media_kind, "video");
    assert.equal(asset.duration_seconds, 19.7);
    assert.equal(asset.content_hash, createHash("sha256").update(Buffer.from([1, 2, 3, 4])).digest("hex"));
    assert.equal(asset.byte_size, 4);
  });

  it("crops 4:5 at the clip's focus and treats cleared audio as the original", async () => {
    const seen: CaptionRenderRequest[] = [];
    const fake = seed({ aspect: "4:5", audio: "cleared", focus: 0.7 });
    const { deps: d } = deps(async (req) => {
      seen.push(req);
      return { bytes: new Uint8Array([9]), renderMs: 50 };
    });
    const result = await renderCaptionOnClip(db(fake), { renderId: "render-1", userId: "op", deps: d });
    assert.deepEqual([result.width, result.height], [720, 900]);
    assert.equal(seen[0].props.audio, "original");
    assert.equal(seen[0].props.cropFocusY, 0.7);
    assert.equal(seen[0].muted, false);
  });

  it("mutes a muted clip", async () => {
    const seen: CaptionRenderRequest[] = [];
    const { deps: d } = deps(async (req) => {
      seen.push(req);
      return { bytes: new Uint8Array([9]), renderMs: 10 };
    });
    await renderCaptionOnClip(db(seed({ audio: "muted" })), { renderId: "render-1", userId: "op", deps: d });
    assert.equal(seen[0].muted, true);
    assert.equal(audioMode("cleared"), "original");
  });

  it("records a failed render and writes no asset", async () => {
    const fake = seed();
    const { uploaded, deps: d } = deps(async () => {
      throw new Error("encode failed");
    });
    await assert.rejects(renderCaptionOnClip(db(fake), { renderId: "render-1", userId: "op", deps: d }), /encode failed/);
    const row = fake.tables.creative_lab_renders[0];
    assert.equal(row.status, "failed");
    assert.match(String(row.error), /encode failed/);
    assert.equal(typeof row.render_ms, "number");
    assert.equal(fake.tables.creative_assets.length, 1);
    assert.equal(uploaded.length, 0);
  });

  it("rejects a caption whose style version is not the bundled profile, before rendering", async () => {
    let called = false;
    const fake = seed({ style: "stale" });
    const { deps: d } = deps(async () => {
      called = true;
      return { bytes: new Uint8Array([1]), renderMs: 1 };
    });
    await assert.rejects(renderCaptionOnClip(db(fake), { renderId: "render-1", userId: "op", deps: d }), /style_version/);
    assert.equal(called, false);
    assert.equal(fake.tables.creative_lab_renders[0].status, "failed");
  });

  it("rejects more than four lines", async () => {
    let called = false;
    const fake = seed({ lines: ["one", "two", "three", "four", "five"] });
    const { deps: d } = deps(async () => {
      called = true;
      return { bytes: new Uint8Array([1]), renderMs: 1 };
    });
    await assert.rejects(renderCaptionOnClip(db(fake), { renderId: "render-1", userId: "op", deps: d }), /5 lines/);
    assert.equal(called, false);
  });

  it("refuses a render owned by someone else without changing it", async () => {
    const fake = seed();
    await assert.rejects(renderCaptionOnClip(db(fake), { renderId: "render-1", userId: "other", deps: deps(async () => ({ bytes: new Uint8Array(), renderMs: 1 })).deps }), /another user/);
    assert.equal(fake.tables.creative_lab_renders[0].status, "queued");
  });
});
