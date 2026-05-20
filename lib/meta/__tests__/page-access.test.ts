import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  pageLabel,
  resolvePageAccess,
  type BusinessPagesFn,
  type PageProbeFn,
} from "../page-access.ts";

/**
 * Pre-flight access check for multi-page page-engagement audiences. Meta builds
 * the source set ATOMICALLY (#200 subcode 1713153), so one inaccessible page
 * kills the whole create. resolvePageAccess partitions requested pages into
 * accessible vs dropped using TWO sources:
 *   (a) the BM page list (owned + partner-shared) — covers "Ads and Insights"
 *       grants whose personal-token tasks probe is empty, AND
 *   (b) the per-page `tasks` probe (MANAGE/CREATE_CONTENT/MODERATE/ADVERTISE/
 *       ANALYZE qualify; MESSAGING does not).
 * Both sources are injected here so the logic runs without the Graph API.
 */

/** Build an injectable probe from a fixture map of pageId → response | Error. */
function probeFrom(
  fixtures: Record<string, { name?: string; tasks?: string[] } | Error>,
  onProbe?: (pageId: string) => void,
): PageProbeFn {
  return async (pageId) => {
    onProbe?.(pageId);
    const fixture = fixtures[pageId];
    if (fixture instanceof Error) throw fixture;
    if (!fixture) throw new Error(`unexpected page probe: ${pageId}`);
    return { id: pageId, ...fixture };
  };
}

/** Build an injectable BM page-list resolver from id → name entries. */
function businessPagesFrom(entries: Record<string, string>): BusinessPagesFn {
  return async () => new Map(Object.entries(entries));
}

describe("resolvePageAccess — per-page tasks probe", () => {
  it("accepts every qualifying task tier (MANAGE/CREATE_CONTENT/MODERATE/ADVERTISE/ANALYZE)", async () => {
    const result = await resolvePageAccess(["1", "2", "3", "4", "5"], "tok", {
      probe: probeFrom({
        "1": { name: "Manage", tasks: ["MANAGE"] },
        "2": { name: "Create", tasks: ["CREATE_CONTENT"] },
        "3": { name: "Moderate", tasks: ["MODERATE"] },
        "4": { name: "Advertise", tasks: ["ADVERTISE"] },
        "5": { name: "Analyze", tasks: ["ANALYZE"] },
      }),
    });
    assert.deepEqual(result.accessiblePageIds, ["1", "2", "3", "4", "5"]);
    assert.equal(result.dropped.length, 0);
  });

  it("accepts an ANALYZE-only page (Ads-and-Insights tier)", async () => {
    const result = await resolvePageAccess(["1"], "tok", {
      probe: probeFrom({ "1": { name: "Insights Only", tasks: ["ANALYZE"] } }),
    });
    assert.deepEqual(result.accessiblePageIds, ["1"]);
    assert.equal(result.dropped.length, 0);
  });

  it("drops a page whose only task is MESSAGING (no ad/insight access)", async () => {
    const result = await resolvePageAccess(["1", "2"], "tok", {
      probe: probeFrom({
        "1": { name: "Admin Page", tasks: ["MANAGE"] },
        "2": { name: "Inbox Only", tasks: ["MESSAGING"] },
      }),
    });
    assert.deepEqual(result.accessiblePageIds, ["1"]);
    assert.equal(result.dropped.length, 1);
    assert.equal(result.dropped[0].pageId, "2");
    assert.equal(result.dropped[0].name, "Inbox Only");
    assert.match(result.dropped[0].reason, /MESSAGING/);
    assert.match(result.dropped[0].reason, /Business Manager/);
  });

  it("drops pages whose probe errors (no access / #200) with the error reason", async () => {
    const err = Object.assign(new Error("Permissions error"), {
      code: 200,
      subcode: 1713153,
    });
    const result = await resolvePageAccess(["1", "2"], "tok", {
      probe: probeFrom({ "1": { name: "Good", tasks: ["ADVERTISE"] }, "2": err }),
    });
    assert.deepEqual(result.accessiblePageIds, ["1"]);
    assert.equal(result.dropped.length, 1);
    assert.equal(result.dropped[0].pageId, "2");
    assert.match(result.dropped[0].reason, /Permissions error \(code 200\/1713153\)/);
  });

  it("treats a page with no tasks array as inaccessible", async () => {
    const result = await resolvePageAccess(["1"], "tok", {
      probe: probeFrom({ "1": { name: "Orphan" } }),
    });
    assert.deepEqual(result.accessiblePageIds, []);
    assert.equal(result.dropped.length, 1);
    assert.match(result.dropped[0].reason, /no role on this page/);
  });

  it("returns an empty accessible set when every page is inaccessible", async () => {
    const result = await resolvePageAccess(["1", "2"], "tok", {
      probe: probeFrom({
        "1": { tasks: ["MESSAGING"] },
        "2": new Error("not found"),
      }),
    });
    assert.deepEqual(result.accessiblePageIds, []);
    assert.equal(result.dropped.length, 2);
  });

  it("dedupes and trims ids, preserving original order in both lists", async () => {
    const result = await resolvePageAccess([" 1 ", "2", "1", "", "3"], "tok", {
      probe: probeFrom({
        "1": { tasks: ["MANAGE"] },
        "2": { tasks: ["MESSAGING"] },
        "3": { tasks: ["ADVERTISE"] },
      }),
    });
    assert.deepEqual(result.accessiblePageIds, ["1", "3"]);
    assert.deepEqual(
      result.dropped.map((d) => d.pageId),
      ["2"],
    );
  });

  it("with no businessPages resolver, falls back to user-token-only probe", async () => {
    const result = await resolvePageAccess(["1", "2"], "tok", {
      probe: probeFrom({
        "1": { tasks: ["ADVERTISE"] },
        "2": { tasks: ["MESSAGING"] },
      }),
    });
    assert.deepEqual(result.accessiblePageIds, ["1"]);
    assert.deepEqual(result.dropped.map((d) => d.pageId), ["2"]);
  });
});

