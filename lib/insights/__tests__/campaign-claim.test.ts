import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyCampaignClaim } from "../meta-event-code-match.ts";

describe("classifyCampaignClaim", () => {
  it("claims a campaign carrying this event's code", () => {
    const c = classifyCampaignClaim("[NX26-DJEZ] DJ EZ - Traffic", "NX26-DJEZ", false);
    assert.deepEqual(c, { include: true, reason: "coded" });
  });

  it("releases a stored campaign once its name carries another event's code", () => {
    // The real 13 Oct rename: this id is still on NX25-DJ EZ's stored list.
    const c = classifyCampaignClaim("[NX26-DJEZ] DJ EZ - Traffic", "NX25-DJ EZ", true);
    assert.equal(c.include, false);
    assert.equal(c.reason, "moved");
    assert.equal(c.movedTo, "NX26-DJEZ");
  });

  it("keeps an uncoded campaign with the event that already claimed it", () => {
    const c = classifyCampaignClaim("Schak - Nanna Makina", "NX26-SCHAK", true);
    assert.deepEqual(c, { include: true, reason: "uncoded_retained" });
  });

  it("does not adopt an uncoded campaign that was never ours", () => {
    const c = classifyCampaignClaim("Morgan Seatree", "NX26-SCHAK", false);
    assert.deepEqual(c, { include: false, reason: "foreign" });
  });

  it("is not fooled by a code that merely shares a prefix", () => {
    const c = classifyCampaignClaim("[ES26-MALLGRAB] Mall Grab", "ES26-MALL", true);
    assert.equal(c.include, false);
    assert.equal(c.reason, "moved");
  });

  it("normalises en-dashes the way the existing matcher does", () => {
    const c = classifyCampaignClaim("[NX26–DJEZ] Retargeting", "NX26-DJEZ", false);
    assert.equal(c.include, true);
  });
});
