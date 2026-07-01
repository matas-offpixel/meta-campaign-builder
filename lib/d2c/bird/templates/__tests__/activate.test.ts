import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { activateTemplate, templateActivationState } from "../client.ts";
import type { BirdTemplate } from "../types.ts";

const cfg = { apiKey: "ak-test", workspaceId: "ws-1" };
const PID = "proj-1";
const TID = "tpl-1";

let origFetch: typeof fetch;
let calls: { method: string; url: string }[];

beforeEach(() => {
  origFetch = globalThis.fetch;
  calls = [];
});
afterEach(() => {
  globalThis.fetch = origFetch;
});

function tpl(status: string, platformInfo: Record<string, { status: string }> = {}): BirdTemplate {
  return {
    id: TID,
    projectId: PID,
    status,
    platformInfo,
    defaultLocale: "en",
    genericContent: [],
    platformContent: [],
    variables: [],
    supportedPlatforms: ["whatsapp"],
    shortLinks: { enabled: false, domain: "brd1.eu" },
    deployments: [],
  };
}

function mockFetch(sequence: (BirdTemplate | { activate: true })[]) {
  let i = 0;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url: String(url) });
    const step = sequence[i++];
    if (step && "activate" in step) {
      return new Response("{}", { status: 200 });
    }
    return new Response(JSON.stringify(step), { status: 200 });
  }) as unknown as typeof fetch;
}

test("activate: draft → PUT /activate fired, returns post-activation status", async () => {
  // GET(draft) → PUT(activate) → GET(pending)
  mockFetch([tpl("draft"), { activate: true }, tpl("active", { "whatsapp:1:en": { status: "pending" } })]);
  const res = await activateTemplate(cfg, PID, TID);
  assert.equal(res.activated, true);
  assert.equal(res.skipped, false);
  assert.equal(res.statusBefore, "draft");
  assert.deepEqual(res.platformStatuses, ["pending"]);
  const put = calls.find((c) => c.method === "PUT");
  assert.ok(put, "PUT was fired");
  assert.match(put!.url, /\/channel-templates\/tpl-1\/activate$/);
});

test("activate: already pending → idempotent skip, no PUT", async () => {
  mockFetch([tpl("active", { "whatsapp:1:en": { status: "pending" } })]);
  const res = await activateTemplate(cfg, PID, TID);
  assert.equal(res.activated, false);
  assert.equal(res.skipped, true);
  assert.equal(calls.filter((c) => c.method === "PUT").length, 0, "no PUT when already submitted");
});

test("activate: already active → idempotent skip", async () => {
  mockFetch([tpl("active", { "whatsapp:1:en": { status: "active" } })]);
  const res = await activateTemplate(cfg, PID, TID);
  assert.equal(res.skipped, true);
});

test("templateActivationState: draft + inactive are activatable, meta states are not", () => {
  assert.equal(templateActivationState(tpl("draft")).submitted, false);
  assert.equal(templateActivationState(tpl("inactive", { "whatsapp:1:en": { status: "inactive" } })).submitted, false);
  assert.equal(templateActivationState(tpl("draft", { "whatsapp:1:en": { status: "pending" } })).submitted, true);
  assert.equal(templateActivationState(tpl("active")).submitted, true);
});
