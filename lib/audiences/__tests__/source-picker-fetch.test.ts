import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  fetchAudienceCampaignVideos,
  fetchAudienceSourceList,
} from "../source-picker-fetch.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchAudienceCampaignVideos defensive JSON", () => {
  it("does not crash on plain-text / HTML body — returns structured error", async () => {
    globalThis.fetch = async () =>
      new Response("<html><body>502 Bad Gateway</body></html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      });

    const r = await fetchAudienceCampaignVideos(
      `http://example.invalid/videos?t=${Date.now()}`,
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.error, /non-JSON|Server returned/i);
      assert.equal(r.rateLimited, false);
    }
  });

  it("504 + Vercel-style 'An error occurred' → timeout-friendly message", async () => {
    globalThis.fetch = async () =>
      new Response("An error occurred with your deployment", {
        status: 504,
      });

    const r = await fetchAudienceCampaignVideos(
      `http://example.invalid/v504?t=${Date.now()}`,
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.error, /timed out/i);
      assert.match(r.error, /504/);
    }
  });

  it("429 non-JSON body still marks rateLimited for UI", async () => {
    globalThis.fetch = async () =>
      new Response("Too Many Requests", {
        status: 429,
      });

    const r = await fetchAudienceCampaignVideos(
      `http://example.invalid/r429?t=${Date.now()}`,
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.rateLimited, true);
  });

  it("200 + valid JSON ok:true still parses payload", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          ok: true,
          campaignName: "Test",
          videos: [{ id: "v1" }],
          contextPageId: "page1",
          skippedCount: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const r = await fetchAudienceCampaignVideos(
      `http://example.invalid/ok?t=${Date.now()}`,
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.data.campaignName, "Test");
      assert.equal(r.data.videos[0]?.id, "v1");
      assert.equal(r.data.contextPageId, "page1");
    }
  });
});

describe("fetchAudienceSourceList defensive JSON", () => {
  it("504 + timeout text → user-friendly error, not parse exception", async () => {
    globalThis.fetch = async () =>
      new Response("An error occurred with your deployment", { status: 504 });

    const r = await fetchAudienceSourceList<unknown[]>(
      `http://example.invalid/list504?t=${Date.now()}`,
      "pages",
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.error, /timed out|Source fetch/i);
    }
  });

  it("non-JSON 200 does not throw — returns structured error", async () => {
    globalThis.fetch = async () =>
      new Response("Internal Server Error", { status: 200 });

    const r = await fetchAudienceSourceList<unknown[]>(
      `http://example.invalid/bad200?t=${Date.now()}`,
      "pages",
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /non-JSON|Server returned/i);
  });

  it("429 + JSON rate_limited still surfaces rate limit", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: "rate_limited",
          message: "Slow down",
          retryAfterMinutes: 15,
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );

    const r = await fetchAudienceSourceList<unknown[]>(
      `http://example.invalid/rl?t=${Date.now()}`,
      "pages",
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.rateLimited, true);
      assert.equal(r.error, "Slow down");
      assert.equal(r.retryAfterMinutes, 15);
    }
  });

  it("200 + valid JSON array still works", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ pages: [{ id: "1" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const r = await fetchAudienceSourceList<{ id: string }[]>(
      `http://example.invalid/pages?t=${Date.now()}`,
      "pages",
    );
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.data[0]?.id, "1");
  });
});
