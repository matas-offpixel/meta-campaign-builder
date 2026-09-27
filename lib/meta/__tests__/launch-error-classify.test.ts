import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyLaunchMetaCode,
  mapLaunchTokenError,
  archivedCampaignMessage,
  websiteUrlRequiredMessage,
} from "../launch-error-classify.ts";

/**
 * Launch token-validation failures must not blanket-blame token expiry. A
 * rate-limited /debug_token call (#4, is_transient) used to surface as
 * "reconnect Facebook" even when the token was fresh
 * (project_auth_error_masks_rate_limit). These tests pin the code→message map.
 */
describe("classifyLaunchMetaCode", () => {
  it("classifies app/user/account rate-limit codes as rate_limit", () => {
    for (const code of [4, 17, 32, 341, 613, 80004]) {
      assert.equal(classifyLaunchMetaCode(code), "rate_limit", `code ${code}`);
    }
  });

  it("classifies genuine auth codes as auth", () => {
    assert.equal(classifyLaunchMetaCode(190), "auth");
    assert.equal(classifyLaunchMetaCode(102), "auth");
  });

  it("classifies unknown / missing codes as other", () => {
    assert.equal(classifyLaunchMetaCode(200), "other");
    assert.equal(classifyLaunchMetaCode(undefined), "other");
    assert.equal(classifyLaunchMetaCode(null), "other");
  });
});

describe("mapLaunchTokenError", () => {
  it("#4 → rate-limit message, 429, no reconnect, no 'reconnect' text", () => {
    const m = mapLaunchTokenError(4);
    assert.equal(m.kind, "rate_limit");
    assert.equal(m.status, 429);
    assert.equal(m.reconnect, false);
    assert.match(m.message, /rate limit reached \(#4\)/i);
    assert.match(m.message, /temporary|retry/i);
    assert.doesNotMatch(m.message, /few minutes/i);
    assert.doesNotMatch(m.message, /reconnect/i);
  });

  it("#80004 (ad-account) → rate-limit message, not reconnect", () => {
    const m = mapLaunchTokenError(80004);
    assert.equal(m.kind, "rate_limit");
    assert.match(m.message, /\(#80004\)/);
    assert.doesNotMatch(m.message, /reconnect/i);
  });

  it("#190 → reconnect message, 401, reconnect=true", () => {
    const m = mapLaunchTokenError(190);
    assert.equal(m.kind, "auth");
    assert.equal(m.status, 401);
    assert.equal(m.reconnect, true);
    assert.match(m.message, /reconnect Facebook/i);
  });

  it("unknown code → keeps the reconnect block (auth gate not weakened)", () => {
    const m = mapLaunchTokenError(undefined);
    assert.equal(m.kind, "other");
    assert.equal(m.status, 401);
    assert.equal(m.reconnect, true);
    assert.match(m.message, /reconnect Facebook/i);
  });
});

describe("website URL required", () => {
  it("names the creative and does not mention Development mode", () => {
    const message = websiteUrlRequiredMessage("Feed Post v1", {
      code: 100,
      subcode: 2061015,
      userMsg: "The website URL field is required. Please complete the field to continue.",
    });
    assert.match(message ?? "", /Feed Post v1/);
    assert.match(message ?? "", /destination URL/);
    assert.doesNotMatch(message ?? "", /Development mode/);
  });

  it("leaves other ad errors alone", () => {
    assert.equal(websiteUrlRequiredMessage("Feed Post v1", { code: 100, subcode: 1815676 }), null);
  });
});

describe("archived campaign", () => {
  it("names the campaign and does not mention Development mode", () => {
    const message = archivedCampaignMessage("120251973029760755", {
      code: 100,
      subcode: 1487866,
      userMsg: "Ad Sets may not be added to archived Campaigns.",
    });
    assert.match(message ?? "", /120251973029760755/);
    assert.match(message ?? "", /archived in Meta/);
    assert.doesNotMatch(message ?? "", /Development mode/);
  });
});
