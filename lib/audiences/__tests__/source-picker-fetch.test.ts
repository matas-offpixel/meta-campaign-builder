import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { audienceSourceRateLimitBody } from "../meta-rate-limit.ts";
import {
  fetchAudienceCampaignVideos,
  fetchAudienceSourceList,
} from "../source-picker-fetch.ts";

describe("fetchAudienceSourceList", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses 429 rate_limited JSON for picker messaging", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: "rate_limited",
          retryAfterMinutes: 30,
          message:
            "Meta is rate-limiting this ad account. Try again in ~30 minutes.",
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );

    const result = await fetchAudienceSourceList<{ id: string }[]>(
      "http://test/pages",
      "pages",
    );
    assert.equal(result.ok, false);
    if (result.ok) assert.fail("expected error branch");
    assert.equal(result.rateLimited, true);
    assert.equal(result.retryAfterMinutes, 30);
    assert.match(result.error, /rate-limit/i);
  });

  it("dedupes concurrent fetches for the same URL", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ ok: true, pages: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const url = "http://test/concurrent-pages";
    const [a, b] = await Promise.all([
      fetchAudienceSourceList<unknown[]>(url, "pages"),
      fetchAudienceSourceList<unknown[]>(url, "pages"),
    ]);
    assert.equal(calls, 1);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
  });
});

describe("fetchAudienceCampaignVideos", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("maps campaign-videos 429 to rateLimited", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify(audienceSourceRateLimitBody()), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });

    const result = await fetchAudienceCampaignVideos("http://test/videos");
    assert.equal(result.ok, false);
    if (result.ok) assert.fail("expected error");
    assert.equal(result.rateLimited, true);
  });
});
