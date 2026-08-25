import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { captureAttribution } from "../attribution.ts";
import { parsePageViewBody } from "../page-view-handler.ts";
import {
  parseSignupSubmission,
  utmFromSearch,
} from "../signup-schema.ts";
import type { SignupFormValues } from "../types.ts";

/**
 * Phase B join-layer contract: views and signups must emit the same
 * utm keys for the same URL. One comparison, both handlers.
 */

const SEARCH =
  "?utm_source=instagram&utm_campaign=wc26&fbclid=abc&evil=1&utm_medium=paid";

const signupBody: SignupFormValues = {
  email: "fan@example.com",
  phone: "",
  consent_gdpr: true,
  utm: Object.fromEntries(new URLSearchParams(SEARCH)),
  referrer_url: "https://instagram.com/",
};

describe("utm shape parity — signup vs page view", () => {
  it("both handlers keep the same allowlisted keys for an identical query string", () => {
    const signup = parseSignupSubmission(signupBody);
    const view = parsePageViewBody({
      utm: Object.fromEntries(new URLSearchParams(SEARCH)),
      referrer_url: "https://instagram.com/",
    });
    const fromSearch = utmFromSearch(SEARCH);
    const fromAttribution = captureAttribution(SEARCH, "https://instagram.com/");

    assert.equal(signup.ok, true);
    assert.equal(view.ok, true);
    if (!signup.ok || !view.ok) return;

    const expected = {
      utm_source: "instagram",
      utm_campaign: "wc26",
      utm_medium: "paid",
      fbclid: "abc",
    };
    assert.deepEqual(signup.data.utm, expected);
    assert.deepEqual(view.utm, expected);
    assert.deepEqual(fromSearch, expected);
    assert.deepEqual(fromAttribution.utm, expected);
    assert.deepEqual(signup.data.utm, view.utm);
    assert.equal(signup.data.referrer_url, view.referrer_url);
  });
});
