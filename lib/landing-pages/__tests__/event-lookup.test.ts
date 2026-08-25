import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assembleEventLandingPageRecord } from "../event-lookup.ts";

describe("assembleEventLandingPageRecord", () => {
  it("null event id → null (no lookup)", () => {
    assert.equal(
      assembleEventLandingPageRecord({
        eventId: null,
        eventSlug: "x",
        clientSlug: "y",
        pageEventId: "p",
      }),
      null,
    );
  });

  it("page id present → hasPage; missing → no LP", () => {
    const withPage = assembleEventLandingPageRecord({
      eventId: "e1",
      eventSlug: "mallorca",
      clientSlug: "gmc",
      pageEventId: "p1",
    });
    assert.equal(withPage?.hasPage, true);
    assert.equal(withPage?.hasClientConfig, false);
    assert.equal(withPage?.customHost, null);

    const without = assembleEventLandingPageRecord({
      eventId: "e1",
      eventSlug: "mallorca",
      clientSlug: "gmc",
      pageEventId: null,
    });
    assert.equal(without?.hasPage, false);
  });
});
