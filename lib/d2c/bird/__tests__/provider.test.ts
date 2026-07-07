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
    project_id: "proj-1",
    template_id: "ver-1",
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

test("all gates pass + runtime verified → live template POST to Bird messages endpoint", async () => {
  // Layers 6 & 9 (2026-07-01 incident), reconciled 2026-07-02 against
  // .scratch/bird-runtime-send-capture.txt. BIRD_RUNTIME_SEND_VERIFIED is now
  // true — a live WhatsApp template send must reach the wire with the
  // corrected shape (array receiver, top-level `template` keyed by
  // projectId/version, flat parameters).
  process.env.FEATURE_D2C_LIVE = "true";
  let capturedBody: Record<string, unknown> | null = null;
  const urls: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(input));
    capturedBody = init?.body ? JSON.parse(String(init.body)) : null;
    return new Response(JSON.stringify({ id: "msg-1" }), { status: 200 });
  };

  const r = await new BirdProvider().send(baseConnection(), sampleMessage());
  assert.equal(r.dryRun, false);
  assert.equal(r.ok, true);
  assert.equal(r.providerJobId, "msg-1");
  assert.ok(
    urls.some((u) => u.includes("/workspaces/ws-1/channels/ch-1/messages")),
  );
  assert.ok(capturedBody, "expected a JSON body");
  const b = capturedBody as unknown as Record<string, unknown>;
  assert.deepEqual(b.receiver, {
    contacts: [{ identifierValue: "+447700900000" }],
  });
  assert.deepEqual(b.template, {
    projectId: "proj-1",
    version: "ver-1",
    locale: "en",
    parameters: [{ type: "string", key: "event_name", value: "Jackies" }],
  });
  assert.equal(b.body, undefined, "template sends must not carry a body field");
});

test("live send without project_id/template_id on audience falls back to plain text", async () => {
  process.env.FEATURE_D2C_LIVE = "true";
  let capturedBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = init?.body ? JSON.parse(String(init.body)) : null;
    return new Response(JSON.stringify({ id: "msg-2" }), { status: 200 });
  };

  const textOnlyMessage: D2CMessage = {
    channel: "whatsapp",
    subject: null,
    bodyMarkdown: "Hello {{event_name}}",
    audience: { recipients: ["+447700900000"] },
    variables: { event_name: "Jackies" },
    correlationId: "send-text",
  };
  const r = await new BirdProvider().send(baseConnection(), textOnlyMessage);
  assert.equal(r.ok, true);
  const b = capturedBody as unknown as Record<string, unknown>;
  assert.equal(b.template, undefined, "non-template sends must not carry a template field");
  assert.deepEqual(b.body, { type: "text", text: { text: "Hello Jackies" } });
});

test("gate is WhatsApp-scoped: live SMS still POSTs to the messages endpoint", async () => {
  process.env.FEATURE_D2C_LIVE = "true";
  const urls: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/messages")) {
      return new Response(JSON.stringify({ id: "sms-1" }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };

  const smsMessage: D2CMessage = {
    channel: "sms",
    subject: null,
    bodyMarkdown: "Hi {{event_name}}",
    audience: { recipients: ["+447700900000"] },
    variables: { event_name: "Jackies" },
    correlationId: "sms-send-1",
  };
  const r = await new BirdProvider().send(baseConnection(), smsMessage);
  assert.equal(r.dryRun, false);
  assert.equal(r.ok, true);
  assert.equal(r.providerJobId, "sms-1");
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

// ── audience.channel_id override (multi-brand-per-client) ──────────────────
//
// Throwback + Hop on the Top share one d2c_connections row (UNIQUE(user_id,
// client_id, provider) forbids a second Bird row per client) but route to
// DIFFERENT WhatsApp channels — so the per-send audience.channel_id must win
// over the connection-level credential, which remains the fallback for
// legacy single-brand clients (Louder, 4theFans, Puzzle, etc.).

test("audience.channel_id present → send goes to that channel, not the credential's", async () => {
  process.env.FEATURE_D2C_LIVE = "true";
  const urls: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ id: "msg-hop" }), { status: 200 });
  };

  const hopMessage: D2CMessage = {
    ...sampleMessage(),
    audience: {
      ...sampleMessage().audience,
      channel_id: "61ad0713-8fa4-5f6c-aabf-fcf3316462fc",
    },
  };
  // baseConnection's credential channel_id is "ch-1" — must NOT be used.
  const r = await new BirdProvider().send(baseConnection(), hopMessage);
  assert.equal(r.ok, true);
  assert.equal(urls.length, 1);
  assert.equal(
    urls[0],
    "https://api.bird.com/workspaces/ws-1/channels/61ad0713-8fa4-5f6c-aabf-fcf3316462fc/messages",
  );
});

test("audience.channel_id absent → falls back to creds.channel_id (legacy single-brand clients)", async () => {
  process.env.FEATURE_D2C_LIVE = "true";
  const urls: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ id: "msg-legacy" }), { status: 200 });
  };

  // sampleMessage's audience carries no channel_id.
  const r = await new BirdProvider().send(baseConnection(), sampleMessage());
  assert.equal(r.ok, true);
  assert.equal(urls.length, 1);
  assert.equal(
    urls[0],
    "https://api.bird.com/workspaces/ws-1/channels/ch-1/messages",
  );
});

test("both audience.channel_id and creds.channel_id absent → graceful error, no fetch", async () => {
  process.env.FEATURE_D2C_LIVE = "true";
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("{}");
  };

  const connNoChannel: D2CConnection = {
    ...baseConnection(),
    credentials: { api_key: "ak-live", workspace_id: "ws-1" },
  };
  const r = await new BirdProvider().send(connNoChannel, sampleMessage());
  assert.equal(r.ok, false);
  assert.equal(r.dryRun, false);
  assert.equal(
    r.error,
    "Missing Bird api_key, workspace_id or channel_id on connection.",
  );
  assert.equal(calls, 0, "should fail fast before any HTTP call");
});

test("byte-diffs the messages URL: audience.channel_id override vs credential fallback", async () => {
  process.env.FEATURE_D2C_LIVE = "true";
  let capturedUrl = "";
  globalThis.fetch = async (input: RequestInfo | URL) => {
    capturedUrl = String(input);
    return new Response(JSON.stringify({ id: "msg-diff" }), { status: 200 });
  };

  const overrideMessage: D2CMessage = {
    ...sampleMessage(),
    audience: { ...sampleMessage().audience, channel_id: "61ad0713-8fa4-5f6c-aabf-fcf3316462fc" },
  };
  await new BirdProvider().send(baseConnection(), overrideMessage);
  const expectedOverrideUrl =
    "https://api.bird.com/workspaces/ws-1/channels/61ad0713-8fa4-5f6c-aabf-fcf3316462fc/messages";
  assert.equal(capturedUrl, expectedOverrideUrl, "override URL must byte-match exactly");

  capturedUrl = "";
  await new BirdProvider().send(baseConnection(), sampleMessage());
  const expectedFallbackUrl = "https://api.bird.com/workspaces/ws-1/channels/ch-1/messages";
  assert.equal(capturedUrl, expectedFallbackUrl, "fallback URL must byte-match exactly");
});
