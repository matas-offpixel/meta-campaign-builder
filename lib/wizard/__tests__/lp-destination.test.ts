import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canAutoFillDestinationUrl,
  destinationHelperKind,
  destinationHelperText,
  destinationUrlsMatch,
  shouldNudgeOffFunnel,
  wizardDestinationChrome,
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

describe("destinationHelperKind — one line, never both why and nudge", () => {
  it("ready + unused LP is nudge, not why", () => {
    assert.equal(
      destinationHelperKind({
        state: "ready",
        offerUrl: true,
        lpUrl: LP,
        chosenUrl: TICKETS,
      }),
      "nudge",
    );
  });

  it("ready + empty field is why, not nudge", () => {
    assert.equal(
      destinationHelperKind({
        state: "ready",
        offerUrl: true,
        lpUrl: LP,
        chosenUrl: "",
      }),
      "why",
    );
  });
});

function renderChrome(input: Parameters<typeof wizardDestinationChrome>[0]): string {
  const chrome = wizardDestinationChrome(input);
  const parts: string[] = [];
  if (chrome.action === "use") parts.push("Use event page");
  const text = destinationHelperText(chrome.helper);
  if (text) parts.push(text);
  return parts.join("\n");
}

describe("wizardDestinationChrome — consume, do not create", () => {
  it("(a) ready page → offered, one helper line", () => {
    const empty = wizardDestinationChrome({
      state: "ready",
      offerUrl: true,
      lpUrl: LP,
      chosenUrl: "",
    });
    assert.equal(empty.action, "use");
    assert.equal(empty.helper, "why");
    assert.equal(destinationHelperText(empty.helper), "views and signups become measurable in your funnel.");

    const off = wizardDestinationChrome({
      state: "ready",
      offerUrl: true,
      lpUrl: LP,
      chosenUrl: TICKETS,
    });
    assert.equal(off.action, "use");
    assert.equal(off.helper, "nudge");
    assert.notEqual(off.helper, "why");
  });

  it("(b) draft / unconfigured / none → no create affordance in rendered output", () => {
    for (const state of ["draft", "unconfigured", "none"] as const) {
      const rendered = renderChrome({
        state,
        offerUrl: false,
        lpUrl: state === "none" ? null : LP,
        chosenUrl: "",
      });
      assert.equal(rendered, "", `${state} must render nothing`);
      assert.doesNotMatch(rendered, /create|publish/i);
      const chrome = wizardDestinationChrome({
        state,
        offerUrl: false,
        lpUrl: state === "none" ? null : LP,
        chosenUrl: TICKETS,
      });
      assert.deepEqual(chrome, { action: null, helper: null });
    }
  });

  it("(c) pasted arbitrary URL passes through to the draft untouched", () => {
    for (const pasted of [
      TICKETS,
      "https://ra.co/events/1",
      "https://dice.fm/event/jamie-jones",
    ]) {
      const next = canAutoFillDestinationUrl(pasted, LP) ? LP : pasted;
      assert.equal(next, pasted);
    }
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
