import assert from "node:assert/strict";
import test from "node:test";

import { dedupeAdjacentApiPathSegment } from "../dedupe-adjacent-api-path-segment.ts";

test("dedupes repeated additional-spend segment", () => {
  assert.equal(
    dedupeAdjacentApiPathSegment(
      "/api/clients/x/venues/WC26/additional-spend/additional-spend",
      "additional-spend",
    ),
    "/api/clients/x/venues/WC26/additional-spend",
  );
});

test("dedupes before entry id", () => {
  assert.equal(
    dedupeAdjacentApiPathSegment(
      "/api/clients/x/venues/WC26/additional-spend/additional-spend/uuid-1",
      "additional-spend",
    ),
    "/api/clients/x/venues/WC26/additional-spend/uuid-1",
  );
});

test("dedupes additional-ticket-entries segment", () => {
  assert.equal(
    dedupeAdjacentApiPathSegment(
      "/api/events/e1/additional-ticket-entries/additional-ticket-entries",
      "additional-ticket-entries",
    ),
    "/api/events/e1/additional-ticket-entries",
  );
});

test("idempotent", () => {
  const once = dedupeAdjacentApiPathSegment(
    "/api/a/additional-spend/additional-spend",
    "additional-spend",
  );
  assert.equal(
    dedupeAdjacentApiPathSegment(once, "additional-spend"),
    "/api/a/additional-spend",
  );
});

test("dedupes before query string", () => {
  assert.equal(
    dedupeAdjacentApiPathSegment(
      "/api/share/venue/tok/additional-ticket-entries/additional-ticket-entries?event_id=e1",
      "additional-ticket-entries",
    ),
    "/api/share/venue/tok/additional-ticket-entries?event_id=e1",
  );
});
