/**
 * Byte-diff test for `sendMailchimpCampaignLive` (fix(d2c/test-send)).
 *
 * `MailchimpProvider.send` dry-runs when the 3-of-3 live gate is off.
 * `sendMailchimpCampaignLive` is the extracted body with NO gate check — the
 * "Send test to me" route calls it directly so a test always fires live to
 * the operator's own inbox, regardless of FEATURE_D2C_LIVE / connection
 * flags. This asserts the bypass at the HTTP boundary: gate off + calling
 * `.send()` still dry-runs, but calling `sendMailchimpCampaignLive` directly
 * hits the wire.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { MailchimpProvider, sendMailchimpCampaignLive } from "../provider.ts";
import type { D2CConnection, D2CMessage } from "../../types.ts";

const realFetch = globalThis.fetch;
const realFlag = process.env.FEATURE_D2C_LIVE;

interface CapturedReq {
  url: string;
  method: string;
  body: unknown;
}
let requests: CapturedReq[] = [];

function stubFetch() {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    let body: unknown = null;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    requests.push({ url: u, method, body });
    const payload = u.endsWith("/3.0/campaigns") ? { id: "camp-test-1" } : { ok: true };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

// Gate fully OFF: feature flag off AND connection not live/approved. A test
// send must fire live regardless.
const gateOffConnection = (): D2CConnection => ({
  id: "conn-1",
  user_id: "u1",
  client_id: "cl1",
  provider: "mailchimp",
  credentials: { api_key: "key-us7", server_prefix: "us7" },
  external_account_id: "us7",
  status: "active",
  last_synced_at: null,
  last_error: null,
  live_enabled: false,
  approved_by_matas: false,
  created_at: "",
  updated_at: "",
});

const testMessage = (): D2CMessage => ({
  channel: "email",
  subject: "[TEST] You're in",
  bodyMarkdown: "Thanks for signing up",
  audience: {
    list_id: "LIST1",
    reply_to: "events@offpixel.co.uk",
    from_name: "Events",
    saved_segment_id: 4471,
    send_now: true,
    campaign_title: "test-send-1-123",
  },
  variables: {},
  correlationId: "test:send-1:123",
});

describe("sendMailchimpCampaignLive bypasses the 3-of-3 gate", () => {
  beforeEach(() => {
    requests = [];
    process.env.FEATURE_D2C_LIVE = "0";
    stubFetch();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realFlag === undefined) delete process.env.FEATURE_D2C_LIVE;
    else process.env.FEATURE_D2C_LIVE = realFlag;
  });

  it("MailchimpProvider.send() dry-runs when the gate is off (baseline, unaffected by this fix)", async () => {
    const res = await new MailchimpProvider().send(gateOffConnection(), testMessage());
    assert.equal(res.dryRun, true);
    assert.equal(requests.length, 0, "gated .send() must not hit the wire");
  });

  it("sendMailchimpCampaignLive() hits the wire even with the gate fully off", async () => {
    const res = await sendMailchimpCampaignLive(gateOffConnection(), testMessage());
    assert.equal(res.ok, true);
    assert.equal(res.dryRun, false);
    assert.ok(requests.length > 0, "bypass must hit the wire regardless of the gate");

    const create = requests.find((r) => r.url.endsWith("/3.0/campaigns") && r.method === "POST");
    assert.ok(create, "campaign create POST should fire");
    assert.deepEqual((create!.body as { recipients?: unknown }).recipients, {
      list_id: "LIST1",
      segment_opts: { saved_segment_id: 4471 },
    });
    assert.equal(
      (create!.body as { settings?: { subject_line?: string } }).settings?.subject_line,
      "[TEST] You're in",
    );
  });

  it("sendMailchimpCampaignLive() sends immediately (send_now), never schedules", async () => {
    await sendMailchimpCampaignLive(gateOffConnection(), testMessage());
    const sent = requests.find((r) => r.url.endsWith("/actions/send") && r.method === "POST");
    const scheduled = requests.find((r) => r.url.endsWith("/actions/schedule"));
    assert.ok(sent, "send_now must POST /actions/send");
    assert.equal(scheduled, undefined, "send_now must NOT schedule");
  });
});
