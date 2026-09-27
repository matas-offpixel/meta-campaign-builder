import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyLaunchMetaCode,
  mapLaunchTokenError,
  archivedCampaignMessage,
  classifyCreativeCreateError,
  creativeFailureBanners,
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

describe("classifyCreativeCreateError", () => {
  const identity = {
    creativeName: "Feed Post v1",
    campaignId: "120251973029760755",
    pageId: "104583921000001",
    instagramAccountId: "17841400000000001",
  };

  it("code 200 'Permissions error' → permission naming the page, not app_mode", () => {
    const r = classifyCreativeCreateError(
      { code: 200, message: "(#200) Permissions error" },
      identity,
    );
    assert.equal(r.kind, "permission");
    assert.equal(r.skippedReason, "permission");
    assert.match(r.message, /Page 104583921000001/);
    assert.match(r.message, /Instagram account 17841400000000001/);
    assert.match(r.message, /lacks a permission/);
    assert.match(r.message, /\/business-managers/);
    assert.doesNotMatch(r.message, /Development|Live\/Public/);
  });

  it("code 10 and subcodes 1349125 / 1349131 → permission", () => {
    for (const err of [
      { code: 10, message: "Application does not have permission for this action" },
      { code: 100, subcode: 1349125, message: "Invalid parameter" },
      { code: 100, subcode: 1349131, message: "Invalid parameter" },
    ]) {
      assert.equal(classifyCreativeCreateError(err, identity).kind, "permission", JSON.stringify(err));
    }
  });

  it("explicit 'app is in development mode' → app_mode with the existing skippedReason", () => {
    const r = classifyCreativeCreateError(
      { code: 100, message: "Cannot create this creative: the app is in development mode." },
      identity,
    );
    assert.equal(r.kind, "app_mode");
    assert.equal(r.skippedReason, "app_mode_blocked");
    assert.match(r.message, /Live\/Public mode/);
  });

  it("Meta's 'created by an app that is in development mode' wording → app_mode", () => {
    const r = classifyCreativeCreateError(
      {
        code: 100,
        subcode: 1885183,
        userMsg: "Ads creative post was created by an app that is in development mode. It must be in public to create this ad.",
      },
      identity,
    );
    assert.equal(r.kind, "app_mode");
  });

  it("explicit app-mode wording wins over code 200", () => {
    const r = classifyCreativeCreateError(
      { code: 200, message: "Permissions error", userMsg: "Switch the app to Live mode to continue." },
      identity,
    );
    assert.equal(r.kind, "app_mode");
  });

  it("'development' in an unrelated sentence → other, with codes appended and no advice", () => {
    const r = classifyCreativeCreateError(
      { code: 100, subcode: 1487390, message: "Invalid parameter: the development of this asset failed" },
      identity,
    );
    assert.equal(r.kind, "other");
    assert.equal(r.skippedReason, undefined);
    assert.equal(r.message, "Invalid parameter: the development of this asset failed · code=100 · subcode=1487390");
  });

  it("non-Meta errors → other with the raw message", () => {
    const r = classifyCreativeCreateError(new Error("socket hang up"), identity);
    assert.equal(r.kind, "other");
    assert.equal(r.message, "socket hang up");
  });

  it("2061015 → the existing website-URL helper text", () => {
    const err = {
      code: 100,
      subcode: 2061015,
      userMsg: "The website URL field is required. Please complete the field to continue.",
    };
    const r = classifyCreativeCreateError(err, identity);
    assert.equal(r.kind, "website_url_required");
    assert.equal(
      r.message,
      `"Feed Post v1" is an Instagram video in a campaign that optimises for a website event. ` +
        `Set its destination URL on the creative in the Creatives step, then launch again.`,
    );
    assert.equal(r.message, websiteUrlRequiredMessage("Feed Post v1", err));
  });

  it("1487866 → the existing archived-campaign helper text", () => {
    const err = { code: 100, subcode: 1487866, userMsg: "Ad Sets may not be added to archived Campaigns." };
    const r = classifyCreativeCreateError(err, identity);
    assert.equal(r.kind, "archived_campaign");
    assert.equal(
      r.message,
      "Campaign 120251973029760755 is archived in Meta. Unarchive it in Ads Manager, " +
        "or duplicate this draft to launch a new campaign.",
    );
    assert.equal(r.message, archivedCampaignMessage("120251973029760755", err));
  });
});

describe("creativeFailureBanners", () => {
  it("three permission failures and no app-mode failures → permission banner only", () => {
    const banners = creativeFailureBanners({
      creativesCreated: [{ name: "Story v1" }],
      creativesFailed: [
        { skippedReason: "permission", pageId: "111", instagramAccountId: "999" },
        { skippedReason: "permission", pageId: "111", instagramAccountId: "999" },
        { skippedReason: "permission", pageId: "222" },
      ],
    });
    assert.equal(banners.appMode, null);
    assert.ok(banners.permission);
    assert.equal(banners.permission.title, "3 creatives blocked — launch token lacks permission");
    assert.equal(
      banners.permission.body,
      "Meta refused these creatives because the launch token lacks a permission on " +
        "Page 111, Instagram account 999 and Page 222. " +
        "Grant access to those assets in Business Managers, then relaunch.",
    );
    const rendered = `${banners.permission.title} ${banners.permission.body}`;
    assert.doesNotMatch(rendered, /Development mode|app mode|Live\/Public/i);
  });

  it("all creatives blocked by permission → body says the structure was created", () => {
    const banners = creativeFailureBanners({
      creativesCreated: [],
      creativesFailed: [{ skippedReason: "permission", pageId: "111" }],
    });
    assert.equal(banners.permission?.allBlocked, true);
    assert.equal(
      banners.permission?.body,
      "Your campaign and ad sets were created in Meta, but no creatives were launched. " +
        "Meta refused this creative because the launch token lacks a permission on Page 111. " +
        "Grant access to that asset in Business Managers, then relaunch.",
    );
  });

  it("app-mode failures keep the existing Development-mode titles", () => {
    const partial = creativeFailureBanners({
      creativesCreated: [{}],
      creativesFailed: [{ skippedReason: "app_mode_blocked" }, { skippedReason: "app_mode_blocked" }],
    });
    assert.equal(partial.appMode?.title, "2 creatives blocked by Meta app mode");
    assert.equal(partial.permission, null);

    const all = creativeFailureBanners({
      creativesCreated: [],
      creativesFailed: [{ skippedReason: "app_mode_blocked" }],
    });
    assert.equal(all.appMode?.title, "Campaign structure created — creatives not launched");
  });

  it("plain failures show neither banner", () => {
    const banners = creativeFailureBanners({
      creativesCreated: [],
      creativesFailed: [{}, { skippedReason: "validation" }],
    });
    assert.deepEqual(banners, { appMode: null, permission: null });
  });
});
