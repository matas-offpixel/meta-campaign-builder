import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { campaignNameMatchesEventCode } from "../matching.ts";

describe("campaignNameMatchesEventCode", () => {
  it("matches bracketed event_code prefixes as a bare case-insensitive substring", () => {
    assert.equal(
      campaignNameMatchesEventCode("[BB26-RIANBRAZIL] Prospecting", "BB26-RIANBRAZIL"),
      true,
    );
    assert.equal(
      campaignNameMatchesEventCode("[bb26-rianbrazil] Retargeting", "BB26-RIANBRAZIL"),
      true,
    );
  });

  it("does not require the event_code to be at the start", () => {
    assert.equal(
      campaignNameMatchesEventCode("Prospecting [BB26-RIANBRAZIL]", "BB26-RIANBRAZIL"),
      true,
    );
  });

  it("does not match empty event codes", () => {
    assert.equal(campaignNameMatchesEventCode("[BB26-RIANBRAZIL]", ""), false);
    assert.equal(campaignNameMatchesEventCode("[BB26-RIANBRAZIL]", "  "), false);
  });
});
