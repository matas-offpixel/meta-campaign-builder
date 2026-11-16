import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  adAccountDigitsOnly,
  eventAdAccountSource,
  isValidAdAccountId,
  normalizeAdAccountId,
} from "../ad-account.ts";

describe("normalizeAdAccountId", () => {
  it("prefixes raw digits", () => {
    assert.equal(normalizeAdAccountId("10151014958791885"), "act_10151014958791885");
  });

  it("passes through already-prefixed ids", () => {
    assert.equal(normalizeAdAccountId("act_10151014958791885"), "act_10151014958791885");
  });

  it("trims whitespace before checking", () => {
    assert.equal(normalizeAdAccountId("  10151014958791885 "), "act_10151014958791885");
  });

  it("does not double the prefix", () => {
    assert.equal(normalizeAdAccountId("act_123456"), "act_123456");
    assert.notEqual(normalizeAdAccountId("act_123456"), "act_act_123456");
  });

  it("returns null for empty / whitespace / null / undefined", () => {
    assert.equal(normalizeAdAccountId(null), null);
    assert.equal(normalizeAdAccountId(undefined), null);
    assert.equal(normalizeAdAccountId(""), null);
    assert.equal(normalizeAdAccountId("   "), null);
  });

  it("rejects non-digit bodies", () => {
    assert.equal(normalizeAdAccountId("act_abc"), null);
    assert.equal(normalizeAdAccountId("act_12-34"), null);
    assert.equal(normalizeAdAccountId("not-an-id"), null);
  });

  it("rejects too-short digit strings", () => {
    assert.equal(normalizeAdAccountId("12345"), null);
    assert.equal(normalizeAdAccountId("act_123"), null);
  });
});

describe("isValidAdAccountId", () => {
  it("returns true for valid ids", () => {
    assert.equal(isValidAdAccountId("10151014958791885"), true);
    assert.equal(isValidAdAccountId("act_10151014958791885"), true);
  });

  it("returns false for invalid ids", () => {
    assert.equal(isValidAdAccountId(null), false);
    assert.equal(isValidAdAccountId("abc"), false);
  });
});

describe("adAccountDigitsOnly", () => {
  it("strips the act_ prefix", () => {
    assert.equal(adAccountDigitsOnly("10151014958791885"), "10151014958791885");
    assert.equal(adAccountDigitsOnly("act_10151014958791885"), "10151014958791885");
  });

  it("returns null for invalid input", () => {
    assert.equal(adAccountDigitsOnly(null), null);
    assert.equal(adAccountDigitsOnly("act_xyz"), null);
  });
});

describe("eventAdAccountSource (the event page's Platform config row)", () => {
  it("the event's own account first: EBR26-KREAM runs in 2011069725849568, not the client's 1073273492854557", () => {
    assert.deepEqual(eventAdAccountSource({ meta_ad_account_id: "2011069725849568", client: { meta_ad_account_id: "1073273492854557" } }), { value: "2011069725849568", source: "event" });
    assert.deepEqual(eventAdAccountSource({ meta_ad_account_id: " 606252931141334 ", client: { meta_ad_account_id: "1073273492854557" } }), { value: "606252931141334", source: "event" });
  });

  it("no account on the event: the client's, inherited; neither: none", () => {
    assert.deepEqual(eventAdAccountSource({ meta_ad_account_id: null, client: { meta_ad_account_id: "1073273492854557" } }), { value: "1073273492854557", source: "client" });
    assert.deepEqual(eventAdAccountSource({ meta_ad_account_id: "  ", client: null }), { value: null, source: null });
  });
});
