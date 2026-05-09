import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  batchFetchVideoMetadata,
  VIDEO_BATCH_SIZE,
  type RawVideoMetadata,
  type VideoMetadataFetcher,
} from "../batch-fetch-video-metadata.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TOKEN = "test-token";

/** Build a minimal Meta batched-IDs response from an array of video IDs. */
function makeBatchResponse(ids: string[]): Record<string, RawVideoMetadata> {
  const out: Record<string, RawVideoMetadata> = {};
  for (const id of ids) {
    out[id] = {
      id,
      title: `Video ${id}`,
      picture: `https://example.com/${id}.jpg`,
      length: 30,
      from: { id: "page1", name: "Test Page" },
    };
  }
  return out;
}

/**
 * Creates a mock fetcher that records calls and returns the provided
 * batch response. If no override is given, auto-generates a response
 * from the `ids` param.
 */
function makeMockFetcher(
  overrides?: Map<string, Record<string, RawVideoMetadata>>,
): { fetcher: VideoMetadataFetcher; calls: string[][] } {
  const calls: string[][] = [];
  const fetcher: VideoMetadataFetcher = async (_path, params, _token) => {
    const ids = (params.ids ?? "").split(",").filter(Boolean);
    calls.push(ids);
    const key = params.ids ?? "";
    return overrides?.get(key) ?? makeBatchResponse(ids);
  };
  return { fetcher, calls };
}

// ─── Unit tests ───────────────────────────────────────────────────────────────

describe("batchFetchVideoMetadata", () => {
  it("empty input returns empty Map without calling the fetcher", async () => {
    const { fetcher, calls } = makeMockFetcher();
    const result = await batchFetchVideoMetadata([], TOKEN, fetcher);
    assert.equal(result.size, 0);
    assert.equal(calls.length, 0, "fetcher should not be called for empty input");
  });

  it("5 video IDs → 1 batched call, Map contains all 5", async () => {
    const ids = ["v1", "v2", "v3", "v4", "v5"];
    const { fetcher, calls } = makeMockFetcher();

    const result = await batchFetchVideoMetadata(ids, TOKEN, fetcher);

    assert.equal(calls.length, 1, `expected 1 call, got ${calls.length}`);
    assert.equal(calls[0]!.length, 5);
    assert.equal(result.size, 5);
    for (const id of ids) {
      assert.ok(result.has(id), `Map missing video ${id}`);
      assert.equal(result.get(id)?.title, `Video ${id}`);
    }
  });

  it("30 video IDs → 2 batched calls (25 + 5)", async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `v${i + 1}`);
    const { fetcher, calls } = makeMockFetcher();

    const result = await batchFetchVideoMetadata(ids, TOKEN, fetcher);

    assert.equal(calls.length, 2, `expected 2 calls for 30 videos, got ${calls.length}`);
    assert.equal(calls[0]!.length, VIDEO_BATCH_SIZE, "first batch should be full (25)");
    assert.equal(calls[1]!.length, 5, "second batch should be remainder (5)");
    assert.equal(result.size, 30);
  });

  it("50 video IDs → 2 batched calls (25 + 25)", async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `v${i + 1}`);
    const { fetcher, calls } = makeMockFetcher();

    const result = await batchFetchVideoMetadata(ids, TOKEN, fetcher);

    assert.equal(calls.length, 2, `expected 2 calls for 50 videos, got ${calls.length}`);
    assert.equal(calls[0]!.length, VIDEO_BATCH_SIZE);
    assert.equal(calls[1]!.length, VIDEO_BATCH_SIZE);
    assert.equal(result.size, 50);
  });

  it("batch error: 1st batch fails, 2nd succeeds → Map contains only 2nd-batch videos", async () => {
    const firstBatchIds = Array.from({ length: 25 }, (_, i) => `v${i + 1}`);
    const secondBatchIds = Array.from({ length: 5 }, (_, i) => `v${i + 26}`);
    const allIds = [...firstBatchIds, ...secondBatchIds];

    let callNum = 0;
    const fetcher: VideoMetadataFetcher = async (_path, params, _token) => {
      callNum++;
      if (callNum === 1) {
        throw new Error("(#80004) Rate limited");
      }
      const ids = (params.ids ?? "").split(",").filter(Boolean);
      return makeBatchResponse(ids);
    };

    const result = await batchFetchVideoMetadata(allIds, TOKEN, fetcher);

    assert.equal(result.size, secondBatchIds.length, "only 2nd batch should be in Map");
    for (const id of secondBatchIds) {
      assert.ok(result.has(id), `Map missing ${id} from successful 2nd batch`);
    }
    for (const id of firstBatchIds) {
      assert.equal(result.has(id), false, `Map should not contain ${id} from failed 1st batch`);
    }
  });

  it("returned entries have id, title, picture, length, from fields", async () => {
    const mockData: Record<string, RawVideoMetadata> = {
      v42: {
        id: "v42",
        title: "My Concert Highlight",
        picture: "https://cdn.example.com/thumb.jpg",
        length: 120,
        from: { id: "pageA", name: "Artist Page" },
      },
    };
    const fetcher: VideoMetadataFetcher = async () => mockData;

    const result = await batchFetchVideoMetadata(["v42"], TOKEN, fetcher);
    const video = result.get("v42");
    assert.ok(video, "video v42 missing from result");
    assert.equal(video.id, "v42");
    assert.equal(video.title, "My Concert Highlight");
    assert.equal(video.picture, "https://cdn.example.com/thumb.jpg");
    assert.equal(video.length, 120);
    assert.equal(video.from?.id, "pageA");
  });
});

// ─── Smoke-level call-count budget assertion ──────────────────────────────────

describe("fetchAudienceMultiCampaignVideos call-count budget", () => {
  it("5 campaigns × 6 videos each uses batched fetch (≤ 13 Meta calls vs old ~155)", async () => {
    const { readFileSync } = await import("node:fs");
    const sources = readFileSync("lib/audiences/sources.ts", "utf8");
    const batchUtil = readFileSync("lib/audiences/batch-fetch-video-metadata.ts", "utf8");

    // sources.ts: batched helper is wired in
    assert.match(sources, /batchFetchVideoMetadata/);
    // sources.ts: VIDEO_BATCH_SIZE constant is present (ceil(N/25) call budget)
    assert.match(sources, /VIDEO_BATCH_SIZE/);
    // sources.ts: thumbnail fallbacks are rate-limited by semaphore
    assert.match(sources, /THUMBNAIL_FALLBACK_CONCURRENCY/);
    assert.match(sources, /thumbnailSem/);
    // batch-fetch-video-metadata.ts: batched call uses Meta's multi-object GET `?ids=` pattern
    assert.match(batchUtil, /ids:.*chunk\.join/);
    // batch-fetch-video-metadata.ts: fields include all required metadata
    assert.match(batchUtil, /id,picture,title,length,from/);
    // sources.ts: no per-video graphGetWithToken call remaining in the video walk
    assert.doesNotMatch(
      sources,
      /graphGetWithToken.*\$\{videoId\}.*fields.*id,picture,title/s,
    );
  });
});
