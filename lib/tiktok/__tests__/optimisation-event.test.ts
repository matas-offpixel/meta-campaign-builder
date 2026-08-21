import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatTikTokOptimisationEventLabel,
  isUnsupportedTikTokOptimisationEvent,
} from "../optimisation-event.ts";

describe("isUnsupportedTikTokOptimisationEvent", () => {
  it("denies CONVERSIONS + ON_WEB_REGISTER and leaves FORM / TRAFFIC alone", () => {
    assert.equal(
      isUnsupportedTikTokOptimisationEvent("CONVERSIONS", "ON_WEB_REGISTER"),
      true,
    );
    assert.equal(
      isUnsupportedTikTokOptimisationEvent("CONVERSIONS", "FORM"),
      false,
    );
    assert.equal(
      isUnsupportedTikTokOptimisationEvent("TRAFFIC", "ON_WEB_REGISTER"),
      false,
    );
    assert.equal(
      isUnsupportedTikTokOptimisationEvent("LEAD_GENERATION", "ON_WEB_REGISTER"),
      false,
    );
    assert.equal(
      isUnsupportedTikTokOptimisationEvent("LEAD_GENERATION", "CONTACT"),
      false,
    );
  });

  it("treats COMPLETE_REGISTRATION and Contact as the same denied pairing", () => {
    assert.equal(
      isUnsupportedTikTokOptimisationEvent("CONVERSIONS", "COMPLETE_REGISTRATION"),
      true,
    );
    assert.equal(
      isUnsupportedTikTokOptimisationEvent("CONVERSIONS", "CONTACT"),
      true,
    );
    assert.equal(
      isUnsupportedTikTokOptimisationEvent(
        "CONVERSIONS",
        "weird_code",
        "Complete registration",
      ),
      true,
    );
    assert.equal(
      isUnsupportedTikTokOptimisationEvent("CONVERSIONS", "weird_code", "Contact"),
      true,
    );
    assert.equal(
      isUnsupportedTikTokOptimisationEvent("CONVERSIONS", "CONSULT"),
      false,
    );
  });

  it("marks denied picker rows without dropping them", () => {
    assert.equal(
      formatTikTokOptimisationEventLabel(
        { optimization_event: "ON_WEB_REGISTER", name: "Complete registration" },
        "CONVERSIONS",
      ),
      "Complete registration · ON_WEB_REGISTER (no longer supported for Conversions)",
    );
    assert.equal(
      formatTikTokOptimisationEventLabel(
        { optimization_event: "FORM", name: "Submit form" },
        "CONVERSIONS",
      ),
      "Submit form · FORM",
    );
  });
});
