import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import {
  JOURNEY_CREATE_VERIFIED,
  createJourneyShell,
  deleteJourney,
  findJourneyByName,
  getJourney,
  listJourneyVersions,
  listJourneys,
  publishVersion,
  writeJourneyVersion,
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

// ── Sequence gate ───────────────────────────────────────────────────────────

test("JOURNEY_CREATE_VERIFIED is false (sequence not yet byte-confirmed)", () => {
  assert.equal(JOURNEY_CREATE_VERIFIED, false);
});

test("writeJourneyVersion throws BIRD_JOURNEY_SEQUENCE_UNCONFIRMED and never calls fetch", async () => {
  mockFetch(() => new Response("{}", { status: 200 }));
  await assert.rejects(
    () =>
      writeJourneyVersion(CFG, "journey-1", {
        trigger: { type: "journey-contact", data: {} },
        definition: { startAt: "x", steps: {} },
      }),
    /BIRD_JOURNEY_SEQUENCE_UNCONFIRMED/,
  );
  assert.equal(calls.length, 0, "must not hit the network while unverified");
});

test("publishVersion throws BIRD_JOURNEY_SEQUENCE_UNCONFIRMED and never calls fetch", async () => {
  mockFetch(() => new Response("{}", { status: 200 }));
  await assert.rejects(
    () => publishVersion(CFG, "journey-1", "version-1"),
    /BIRD_JOURNEY_SEQUENCE_UNCONFIRMED/,
  );
  assert.equal(calls.length, 0, "must not hit the network while unverified");
});

// ── Step 1 (CONFIRMED): createJourneyShell ──────────────────────────────────

// Byte-exact against .scratch/bird-journey-create-probe-capture.txt, probe #2
// (2026-07-10T07:22:54.919Z) — the request body Bird accepted with 201.
const CAPTURED_CREATE_REQUEST_BODY = {
  name: "zz-capture-test-394e02a8-58fe-4e7a-a268-a25eb4ef7ede",
};
const CAPTURED_CREATE_RESPONSE_BODY = {
  id: "8e228cb6-68e2-441f-97ed-69f6ae68a395",
  status: "requires-configuration",
  name: "zz-capture-test-394e02a8-58fe-4e7a-a268-a25eb4ef7ede",
  secrets: {},
  settings: { maxSteps: 200 },
  trigger: null,
  publishedVersion: null,
  publishedVersionStepCount: 0,
  draftVersion: null,
  versionCount: 0,
  invocationCount: 0,
  conversionCount: 0,
  description: "",
  tags: null,
  category: "",
  stepFeatures: [],
  capabilities: { audienceEnrollment: false },
  createdAt: "2026-07-10T07:22:55.116Z",
  updatedAt: "2026-07-10T07:22:55.116Z",
};

test("createJourneyShell: request body is byte-exact against the captured probe #2 POST", async () => {
  mockFetch((method, url) => {
    assert.equal(method, "POST");
    assert.equal(url, `https://api.bird.com/workspaces/${CFG.workspaceId}/journeys`);
    return new Response(JSON.stringify(CAPTURED_CREATE_RESPONSE_BODY), { status: 201 });
  });

  const result = await createJourneyShell(CFG, CAPTURED_CREATE_REQUEST_BODY.name);

  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].body ?? "{}"), CAPTURED_CREATE_REQUEST_BODY);
  assert.deepEqual(result, CAPTURED_CREATE_RESPONSE_BODY);
  assert.equal(result.status, "requires-configuration");
  assert.equal(result.trigger, null);
  assert.equal(result.versionCount, 0);
});

test("createJourneyShell: surfaces non-2xx as BirdHttpError", async () => {
  mockFetch(() => new Response(JSON.stringify({ code: "InvalidPayload" }), { status: 422 }));
  await assert.rejects(() => createJourneyShell(CFG, "bad-name"), /Bird HTTP 422/);
});

// ── Reads ────────────────────────────────────────────────────────────────

test("listJourneys unwraps the results envelope", async () => {
  mockFetch((method, url) => {
    assert.equal(method, "GET");
    assert.match(url, /\/journeys\?limit=100$/);
    return new Response(
      JSON.stringify({ results: [{ id: "j1", name: "T26-ALGARVE", status: "active" }] }),
      { status: 200 },
    );
  });
  const list = await listJourneys(CFG);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "j1");
});

test("findJourneyByName matches case-insensitively and trims", async () => {
  mockFetch(() =>
    new Response(JSON.stringify({ results: [{ id: "j1", name: " T26-Algarve " }] }), {
      status: 200,
    }),
  );
  const found = await findJourneyByName(CFG, "t26-algarve");
  assert.equal(found?.id, "j1");
});

test("findJourneyByName returns null when no match", async () => {
  mockFetch(() => new Response(JSON.stringify({ results: [] }), { status: 200 }));
  const found = await findJourneyByName(CFG, "nope");
  assert.equal(found, null);
});

test("getJourney GETs the single-journey endpoint", async () => {
  mockFetch((method, url) => {
    assert.equal(method, "GET");
    assert.equal(url, `https://api.bird.com/workspaces/${CFG.workspaceId}/journeys/j1`);
    return new Response(JSON.stringify({ id: "j1", status: "active" }), { status: 200 });
  });
  const journey = await getJourney(CFG, "j1");
  assert.equal(journey.id, "j1");
});

test("listJourneyVersions unwraps the results envelope (empty, per probe #2)", async () => {
  mockFetch((method, url) => {
    assert.equal(method, "GET");
    assert.match(url, /\/journeys\/j1\/versions$/);
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  });
  const versions = await listJourneyVersions(CFG, "j1");
  assert.deepEqual(versions, []);
});

// ── Cleanup helper ───────────────────────────────────────────────────────

test("deleteJourney: DELETE, 204 no body", async () => {
  mockFetch((method, url) => {
    assert.equal(method, "DELETE");
    assert.equal(url, `https://api.bird.com/workspaces/${CFG.workspaceId}/journeys/j1`);
    return new Response(null, { status: 204 });
  });
  await deleteJourney(CFG, "j1");
  assert.equal(calls.length, 1);
});

test("deleteJourney: surfaces non-2xx as BirdHttpError", async () => {
  mockFetch(() => new Response("nope", { status: 500 }));
  await assert.rejects(() => deleteJourney(CFG, "j1"), /Bird HTTP 500/);
});
