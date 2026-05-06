import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { sumLandingPageViewsFromSharePayload } from "../funnel-pacing-payload.ts";

describe("sumLandingPageViewsFromSharePayload", () => {
  test("sums concept groups and unattributed LPV from an ok snapshot payload", () => {
    const payload = {
      kind: "ok" as const,
      groups: [{ landingPageViews: 100 }, { landingPageViews: 40 }],
      meta: {
        unattributed: { landingPageViews: 10 },
      },
    };

    assert.equal(sumLandingPageViewsFromSharePayload(payload), 150);
  });

  test("returns 0 for non-ok snapshot payloads", () => {
    const payload = { kind: "skip" as const };

    assert.equal(sumLandingPageViewsFromSharePayload(payload), 0);
  });
});
