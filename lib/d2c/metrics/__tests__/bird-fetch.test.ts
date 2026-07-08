/**
 * Byte-diff test for the Bird broadcast metrics fetch (Goal 4). Asserts the
 * exact request URL (?expand=counters) + AccessKey auth header at the HTTP
 * boundary — per feedback_dry_run_stubs_miss_byte_level_bugs.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { fetchBirdMetrics } from "../bird.ts";

const realFetch = globalThis.fetch;

interface Captured {
  url: string;
  method: string;
  auth: string | null;
}

let captured: Captured | null = null;

function stubFetch(responseBody: unknown) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    captured = {
      url: String(url),
      method: init?.method ?? "GET",
      auth: headers.get("authorization"),
    };
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("fetchBirdMetrics HTTP boundary", () => {
  beforeEach(() => {
    captured = null;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("GETs the broadcast with ?expand=counters and AccessKey auth", async () => {
    stubFetch({
      counters: { campaign: { total: 100, dispatched: 98, dispatchFailed: 2, skipped: 0 } },
    });
    const m = await fetchBirdMetrics("KEY123", "ws-1", "cid-1", "bid-1", {
      nowIso: "2026-07-08T00:00:00.000Z",
    });
    assert.equal(
      captured?.url,
      "https://api.bird.com/workspaces/ws-1/campaigns/cid-1/broadcasts/bid-1?expand=counters",
    );
    assert.equal(captured?.method, "GET");
    assert.equal(captured?.auth, "AccessKey KEY123");
    // Mapped correctly.
    assert.equal(m.delivered, 98);
    assert.equal(m.attempted, 100);
    assert.equal(m.bounces, 2);
  });
});
