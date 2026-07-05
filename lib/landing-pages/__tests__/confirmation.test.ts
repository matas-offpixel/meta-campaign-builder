import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONFIRMATION_BODY_MAX,
  CONFIRMATION_CTA_LABEL_MAX,
  getConfirmationCardConfig,
} from "../confirmation.ts";

/**
 * OP909 Phase 4 — post-signup confirmation card resolver. Pins the four
 * states the brief names (fallback / body only / body + CTA / CTA only)
 * plus the defensive sanitisation (content jsonb is SQL-editable, so the
 * resolver cannot trust the admin schema's write-time caps).
 */

describe("getConfirmationCardConfig", () => {
  it("nothing configured → default card", () => {
    for (const content of [null, undefined, {}, { title: "x" }]) {
      const config = getConfirmationCardConfig(content);
      assert.deepEqual(config, { body: null, cta: null, defaultUsed: true });
    }
  });

  it("body only → custom body, no CTA", () => {
    const config = getConfirmationCardConfig({
      confirmation_body: "  Your registration has been confirmed.  ",
    });
    assert.equal(config.body, "Your registration has been confirmed.");
    assert.equal(config.cta, null);
    assert.equal(config.defaultUsed, false);
  });

  it("body + CTA → both present, label case preserved", () => {
    const config = getConfirmationCardConfig({
      confirmation_body: "Join the WhatsApp community group.\nSee you there.",
      confirmation_cta_label: "JOIN WHATSAPP COMMUNITY",
      confirmation_cta_url: "https://chat.whatsapp.com/abc123",
    });
    assert.equal(
      config.body,
      "Join the WhatsApp community group.\nSee you there.",
    );
    assert.deepEqual(config.cta, {
      label: "JOIN WHATSAPP COMMUNITY",
      url: "https://chat.whatsapp.com/abc123",
    });
    assert.equal(config.defaultUsed, false);
  });

  it("CTA only → default body copy stays, button renders", () => {
    const config = getConfirmationCardConfig({
      confirmation_cta_label: "GET TICKETS",
      confirmation_cta_url: "https://example.com/tickets",
    });
    assert.equal(config.body, null);
    assert.ok(config.cta);
    assert.equal(config.defaultUsed, false);
  });

  it("half a CTA → no button (label or url alone is not a button)", () => {
    assert.equal(
      getConfirmationCardConfig({ confirmation_cta_label: "GO" }).cta,
      null,
    );
    assert.equal(
      getConfirmationCardConfig({
        confirmation_cta_url: "https://example.com",
      }).cta,
      null,
    );
  });

  it("non-http(s) CTA urls are dropped (javascript:, mailto:, garbage)", () => {
    for (const url of ["javascript:alert(1)", "mailto:x@y.z", "not a url", ""]) {
      const config = getConfirmationCardConfig({
        confirmation_cta_label: "GO",
        confirmation_cta_url: url,
      });
      assert.equal(config.cta, null, `expected drop: ${url}`);
    }
  });

  it("over-length values are clamped defensively (SQL-authored content)", () => {
    const config = getConfirmationCardConfig({
      confirmation_body: "x".repeat(500),
      confirmation_cta_label: "y".repeat(100),
      confirmation_cta_url: "https://example.com",
    });
    assert.equal(config.body?.length, CONFIRMATION_BODY_MAX);
    assert.equal(config.cta?.label.length, CONFIRMATION_CTA_LABEL_MAX);
  });

  it("non-string junk in the keys → default card", () => {
    const config = getConfirmationCardConfig({
      confirmation_body: 42,
      confirmation_cta_label: ["GO"],
      confirmation_cta_url: { href: "https://x.com" },
    });
    assert.deepEqual(config, { body: null, cta: null, defaultUsed: true });
  });
});
