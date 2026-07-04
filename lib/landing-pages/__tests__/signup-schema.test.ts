import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  inferSignupSource,
  normalizeHandle,
  parseSignupSubmission,
} from "../signup-schema.ts";
import type { SignupFormValues } from "../types.ts";

/**
 * The SHARED validation schema — one module, imported by both the client
 * form and the API route, so these tests cover both enforcement points.
 */

const valid: SignupFormValues = {
  first_name: "Amelia",
  last_name: "Stone",
  email: "Amelia.Stone@Example.COM",
  // 07700 900xxx is the Ofcom drama range — unambiguously GB (  // actually a Guernsey prefix; libphonenumber resolves it to GG).
  phone: "07400 123456",
  phone_country: "GB",
  city: "London",
  ig_handle: "@Amelia.Stone",
  tt_handle: "@amelia_tt",
  consent_gdpr: true,
  consent_wa_opt_in: true,
  utm: { utm_source: "instagram", utm_medium: "paid" },
  referrer_url: "https://instagram.com/",
};

describe("parseSignupSubmission — accept + normalisation", () => {
  it("accepts a full valid submission and normalises every field", () => {
    const result = parseSignupSubmission(valid);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.email, "amelia.stone@example.com");
    assert.equal(result.data.phone_e164, "+447400123456");
    assert.equal(result.data.phone_country_code, "GB");
    assert.equal(result.data.ig_handle, "amelia.stone");
    assert.equal(result.data.tt_handle, "amelia_tt");
    assert.equal(result.data.consent_wa_opt_in, true);
    assert.equal(result.data.source, "paid_meta");
  });

  it("accepts email-only (no phone) and phone-only (no email)", () => {
    const emailOnly = parseSignupSubmission({ ...valid, phone: "", consent_wa_opt_in: false });
    assert.equal(emailOnly.ok, true);
    const phoneOnly = parseSignupSubmission({ ...valid, email: "" });
    assert.equal(phoneOnly.ok, true);
    if (phoneOnly.ok) assert.equal(phoneOnly.data.email, null);
  });

  it("silently drops WA opt-in when no phone is provided (never trust the client)", () => {
    const result = parseSignupSubmission({
      ...valid,
      phone: "",
      consent_wa_opt_in: true,
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.data.consent_wa_opt_in, false);
  });

  it("allowlists utm keys and drops everything else", () => {
    const result = parseSignupSubmission({
      ...valid,
      utm: { utm_source: "tiktok", evil_key: "x", utm_campaign: "wc26" },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(Object.keys(result.data.utm).sort(), [
      "utm_campaign",
      "utm_source",
    ]);
  });
});

describe("parseSignupSubmission — reject matrix", () => {
  it("rejects missing consent_gdpr", () => {
    const result = parseSignupSubmission({ ...valid, consent_gdpr: false });
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.field_errors.consent_gdpr);
  });

  it("rejects when BOTH email and phone are missing (contactability)", () => {
    const result = parseSignupSubmission({ ...valid, email: "", phone: "" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.field_errors.contact);
  });

  it("rejects an invalid email format", () => {
    const result = parseSignupSubmission({ ...valid, email: "not-an-email" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.field_errors.email);
  });

  it("rejects an invalid phone (not parseable to E.164)", () => {
    const result = parseSignupSubmission({ ...valid, phone: "12345" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.field_errors.phone);
  });

  it("rejects a handle over 30 chars or with invalid chars", () => {
    const tooLong = parseSignupSubmission({
      ...valid,
      ig_handle: "@" + "a".repeat(31),
    });
    assert.equal(tooLong.ok, false);
    const badChars = parseSignupSubmission({ ...valid, tt_handle: "@has spaces!" });
    assert.equal(badChars.ok, false);
  });

  it("rejects missing first/last name and an empty payload collects ALL errors", () => {
    const result = parseSignupSubmission({});
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.field_errors.first_name);
      assert.ok(result.field_errors.last_name);
      assert.ok(result.field_errors.contact);
      assert.ok(result.field_errors.consent_gdpr);
    }
  });
});

describe("normalizeHandle / inferSignupSource", () => {
  it("strips @, lowercases, and nulls empty", () => {
    assert.equal(normalizeHandle("@@DJ_Kayode"), "dj_kayode");
    assert.equal(normalizeHandle("   "), null);
  });

  it("buckets sources: meta / tiktok / google / organic / other", () => {
    assert.equal(inferSignupSource({ utm_source: "facebook" }), "paid_meta");
    assert.equal(inferSignupSource({ fbclid: "abc" }), "paid_meta");
    assert.equal(inferSignupSource({ utm_source: "tiktok" }), "paid_tiktok");
    assert.equal(inferSignupSource({ gclid: "xyz" }), "paid_google");
    assert.equal(inferSignupSource({}), "organic");
    assert.equal(inferSignupSource({ utm_source: "newsletter" }), "other_newsletter");
  });
});
