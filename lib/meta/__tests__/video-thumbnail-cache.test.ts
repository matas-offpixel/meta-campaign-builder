import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";

import {
  fetchThumbnailUrl,
  fetchThumbnailUrlsBatch,
  type FetchThumbnailUrlArgs,
} from "../video-thumbnail-cache.ts";
import { CREATIVE_THUMBNAIL_BUCKET } from "../creative-thumbnail-pure.ts";

interface FakeStorageObject {
  bytes: Buffer;
  contentType: string;
}

/**
 * Minimal in-memory stand-in for the single Supabase Storage surface
 * `fetchThumbnailUrl` touches: `storage.from(bucket).list/upload/getPublicUrl`.
 * Mirrors the real client's `{ data, error }` result shape.
 */
function fakeAdmin(options?: { failUpload?: boolean; failList?: boolean }) {
  const storageObjects = new Map<string, FakeStorageObject>();

  return {
    storageObjects,
    storage: {
      from(bucket: string) {
        return {
          async list(prefix: string, opts: { search?: string }) {
            if (options?.failList) {
              return { data: null, error: { message: "boom" } };
            }
            const search = opts?.search ?? "";
            const names: { name: string }[] = [];
            for (const key of storageObjects.keys()) {
              if (!key.startsWith(`${bucket}/${prefix}/`)) continue;
              const name = key.slice(`${bucket}/${prefix}/`.length);
              if (search && !name.includes(search)) continue;
              names.push({ name });
            }
            return { data: names, error: null };
          },
          async upload(
            path: string,
            body: Buffer,
            opts: { contentType?: string },
          ) {
            if (options?.failUpload) {
              return { data: null, error: { message: "upload rejected" } };
            }
            storageObjects.set(`${bucket}/${path}`, {
              bytes: Buffer.from(body),
              contentType: opts?.contentType ?? "application/octet-stream",
            });
            return { data: { path }, error: null };
          },
          getPublicUrl(path: string) {
            return {
              data: {
                publicUrl: `https://fake.supabase.co/storage/v1/object/public/${bucket}/${path}`,
              },
            };
          },
        };
      },
    },
  };
}

