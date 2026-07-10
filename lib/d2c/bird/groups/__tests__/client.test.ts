import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import {
  createGroup,
  findGroupByName,
  getGroup,
  listGroups,
  resolveOrCreateGroup,
} from "../client.ts";

const CFG = {
  apiKey: "ak-test",
  workspaceId: "9c308f77-c5ed-44d3-9714-9da017c7536c",
} as const;

let origFetch: typeof fetch;
let calls: { method: string; url: string; body?: string }[];

beforeEach(() => {
  origFetch = globalThis.fetch;
  calls = [];
});
afterEach(() => {
  globalThis.fetch = origFetch;
});

function mockFetch(handler: (method: string, url: string, body?: string) => Response) {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body as string | undefined;
    calls.push({ method, url: String(url), body });
    return handler(method, String(url), body);
  }) as unknown as typeof fetch;
}

test("listGroups unwraps the results envelope and caps limit at 100", async () => {
  mockFetch((method, url) => {
    assert.equal(method, "GET");
    assert.match(url, /\/groups\?limit=100$/);
    return new Response(
      JSON.stringify({ results: [{ id: "g1", name: "T26-ALGARVE" }] }),
      { status: 200 },
    );
  });
  const list = await listGroups(CFG, 500); // caller passes >100, must be capped
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "g1");
});

test("getGroup GETs the single-group endpoint", async () => {
  mockFetch((method, url) => {
    assert.equal(method, "GET");
    assert.equal(url, `https://api.bird.com/workspaces/${CFG.workspaceId}/groups/g1`);
    return new Response(JSON.stringify({ id: "g1", name: "T26-ALGARVE" }), { status: 200 });
  });
  const group = await getGroup(CFG, "g1");
  assert.equal(group.id, "g1");
});

test("findGroupByName matches case-insensitively and trims", async () => {
  mockFetch(() =>
    new Response(JSON.stringify({ results: [{ id: "g1", name: " T26-Algarve " }] }), {
      status: 200,
    }),
  );
  const found = await findGroupByName(CFG, "t26-algarve");
  assert.equal(found?.id, "g1");
});

test("findGroupByName returns null when no match", async () => {
  mockFetch(() => new Response(JSON.stringify({ results: [] }), { status: 200 }));
  const found = await findGroupByName(CFG, "nope");
  assert.equal(found, null);
});

test("createGroup: POST { name } -> group envelope (probe #1 shape)", async () => {
  mockFetch((method, url, body) => {
    assert.equal(method, "POST");
    assert.equal(url, `https://api.bird.com/workspaces/${CFG.workspaceId}/groups`);
    assert.deepEqual(JSON.parse(body ?? "{}"), { name: "ZZ-CAPTURE-TEST" });
    return new Response(
      JSON.stringify({ id: "95e23209-67dc-4390-a931-b5a490ae7800", name: "ZZ-CAPTURE-TEST" }),
      { status: 201 },
    );
  });
  const group = await createGroup(CFG, "ZZ-CAPTURE-TEST");
  assert.equal(group.id, "95e23209-67dc-4390-a931-b5a490ae7800");
});

test("resolveOrCreateGroup: returns existing group, no create POST", async () => {
  mockFetch(() =>
    new Response(JSON.stringify({ results: [{ id: "g-existing", name: "T26-ALGARVE" }] }), {
      status: 200,
    }),
  );
  const result = await resolveOrCreateGroup(CFG, "T26-ALGARVE");
  assert.equal(result.existed, true);
  assert.equal(result.group.id, "g-existing");
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);
});

test("resolveOrCreateGroup: creates when no match found", async () => {
  let i = 0;
  mockFetch((method) => {
    if (i++ === 0) return new Response(JSON.stringify({ results: [] }), { status: 200 });
    assert.equal(method, "POST");
    return new Response(JSON.stringify({ id: "g-new", name: "T26-NEWCITY" }), { status: 201 });
  });
  const result = await resolveOrCreateGroup(CFG, "T26-NEWCITY");
  assert.equal(result.existed, false);
  assert.equal(result.group.id, "g-new");
});
