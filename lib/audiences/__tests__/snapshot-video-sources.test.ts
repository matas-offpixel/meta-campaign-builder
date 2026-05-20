// ─────────────────────────────────────────────────────────────────────────────
// snapshot-video-sources resolver tests.
//
// Run with:
//   node --experimental-strip-types --test \
//     lib/audiences/__tests__/snapshot-video-sources.test.ts
//
// Stubs the chained Supabase query builder (same pattern as
// `lib/db/__tests__/active-creatives-snapshots.test.ts`) so we
// never construct a real client.
// ─────────────────────────────────────────────────────────────────────────────

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getCurrentBuildVersion } from "../../build-version.ts";
import { getVideoSourcesFromSnapshot } from "../snapshot-video-sources.ts";
import type { ShareActiveCreativesResult } from "../../reporting/share-active-creatives.ts";

// ── Tiny chained-builder stub ─────────────────────────────────────────────

interface ReadResult {
  data: unknown;
  error: unknown;
}

function makeSequentialReadStub(
  results: ReadResult[],
): {
  client: SupabaseClient;
  calls: Array<{
    table: string | null;
    eqs: Array<{ col: string; val: unknown }>;
  }>;
} {
  const queue = [...results];
  const calls: Array<{
    table: string | null;
    eqs: Array<{ col: string; val: unknown }>;
  }> = [];
  let current: (typeof calls)[number] | null = null;

  const builder: Record<string, unknown> = {
    select() {
      return builder;
    },
    eq(col: string, val: unknown) {
      current?.eqs.push({ col, val });
      return builder;
    },
    is() {
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return builder;
    },
    maybeSingle() {
      const next = queue.shift() ?? { data: null, error: null };
      return Promise.resolve(next);
    },
  };

  const client = {
    from(table: string) {
      current = { table, eqs: [] };
      calls.push(current);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

function okPayload(
  audienceVideoSources?:
    | { video_id: string; context_page_id: string }[]
    | undefined,
): ShareActiveCreativesResult {
  return {
    kind: "ok",
    groups: [],
    ad_account_id: "act_1",
    event_code: "EVT-1",
    fetched_at: "2026-04-22T12:00:00Z",
    meta: {
      campaigns_total: 1,
      campaigns_failed: 0,
      ads_fetched: 1,
      dropped_no_creative: 0,
      truncated: false,
      unattributed: {
        ads_count: 0,
        spend: 0,
        impressions: 0,
        clicks: 0,
        inline_link_clicks: 0,
        landingPageViews: 0,
        registrations: 0,
        purchases: 0,
      },
    },
    audience_video_sources: audienceVideoSources,
  };
}

function freshRow(payload: ShareActiveCreativesResult): ReadResult {
  return {
    data: {
      payload,
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      is_stale: false,
      build_version: getCurrentBuildVersion(),
    },
    error: null,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("getVideoSourcesFromSnapshot — empty input", () => {
  it("returns empty map without touching Supabase", async () => {
    const { client, calls } = makeSequentialReadStub([]);
    const out = await getVideoSourcesFromSnapshot(client, []);
    assert.equal(out.size, 0);
    assert.equal(calls.length, 0);
  });
});

describe("getVideoSourcesFromSnapshot — cache hit", () => {
  it("returns extracted (videoId, contextPageId) pairs", async () => {
    const sources = [
      { video_id: "v1", context_page_id: "p1" },
      { video_id: "v2", context_page_id: "p1" },
    ];
    const { client } = makeSequentialReadStub([freshRow(okPayload(sources))]);
    const out = await getVideoSourcesFromSnapshot(client, ["evt-1"]);
    const hit = out.get("evt-1");
    assert.ok(hit && hit.kind === "hit");
    if (hit.kind === "hit") {
      assert.deepEqual(hit.sources, [
        { videoId: "v1", contextPageId: "p1" },
        { videoId: "v2", contextPageId: "p1" },
      ]);
      assert.equal(hit.stale, false);
    }
  });

  it("marks rows past expires_at as stale=true", async () => {
    const expired: ReadResult = {
      data: {
        payload: okPayload([{ video_id: "v1", context_page_id: "p1" }]),
        fetched_at: new Date(Date.now() - 120_000).toISOString(),
        expires_at: new Date(Date.now() - 60_000).toISOString(),
        is_stale: false,
        build_version: getCurrentBuildVersion(),
      },
      error: null,
    };
    const { client } = makeSequentialReadStub([expired]);
    const out = await getVideoSourcesFromSnapshot(client, ["evt-1"]);
    const hit = out.get("evt-1");
    assert.ok(hit && hit.kind === "hit");
    if (hit.kind === "hit") {
      assert.equal(hit.stale, true);
    }
  });

  it("marks rows with is_stale=true as stale=true even when not expired", async () => {
    const staleFlag: ReadResult = {
      data: {
        payload: okPayload([{ video_id: "v1", context_page_id: "p1" }]),
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        is_stale: true,
        build_version: getCurrentBuildVersion(),
      },
      error: null,
    };
    const { client } = makeSequentialReadStub([staleFlag]);
    const out = await getVideoSourcesFromSnapshot(client, ["evt-1"]);
    const hit = out.get("evt-1");
    assert.ok(hit && hit.kind === "hit");
    if (hit.kind === "hit") {
      assert.equal(hit.stale, true);
    }
  });
});

describe("getVideoSourcesFromSnapshot — cache miss", () => {
  it("returns no_snapshot when DB returns null row", async () => {
    const { client } = makeSequentialReadStub([
      { data: null, error: null },
    ]);
    const out = await getVideoSourcesFromSnapshot(client, ["evt-1"]);
    const result = out.get("evt-1");
    assert.ok(result && result.kind === "miss");
    if (result.kind === "miss") {
      assert.equal(result.reason, "no_snapshot");
    }
  });

  it("returns no_snapshot when build_version mismatches", async () => {
    const mismatched: ReadResult = {
      data: {
        payload: okPayload([{ video_id: "v1", context_page_id: "p1" }]),
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        is_stale: false,
        // Different sha than getCurrentBuildVersion() — read helper
        // returns null which the resolver treats as miss.
        build_version: "completely-different-sha",
      },
      error: null,
    };
    const { client } = makeSequentialReadStub([mismatched]);
    const out = await getVideoSourcesFromSnapshot(client, ["evt-1"]);
    const result = out.get("evt-1");
    assert.ok(result && result.kind === "miss");
    if (result.kind === "miss") {
      assert.equal(result.reason, "no_snapshot");
    }
  });

  it("returns no_audience_sources when snapshot is pre-PR (no audience_video_sources)", async () => {
    // Snapshot from earlier cron cycle — payload exists but lacks
    // the new field. After this PR deploys, the next cron cycle
    // (≤6h) overwrites with the populated shape. In the meantime
    // the event falls back to the live walk.
    const { client } = makeSequentialReadStub([freshRow(okPayload())]);
    const out = await getVideoSourcesFromSnapshot(client, ["evt-1"]);
    const result = out.get("evt-1");
    assert.ok(result && result.kind === "miss");
    if (result.kind === "miss") {
      assert.equal(result.reason, "no_audience_sources");
    }
  });

  it("returns no_audience_sources when audience_video_sources is empty", async () => {
    const { client } = makeSequentialReadStub([freshRow(okPayload([]))]);
    const out = await getVideoSourcesFromSnapshot(client, ["evt-1"]);
    const result = out.get("evt-1");
    assert.ok(result && result.kind === "miss");
    if (result.kind === "miss") {
      assert.equal(result.reason, "no_audience_sources");
    }
  });

  it("returns no_audience_sources when payload is skip/error discriminant", async () => {
    // Defensive — writer's refusal contract should prevent this,
    // but if a future regression lets one through we degrade
    // rather than throw.
    const skipPayload: ShareActiveCreativesResult = {
      kind: "skip",
      reason: "no_linked_campaigns",
    };
    const { client } = makeSequentialReadStub([freshRow(skipPayload)]);
    const out = await getVideoSourcesFromSnapshot(client, ["evt-1"]);
    const result = out.get("evt-1");
    assert.ok(result && result.kind === "miss");
    if (result.kind === "miss") {
      assert.equal(result.reason, "no_audience_sources");
    }
  });
});

describe("getVideoSourcesFromSnapshot — mixed batch", () => {
  it("classifies each event independently (hit / miss / pre-cache)", async () => {
    const { client } = makeSequentialReadStub([
      freshRow(okPayload([{ video_id: "v1", context_page_id: "p1" }])),
      { data: null, error: null },
      freshRow(okPayload()),
    ]);
    const out = await getVideoSourcesFromSnapshot(client, [
      "evt-hit",
      "evt-miss",
      "evt-pre-cache",
    ]);
    assert.equal(out.size, 3);
    const hit = out.get("evt-hit");
    const miss = out.get("evt-miss");
    const preCache = out.get("evt-pre-cache");
    assert.equal(hit?.kind, "hit");
    assert.equal(miss?.kind, "miss");
    if (miss?.kind === "miss") {
      assert.equal(miss.reason, "no_snapshot");
    }
    assert.equal(preCache?.kind, "miss");
    if (preCache?.kind === "miss") {
      assert.equal(preCache.reason, "no_audience_sources");
    }
  });

  it("filters the snapshot query by event_id and date_preset=maximum", async () => {
    const { client, calls } = makeSequentialReadStub([
      freshRow(okPayload([{ video_id: "v1", context_page_id: "p1" }])),
      { data: null, error: null },
    ]);
    await getVideoSourcesFromSnapshot(client, ["evt-1", "evt-2"]);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0]!.eqs, [
      { col: "event_id", val: "evt-1" },
      { col: "date_preset", val: "maximum" },
    ]);
    assert.deepEqual(calls[1]!.eqs, [
      { col: "event_id", val: "evt-2" },
      { col: "date_preset", val: "maximum" },
    ]);
  });
});
