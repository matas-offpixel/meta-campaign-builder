import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";

import {
  audienceSourcePayloadIsCacheable,
  clearAudienceSourceCache,
  getCachedAudienceSource,
} from "../source-cache.ts";

describe("audienceSourcePayloadIsCacheable", () => {
  it("rejects empty arrays and empty video payloads", () => {
    assert.equal(audienceSourcePayloadIsCacheable([]), false);
    assert.equal(
      audienceSourcePayloadIsCacheable({ campaignName: "x", videos: [] }),
      false,
    );
  });

  it("accepts non-empty arrays and video payloads", () => {
    assert.equal(audienceSourcePayloadIsCacheable([{ id: "1" }]), true);
    assert.equal(
      audienceSourcePayloadIsCacheable({
        campaignName: "x",
        videos: [{ id: "v1" }],
      }),
      true,
    );
  });
});

describe("getCachedAudienceSource", () => {
  beforeEach(() => clearAudienceSourceCache());

  it("does not cache loader failures (each miss re-invokes load)", async () => {
    let calls = 0;
    await assert.rejects(
      async () =>
        getCachedAudienceSource(["user", "client", "x"], async () => {
          calls += 1;
          throw new Error("graph failed");
        }),
      /graph failed/,
    );
    await assert.rejects(
      async () =>
        getCachedAudienceSource(["user", "client", "x"], async () => {
          calls += 1;
          throw new Error("graph failed");
        }),
      /graph failed/,
    );
    assert.equal(calls, 2);
  });

  it("does not cache empty array responses", async () => {
    let calls = 0;
    const a = await getCachedAudienceSource(["user", "pages"], async () => {
      calls += 1;
      return [];
    });
    assert.deepEqual(a, []);
    const b = await getCachedAudienceSource(["user", "pages"], async () => {
      calls += 1;
      return [];
    });
    assert.deepEqual(b, []);
    assert.equal(calls, 2);
  });

  it("caches non-empty successful payloads", async () => {
    let calls = 0;
    const first = await getCachedAudienceSource(["user", "pages"], async () => {
      calls += 1;
      return [{ id: "p1", name: "Test" }];
    });
    const second = await getCachedAudienceSource(["user", "pages"], async () => {
      calls += 1;
      return [{ id: "wrong" }];
    });
    assert.deepEqual(first, second);
    assert.equal(calls, 1);
  });
});