describe("resolvePageAccess — Business Manager rescue", () => {
  it("accepts a BM-shared page even when its tasks probe is EMPTY", async () => {
    // Innervisions case: personal token sees no tasks, but the page is shared
    // into the client's BM at the Ads-and-Insights tier.
    const result = await resolvePageAccess(["ame", "dixon"], "tok", {
      probe: probeFrom({
        "ame": { name: "Âme", tasks: [] },
        "dixon": { name: "Dixon", tasks: [] },
      }),
      businessPages: businessPagesFrom({ "ame": "Âme", "dixon": "Dixon" }),
    });
    assert.deepEqual(result.accessiblePageIds, ["ame", "dixon"]);
    assert.equal(result.dropped.length, 0);
    assert.equal(result.names["ame"], "Âme");
  });

  it("accepts a BM-shared page even when its tasks probe ERRORS", async () => {
    const err = Object.assign(new Error("Unsupported get request"), { code: 100 });
    const result = await resolvePageAccess(["shared", "blocked"], "tok", {
      probe: probeFrom({ "shared": err, "blocked": err }),
      businessPages: businessPagesFrom({ "shared": "Shared Page" }),
    });
    assert.deepEqual(result.accessiblePageIds, ["shared"]);
    assert.deepEqual(result.dropped.map((d) => d.pageId), ["blocked"]);
  });

  it("short-circuits the probe for BM pages (probe is not called)", async () => {
    const probed: string[] = [];
    const result = await resolvePageAccess(["bm", "direct"], "tok", {
      probe: probeFrom(
        { "bm": { tasks: [] }, "direct": { tasks: ["MANAGE"] } },
        (id) => probed.push(id),
      ),
      businessPages: businessPagesFrom({ "bm": "BM Page" }),
    });
    assert.deepEqual(result.accessiblePageIds, ["bm", "direct"]);
    // Only the non-BM page is probed; the BM page short-circuits.
    assert.deepEqual(probed, ["direct"]);
  });

  it("combines both sources: BM page + direct-task page accessible, others dropped", async () => {
    const result = await resolvePageAccess(["bm", "direct", "none"], "tok", {
      probe: probeFrom({
        "bm": { tasks: [] },
        "direct": { name: "Direct", tasks: ["ADVERTISE"] },
        "none": { name: "No Access", tasks: ["MESSAGING"] },
      }),
      businessPages: businessPagesFrom({ "bm": "BM Page" }),
    });
    assert.deepEqual(result.accessiblePageIds, ["bm", "direct"]);
    assert.deepEqual(result.dropped.map((d) => d.pageId), ["none"]);
  });

  it("degrades to probe-only when the businessPages resolver throws", async () => {
    const result = await resolvePageAccess(["1", "2"], "tok", {
      probe: probeFrom({
        "1": { tasks: ["ADVERTISE"] },
        "2": { tasks: [] },
      }),
      businessPages: async () => {
        throw new Error("BM lookup failed");
      },
    });
    assert.deepEqual(result.accessiblePageIds, ["1"]);
    assert.deepEqual(result.dropped.map((d) => d.pageId), ["2"]);
  });
});

describe("pageLabel", () => {
  it("renders 'Name (id)' when a name is known", () => {
    assert.equal(pageLabel("123", { "123": "Âme" }), "Âme (123)");
  });

  it("falls back to the bare id when no name is known", () => {
    assert.equal(pageLabel("123", {}), "123");
  });
});
