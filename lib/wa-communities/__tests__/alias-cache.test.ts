import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  aliasCacheKey,
  aliasCacheTag,
  aliasReadCacheKey,
  cacheOrLookup,
  purgeAliasCache,
  setAliasCacheForTests,
  type AliasCache,
} from "../alias-cache.ts";

function memoryCache(): AliasCache & { store: Map<string, { value: unknown; tags: string[] }> } {
  const store = new Map<string, { value: unknown; tags: string[] }>();
  return {
    store,
    async get(key) {
      return store.get(key)?.value ?? null;
    },
    async set(key, value, options) {
      store.set(key, { value, tags: options?.tags ?? [] });
    },
    async delete(key) {
      store.delete(key);
    },
    async expireTag(tag) {
      const tags = Array.isArray(tag) ? tag : [tag];
      for (const [key, entry] of store) {
        if (entry.tags.some((t) => tags.includes(t))) store.delete(key);
      }
    },
  };
}

describe("alias cache", () => {
  afterEach(() => {
    setAliasCacheForTests(null);
  });

  it("warms a positive hit and serves it without a second lookup", async () => {
    const cache = memoryCache();
    setAliasCacheForTests(cache);
    let calls = 0;
    const first = await cacheOrLookup("fever105-sheffield", async () => {
      calls += 1;
      return { destination_invite_code: "DdsCUNGsF1RAZlGXkA5L81" };
    });
    const second = await cacheOrLookup("fever105-sheffield", async () => {
      calls += 1;
      return { destination_invite_code: "SHOULD_NOT_RUN" };
    });
    assert.equal(calls, 1);
    assert.equal(first?.destination_invite_code, "DdsCUNGsF1RAZlGXkA5L81");
    assert.equal(second?.destination_invite_code, "DdsCUNGsF1RAZlGXkA5L81");
    assert.deepEqual(cache.store.get(aliasCacheKey("fever105-sheffield"))?.tags, [
      aliasCacheTag("fever105-sheffield"),
    ]);
  });

  it("repoint purge is visible on the next lookup", async () => {
    const cache = memoryCache();
    setAliasCacheForTests(cache);
    await cacheOrLookup("puzzle-circuit", async () => ({
      destination_invite_code: "EIRmWYF6uTVBBfXVE5vXxU",
    }));
    cache.store.set(aliasReadCacheKey("puzzle-circuit"), {
      value: { destination_invite_code: "EIRmWYF6uTVBBfXVE5vXxU" },
      tags: [aliasCacheTag("puzzle-circuit")],
    });

    const started = Date.now();
    const purged = await purgeAliasCache("puzzle-circuit");
    assert.equal(purged, "purged");
    assert.equal(cache.store.has(aliasCacheKey("puzzle-circuit")), false);
    assert.equal(cache.store.has(aliasReadCacheKey("puzzle-circuit")), false);

    const next = await cacheOrLookup("puzzle-circuit", async () => ({
      destination_invite_code: "BBBBBBBB22222222",
    }));
    assert.equal(next?.destination_invite_code, "BBBBBBBB22222222");
    assert.ok(Date.now() - started < 10_000);
  });

  it("retries a failed purge once, then accepts staleness", async () => {
    let attempts = 0;
    setAliasCacheForTests({
      async get() {
        return null;
      },
      async set() {},
      async delete() {
        attempts += 1;
        throw new Error("purge down");
      },
      async expireTag() {
        attempts += 1;
        throw new Error("purge down");
      },
    });
    const result = await purgeAliasCache("cdw");
    assert.equal(result, "failed");
    assert.ok(attempts >= 2);
  });

  it("does not cache a lookup that throws", async () => {
    const cache = memoryCache();
    setAliasCacheForTests(cache);
    await assert.rejects(
      cacheOrLookup("throwback-madrid", async () => {
        throw new Error("timeout");
      }),
      /timeout/,
    );
    assert.equal(cache.store.size, 0);
  });
});
