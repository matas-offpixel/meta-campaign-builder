import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";

import { styleVersion } from "../../../src/remotion/caption-style/profile.ts";
import type { ServiceRoleDb } from "../load.ts";
import { audioMode, loadLabRender, renderCaptionOnClip, renderStoragePath, type CaptionRenderRequest } from "../render.ts";
import { fakeDb, type FakeDb } from "./fake-db.ts";

const LINES = ["Luke Dean joins", "Enzo Siragusa for", "our 4th Birthday", "You in?"];
let version = "";

before(async () => {
  version = await styleVersion();
});

function seed(over: { aspect?: string; kind?: string; lines?: string[]; style?: string; audio?: string; userId?: string; focus?: number } = {}): FakeDb {
  return fakeDb({
    creative_lab_renders: [
      {
        id: "render-1",
        user_id: over.userId ?? "op",
        clip_id: "clip-1",
        caption_id: "cap-1",
        style_version: over.style ?? version,
        aspect: over.aspect ?? "9:16",
        kind: over.kind ?? "video",
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

  it("rejects aspect 4:5 with kind video before rendering", async () => {
    let called = false;
    const fake = seed({ aspect: "4:5", kind: "video" });
    const { deps: d } = deps(async () => {
      called = true;
      return { bytes: new Uint8Array([9]), renderMs: 50 };
    });
    await assert.rejects(renderCaptionOnClip(db(fake), { renderId: "render-1", userId: "op", deps: d }), /aspect '4:5' with kind 'video'/);
    assert.equal(called, false);
    assert.equal(fake.tables.creative_lab_renders[0].status, "failed");
    assert.throws(() => loadLabRender({ aspect: "4:5", kind: "video" }), /aspect '4:5' with kind 'video'/);
  });

  it("plays cleared audio and passes the clip focus through on 9:16", async () => {
    const seen: CaptionRenderRequest[] = [];
    const fake = seed({ audio: "cleared", focus: 0.3 });
    const { deps: d } = deps(async (req) => {
      seen.push(req);
      return { bytes: new Uint8Array([9]), renderMs: 50 };
    });
    const result = await renderCaptionOnClip(db(fake), { renderId: "render-1", userId: "op", deps: d });
    assert.deepEqual([result.width, result.height, result.aspect], [720, 1280, "9:16"]);
    assert.equal(seen[0].props.audio, "original");
    assert.equal(seen[0].props.cropFocusY, 0.3);
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

  it("registers the asset and deletes the Lambda render", async () => {
    const fake = seed();
    const deleted: { bucketName: string; lambdaRenderId: string }[] = [];
    const result = await renderCaptionOnClip(db(fake), {
      renderId: "render-1",
      userId: "op",
      serveUrl: "https://serve.example/creative-lab",
      deps: {
        signUrl: async () => "https://signed.example/ugc1.mp4",
        probe: async () => ({ width: 956, height: 718, fps: 30, durationInSeconds: 34.06 }),
        upload: async () => {},
        lambda: {
          render: async () => ({
            bytes: new Uint8Array([7, 7, 7]),
            renderMs: 4321,
            estimatedCostUsd: 0.012,
            estimatedCostDisplay: "$0.012",
            bucketName: "remotionlambda-euwest2",
            lambdaRenderId: "lambda-render-1",
          }),
          deleteRender: async (target) => {
            deleted.push(target);
          },
        },
      },
    });
    assert.equal(result.renderMs, 4321);
    assert.equal(result.estimatedCostUsd, 0.012);
    assert.deepEqual([result.width, result.height], [402, 718]);
    assert.equal(fake.tables.creative_lab_renders[0].status, "done");
    assert.equal(fake.tables.creative_lab_renders[0].creative_asset_id, result.creativeAssetId);
    assert.equal(fake.tables.creative_assets.some((asset) => asset.id === result.creativeAssetId), true);
    assert.deepEqual(deleted, [{ bucketName: "remotionlambda-euwest2", lambdaRenderId: "lambda-render-1" }]);
  });

  it("marks the row failed when Lambda returns an error and does not delete", async () => {
    const fake = seed();
    let deleted = false;
    await assert.rejects(
      renderCaptionOnClip(db(fake), {
        renderId: "render-1",
        userId: "op",
        serveUrl: "https://serve.example/creative-lab",
        deps: {
          signUrl: async () => "https://signed.example/ugc1.mp4",
          probe: async () => ({ width: 720, height: 1280, fps: 30, durationInSeconds: 10 }),
          upload: async () => {},
          lambda: {
            render: async () => {
              throw new Error("Chrome failed to launch");
            },
            deleteRender: async () => {
              deleted = true;
            },
          },
        },
      }),
      /Chrome failed to launch/,
    );
    assert.equal(fake.tables.creative_lab_renders[0].status, "failed");
    assert.match(String(fake.tables.creative_lab_renders[0].error), /Chrome failed to launch/);
    assert.equal(fake.tables.creative_assets.length, 1);
    assert.equal(deleted, false);
  });

  it("rejects a missing serve URL before calling Lambda", async () => {
    const previous = process.env.REMOTION_LAMBDA_SERVE_URL;
    delete process.env.REMOTION_LAMBDA_SERVE_URL;
    let called = false;
    try {
      await assert.rejects(
        renderCaptionOnClip(db(seed()), {
          renderId: "render-1",
          userId: "op",
          deps: {
            signUrl: async () => "https://signed.example/ugc1.mp4",
            probe: async () => ({ width: 720, height: 1280, fps: 30, durationInSeconds: 10 }),
            upload: async () => {},
            lambda: {
              render: async () => {
                called = true;
                throw new Error("should not render");
              },
              deleteRender: async () => {
                called = true;
              },
            },
          },
        }),
        /REMOTION_LAMBDA_SERVE_URL/,
      );
      assert.equal(called, false);
    } finally {
      if (previous === undefined) delete process.env.REMOTION_LAMBDA_SERVE_URL;
      else process.env.REMOTION_LAMBDA_SERVE_URL = previous;
    }
  });

  it("refuses the long size while it is unapproved, before any upload", async () => {
    const fake = seed();
    fake.tables.creative_lab_captions[0].size_variant = "long";
    let uploaded = false;
    await assert.rejects(
      renderCaptionOnClip(db(fake), {
        renderId: "render-1",
        userId: "op",
        deps: deps(async () => {
          uploaded = true;
          return { bytes: new Uint8Array([1]), renderMs: 1 };
        }).deps,
      }),
      /long caption size is not approved/,
    );
    assert.equal(uploaded, false);
    assert.equal(fake.tables.creative_lab_renders[0].status, "failed");
  });

  it("writes a retry to a new object so the failed attempt is left in place", async () => {
    const fake = seed();
    fake.tables.creative_lab_renders[0].attempt = 2;
    const { uploaded, deps: d } = deps(async () => ({ bytes: new Uint8Array([1, 2, 3]), renderMs: 4 }));
    const result = await renderCaptionOnClip(db(fake), { renderId: "render-1", userId: "op", deps: d });
    assert.equal(renderStoragePath("render-1", 1), "videos/creative-lab/render-1-9x16.mp4");
    assert.equal(renderStoragePath("render-1", 2), "videos/creative-lab/render-1-a2-9x16.mp4");
    assert.equal(result.storagePath, "videos/creative-lab/render-1-a2-9x16.mp4");
    assert.equal(uploaded[0].path, result.storagePath);
  });

  it("never asks Remotion to photograph an unapproved long size", () => {
    const source = readFileSync(new URL("../render.ts", import.meta.url), "utf8");
    assert.equal(source.includes("unapprovedProof"), false);
  });
});
