import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { META_VIDEO_SIGNED_URL_TTL_SECONDS, metaVideoUploadMode, parseAdvideosId } from "../video-file-url.ts";
import { uploadStoredVideoByUrl, type StorageVideoByUrlDeps } from "../storage-video-by-url.ts";

const HASH = "ab".repeat(32);
const SIGNED = "https://abc.supabase.co/storage/v1/object/sign/campaign-assets/videos/x.mp4?token=secret";

function harness(overrides: Partial<StorageVideoByUrlDeps> = {}) {
  const fetches: string[] = [];
  const posts: Record<string, unknown>[] = [];
  const signedTtls: number[] = [];
  const removed: string[] = [];
  const registry = new Map<string, { videoId: string; previewUrl: string }>();
  const deps: StorageVideoByUrlDeps = {
    storagePath: "videos/11111111-1111-4111-8111-111111111111.mp4",
    storageBucket: "campaign-assets",
    fileName: "Bournemouth Presenter V1.mp4",
    adAccountId: "999",
    token: "tok",
    contentHash: HASH,
    byteSize: 138 * 1024 * 1024,
    contentType: "video/mp4",
    userId: "user-1",
    supabase: {},
    createSignedUrl: async (_bucket, _path, ttl) => {
      signedTtls.push(ttl);
      return { signedUrl: SIGNED };
    },
    remove: async (_bucket, path) => {
      removed.push(path);
    },
    findExisting: async (_client, input) => registry.get(input.identity.contentHash) ?? null,
    register: async (input) => {
      registry.set(input.identity.contentHash, {
        videoId: input.result.videoId ?? "",
        previewUrl: input.result.previewUrl ?? "",
      });
      return "asset-1";
    },
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetches.push(url);
      if (url.includes("supabase.co")) throw new Error(`route fetched storage: ${url}`);
      posts.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ id: "vid_bournemouth" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
    getStatus: async () => ({ status: { video_status: "ready" } }),
    fetchThumbnail: async () => "https://cdn.example/thumb.jpg",
    statusDelaysMs: [0],
    ...overrides,
  };
  return { deps, fetches, posts, signedTtls, removed, registry };
}

describe("storage video by url", () => {
  it("posts file_url once, signs for 1800s, and never fetches the signed URL", async () => {
    const { deps, fetches, posts, signedTtls } = harness();
    const result = await uploadStoredVideoByUrl(deps);
    assert.equal(META_VIDEO_SIGNED_URL_TTL_SECONDS, 1800);
    assert.deepEqual(signedTtls, [1800]);
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.file_url, SIGNED);
    assert.equal(posts[0]?.title, "Bournemouth_Presenter_V1");
    assert.equal(posts[0]?.thumb_offset, 1000);
    assert.equal(fetches.length, 1);
    assert.match(fetches[0]!, /graph\.facebook\.com\/v21\.0\/act_999\/advideos/);
    assert.equal(fetches.some((url) => url.includes("supabase.co")), false);
    assert.equal(result.videoId, "vid_bournemouth");
    assert.equal(result.previewUrl, "https://cdn.example/thumb.jpg");
    assert.equal(result.registryAssetId, "asset-1");
  });

  it("a second call with the same hash returns the registry row and does not call Meta", async () => {
    const { deps, posts, registry } = harness();
    await uploadStoredVideoByUrl(deps);
    registry.set(HASH, { videoId: "vid_bournemouth", previewUrl: "https://cdn.example/thumb.jpg" });
    const again = await uploadStoredVideoByUrl(deps);
    assert.equal(posts.length, 1);
    assert.equal(again.videoId, "vid_bournemouth");
    assert.equal(again.registryAssetId, undefined);
  });

  it("waits when the id is not queryable yet, then uses the id", async () => {
    const seen: string[] = [];
    const bodies = [
      { error: { message: "Unsupported get request. Object does not exist", code: 100 } },
      { status: { video_status: "processing" } },
      { status: { video_status: "ready" } },
    ];
    const { deps } = harness({
      getStatus: async (videoId) => {
        seen.push(videoId);
        return bodies.shift();
      },
      statusDelaysMs: [0, 0, 0],
    });
    const result = await uploadStoredVideoByUrl(deps);
    assert.deepEqual(seen, ["vid_bournemouth", "vid_bournemouth", "vid_bournemouth"]);
    assert.equal(result.videoId, "vid_bournemouth");
  });

  it("reads id or video_id and refuses a body with neither", () => {
    assert.equal(parseAdvideosId({ id: "1" }), "1");
    assert.equal(parseAdvideosId({ video_id: "2" }), "2");
    assert.equal(parseAdvideosId({ success: true }), null);
  });

  it("the image path still downloads the object; the file_url module does not", () => {
    const route = readFileSync(new URL("../../../app/api/meta/upload-asset/route.ts", import.meta.url), "utf8");
    const byUrl = readFileSync(new URL("../storage-video-by-url.ts", import.meta.url), "utf8");
    const fields = readFileSync(new URL("../video-file-url.ts", import.meta.url), "utf8");
    assert.match(route, /createSignedUrl\(storagePath, META_STORAGE_FETCH_TTL_SECONDS\)/);
    assert.match(route, /videoBlob = await fileRes\.blob\(\)/);
    assert.match(route, /uploadImageAsset\(/);
    assert.match(route, /uploadVideoAsset\(/);
    assert.equal(byUrl.includes(".blob("), false);
    assert.equal(byUrl.includes("arrayBuffer("), false);
    assert.equal(byUrl.includes("new File("), false);
    assert.equal(fields.includes(".blob("), false);
    assert.equal(fields.includes("arrayBuffer("), false);
    assert.equal(metaVideoUploadMode(undefined), "file_url");
    assert.equal(metaVideoUploadMode("multipart"), "multipart");
    assert.equal(metaVideoUploadMode("UPLOAD_BY_FILE"), "multipart");
  });
});
