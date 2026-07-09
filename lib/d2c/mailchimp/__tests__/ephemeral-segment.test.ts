/**
 * Byte-diff tests for lib/d2c/mailchimp/ephemeral-segment.ts (2026-07-09 fix).
 *
 * Root cause under test: `createMemberSegment` used to POST a `static_segment`
 * array, which Mailchimp's modern UI renders as a **tag**, not a segment
 * (static segments and tags share the same underlying object/id space — see
 * the module's own doc comment and `lib/d2c/audience/tag-registry.ts`'s
 * `GET /lists/{id}/segments?type=static` tag-enumeration). Every autoresp/
 * test-send fire was therefore minting a throwaway `d2c-autoresp-<ts>` /
 * `d2c-test-<ts>` **tag** — live-verified accumulating in Throwback's
 * audience `c2b4d77acb` Tags panel and explicitly flagged by Matas.
 *
 * The fix swaps to a **saved** (query-based) segment — a single
 * `EmailAddress` condition matching exactly the member — which is a
 * distinct Mailchimp segment `type` that never surfaces in the Tags UI.
 *
 * Per feedback_dry_run_stubs_miss_byte_level_bugs — assert the exact wire
 * shape of the POST body, not just that *a* request fired.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createMemberSegment, deleteSegment } from "../ephemeral-segment.ts";

const realFetch = globalThis.fetch;

interface CapturedReq {
  url: string;
  method: string;
  body: unknown;
}
let requests: CapturedReq[] = [];

function stubFetch(responsePayload: unknown = { id: 9931, name: "d2c-autoresp-123" }) {
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
    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("createMemberSegment", () => {
  beforeEach(() => {
    requests = [];
    stubFetch();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("POSTs a saved (query) segment via options.conditions — NOT static_segment", async () => {
    const result = await createMemberSegment(
      "us7",
      "test-key",
      "c2b4d77acb",
      "hello+finalproof@offpixel.co.uk",
      { namePrefix: "d2c-autoresp", nowMs: 1_720_000_000_000 },
    );

    assert.equal(requests.length, 1);
    const req = requests[0]!;
    assert.equal(req.method, "POST");
    assert.ok(req.url.endsWith("/3.0/lists/c2b4d77acb/segments"));

    // Byte-diff: the exact body shape, no `static_segment` key anywhere.
    assert.deepEqual(req.body, {
      name: "d2c-autoresp-1720000000000",
      options: {
        match: "any",
        conditions: [
          {
            condition_type: "EmailAddress",
            field: "merge0",
            op: "is",
            value: "hello+finalproof@offpixel.co.uk",
          },
        ],
      },
    });
    assert.equal(
      Object.prototype.hasOwnProperty.call(req.body as object, "static_segment"),
      false,
      "must never send static_segment — that's what created the tag pollution",
    );

    assert.deepEqual(result, { id: 9931, name: "d2c-autoresp-123" });
  });

  it("uses the given namePrefix (test-send passes d2c-test)", async () => {
    await createMemberSegment("us7", "test-key", "LIST1", "matt@offpixel.co.uk", {
      namePrefix: "d2c-test",
      nowMs: 1_720_000_000_000,
    });
    const req = requests[0]!;
    assert.equal((req.body as { name: string }).name, "d2c-test-1720000000000");
  });

  it("defaults the name prefix to d2c-autoresp when unset (webhook autoresp path)", async () => {
    await createMemberSegment("us7", "test-key", "LIST1", "fan@example.com", {
      nowMs: 1_720_000_000_000,
    });
    const req = requests[0]!;
    assert.equal((req.body as { name: string }).name, "d2c-autoresp-1720000000000");
  });
});

describe("deleteSegment", () => {
  beforeEach(() => {
    requests = [];
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("DELETEs the segment by id", async () => {
    stubFetch({});
    await deleteSegment("us7", "test-key", "c2b4d77acb", 9931);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.method, "DELETE");
    assert.ok(requests[0]!.url.endsWith("/3.0/lists/c2b4d77acb/segments/9931"));
  });

  it("swallows a failed delete (best-effort — never throws)", async () => {
    globalThis.fetch = (async () =>
      new Response("Not Found", { status: 404 })) as typeof fetch;
    await assert.doesNotReject(() => deleteSegment("us7", "test-key", "LIST1", 1));
  });
});
