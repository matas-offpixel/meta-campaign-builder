import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildTimeline,
  completeRegistrationEventId,
  extractClickIds,
  fanStatus,
  formatGeo,
  utmParams,
} from "../fan-detail-view.ts";

test("fanStatus: anonymised beats deleted beats active", () => {
  assert.equal(fanStatus(null, null), "active");
  assert.equal(fanStatus("2026-07-01T00:00:00Z", null), "deleted");
  assert.equal(fanStatus(null, "2026-07-01T00:00:00Z"), "anonymized");
  // both set → anonymised wins (stronger, irreversible)
  assert.equal(
    fanStatus("2026-07-01T00:00:00Z", "2026-07-02T00:00:00Z"),
    "anonymized",
  );
});

test("extractClickIds pulls fbclid/ttclid/gclid, trims, nulls blanks", () => {
  assert.deepEqual(
    extractClickIds({ fbclid: " abc123 ", gclid: "g1", utm_source: "ig" }),
    { fbclid: "abc123", ttclid: null, gclid: "g1" },
  );
  assert.deepEqual(extractClickIds(null), {
    fbclid: null,
    ttclid: null,
    gclid: null,
  });
  assert.deepEqual(extractClickIds({ ttclid: "   " }), {
    fbclid: null,
    ttclid: null,
    gclid: null,
  });
});

test("utmParams returns only utm_* keys in stable order, excludes click ids", () => {
  assert.deepEqual(
    utmParams({
      utm_campaign: "summer",
      utm_source: "instagram",
      fbclid: "x",
      utm_medium: "paid",
    }),
    [
      { key: "utm_source", value: "instagram" },
      { key: "utm_medium", value: "paid" },
      { key: "utm_campaign", value: "summer" },
    ],
  );
  assert.deepEqual(utmParams(null), []);
});

test("formatGeo composes city/region/country and degrades gracefully", () => {
  assert.equal(formatGeo("GB", "ENG", "London"), "London, ENG · United Kingdom (GB)");
  assert.equal(formatGeo("GB", null, null), "United Kingdom (GB)");
  assert.equal(formatGeo(null, null, "London"), "London");
  assert.equal(formatGeo(null, "ENG", null), "ENG");
  assert.equal(formatGeo(null, null, null), "—");
});

test("completeRegistrationEventId is deterministic per signup", () => {
  assert.equal(completeRegistrationEventId("abc-123"), "abc-123-cr");
});

test("buildTimeline sorts newest-first and tags kind", () => {
  const out = buildTimeline([
    { createdAt: "2026-07-01T10:00:00Z", eventName: "Jackies", isRepeat: false },
    { createdAt: "2026-07-03T10:00:00Z", eventName: "Jackies", isRepeat: true },
    { createdAt: "not-a-date", eventName: "Bad", isRepeat: true },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].kind, "repeat");
  assert.equal(out[0].at, "2026-07-03T10:00:00Z");
  assert.equal(out[1].kind, "signup");
});
