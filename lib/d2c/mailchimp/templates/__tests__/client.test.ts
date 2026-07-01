import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import {
  createCampaign,
  createTemplate,
  deleteTemplate,
  findTemplateByName,
  listTemplates,
  resolveAudienceByName,
  resolveSegmentByTag,
  scheduleCampaign,
} from "../client.ts";

const cfg = { serverPrefix: "us7", apiKey: "key-us7" };

let origFetch: typeof fetch;
let calls: { method: string; url: string; body?: unknown }[];

beforeEach(() => {
  origFetch = globalThis.fetch;
  calls = [];
});
afterEach(() => {
  globalThis.fetch = origFetch;
});

function route(map: Record<string, unknown>) {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown;
    if (init?.body) {
      try {
        body = JSON.parse(String(init.body));
      } catch {
        body = init.body;
      }
    }
    calls.push({ method, url: u, body });
    // find first key that the URL path contains
    for (const [frag, resp] of Object.entries(map)) {
      const [m, path] = frag.includes(" ") ? frag.split(" ") : ["", frag];
      if (u.includes(path) && (!m || m === method)) {
        return new Response(JSON.stringify(resp), { status: 200 });
      }
    }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
}

test("createTemplate posts name+html and returns id", async () => {
  route({ "POST /3.0/templates": { id: 42, name: "jackies_announcement", type: "user" } });
  const t = await createTemplate(cfg, { name: "jackies_announcement", html: "<b>hi</b>" });
  assert.equal(t.id, 42);
  const post = calls.find((c) => c.method === "POST");
  assert.equal((post!.body as { name: string }).name, "jackies_announcement");
});

test("findTemplateByName lists user templates and matches exact name", async () => {
  route({
    "/3.0/templates": {
      templates: [
        { id: 1, name: "other", type: "user" },
        { id: 2, name: "jackies_autoresp", type: "user" },
      ],
      total_items: 2,
    },
  });
  const found = await findTemplateByName(cfg, "jackies_autoresp");
  assert.equal(found?.id, 2);
  const missing = await findTemplateByName(cfg, "nope");
  assert.equal(missing, null);
});

test("listTemplates caps count at 1000 and passes type", async () => {
  route({ "/3.0/templates": { templates: [], total_items: 0 } });
  await listTemplates(cfg, { count: 5000, type: "user" });
  assert.match(calls[0].url, /count=1000/);
  assert.match(calls[0].url, /type=user/);
});

test("deleteTemplate issues DELETE", async () => {
  route({ "DELETE /3.0/templates/7": {} });
  await deleteTemplate(cfg, 7);
  assert.equal(calls[0].method, "DELETE");
  assert.match(calls[0].url, /\/3\.0\/templates\/7$/);
});

test("createCampaign sets segment_opts when segmentId given", async () => {
  route({ "POST /3.0/campaigns": { id: "camp1", type: "regular" } });
  const c = await createCampaign(cfg, {
    listId: "list1",
    segmentId: 99,
    subject: "S",
    title: "T",
    fromName: "F",
    replyTo: "r@e.co",
  });
  assert.equal(c.id, "camp1");
  const b = calls[0].body as { recipients: { segment_opts?: { saved_segment_id: number } } };
  assert.equal(b.recipients.segment_opts?.saved_segment_id, 99);
});

test("scheduleCampaign posts schedule_time", async () => {
  route({ "POST /3.0/campaigns/camp1/actions/schedule": {} });
  await scheduleCampaign(cfg, "camp1", "2026-07-02T10:00:00Z");
  const b = calls[0].body as { schedule_time: string };
  assert.equal(b.schedule_time, "2026-07-02T10:00:00Z");
});

test("resolveAudienceByName + resolveSegmentByTag match case-insensitively", async () => {
  route({
    "/3.0/lists?": { lists: [{ id: "L1", name: "Jackies Fans" }], total_items: 1 },
    "/segments": {
      segments: [{ id: 5, name: "jackies_j26-mallorca-pdm" }],
      total_items: 1,
    },
  });
  const aud = await resolveAudienceByName(cfg, "jackies fans");
  assert.equal(aud?.id, "L1");
  const seg = await resolveSegmentByTag(cfg, "L1", "JACKIES_J26-MALLORCA-PDM");
  assert.equal(seg?.id, 5);
});
