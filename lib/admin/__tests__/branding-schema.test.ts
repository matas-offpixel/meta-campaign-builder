import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildBrandingUpdate,
  parseBrandingForm,
  type BrandingFormValues,
} from "../branding-schema.ts";

/**
 * OP909 Phase 2 — org/brand settings validation + payload builder.
 * The builder test pins the EXACT update payload (byte-diff style via
 * deepEqual) because this is the only write path into the theme jsonb
 * from the client surface — a shape drift here silently corrupts
 * operator-authored themes.
 */

const VALID_INPUT = {
  logo_style: "box_logo",
  box_logo_text: "JACKIES",
  brand_color: "#E5322D",
  privacy_policy_url: "https://gmc.example.com/privacy",
  brand_instagram_url_default: "https://instagram.com/jackies",
  brand_tiktok_url_default: "https://tiktok.com/@jackies",
  show_off_pixel_attribution: "on",
};

describe("parseBrandingForm", () => {
  it("happy path — full form parses with trimming + checkbox coercion", () => {
    const result = parseBrandingForm({
      ...VALID_INPUT,
      box_logo_text: "  JACKIES  ",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value, {
      logo_style: "box_logo",
      box_logo_text: "JACKIES",
      brand_color: "#E5322D",
      privacy_policy_url: "https://gmc.example.com/privacy",
      brand_instagram_url_default: "https://instagram.com/jackies",
      brand_tiktok_url_default: "https://tiktok.com/@jackies",
      show_off_pixel_attribution: true,
    });
  });

  it("empty optional fields become null; unchecked checkbox is false", () => {
    const result = parseBrandingForm({
      logo_style: "wordmark",
      box_logo_text: "",
      brand_color: "",
      privacy_policy_url: "",
      brand_instagram_url_default: "",
      brand_tiktok_url_default: "",
      show_off_pixel_attribution: null, // FormData.get returns null when unchecked
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value, {
      logo_style: "wordmark",
      box_logo_text: null,
      brand_color: null,
      privacy_policy_url: null,
      brand_instagram_url_default: null,
      brand_tiktok_url_default: null,
      show_off_pixel_attribution: false,
    });
  });

  it("rejects an unknown logo style", () => {
    const result = parseBrandingForm({ ...VALID_INPUT, logo_style: "banner" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.logo_style);
  });

  it("rejects over-long box logo text", () => {
    const result = parseBrandingForm({
      ...VALID_INPUT,
      box_logo_text: "SEVENTEEN-CHARS!!",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.box_logo_text);
  });

  it("rejects non-hex brand colors (CSS injection dies here)", () => {
    for (const bad of [
      "red",
      "#E5322D; } body { display:none",
      "url(javascript:alert(1))",
      "#12345",
    ]) {
      const result = parseBrandingForm({ ...VALID_INPUT, brand_color: bad });
      assert.equal(result.ok, false, `expected reject: ${bad}`);
    }
  });

  it("accepts 3-digit hex", () => {
    const result = parseBrandingForm({ ...VALID_INPUT, brand_color: "#f40" });
    assert.equal(result.ok, true);
  });

  it("privacy policy must be https (http rejected)", () => {
    const result = parseBrandingForm({
      ...VALID_INPUT,
      privacy_policy_url: "http://gmc.example.com/privacy",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.privacy_policy_url);
  });

  it("social URLs accept http, reject javascript: and garbage", () => {
    const httpOk = parseBrandingForm({
      ...VALID_INPUT,
      brand_instagram_url_default: "http://instagram.com/jackies",
    });
    assert.equal(httpOk.ok, true);

    for (const bad of ["javascript:alert(1)", "not a url", "//protocol-relative"]) {
      const result = parseBrandingForm({
        ...VALID_INPUT,
        brand_tiktok_url_default: bad,
      });
      assert.equal(result.ok, false, `expected reject: ${bad}`);
    }
  });

  it("collects MULTIPLE field errors in one pass", () => {
    const result = parseBrandingForm({
      logo_style: "nope",
      brand_color: "red",
      privacy_policy_url: "ftp://x",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(
      Object.keys(result.errors).sort(),
      ["brand_color", "logo_style", "privacy_policy_url"],
    );
  });
});

describe("buildBrandingUpdate", () => {
  const VALUES: BrandingFormValues = {
    logo_style: "box_logo",
    box_logo_text: "JACKIES",
    brand_color: "#E5322D",
    privacy_policy_url: "https://gmc.example.com/privacy",
    brand_instagram_url_default: "https://instagram.com/jackies",
    brand_tiktok_url_default: null,
    show_off_pixel_attribution: false,
  };

  it("pins the exact payload shape — brand_color merges into theme", () => {
    const payload = buildBrandingUpdate(
      { secondary_color: "#241f31", logo_url: "https://x.com/logo.png" },
      VALUES,
    );
    assert.deepEqual(payload, {
      logo_style: "box_logo",
      box_logo_text: "JACKIES",
      theme: {
        secondary_color: "#241f31",
        logo_url: "https://x.com/logo.png",
        primary_color: "#E5322D",
      },
      privacy_policy_url: "https://gmc.example.com/privacy",
      brand_instagram_url_default: "https://instagram.com/jackies",
      brand_tiktok_url_default: null,
      show_off_pixel_attribution: false,
    });
  });

  it("null brand_color REMOVES theme.primary_color (auto accent)", () => {
    const payload = buildBrandingUpdate(
      { primary_color: "#ff0000", secondary_color: "#241f31" },
      { ...VALUES, brand_color: null },
    );
    assert.deepEqual(payload.theme, { secondary_color: "#241f31" });
  });

  it("null current theme starts from empty (no crash, no leakage)", () => {
    const payload = buildBrandingUpdate(null, VALUES);
    assert.deepEqual(payload.theme, { primary_color: "#E5322D" });
  });

  it("does not mutate the input theme object", () => {
    const current = { primary_color: "#ff0000" };
    buildBrandingUpdate(current, VALUES);
    assert.deepEqual(current, { primary_color: "#ff0000" });
  });
});
