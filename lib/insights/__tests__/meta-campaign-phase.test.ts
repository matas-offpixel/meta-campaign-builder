import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  isPresaleCampaignName,
  isSubFixtureCampaignName,
  partitionMetaSpendForCampaign,
} from "../meta-campaign-phase.ts";

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

describe("partitionMetaSpendForCampaign", () => {
  it("treats Last 32 / Final as regular spend even when presale wording appears", () => {
    assert.deepEqual(
      partitionMetaSpendForCampaign("[X] Last 32 — presale tag", 50),
      { regular: 50, presale: 0 },
    );
    assert.deepEqual(partitionMetaSpendForCampaign("[X] Final Offer", 40), {
      regular: 40,
      presale: 0,
    });
  });

  it("routes presale-labelled campaigns to presale bucket", () => {
    assert.deepEqual(partitionMetaSpendForCampaign("[X] PRESALE TRAFFIC", 99), {
      regular: 0,
      presale: 99,
    });
  });

  it("detects sub-fixture markers", () => {
    assert.equal(isSubFixtureCampaignName("[WC26-X] Last 32 Traffic"), true);
    assert.equal(isSubFixtureCampaignName("[WC26-X] Conversion Final"), true);
  });
});
