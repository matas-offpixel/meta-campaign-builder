import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isCampaignRuntimeActive } from "../campaign-active.ts";
import type { MetaCampaignSummary } from "../../types.ts";

function campaign(
  partial: Pick<MetaCampaignSummary, "effectiveStatus" | "status">,
): Pick<MetaCampaignSummary, "effectiveStatus" | "status"> {
  return partial;
}

describe("isCampaignRuntimeActive", () => {
  it("matches when effective_status and status are ACTIVE", () => {
    assert.equal(
      isCampaignRuntimeActive(campaign({ effectiveStatus: "ACTIVE", status: "ACTIVE" })),
      true,
    );
  });

  it("matches when effective_status is ACTIVE and status is PAUSED", () => {
    assert.equal(
      isCampaignRuntimeActive(campaign({ effectiveStatus: "ACTIVE", status: "PAUSED" })),
      true,
    );
  });

  it("does not match when effective_status is PAUSED even if status is ACTIVE", () => {
    assert.equal(
      isCampaignRuntimeActive(campaign({ effectiveStatus: "PAUSED", status: "ACTIVE" })),
      false,
    );
  });

  it("falls back to status when effective_status is missing", () => {
    assert.equal(
      isCampaignRuntimeActive(campaign({ effectiveStatus: undefined, status: "ACTIVE" })),
      true,
    );
    assert.equal(
      isCampaignRuntimeActive(campaign({ effectiveStatus: "", status: "ACTIVE" })),
      true,
    );
  });
});
