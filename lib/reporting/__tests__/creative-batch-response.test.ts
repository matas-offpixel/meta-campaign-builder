import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  buildCreativeBatchRequest,
  parseCreativeBatchSubResponse,
} from "../creative-batch-response.ts";

const FIELDS = "id,name,image_url,video_id,object_story_spec";

test("buildCreativeBatchRequest emits one GET sub-request per id", () => {
  const req = buildCreativeBatchRequest(["111", "222"], FIELDS);
  assert.deepEqual(req, [
    { method: "GET", relative_url: `111?fields=${FIELDS}` },
    { method: "GET", relative_url: `222?fields=${FIELDS}` },
  ]);
});

test("buildCreativeBatchRequest does NOT use the ids= multi-read removed in v26.0", () => {
  // Guard against a well-meaning revert to `GET /?ids=…`, which Meta
  // removed in Graph API v26.0. That call fails with meta_code=100 and
  // the caller swallows per-batch failures by design, so a regression
  // here is silent: hydration returns an empty map, creative previews
  // fall back to initials placeholders, and the AI auto-tagger skips
  // every creative for want of a thumbnail.
  const req = buildCreativeBatchRequest(["111", "222"], FIELDS);
  for (const sub of req) {
    assert.equal(
      sub.relative_url.includes("ids="),
      false,
      "relative_url must address a single creative, not an ids= list",
    );
  }
});

test("buildCreativeBatchRequest returns an empty array for no ids", () => {
  assert.deepEqual(buildCreativeBatchRequest([], FIELDS), []);
});

test("parseCreativeBatchSubResponse parses a successful sub-response", () => {
  const parsed = parseCreativeBatchSubResponse({
    code: 200,
    body: JSON.stringify({ id: "111", name: "Promo Video", video_id: "999" }),
  });
  assert.equal(parsed?.id, "111");
  assert.equal(parsed?.name, "Promo Video");
  assert.equal(parsed?.video_id, "999");
});

test("parseCreativeBatchSubResponse rejects an error envelope", () => {
  // A failed sub-request rides inside the batch's own HTTP 200. Without
  // this branch it would land in the map as a creative whose every
  // field is undefined — worse than a miss, because the caller would
  // stop treating it as unhydrated.
  assert.equal(
    parseCreativeBatchSubResponse({
      code: 400,
      body: JSON.stringify({
        error: { message: "Unsupported get request.", code: 100 },
      }),
    }),
    null,
  );
});

test("parseCreativeBatchSubResponse rejects a body with no id", () => {
  assert.equal(
    parseCreativeBatchSubResponse({ code: 200, body: JSON.stringify({ name: "x" }) }),
    null,
  );
  assert.equal(
    parseCreativeBatchSubResponse({ code: 200, body: JSON.stringify({ id: "" }) }),
    null,
  );
});

test("parseCreativeBatchSubResponse rejects malformed and non-object bodies", () => {
  assert.equal(parseCreativeBatchSubResponse({ code: 200, body: "{not json" }), null);
  assert.equal(parseCreativeBatchSubResponse({ code: 200, body: "true" }), null);
  assert.equal(parseCreativeBatchSubResponse({ code: 200, body: "[]" }), null);
  assert.equal(parseCreativeBatchSubResponse({ code: 200, body: "null" }), null);
});

test("parseCreativeBatchSubResponse rejects missing / empty sub-responses", () => {
  assert.equal(parseCreativeBatchSubResponse(null), null);
  assert.equal(parseCreativeBatchSubResponse(undefined), null);
  assert.equal(parseCreativeBatchSubResponse({}), null);
  assert.equal(parseCreativeBatchSubResponse({ code: 500, body: "" }), null);
});
