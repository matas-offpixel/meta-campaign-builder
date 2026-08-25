import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canAutoFillDestinationUrl,
  destinationUrlsMatch,
  shouldNudgeOffFunnel,
} from "../lp-destination.ts";
import { WIZARD_DESTINATION_URL_FIELDS } from "../lp-destination-fields.ts";

const LP = "https://app.offpixel.co.uk/l/gmc/mallorca";
const TICKETS = "https://tickets.example.com/event";

describe("canAutoFillDestinationUrl — never overwrite a typed URL", () => {
  it("empty field can be filled", () => {
    assert.equal(canAutoFillDestinationUrl("", LP), true);
    assert.equal(canAutoFillDestinationUrl("   ", LP), true);
  });

  it("already-the-LP is a no-op fill, not an overwrite", () => {
    assert.equal(canAutoFillDestinationUrl(LP, LP), true);
    assert.equal(canAutoFillDestinationUrl(`${LP}/`, LP), true);
  });

  it("operator-typed other URL is never overwritten", () => {
    assert.equal(canAutoFillDestinationUrl(TICKETS, LP), false);
    assert.equal(canAutoFillDestinationUrl("https://ra.co/events/1", LP), false);
  });
});

describe("shouldNudgeOffFunnel — only when an LP exists and is unused", () => {
  it("no LP → no nudge", () => {
    assert.equal(shouldNudgeOffFunnel({ lpUrl: null, chosenUrl: TICKETS }), false);
    assert.equal(shouldNudgeOffFunnel({ lpUrl: "", chosenUrl: TICKETS }), false);
  });

  it("empty field is not off-funnel (not yet chosen)", () => {
    assert.equal(shouldNudgeOffFunnel({ lpUrl: LP, chosenUrl: "" }), false);
  });

  it("LP chosen → no nudge", () => {
    assert.equal(shouldNudgeOffFunnel({ lpUrl: LP, chosenUrl: LP }), false);
    assert.equal(shouldNudgeOffFunnel({ lpUrl: LP, chosenUrl: `${LP}/` }), false);
  });

  it("non-LP URL while an LP exists → nudge", () => {
    assert.equal(shouldNudgeOffFunnel({ lpUrl: LP, chosenUrl: TICKETS }), true);
  });
});

describe("destinationUrlsMatch", () => {
  it("treats trailing slash as the same destination", () => {
    assert.equal(destinationUrlsMatch(LP, `${LP}/`), true);
    assert.equal(destinationUrlsMatch(TICKETS, LP), false);
  });
});

describe("one-click fill contract (per wizard field)", () => {
  for (const field of WIZARD_DESTINATION_URL_FIELDS) {
    it(`${field.id}: click-fill sets an empty field to the canonical URL`, () => {
      const current = "";
      assert.equal(canAutoFillDestinationUrl(current, LP), true);
      const next = canAutoFillDestinationUrl(current, LP) ? LP : current;
      assert.equal(next, LP);
    });

    it(`${field.id}: typed URL survives a suggested-URL pass`, () => {
      const current = TICKETS;
      const next = canAutoFillDestinationUrl(current, LP) ? LP : current;
      assert.equal(next, TICKETS);
    });

    it(`${field.id}: nudge only when LP exists and is unused`, () => {
      assert.equal(
        shouldNudgeOffFunnel({ lpUrl: LP, chosenUrl: TICKETS }),
        true,
      );
      assert.equal(
        shouldNudgeOffFunnel({ lpUrl: null, chosenUrl: TICKETS }),
        false,
      );
      assert.equal(
        shouldNudgeOffFunnel({ lpUrl: LP, chosenUrl: LP }),
        false,
      );
    });
  }
});
