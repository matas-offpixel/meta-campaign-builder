/**
 * lib/d2c/mailchimp/__tests__/singular-tag-segment-opts.test.ts
 *
 * 2026-07-14 bug report: "Mailchimp provider needs audience.segment_opts for
 * tag-scoped sends... any presale/gen-sale email send WILL blast the whole
 * audience if approved as-is." Investigated against the live T26-ALGARVE
 * `d2c_scheduled_sends` rows before writing any code — every email row's
 * `audience` carries the SINGULAR `tag` field (e.g. `{ tag: "T26-ALGARVE",
 * list_id, ... }`), not the plural `tags[]` array `provider-segment-opts.test.ts`
 * already covers. `resolveSegmentOpts` (provider.ts) already falls back
 * audience.tags[] → [audience.tag] via `resolveAudienceTags`
 * (audience/tag-registry.ts) — confirmed live: the T26-ALGARVE "announce"
 * email's persisted `result_jsonb` shows a correctly-scoped
 * `segment_text: "Tags contact is tagged T26-ALGARVE"`, not a whole-list send.
 *
 * Conclusion: this specific bug does NOT reproduce against current `main` —
 * segment_opts resolution already works for the singular-tag production
 * shape. This test closes the gap explicitly (byte-diffs the exact
 * production audience shape, not just the plural-tags fixture) so a future
 * regression here is caught, without duplicating the resolver logic itself.
 * See the PR body / session log for the full investigation.
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
      payload = {
        segments: [{ id: 101, name: "T26-ALGARVE", member_count: 500 }],
      };
    } else if (u.endsWith("/3.0/campaigns")) {
      payload = { id: "camp-algarve", long_archive_url: "https://us7.campaign-archive.com/?u=a&id=b" };
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
  id: "conn-throwback",
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

// Byte-identical to the live T26-ALGARVE "reminder" email row's `audience`
// column (queried 2026-07-14) — singular `tag`, plus the `audience_id`
// legacy alias some rows still carry alongside `list_id`.
const productionShapeMessage = (): D2CMessage => ({
  channel: "email",
  subject: "Presale reminder",
  bodyMarkdown: "The presale is almost here",
  audience: {
    tag: "T26-ALGARVE",
    list_id: "c2b4d77acb",
    audience_id: "c2b4d77acb",
    reply_to: "hello@throwbackbcn.com",
    from_name: "Throwback",
  },
  variables: {},
  correlationId: "send-t26-reminder",
});

describe("MailchimpProvider — singular audience.tag (real production shape)", () => {
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

  it("resolves audience.tag (singular) → recipients.segment_opts scoped to that tag, not the whole list", async () => {
    const res = await new MailchimpProvider().send(connection(), productionShapeMessage());
    assert.equal(res.ok, true, res.error);

    const create = requests.find((r) => r.url.endsWith("/3.0/campaigns") && r.method === "POST");
    assert.ok(create, "campaign create POST should have fired");

    const body = create!.body as { recipients?: unknown };
    assert.deepEqual(body.recipients, {
      list_id: "c2b4d77acb",
      segment_opts: {
        match: "any",
        conditions: [
          { condition_type: "StaticSegment", field: "static_segment", op: "static_is", value: 101 },
        ],
      },
    });
  });
});
