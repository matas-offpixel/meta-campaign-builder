import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  buildMultiGetBatch,
  collectMultiGetResponses,
  parseMultiGetSubResponse,
} from "../graph-multi-get-parse.ts";

test("buildMultiGetBatch emits one GET sub-request per id", () => {
  const req = buildMultiGetBatch(["111", "222"], "id,name");
  assert.deepEqual(req, [
    { method: "GET", relative_url: "111?fields=id%2Cname" },
    { method: "GET", relative_url: "222?fields=id%2Cname" },
  ]);
});

test("buildMultiGetBatch never emits the ids= multi-read Meta removed in v26.0", () => {
  // The regression this whole module exists to prevent. Reverting to
  // `GET /?ids=…` fails with meta_code=100, and every caller swallows
  // failures by design — so the breakage is silent: blank creative
  // previews, no AI tags, a frozen audience cache, and budget-pacing
  // spend reading as zero.
  for (const sub of buildMultiGetBatch(["111", "222"], "id,name")) {
    assert.equal(sub.relative_url.includes("ids="), false);
  }
});

test("buildMultiGetBatch percent-encodes field-expansion syntax", () => {
  // Real field lists from budget pacing and the ad-set guard. Braces
  // and parens are not legal raw in a URL; Meta decodes before parsing.
  const [pacing] = buildMultiGetBatch(
    ["123"],
    "insights.date_preset(maximum){spend}",
  );
  assert.equal(
    pacing.relative_url,
    "123?fields=insights.date_preset(maximum)%7Bspend%7D",
  );

  const [guard] = buildMultiGetBatch(
    ["456"],
    "id,is_dynamic_creative,ads.limit(0).summary(true)",
  );
  assert.equal(
    guard.relative_url,
    "456?fields=id%2Cis_dynamic_creative%2Cads.limit(0).summary(true)",
  );
});

test("buildMultiGetBatch omits the query string when no fields are requested", () => {
  assert.deepEqual(buildMultiGetBatch(["111"], ""), [
    { method: "GET", relative_url: "111" },
  ]);
});

test("buildMultiGetBatch returns an empty array for no ids", () => {
  assert.deepEqual(buildMultiGetBatch([], "id,name"), []);
});

test("parseMultiGetSubResponse parses a successful sub-response", () => {
  const parsed = parseMultiGetSubResponse({
    code: 200,
    body: JSON.stringify({ id: "111", name: "Promo Video", video_id: "999" }),
  });
  assert.equal(parsed?.id, "111");
  assert.equal(parsed?.name, "Promo Video");
  assert.equal(parsed?.video_id, "999");
});

test("parseMultiGetSubResponse rejects an error envelope", () => {
  // A failed sub-request rides inside the batch's own HTTP 200. Without
  // this branch it lands in the map as a node whose every field is
  // undefined — worse than a miss, because every caller treats "key
  // present" as "Meta answered".
  assert.equal(
    parseMultiGetSubResponse({
      code: 400,
      body: JSON.stringify({
        error: { message: "Unsupported get request.", code: 100 },
      }),
    }),
    null,
  );
});

test("parseMultiGetSubResponse rejects bodies with no usable id", () => {
  assert.equal(
    parseMultiGetSubResponse({ code: 200, body: JSON.stringify({ name: "x" }) }),
    null,
  );
  assert.equal(
    parseMultiGetSubResponse({ code: 200, body: JSON.stringify({ id: "" }) }),
    null,
  );
  assert.equal(
    parseMultiGetSubResponse({ code: 200, body: JSON.stringify({ id: 111 }) }),
    null,
  );
});

test("parseMultiGetSubResponse rejects malformed and non-object bodies", () => {
  assert.equal(parseMultiGetSubResponse({ code: 200, body: "{not json" }), null);
  assert.equal(parseMultiGetSubResponse({ code: 200, body: "true" }), null);
  assert.equal(parseMultiGetSubResponse({ code: 200, body: "[]" }), null);
  assert.equal(parseMultiGetSubResponse({ code: 200, body: "null" }), null);
});

test("parseMultiGetSubResponse rejects missing / empty sub-responses", () => {
  assert.equal(parseMultiGetSubResponse(null), null);
  assert.equal(parseMultiGetSubResponse(undefined), null);
  assert.equal(parseMultiGetSubResponse({}), null);
  assert.equal(parseMultiGetSubResponse({ code: 500, body: "" }), null);
});

test("collectMultiGetResponses returns the id-keyed shape the ids= endpoint returned", () => {
  // Callers were all written against `Record<string, T>` and index it
  // as `res[id]`. Keeping that exact shape is what makes every call
  // site a one-identifier swap.
  const map = collectMultiGetResponses<{ id: string; name?: string }>([
    { code: 200, body: JSON.stringify({ id: "a", name: "Alpha" }) },
    { code: 200, body: JSON.stringify({ id: "b", name: "Beta" }) },
  ]);
  assert.deepEqual(Object.keys(map).sort(), ["a", "b"]);
  assert.equal(map.a.name, "Alpha");
});

test("collectMultiGetResponses drops failed sub-responses instead of keying them", () => {
  const map = collectMultiGetResponses<{ id: string }>([
    { code: 200, body: JSON.stringify({ id: "ok" }) },
    { code: 400, body: JSON.stringify({ error: { message: "gone" } }) },
    { code: 200, body: "{malformed" },
    null,
  ]);
  assert.deepEqual(Object.keys(map), ["ok"]);
});

test("collectMultiGetResponses keys by the body id, not array position", () => {
  const map = collectMultiGetResponses<{ id: string }>([
    { code: 200, body: JSON.stringify({ id: "second" }) },
    { code: 200, body: JSON.stringify({ id: "first" }) },
  ]);
  assert.equal(map.first.id, "first");
  assert.equal(map.second.id, "second");
});

test("collectMultiGetResponses returns an empty object for an empty batch", () => {
  assert.deepEqual(collectMultiGetResponses([]), {});
});
