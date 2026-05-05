import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  WC26_GLASGOW_O2_EVENT_CODE,
  WC26_GLASGOW_SWG3_EVENT_CODE,
  WC26_GLASGOW_UMBRELLA_CUTOVER_DATE,
  isWc26GlasgowUmbrellaOnlyCampaignName,
  isWc26GlasgowVenueSiblingEventCode,
  wc26GlasgowUmbrellaSpendBelongsToVenueEvent,
} from "../wc26-glasgow-umbrella.ts";

describe("wc26-glasgow-umbrella", () => {
  it("detects venue sibling codes", () => {
    assert.equal(isWc26GlasgowVenueSiblingEventCode("WC26-GLASGOW-SWG3"), true);
    assert.equal(isWc26GlasgowVenueSiblingEventCode("WC26-GLASGOW-O2"), true);
    assert.equal(isWc26GlasgowVenueSiblingEventCode("WC26-BRIGHTON"), false);
  });

  it("classifies umbrella-only campaign names", () => {
    assert.equal(
      isWc26GlasgowUmbrellaOnlyCampaignName("[WC26-GLASGOW] TRAFFIC ADS"),
      true,
    );
    assert.equal(
      isWc26GlasgowUmbrellaOnlyCampaignName("[WC26-GLASGOW] PRESALE"),
      true,
    );
    assert.equal(
      isWc26GlasgowUmbrellaOnlyCampaignName(
        "[WC26-GLASGOW-SWG3] retargeting variants",
      ),
      false,
    );
    assert.equal(
      isWc26GlasgowUmbrellaOnlyCampaignName(
        "[WC26-GLASGOW-O2] retargeting variants",
      ),
      false,
    );
  });

  it("routes umbrella spend by cutover date", () => {
    const cutover = WC26_GLASGOW_UMBRELLA_CUTOVER_DATE;
    assert.equal(
      wc26GlasgowUmbrellaSpendBelongsToVenueEvent(
        WC26_GLASGOW_SWG3_EVENT_CODE,
        cutover,
      ),
      true,
    );
    assert.equal(
      wc26GlasgowUmbrellaSpendBelongsToVenueEvent(
        WC26_GLASGOW_SWG3_EVENT_CODE,
        "2026-05-05",
      ),
      false,
    );
    assert.equal(
      wc26GlasgowUmbrellaSpendBelongsToVenueEvent(
        WC26_GLASGOW_O2_EVENT_CODE,
        cutover,
      ),
      false,
    );
    assert.equal(
      wc26GlasgowUmbrellaSpendBelongsToVenueEvent(
        WC26_GLASGOW_O2_EVENT_CODE,
        "2026-05-05",
      ),
      true,
    );
  });
});
