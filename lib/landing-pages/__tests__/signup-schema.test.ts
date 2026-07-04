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
  email: "Amelia.Stone@Example.COM",
  // 07400 xxxxxx is unambiguously a GB mobile prefix (07700 900xxx is the
  // Ofcom drama range but libphonenumber resolves 07911 to Guernsey).
  phone: "07400 123456",
  phone_country: "GB",
  // PR-6 mutex: exactly one social platform per submission.
  ig_handle: "@Amelia.Stone",
  tt_handle: "",
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
    assert.equal(result.data.tt_handle, null);
    assert.equal(result.data.consent_wa_opt_in, true);
    assert.equal(result.data.source, "paid_meta");
  });

  it("PR 6: legacy first_name/last_name/city keys are ignored, not rejected", () => {
    const result = parseSignupSubmission({
      ...valid,
      first_name: "Amelia",
      last_name: "Stone",
      city: "London",
    } as SignupFormValues);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(!("first_name" in result.data));
      assert.ok(!("city" in result.data));
    }
  });

  it("PR 6: tiktok-only submissions normalise the same way", () => {
    const result = parseSignupSubmission({
      ...valid,
      ig_handle: "",
      tt_handle: "@Amelia_TT",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.ig_handle, null);
      assert.equal(result.data.tt_handle, "amelia_tt");
    }
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

describe("PR 7: E.164 trunk-zero handling (no leading 0 in the stored number)", () => {
  it("07400 123456 / 7400 123456 / +447400123456 all converge to the same E.164 (GB)", () => {
    for (const phone of ["07400 123456", "7400 123456", "+44 7400 123456"]) {
      const result = parseSignupSubmission({ ...valid, phone, phone_country: "GB" });
      assert.equal(result.ok, true, `phone=${phone} should parse`);
      if (result.ok) {
        assert.equal(result.data.phone_e164, "+447400123456");
        assert.equal(result.data.phone_e164?.startsWith("+440"), false);
      }
    }
  });

  it("same convergence holds for other trunk-0 numbering plans (FR, DE)", () => {
    const fr = parseSignupSubmission({
      ...valid,
      phone: "06 12 34 56 78",
      phone_country: "FR",
    });
    assert.equal(fr.ok, true);
    if (fr.ok) assert.equal(fr.data.phone_e164, "+33612345678");

    const frNoZero = parseSignupSubmission({
      ...valid,
      phone: "6 12 34 56 78",
      phone_country: "FR",
    });
    assert.equal(frNoZero.ok, true);
    if (frNoZero.ok) assert.equal(frNoZero.data.phone_e164, "+33612345678");

    const de = parseSignupSubmission({
      ...valid,
      phone: "030 12345678",
      phone_country: "DE",
    });
    assert.equal(de.ok, true);
    if (de.ok) assert.equal(de.data.phone_e164, "+493012345678");
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
    const badChars = parseSignupSubmission({
      ...valid,
      ig_handle: "",
      tt_handle: "@has spaces!",
    });
    assert.equal(badChars.ok, false);
  });

  it("PR 6: rejects when BOTH ig_handle and tt_handle are set (social mutex)", () => {
    const result = parseSignupSubmission({
      ...valid,
      ig_handle: "@one",
      tt_handle: "@two",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.field_errors.social);
  });

  it("an empty payload collects ALL errors in one pass", () => {
    const result = parseSignupSubmission({});
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.field_errors.contact);
      assert.ok(result.field_errors.consent_gdpr);
      assert.ok(!result.field_errors.first_name, "names left the schema in PR 6");
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

describe("capi_event_id (PR 3)", () => {
  const base = {
    email: "amelia@example.com",
    consent_gdpr: true,
  };

  it("valid id passes through verbatim", () => {
    const result = parseSignupSubmission({ ...base, capi_event_id: "abc-123-DEF_45:lead" });
    assert.ok(result.ok);
    if (result.ok) assert.equal(result.data.capi_event_id, "abc-123-DEF_45:lead");
  });

  it("missing / invalid ids degrade to null WITHOUT a field error (tracking must never block a signup)", () => {
    for (const bad of [undefined, "", "short", "x".repeat(65), "has spaces here", 42, { evil: 1 }]) {
      const result = parseSignupSubmission({ ...base, capi_event_id: bad });
      assert.ok(result.ok, `capi_event_id=${JSON.stringify(bad)} must not reject the signup`);
      if (result.ok) assert.equal(result.data.capi_event_id, null);
    }
  });
});
