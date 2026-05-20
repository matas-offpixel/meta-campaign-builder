import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  pageLabel,
  resolvePageAccess,
  type PageProbeFn,
} from "../page-access.ts";

/**
 * Pre-flight access check for multi-page page-engagement audiences. Meta builds
 * the source set ATOMICALLY (#200 subcode 1713153), so one inaccessible page
 * kills the whole create. resolvePageAccess partitions requested pages into
 * accessible vs dropped using the same token the write will use.
 *
 * A page is accessible only when the probe returns a sufficient task
 * (MANAGE / CREATE_CONTENT / ADVERTISE). The probe is injected here so the
 * partitioning logic is exercised without touching the Graph API.
 */

/** Build an injectable probe from a fixture map of pageId → response | Error. */
function probeFrom(
  fixtures: Record<string, { name?: string; tasks?: string[] } | Error>,
): PageProbeFn {
  return async (pageId) => {
    const fixture = fixtures[pageId];
    if (fixture instanceof Error) throw fixture;
    if (!fixture) throw new Error(`unexpected page probe: ${pageId}`);
    return { id: pageId, ...fixture };
  };
}

describe("resolvePageAccess", () => {
  it("keeps pages with an admin/advertise task and reports their names", async () => {
    const result = await resolvePageAccess(
      ["1", "2", "3"],
      "tok",
      probeFrom({
        "1": { name: "Âme", tasks: ["MANAGE", "CREATE_CONTENT"] },
        "2": { name: "Page Two", tasks: ["ADVERTISE"] },
        "3": { name: "Page Three", tasks: ["MANAGE"] },
      }),
    );
    assert.deepEqual(result.accessiblePageIds, ["1", "2", "3"]);
    assert.equal(result.dropped.length, 0);
    assert.equal(result.names["1"], "Âme");
  });

  it("drops pages where the token lacks a sufficient task", async () => {
    const result = await resolvePageAccess(
      ["1", "2"],
      "tok",
      probeFrom({
        "1": { name: "Admin Page", tasks: ["MANAGE"] },
        "2": { name: "Read Only", tasks: ["ANALYZE", "MODERATE"] },
      }),
    );
    assert.deepEqual(result.accessiblePageIds, ["1"]);
    assert.equal(result.dropped.length, 1);
    assert.equal(result.dropped[0].pageId, "2");
    assert.equal(result.dropped[0].name, "Read Only");
    assert.match(result.dropped[0].reason, /ANALYZE, MODERATE/);
  });

  it("drops pages whose probe errors (no access / #200) with the error reason", async () => {
    const err = Object.assign(new Error("Permissions error"), {
      code: 200,
      subcode: 1713153,
    });
    const result = await resolvePageAccess(
      ["1", "2"],
      "tok",
      probeFrom({
        "1": { name: "Good", tasks: ["ADVERTISE"] },
        "2": err,
      }),
    );
    assert.deepEqual(result.accessiblePageIds, ["1"]);
    assert.equal(result.dropped.length, 1);
    assert.equal(result.dropped[0].pageId, "2");
    assert.match(result.dropped[0].reason, /Permissions error \(code 200\/1713153\)/);
  });

  it("treats a page with no tasks array as inaccessible", async () => {
    const result = await resolvePageAccess(
      ["1"],
      "tok",
      probeFrom({ "1": { name: "Orphan" } }),
    );
    assert.deepEqual(result.accessiblePageIds, []);
    assert.equal(result.dropped.length, 1);
    assert.match(result.dropped[0].reason, /no admin role/);
  });

  it("returns an empty accessible set when every page is inaccessible", async () => {
    const result = await resolvePageAccess(
      ["1", "2"],
      "tok",
      probeFrom({
        "1": { tasks: ["ANALYZE"] },
        "2": new Error("not found"),
      }),
    );
    assert.deepEqual(result.accessiblePageIds, []);
    assert.equal(result.dropped.length, 2);
  });

  it("dedupes and trims ids, preserving original order in both lists", async () => {
    const result = await resolvePageAccess(
      [" 1 ", "2", "1", "", "3"],
      "tok",
      probeFrom({
        "1": { tasks: ["MANAGE"] },
        "2": { tasks: ["ANALYZE"] },
        "3": { tasks: ["ADVERTISE"] },
      }),
    );
    assert.deepEqual(result.accessiblePageIds, ["1", "3"]);
    assert.deepEqual(
      result.dropped.map((d) => d.pageId),
      ["2"],
    );
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
