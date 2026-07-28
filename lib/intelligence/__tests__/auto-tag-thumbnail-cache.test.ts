import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { createSupabaseAutoTagThumbnailCache } from "../auto-tag-thumbnail-cache.ts";
import { CREATIVE_THUMBNAIL_BUCKET } from "../../meta/creative-thumbnail-pure.ts";

interface FakeStorageObject {
  bytes: Buffer;
  contentType: string;
}

interface FakeIndexRow {
  url_hash: string;
  content_hash: string;
  content_type: string;
}

/**
 * Minimal in-memory stand-in for the two Supabase surfaces
 * `createSupabaseAutoTagThumbnailCache` touches:
 *   - `storage.from(bucket).download/upload` — the content-addressed blob.
 *   - `from(table).select().eq().maybeSingle()` / `.upsert()` — the
 *     url -> content-hash index (migration 149).
 * Mirrors the real client's `{ data, error }` result shape throughout.
 */
function fakeSupabaseClient(options?: {
  failDownload?: boolean;
  failUpload?: boolean;
}) {
  const storageObjects = new Map<string, FakeStorageObject>();
  const indexRows = new Map<string, FakeIndexRow>();

  return {
    storageObjects,
    indexRows,
    storage: {
      from(bucket: string) {
        return {
          async download(path: string) {
            if (options?.failDownload) {
              return { data: null, error: { message: "boom" } };
            }
            const obj = storageObjects.get(`${bucket}/${path}`);
            if (!obj) return { data: null, error: { message: "not found" } };
            const blob = new Blob([new Uint8Array(obj.bytes)], {
              type: obj.contentType,
            });
            return { data: blob, error: null };
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
        };
      },
    },
    from() {
      return {
        select() {
          return {
            eq(_column: string, value: string) {
              return {
                async maybeSingle() {
                  const row = indexRows.get(value);
                  return { data: row ?? null, error: null };
                },
              };
            },
          };
        },
        async upsert(row: FakeIndexRow) {
          indexRows.set(row.url_hash, row);
          return { data: null, error: null };
        },
      };
    },
  };
}

describe("createSupabaseAutoTagThumbnailCache", () => {
  it("returns null on a miss without throwing", async () => {
    const client = fakeSupabaseClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cache = createSupabaseAutoTagThumbnailCache(client as any);
    assert.equal(await cache.get("https://cdn/never-seen.jpg"), null);
  });

  it("put then get round-trips the same bytes, media type, and hash", async () => {
    const client = fakeSupabaseClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cache = createSupabaseAutoTagThumbnailCache(client as any);
    const url = "https://cdn/a?sig=1";
    const base64 = Buffer.from([1, 2, 3, 4]).toString("base64");
    const hash = "deadbeef";

    await cache.put(url, hash, { base64, mediaType: "image/png" });
    const hit = await cache.get(url);

    assert.ok(hit);
    assert.equal(hit?.hash, hash);
    assert.equal(hit?.mediaType, "image/png");
    assert.equal(hit?.base64, base64);
  });

  it("stores the blob under the shared creative-thumbnails bucket with an auto-tag/hash prefix", async () => {
    const client = fakeSupabaseClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cache = createSupabaseAutoTagThumbnailCache(client as any);
    await cache.put("https://cdn/a?sig=1", "deadbeef", {
      base64: Buffer.from([1, 2, 3]).toString("base64"),
      mediaType: "image/jpeg",
    });

    const paths = [...client.storageObjects.keys()];
    assert.equal(paths.length, 1);
    assert.equal(
      paths[0],
      `${CREATIVE_THUMBNAIL_BUCKET}/auto-tag/hash/deadbeef.jpg`,
    );
    assert.equal(client.indexRows.size, 1);
  });

  it("two different URLs with identical bytes collapse to one hash blob", async () => {
    const client = fakeSupabaseClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cache = createSupabaseAutoTagThumbnailCache(client as any);
    const base64 = Buffer.from([9, 9, 9]).toString("base64");
    const hash = "sharedhash";

    await cache.put("https://cdn/x?sig=1", hash, {
      base64,
      mediaType: "image/webp",
    });
    await cache.put("https://cdn/y?sig=2", hash, {
      base64,
      mediaType: "image/webp",
    });

    // One blob, two index rows (one per URL) pointing at it.
    assert.equal(client.storageObjects.size, 1);
    assert.equal(client.indexRows.size, 2);

    const hitX = await cache.get("https://cdn/x?sig=1");
    const hitY = await cache.get("https://cdn/y?sig=2");
    assert.equal(hitX?.base64, base64);
    assert.equal(hitY?.base64, base64);
  });

  it("returns null (never throws) when the index lookup can't resolve a blob", async () => {
    const client = fakeSupabaseClient({ failDownload: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cache = createSupabaseAutoTagThumbnailCache(client as any);
    await cache.put("https://cdn/a?sig=1", "deadbeef", {
      base64: Buffer.from([1]).toString("base64"),
      mediaType: "image/jpeg",
    });
    // Upload also "fails" under failDownload in this fake, but put()
    // swallows that — the real assertion is that get() never throws either.
    const result = await cache.get("https://cdn/a?sig=1");
    assert.equal(result, null);
  });

  it("put swallows a Storage upload rejection instead of throwing (regression: bucket mime allow-list)", async () => {
    // Regression coverage for the bug a live smoke test caught: Storage
    // `upload()` returns `{ error }` rather than throwing on a rejected
    // write (e.g. a disallowed mime type), so `put()` must check the
    // `error` field explicitly rather than only catching exceptions.
    const client = fakeSupabaseClient({ failUpload: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cache = createSupabaseAutoTagThumbnailCache(client as any);
    await assert.doesNotReject(
      cache.put("https://cdn/a?sig=1", "deadbeef", {
        base64: Buffer.from([1]).toString("base64"),
        mediaType: "image/jpeg",
      }),
    );
    // And crucially: no index row should have been written for a blob that
    // was never actually stored, or a later get() would "hit" and then
    // fail the download.
    assert.equal(client.indexRows.size, 0);
    assert.equal(await cache.get("https://cdn/a?sig=1"), null);
  });
});
