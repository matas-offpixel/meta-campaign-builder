/**
 * Byte-diff test for the single-member autoresponder Mailchimp send path
 * (Goal 2). Asserts at the HTTP boundary that a send carrying
 * `audience.saved_segment_id` + `audience.send_now`:
 *   - targets recipients.segment_opts = { saved_segment_id } (NOT a tag-derived
 *     StaticSegment condition set — the caller resolved the member into an
 *     ephemeral static segment),
 *   - fires POST /actions/send immediately (NOT /actions/schedule).
 *
 * Per feedback_dry_run_stubs_miss_byte_level_bugs — verify the real wire shape.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { MailchimpProvider } from "../provider.ts";
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
    const payload = u.endsWith("/3.0/campaigns") ? { id: "camp-autoresp-1" } : { ok: true };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

const connection = (): D2CConnection => ({
  id: "conn-1",
  user_id: "u1",
  client_id: "cl1",
  provider: "mailchimp",
  credentials: { api_key: "key-us7", server_prefix: "us7" },
  external_account_id: "us7",
  status: "active",
  last_synced_at: null,
  last_error: null,
  live_enabled: true,
  approved_by_matas: true,
  created_at: "",
  updated_at: "",
});

const singleMemberMessage = (): D2CMessage => ({
  channel: "email",
  subject: "You're in",
  bodyMarkdown: "Thanks for signing up",
  audience: {
    list_id: "LIST1",
    reply_to: "events@offpixel.co.uk",
    from_name: "Events",
    saved_segment_id: 9931,
    send_now: true,
    campaign_title: "autoresp-send-1",
  },
  variables: {},
  correlationId: "autoresp:send-1",
});

describe("MailchimpProvider single-member autoresponder send", () => {
  beforeEach(() => {
    requests = [];
    process.env.FEATURE_D2C_LIVE = "1";
    stubFetch();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realFlag === undefined) delete process.env.FEATURE_D2C_LIVE;
    else process.env.FEATURE_D2C_LIVE = realFlag;
  });

  it("targets recipients.segment_opts.saved_segment_id (no tag resolution)", async () => {
    const res = await new MailchimpProvider().send(connection(), singleMemberMessage());
    assert.equal(res.ok, true);

    // No tag-search should have fired — the member is already in an ephemeral segment.
    assert.equal(
      requests.some((r) => r.url.includes("/tags?count=1000")),
      false,
      "must not resolve tags for a saved_segment_id send",
    );

    const create = requests.find((r) => r.url.endsWith("/3.0/campaigns") && r.method === "POST");
    assert.ok(create, "campaign create POST should fire");
    assert.deepEqual((create!.body as { recipients?: unknown }).recipients, {
      list_id: "LIST1",
      segment_opts: { saved_segment_id: 9931 },
    });
  });

  it("fires actions/send immediately (send_now), never actions/schedule", async () => {
    await new MailchimpProvider().send(connection(), singleMemberMessage());
    const sent = requests.find(
      (r) => r.url.endsWith("/actions/send") && r.method === "POST",
    );
    const scheduled = requests.find((r) => r.url.endsWith("/actions/schedule"));
    assert.ok(sent, "send_now must POST /actions/send");
    assert.equal(scheduled, undefined, "send_now must NOT schedule");
  });

  it("gate off → dry run, no Mailchimp calls at all", async () => {
    process.env.FEATURE_D2C_LIVE = "0";
    const res = await new MailchimpProvider().send(connection(), singleMemberMessage());
    assert.equal(res.dryRun, true);
    assert.equal(res.ok, true);
    assert.equal(requests.length, 0, "dry run must not hit the wire");
  });
});
