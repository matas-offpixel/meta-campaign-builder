import { test } from "node:test";
import assert from "node:assert/strict";

import { nextPresale, pixelWarning } from "../dashboard-widgets.ts";

const NOW = Date.parse("2026-07-05T12:00:00Z");

test("nextPresale picks the soonest future presale among live pages", () => {
  const out = nextPresale(
    [
      { status: "live", presaleAt: "2026-08-01T10:00:00Z", eventName: "Later", eventSlug: "later" },
      { status: "live", presaleAt: "2026-07-10T10:00:00Z", eventName: "Soon", eventSlug: "soon" },
      { status: "draft", presaleAt: "2026-07-06T10:00:00Z", eventName: "Draft", eventSlug: "draft" },
      { status: "live", presaleAt: "2026-07-01T10:00:00Z", eventName: "Past", eventSlug: "past" },
    ],
    NOW,
  );
  assert.equal(out?.eventSlug, "soon");
});

test("nextPresale returns null when nothing qualifies", () => {
  assert.equal(
    nextPresale(
      [
        { status: "live", presaleAt: null, eventName: "No date", eventSlug: "a" },
        { status: "live", presaleAt: "2026-01-01T00:00:00Z", eventName: "Past", eventSlug: "b" },
        { status: "draft", presaleAt: "2027-01-01T00:00:00Z", eventName: "Draft", eventSlug: "c" },
        { status: "live", presaleAt: "not-a-date", eventName: "Bad", eventSlug: "d" },
      ],
      NOW,
    ),
    null,
  );
});

test("pixelWarning: no live pages → silent", () => {
  assert.equal(
    pixelWarning({ livePages: 0, pixelId: null, capiTokenConfigured: false }),
    null,
  );
});

test("pixelWarning: live + no pixel → error", () => {
  const w = pixelWarning({ livePages: 2, pixelId: null, capiTokenConfigured: false });
  assert.equal(w?.level, "error");
});

test("pixelWarning: live + pixel but no CAPI → warning", () => {
  const w = pixelWarning({ livePages: 2, pixelId: "123", capiTokenConfigured: false });
  assert.equal(w?.level, "warning");
});

test("pixelWarning: fully configured → silent", () => {
  assert.equal(
    pixelWarning({ livePages: 3, pixelId: "123", capiTokenConfigured: true }),
    null,
  );
});
