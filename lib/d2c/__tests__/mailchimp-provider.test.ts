import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import type { D2CConnection, D2CMessage } from "../types.ts";
import {
  MailchimpProvider,
  mailchimpDryRunGatesBlockLiveSend,
} from "../mailchimp/provider.ts";

const baseConnection = (): D2CConnection => ({
  id: "c1",
  user_id: "u1",
  client_id: "cl1",
  provider: "mailchimp",
  credentials: {
    api_key: "key-us21",
    server_prefix: "us21",
  },
  external_account_id: "us21",
  status: "active",
  last_synced_at: null,
  last_error: null,
  live_enabled: true,
  approved_by_matas: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

const sampleMessage = (): D2CMessage => ({
  channel: "email",
  subject: "Hi",
  bodyMarkdown: "Hello **there**",
  audience: {
    list_id: "lst",
    reply_to: "a@b.com",
    from_name: "Test",
  },
  variables: {},
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

test("mailchimpDryRunGates: feature flag off", () => {
  process.env.FEATURE_D2C_LIVE = "false";
  const c = baseConnection();
  const g = mailchimpDryRunGatesBlockLiveSend(c);
  assert.equal(g.featureOff, true);
  assert.equal(g.liveDisabled, false);
  assert.equal(g.notMatasApproved, false);
});

test("mailchimpDryRunGates: live_enabled off", () => {
  process.env.FEATURE_D2C_LIVE = "true";
  const c = { ...baseConnection(), live_enabled: false };
  const g = mailchimpDryRunGatesBlockLiveSend(c);
  assert.equal(g.featureOff, false);
  assert.equal(g.liveDisabled, true);
});

test("mailchimpDryRunGates: approved_by_matas off", () => {
  process.env.FEATURE_D2C_LIVE = "true";
  const c = { ...baseConnection(), approved_by_matas: false };
  const g = mailchimpDryRunGatesBlockLiveSend(c);
  assert.equal(g.notMatasApproved, true);
});

test("send short-circuits dry-run when FEATURE_D2C_LIVE is off (no fetch)", async () => {
  process.env.FEATURE_D2C_LIVE = "false";
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("{}");
  };

  const provider = new MailchimpProvider();
  const r = await provider.send(baseConnection(), sampleMessage());
  assert.equal(r.dryRun, true);
  assert.equal(r.ok, true);
  assert.equal(calls, 0);
});

test("send short-circuits when live_enabled is false", async () => {
  process.env.FEATURE_D2C_LIVE = "true";
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("{}");
  };
  const provider = new MailchimpProvider();
  const r = await provider.send(
    { ...baseConnection(), live_enabled: false },
    sampleMessage(),
  );
  assert.equal(r.dryRun, true);
  assert.equal(calls, 0);
});

test("send short-circuits when approved_by_matas is false", async () => {
  process.env.FEATURE_D2C_LIVE = "true";
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response("{}");
  };
  const provider = new MailchimpProvider();
  const r = await provider.send(
    { ...baseConnection(), approved_by_matas: false },
    sampleMessage(),
  );
  assert.equal(r.dryRun, true);
  assert.equal(calls, 0);
});

test("live path calls Mailchimp campaigns endpoints (fetch mocked)", async () => {
  process.env.FEATURE_D2C_LIVE = "true";
  const urls: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith("/3.0/campaigns") && !url.includes("actions")) {
      return new Response(JSON.stringify({ id: "cmp1" }), { status: 200 });
    }
    if (url.includes("/3.0/campaigns/cmp1/content")) {
      return new Response("{}", { status: 200 });
    }
    if (url.includes("/3.0/campaigns/cmp1/actions/schedule")) {
      return new Response("{}", { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };

  const provider = new MailchimpProvider();
  const r = await provider.send(baseConnection(), sampleMessage());
  assert.equal(r.dryRun, false);
  assert.equal(r.ok, true);
  assert.equal(r.providerJobId, "cmp1");
  assert.ok(urls.some((u) => u.includes("/3.0/campaigns")));
  assert.ok(urls.some((u) => u.includes("/content")));
});

test("validateCredentials pings Mailchimp", async () => {
  process.env.FEATURE_D2C_LIVE = "true";
  let pinged = false;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/3.0/ping")) {
      pinged = true;
      return new Response(JSON.stringify({ health_status: "Everything's Chimpy!" }), {
        status: 200,
      });
    }
    return new Response("{}", { status: 404 });
  };
  const provider = new MailchimpProvider();
  const v = await provider.validateCredentials({
    api_key: "k",
    server_prefix: "us21",
  });
  assert.equal(v.ok, true);
  assert.equal(pinged, true);
});
