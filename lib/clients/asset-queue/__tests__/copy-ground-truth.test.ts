import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCopyPromptBundle } from "../copy-generator.ts";

const BASE_INPUT = {
  assetName: "Colin Hendry Assets Glasgow",
  mediaType: "Graphic",
  funnel: "BOFU",
  location: "Scotland",
  eventName: "WC26 Glasgow O2",
  eventCode: "WC26-GLASGOW-O2",
  venueName: "O2 Academy Glasgow",
  venueCity: "Glasgow",
};

describe("buildCopyPromptBundle ground-truth constraints", () => {
  it("system prompt forbids inventing venues and fixtures", () => {
    const { system } = buildCopyPromptBundle(BASE_INPUT);
    assert.match(system, /NEVER invent or assume venue names/i);
    assert.match(system, /NEVER invent fixtures, opponents/i);
  });

  it("user prompt lists venue name and city as ground truth", () => {
    const { user } = buildCopyPromptBundle(BASE_INPUT);
    assert.match(user, /Venue name \(use exactly if provided\): O2 Academy Glasgow/);
    assert.match(user, /Venue city \(use exactly if provided\): Glasgow/);
    assert.match(user, /ONLY the ground-truth fields above/);
  });

  it("venue-wide prompt still includes ground-truth rules", () => {
    const { system, user } = buildCopyPromptBundle({
      ...BASE_INPUT,
      assetName: "Bournemouth Tickets Loading Bar",
    });
    assert.match(system, /do NOT mention a specific fixture/i);
    assert.match(user, /no invented venues, cities, fixtures, or opponents/i);
  });
});
