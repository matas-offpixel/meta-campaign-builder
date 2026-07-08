/**
 * Byte-diff test for the multi-tag Mailchimp campaign-create request (Goal 5).
 * Asserts the exact /3.0/campaigns URL + the recipients.segment_opts body
 * (match:"any" + one StaticSegment condition per resolved tag id) at the HTTP
 * boundary — per feedback_dry_run_stubs_miss_byte_level_bugs +
 * reference_mailchimp_tag_is_segment_id (a tag IS a static segment id).
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { MailchimpProvider } from "../provider.ts";
import { __clearTagCacheForTests } from "../../audience/tag-registry.ts";
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

    let payload: unknown = {};
    if (u.includes("/segments?type=static")) {
      // Bug C fix (2026-07-08): the real endpoint is /segments?type=static,
      // not /tags — the latter 404s. See tag-registry.ts's getAudienceTags doc.
      payload = {
        segments: [
          { id: 101, name: "T26-ALGARVE", member_count: 500 },
          { id: 202, name: "H26-PORTO", member_count: 800 },
        ],
      };
    } else if (u.endsWith("/3.0/campaigns")) {
      payload = { id: "camp-1", long_archive_url: "https://us7.campaign-archive.com/?u=a&id=b" };
    } else {
      payload = { ok: true };
    }
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

const message = (tags: string[]): D2CMessage => ({
  channel: "email",
  subject: "Announce",
  bodyMarkdown: "Hello",
  audience: {
    list_id: "LIST1",
    reply_to: "events@offpixel.co.uk",
    from_name: "Events",
    tags,
  },
  variables: {},
  correlationId: "corr-1",
});

describe("MailchimpProvider multi-tag campaign create", () => {
  beforeEach(() => {
    requests = [];
    __clearTagCacheForTests();
    process.env.FEATURE_D2C_LIVE = "1";
    stubFetch();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realFlag === undefined) delete process.env.FEATURE_D2C_LIVE;
    else process.env.FEATURE_D2C_LIVE = realFlag;
  });

  it("sends recipients.segment_opts with a StaticSegment condition per tag", async () => {
    const res = await new MailchimpProvider().send(connection(), message(["T26-ALGARVE", "H26-PORTO"]));
    assert.equal(res.ok, true);

    const create = requests.find((r) => r.url.endsWith("/3.0/campaigns") && r.method === "POST");
    assert.ok(create, "campaign create POST should have fired");
    assert.equal(create!.url, "https://us7.api.mailchimp.com/3.0/campaigns");

    const body = create!.body as { recipients?: unknown };
    assert.deepEqual(body.recipients, {
      list_id: "LIST1",
      segment_opts: {
        match: "any",
        conditions: [
          { condition_type: "StaticSegment", field: "static_segment", op: "static_is", value: 101 },
          { condition_type: "StaticSegment", field: "static_segment", op: "static_is", value: 202 },
        ],
      },
    });
  });

  it("errors (does not silently drop) when a tag can't be resolved", async () => {
    const res = await new MailchimpProvider().send(connection(), message(["T26-ALGARVE", "NOPE"]));
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /Tag "NOPE" not found/);
    // No campaign should have been created.
    assert.equal(requests.some((r) => r.url.endsWith("/3.0/campaigns") && r.method === "POST"), false);
  });

  it("back-compat: no tags → plain list_id recipients (no segment_opts)", async () => {
    const msg = message([]);
    (msg.audience as Record<string, unknown>).tags = undefined;
    const res = await new MailchimpProvider().send(connection(), msg);
    assert.equal(res.ok, true);
    const create = requests.find((r) => r.url.endsWith("/3.0/campaigns") && r.method === "POST");
    assert.deepEqual((create!.body as { recipients?: unknown }).recipients, { list_id: "LIST1" });
  });
});