function fakeGraphGet(
  responses: Record<string, unknown[]>,
  callLog: string[],
) {
  return async (path: string) => {
    callLog.push(path);
    const videoId = path.replace(/^\//, "").replace(/\/thumbnails$/, "");
    return { data: responses[videoId] ?? [] };
  };
}

function fakeFetchImage(bytes = Buffer.from([1, 2, 3, 4])) {
  const calls: string[] = [];
  const fetchImage = (async (url: string) => {
    calls.push(url);
    return {
      ok: true,
      headers: new Map([["content-type", "image/jpeg"]]),
      async arrayBuffer() {
        return bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        );
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImage, calls };
}

const originalEnv = process.env.ENABLE_META_THUMBNAIL_FETCH;
afterEach(() => {
  if (originalEnv === undefined) delete process.env.ENABLE_META_THUMBNAIL_FETCH;
  else process.env.ENABLE_META_THUMBNAIL_FETCH = originalEnv;
});

describe("fetchThumbnailUrl", () => {
  it("cache miss: fetches Meta once, uploads bytes, returns a public URL", async () => {
    const admin = fakeAdmin();
    const graphCalls: string[] = [];
    const graphGet = fakeGraphGet(
      {
        "1001": [
          { uri: "https://cdn.example/wide.jpg", width: 1920, height: 1080 },
          {
            uri: "https://cdn.example/preferred.jpg",
            width: 640,
            height: 360,
            is_preferred: true,
          },
        ],
      },
      graphCalls,
    );
    const { fetchImage, calls: imageCalls } = fakeFetchImage();

    const args: FetchThumbnailUrlArgs = {
      videoId: "1001",
      token: "token",
      admin,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graphGet: graphGet as any,
      fetchImage,
    };
    const url = await fetchThumbnailUrl(args);

    assert.equal(graphCalls.length, 1);
    assert.equal(graphCalls[0], "/1001/thumbnails");
    assert.deepEqual(imageCalls, ["https://cdn.example/preferred.jpg"]);
    assert.equal(
      url,
      `https://fake.supabase.co/storage/v1/object/public/${CREATIVE_THUMBNAIL_BUCKET}/video-thumb/1001.jpg`,
    );
    assert.equal(
      admin.storageObjects.has(`${CREATIVE_THUMBNAIL_BUCKET}/video-thumb/1001.jpg`),
      true,
    );
  });

  it("cache hit: returns the cached URL without calling Meta", async () => {
    const admin = fakeAdmin();
    admin.storageObjects.set(
      `${CREATIVE_THUMBNAIL_BUCKET}/video-thumb/1002.jpg`,
      { bytes: Buffer.from([9]), contentType: "image/jpeg" },
    );
    const graphCalls: string[] = [];
    const graphGet = fakeGraphGet({}, graphCalls);

    const url = await fetchThumbnailUrl({
      videoId: "1002",
      token: "token",
      admin,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graphGet: graphGet as any,
    });

    assert.equal(graphCalls.length, 0);
    assert.equal(
      url,
      `https://fake.supabase.co/storage/v1/object/public/${CREATIVE_THUMBNAIL_BUCKET}/video-thumb/1002.jpg`,
    );
  });

  it("fetchThumbnailUrl called twice (sequentially) for the same video_id hits Meta exactly once", async () => {
    const admin = fakeAdmin();
    const graphCalls: string[] = [];
    const graphGet = fakeGraphGet(
      { "1003": [{ uri: "https://cdn.example/a.jpg", width: 100, height: 100 }] },
      graphCalls,
    );
    const { fetchImage } = fakeFetchImage();
    const args = {
      videoId: "1003",
      token: "token",
      admin,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graphGet: graphGet as any,
      fetchImage,
    };

    const first = await fetchThumbnailUrl(args);
    const second = await fetchThumbnailUrl(args);

    assert.equal(graphCalls.length, 1);
    assert.equal(first, second);
    assert.ok(first);
  });

  it("concurrent calls for the same video_id share one in-flight Meta fetch", async () => {
    const admin = fakeAdmin();
    const graphCalls: string[] = [];
    const graphGet = fakeGraphGet(
      { "1004": [{ uri: "https://cdn.example/a.jpg", width: 100, height: 100 }] },
      graphCalls,
    );
    const { fetchImage } = fakeFetchImage();
    const args = {
      videoId: "1004",
      token: "token",
      admin,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graphGet: graphGet as any,
      fetchImage,
    };

    const [a, b, c] = await Promise.all([
      fetchThumbnailUrl(args),
      fetchThumbnailUrl(args),
      fetchThumbnailUrl(args),
    ]);

    assert.equal(graphCalls.length, 1);
    assert.equal(a, b);
    assert.equal(b, c);
  });

  it("ENABLE_META_THUMBNAIL_FETCH=0: cache miss returns null without calling Meta", async () => {
    process.env.ENABLE_META_THUMBNAIL_FETCH = "0";
    const admin = fakeAdmin();
    const graphCalls: string[] = [];
    const graphGet = fakeGraphGet({}, graphCalls);

    const url = await fetchThumbnailUrl({
      videoId: "1005",
      token: "token",
      admin,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graphGet: graphGet as any,
    });

    assert.equal(url, null);
    assert.equal(graphCalls.length, 0);
  });

  it("ENABLE_META_THUMBNAIL_FETCH=0: cache hit still serves from Storage", async () => {
    process.env.ENABLE_META_THUMBNAIL_FETCH = "0";
    const admin = fakeAdmin();
    admin.storageObjects.set(
      `${CREATIVE_THUMBNAIL_BUCKET}/video-thumb/1006.jpg`,
      { bytes: Buffer.from([9]), contentType: "image/jpeg" },
    );

    const url = await fetchThumbnailUrl({
      videoId: "1006",
      token: "token",
      admin,
    });

    assert.ok(url?.endsWith("video-thumb/1006.jpg"));
  });

  it("returns null (never throws) when the Graph call rejects", async () => {
    const admin = fakeAdmin();
    const url = await fetchThumbnailUrl({
      videoId: "1007",
      token: "token",
      admin,
      graphGet: async () => {
        throw new Error("Meta deleted this video");
      },
    });
    assert.equal(url, null);
  });

  it("returns null (never throws) when the Storage upload fails", async () => {
    const admin = fakeAdmin({ failUpload: true });
    const graphGet = fakeGraphGet(
      { "1008": [{ uri: "https://cdn.example/a.jpg", width: 100, height: 100 }] },
      [],
    );
    const { fetchImage } = fakeFetchImage();

    const url = await fetchThumbnailUrl({
      videoId: "1008",
      token: "token",
      admin,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graphGet: graphGet as any,
      fetchImage,
    });
    assert.equal(url, null);
  });

  it("returns null immediately for a malformed video_id (no Storage or Meta calls)", async () => {
    const admin = fakeAdmin();
    const graphCalls: string[] = [];
    const graphGet = fakeGraphGet({}, graphCalls);

    const url = await fetchThumbnailUrl({
      videoId: "not-a-real-id; DROP TABLE",
      token: "token",
      admin,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      graphGet: graphGet as any,
    });

    assert.equal(url, null);
    assert.equal(graphCalls.length, 0);
    assert.equal(admin.storageObjects.size, 0);
  });
});

describe("fetchThumbnailUrlsBatch", () => {
  it("dedupes repeated ids and returns a Map keyed by video_id, omitting misses", async () => {
    const admin = fakeAdmin();
    const graphCalls: string[] = [];
    const graphGet = fakeGraphGet(
      {
        "1009": [{ uri: "https://cdn.example/9.jpg", width: 100, height: 100 }],
        "1010": [],
      },
      graphCalls,
    );
    const { fetchImage } = fakeFetchImage();

    const result = await fetchThumbnailUrlsBatch(
      ["1009", "1009", "1010"],
      {
        token: "token",
        admin,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        graphGet: graphGet as any,
        fetchImage,
      },
    );

    // One Graph call per unique id — "1009" de-duped despite appearing twice.
    assert.equal(graphCalls.length, 2);
    assert.equal(result.size, 1);
    assert.ok(result.get("1009")?.endsWith("video-thumb/1009.jpg"));
    assert.equal(result.has("1010"), false);
  });
});
