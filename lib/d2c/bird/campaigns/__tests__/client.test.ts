import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import {
  buildDraftPayload,
  createDraftCampaign,
  type BirdCampaign,
} from "../client.ts";

const BASE_INPUT = {
  apiKey: "ak-test",
  workspaceId: "ws-1",
  channelId: "chan-1",
  projectId: "proj-1",
  templateId: "tpl-1",
  name: "j26-mallorca_presale_live_20260801",
  locale: "es-ES",
  variables: { EVENT_NAME: "Jackies", TICKET_URL: "https://ra.co/events/2375157" },
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

/** Mock: first call is the GET-by-name list, second (optional) is the POST. */
function mockFetch(list: BirdCampaign[], created?: BirdCampaign) {
  let i = 0;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url: String(url), body: init?.body as string | undefined });
    if (i++ === 0) {
      return new Response(JSON.stringify({ results: list }), { status: 200 });
    }
    return new Response(JSON.stringify(created ?? {}), { status: 200 });
  }) as unknown as typeof fetch;
}

test("createDraftCampaign: happy path creates draft and returns id/editUrl/status", async () => {
  mockFetch([], { id: "camp-123", status: "draft" });
  const res = await createDraftCampaign({ ...BASE_INPUT });

  assert.equal(res.existed, false);
  assert.equal(res.id, "camp-123");
  assert.equal(res.status, "draft");
  assert.match(res.editUrl, /\/workspaces\/ws-1\/campaigns\/camp-123$/);

  const post = calls.find((c) => c.method === "POST");
  assert.ok(post, "POST fired");
  const payload = JSON.parse(post!.body ?? "{}");
  assert.equal(payload.name, BASE_INPUT.name);
  assert.equal(payload.status, "draft");
  assert.equal(payload.channelId, "chan-1");
  assert.equal(payload.content.template.templateId, "tpl-1");
});

test("createDraftCampaign: idempotency — existing campaign by name is returned, no POST", async () => {
  mockFetch([{ id: "camp-existing", name: BASE_INPUT.name, status: "draft" }]);
  const res = await createDraftCampaign({ ...BASE_INPUT });

  assert.equal(res.existed, true);
  assert.equal(res.id, "camp-existing");
  assert.equal(calls.filter((c) => c.method === "POST").length, 0, "no POST on skip");
});

test("buildDraftPayload: recipients tag pre-populates a segment reference", () => {
  const payload = buildDraftPayload({ ...BASE_INPUT, recipients: { tag: "jackies_j26" } });
  assert.deepEqual(payload.recipients, { type: "segment", segmentTag: "jackies_j26" });

  const empty = buildDraftPayload({ ...BASE_INPUT });
  assert.deepEqual(empty.recipients, { type: "manual", audiences: [] });
});
