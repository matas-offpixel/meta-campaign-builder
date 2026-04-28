import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isPresaleCampaignName } from "../meta-campaign-phase.ts";

describe("isPresaleCampaignName", () => {
  it("matches common presale campaign-name variants", () => {
    for (const name of [
      "[WC26-BRISTOL] PRESALE",
      "[WC26-BRISTOL] presale",
      "[WC26-BRISTOL] Pre-Sale",
      "[WC26-BRISTOL] pre sale",
      "[WC26-BRISTOL] pre_sale",
    ]) {
      assert.equal(isPresaleCampaignName(name), true, name);
    }
  });

  it("does not match adjacent pre-prefixed words", () => {
    for (const name of ["PRE-REG", "PRESS", "PREORDER", "preseason"]) {
      assert.equal(isPresaleCampaignName(name), false, name);
    }
  });
});
