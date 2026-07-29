/**
 * Regression tests for Bird list pagination.
 *
 * The workspace passed 100 projects, and `listProjects` previously read only
 * the first page. `findProjectByName` then reported "not found" for a project
 * that exists, and the runner responded by creating a DUPLICATE project — a
 * silent data-integrity failure with no error to notice.
 *
 * The subtle part: Bird returns the cursor as `nextPageToken` but only accepts
 * it back as the `pageToken` query param. Sending it as `nextPageToken`
 * re-serves page 1 forever, which looks like it works until you check the ids.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { findProjectByName, listProjects, listTemplates } from "../client.ts";

const cfg = { apiKey: "test-key", workspaceId: "ws-1" };

interface Page {
  results: unknown[];
  nextPageToken?: string;
}

/** Install a fake fetch serving `pages` keyed by the `pageToken` param. */
function mockFetch(pages: Record<string, Page>) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const u = new URL(String(url));
    calls.push(u.pathname + u.search);
    const page = pages[u.searchParams.get("pageToken") ?? ""];
    if (!page) throw new Error(`unexpected pageToken: ${u.searchParams.get("pageToken")}`);
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const project = (id: string, name: string) => ({ id, name, type: "channelTemplate" });

test("listProjects follows nextPageToken across every page", async () => {
  const m = mockFetch({
    "": { results: [project("p1", "alpha")], nextPageToken: "tok-2" },
    "tok-2": { results: [project("p2", "beta")], nextPageToken: "tok-3" },
    "tok-3": { results: [project("p3", "gamma")] },
  });
  try {
    const all = await listProjects(cfg);
    assert.deepEqual(all.map((p) => p.id), ["p1", "p2", "p3"]);
  } finally {
    m.restore();
  }
});

test("the cursor is sent back as `pageToken`, not `nextPageToken`", async () => {
  const m = mockFetch({
    "": { results: [project("p1", "alpha")], nextPageToken: "tok-2" },
    "tok-2": { results: [project("p2", "beta")] },
  });
  try {
    await listProjects(cfg);
    assert.equal(m.calls.length, 2);
    assert.ok(m.calls[1].includes("pageToken=tok-2"), m.calls[1]);
    assert.ok(!m.calls[1].includes("nextPageToken="), m.calls[1]);
  } finally {
    m.restore();
  }
});

test("findProjectByName matches a project that lives beyond page 1", async () => {
  const m = mockFetch({
    "": { results: [project("p1", "alpha")], nextPageToken: "tok-2" },
    "tok-2": { results: [project("p2", "throwback_monsantos_presale_live_en")] },
  });
  try {
    const hit = await findProjectByName(cfg, "throwback_monsantos_presale_live_en");
    assert.equal(hit?.id, "p2");
  } finally {
    m.restore();
  }
});

test("never requests limit above Bird's cap of 100 (>100 → 422)", async () => {
  const m = mockFetch({ "": { results: [] } });
  try {
    await listProjects(cfg);
    const limit = new URLSearchParams(m.calls[0].split("?")[1]).get("limit");
    assert.equal(limit, "100");
  } finally {
    m.restore();
  }
});

test("maxItems stops early without walking every page", async () => {
  const m = mockFetch({ "": { results: [project("p1", "alpha")], nextPageToken: "tok-2" } });
  try {
    const one = await listTemplates(cfg, "proj-1", 1);
    assert.equal(one.length, 1);
    assert.equal(m.calls.length, 1, "should not have fetched page 2");
    assert.ok(m.calls[0].includes("limit=1"), m.calls[0]);
  } finally {
    m.restore();
  }
});

test("a non-advancing cursor terminates instead of looping forever", async () => {
  // Bird re-serving the same token is exactly what the nextPageToken/pageToken
  // mix-up produced; the loop must not spin on it.
  const m = mockFetch({
    "": { results: [project("p1", "alpha")], nextPageToken: "" },
  });
  try {
    const all = await listProjects(cfg);
    assert.deepEqual(all.map((p) => p.id), ["p1"]);
    assert.equal(m.calls.length, 1);
  } finally {
    m.restore();
  }
});
