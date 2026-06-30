import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import type { D2CConnection, D2CMessage } from "../../types.ts";
import { BirdProvider, birdDryRunGatesBlockLiveSend } from "../provider.ts";

const baseConnection = (): D2CConnection => ({
  id: "c1",
  user_id: "u1",
  client_id: "cl1",
  provider: "bird",
  credentials: {
    api_key: "ak-live",
    workspace_id: "ws-1",
    channel_id: "ch-1",
  },
  external_account_id: "ws-1",
  status: "active",
  last_synced_at: null,
  last_error: null,
  live_enabled: true,
  approved_by_matas: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

const sampleMessage = (): D2CMessage => ({
  channel: "whatsapp",
  subject: null,
  bodyMarkdown: "Hello {{event_name}}",
  audience: {
    recipients: ["+447700900000"],
    template_name: "presale_reminder",
    locale: "en",
  },
  variables: { event_name: "Jackies" },
  correlationId: "send-1",
});

let origFetch: typeof fetch;
let origLive: string | undefined;

beforeEach(() => {
  origFetch = globalThis.fetch;
  origLive = process.env.FEATURE_D2C_LIVE;
});

afterEach(() => {
  globalThis.fetch = origFetch;
  if (origLive === undefined) delete process.env.FEATURE_D2C_LIVE;
  else process.env.FEATURE_D2C_LIVE = origLive;
});

test("gate 1: FEATURE_D2C_LIVE off → dry run, no fetch", async () => {
  process.env.FEATURE_D2C_LIVE = "false";
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("{}");
  };
  const g = birdDryRunGatesBlockLiveSend(baseConnection());
  assert.equal(g.featureOff, true);

  const r = await new BirdProvider().send(baseConnection(), sampleMessage());
  assert.equal(r.dryRun, true);
  assert.equal(r.ok, true);
  assert.equal(calls, 0);
});

test("gate 2: live_enabled off → dry run, no fetch", async () => {
  process.env.FEATURE_D2C_LIVE = "true";
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("{}");
  };
  const conn = { ...baseConnection(), live_enabled: false };
  const g = birdDryRunGatesBlockLiveSend(conn);
  assert.equal(g.liveDisabled, true);

  const r = await new BirdProvider().send(conn, sampleMessage());
  assert.equal(r.dryRun, true);
  assert.equal(calls, 0);
});

test("gate 3: approved_by_matas off → dry run, no fetch", async () => {
  process.env.FEATURE_D2C_LIVE = "true";
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("{}");
  };
  const conn = { ...baseConnection(), approved_by_matas: false };
  const g = birdDryRunGatesBlockLiveSend(conn);
  assert.equal(g.notMatasApproved, true);

  const r = await new BirdProvider().send(conn, sampleMessage());
  assert.equal(r.dryRun, true);
  assert.equal(calls, 0);
});

test("all three gates pass → live POST to Bird messages endpoint", async () => {
  process.env.FEATURE_D2C_LIVE = "true";
  const urls: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/messages")) {
      return new Response(JSON.stringify({ id: "msg-1" }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };

  const r = await new BirdProvider().send(baseConnection(), sampleMessage());
  assert.equal(r.dryRun, false);
  assert.equal(r.ok, true);
  assert.equal(r.providerJobId, "msg-1");
  assert.ok(
    urls.some((u) => u.includes("/workspaces/ws-1/channels/ch-1/messages")),
  );
});

test("validateCredentials hits GET /channels", async () => {
  let path = "";
  globalThis.fetch = async (input: RequestInfo | URL) => {
    path = String(input);
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  };
  const v = await new BirdProvider().validateCredentials({
    api_key: "ak",
    workspace_id: "ws-1",
  });
  assert.equal(v.ok, true);
  assert.match(path, /\/workspaces\/ws-1\/channels$/);
});

test("validateCredentials fails without api_key/workspace_id", async () => {
  const v = await new BirdProvider().validateCredentials({ api_key: "ak" });
  assert.equal(v.ok, false);
});
