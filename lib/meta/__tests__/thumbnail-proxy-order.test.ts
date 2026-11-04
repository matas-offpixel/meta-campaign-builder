import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CREATIVE_THUMB_MIN_BYTES,
  legacyProxyObjectsUnderFloor,
  purgeLegacyProxyObjects,
  versionedStoragePathForAd,
} from "../creative-thumbnail-pure.ts";
import {
  resolveStoredThumbnail,
  type ThumbnailBucket,
} from "../creative-thumbnail-store.ts";
import {
  CREATIVE_THUMBNAIL_EDGE,
  fetchThumbnailImageBytes,
} from "../thumbnail-proxy-order.ts";

const AD = "120000000000001";
const VIDEO = "https://cdn.test/video-large.jpg";
const IMAGE = "https://cdn.test/image-full.jpg";
const SMALL = "https://cdn.test/thumb-64.jpg";
const SIZED = "https://cdn.test/thumb-600.jpg";

function jpeg(body = "jpeg-bytes"): Response {
  return new Response(body, { headers: { "content-type": "image/jpeg" } });
}

function creative(fields: Record<string, string>) {
  return { creative: { id: "cr-1", ...fields } };
}

describe("fetchThumbnailImageBytes order", () => {
  it("uses the video thumbnail when video_id is present, not thumbnail_url", async () => {
    const fetched: string[] = [];
    const graphs: string[] = [];
    const { buffer } = await fetchThumbnailImageBytes(AD, "token", { storage: { from: () => ({}) } } as never, {
      graphGet: async (path) => {
        graphs.push(path);
        return creative({ video_id: "9988", thumbnail_url: SMALL, image_url: IMAGE });
      },
      fetchVideoThumbnail: async () => VIDEO,
      fetchImage: async (url) => {
        fetched.push(String(url));
        return jpeg("video");
      },
    });
    assert.deepEqual(graphs, [`/${AD}`]);
    assert.deepEqual(fetched, [VIDEO]);
    assert.equal(buffer.toString(), "video");
  });

  it("uses image_url ahead of the 64px thumbnail_url", async () => {
    const fetched: string[] = [];
    let graphs = 0;
    await fetchThumbnailImageBytes(AD, "token", { storage: { from: () => ({}) } } as never, {
      graphGet: async () => {
        graphs += 1;
        return creative({ thumbnail_url: SMALL, image_url: IMAGE });
      },
      fetchVideoThumbnail: async () => {
        throw new Error("video path");
      },
      fetchImage: async (url) => {
        fetched.push(String(url));
        return jpeg();
      },
    });
    assert.equal(graphs, 1);
    assert.deepEqual(fetched, [IMAGE]);
  });

  it("asks for a 600px thumbnail_url and uses the 64px url only when that is all there is", async () => {
    const calls: Array<{ path: string; params: Record<string, string> }> = [];
    const fetched: string[] = [];
    const graphGet = async (path: string, params: Record<string, string>) => {
      calls.push({ path, params });
      if (path === `/${AD}`) return creative({ thumbnail_url: SMALL });
      return { thumbnail_url: SIZED };
    };
    await fetchThumbnailImageBytes(AD, "token", { storage: { from: () => ({}) } } as never, {
      graphGet,
      fetchImage: async (url) => {
        fetched.push(String(url));
        return jpeg("sized");
      },
    });
    assert.equal(calls[1]?.params.thumbnail_width, CREATIVE_THUMBNAIL_EDGE);
    assert.equal(calls[1]?.params.thumbnail_height, CREATIVE_THUMBNAIL_EDGE);
    assert.equal(calls[1]?.params.fields, "thumbnail_url");
    assert.deepEqual(fetched, [SIZED]);

    const fallback: string[] = [];
    await fetchThumbnailImageBytes(AD, "token", { storage: { from: () => ({}) } } as never, {
      graphGet: async (path) => {
        if (path === `/${AD}`) return creative({ thumbnail_url: SMALL });
        throw new Error("creative read failed");
      },
      fetchImage: async (url) => {
        fallback.push(String(url));
        return jpeg("small");
      },
    });
    assert.deepEqual(fallback, [SMALL]);
  });
});

function memoryBucket(initial: Record<string, Buffer> = {}): ThumbnailBucket & { files: Map<string, Buffer> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    async download(path) {
      const hit = files.get(path);
      if (!hit) return { data: null, error: { message: "not found" } };
      return { data: { arrayBuffer: async () => Uint8Array.from(hit).buffer }, error: null };
    },
    async upload(path, body) {
      files.set(path, Buffer.from(body));
      return { error: null };
    },
  };
}

describe("resolveStoredThumbnail", () => {
  it("re-fetches a small legacy object once and then serves the versioned object", async () => {
    const legacy = Buffer.alloc(1200, 1);
    const bucket = memoryBucket({ [`${AD}.jpg`]: legacy });
    let loads = 0;
    const fresh = Buffer.alloc(900, 2);
    const load = async () => {
      loads += 1;
      return { buffer: fresh, contentType: "image/jpeg" };
    };
    const first = await resolveStoredThumbnail({ bucket, adId: AD, load });
    const second = await resolveStoredThumbnail({ bucket, adId: AD, load });
    assert.equal(loads, 1);
    assert.equal(first.source, "meta");
    assert.equal(second.source, "cache");
    assert.equal(second.buffer.length, 900);
    assert.ok(fresh.length < CREATIVE_THUMB_MIN_BYTES);
    assert.equal(bucket.files.get(versionedStoragePathForAd(AD, "image/jpeg"))?.length, 900);
    assert.equal(bucket.files.get(`${AD}.jpg`)?.length, 1200);
  });
});

describe("purgeLegacyProxyObjects", () => {
  it("dry run deletes nothing", async () => {
    const names = legacyProxyObjectsUnderFloor(
      [
        { name: `${AD}.jpg`, size: 1300 },
        { name: "999.jpg", size: 1300 },
        { name: `${AD}.jpg`.replace(AD, "888"), size: 20_000 },
        { name: "v2/120.jpg", size: 100 },
        { name: "video-thumb/1.jpg", size: 100 },
      ],
      new Set([AD, "888"]),
    );
    assert.deepEqual(names, [`${AD}.jpg`]);
    let removed = 0;
    const result = await purgeLegacyProxyObjects({
      names,
      apply: false,
      remove: async () => {
        removed += 1;
      },
    });
    assert.equal(result.deleted, 0);
    assert.equal(result.matched, 1);
    assert.equal(removed, 0);
  });
});
