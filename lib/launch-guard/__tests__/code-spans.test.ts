import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { codeSpans } from "../code-spans.ts";

const whole = (text: string) => codeSpans(text).filter((span) => span.whole).map((span) => span.text);

describe("codeSpans (values that never break)", () => {
  it("event codes in RC-C-393's lines", () => {
    assert.deepEqual(whole("The campaign name says EBR27-GLITTERBOX. This event is NX27-GLITTERBOX."), [
      "EBR27-GLITTERBOX",
      "NX27-GLITTERBOX",
    ]);
    assert.deepEqual(whole("[EBR27-GLITTERBOX] SIGNUP"), ["EBR27-GLITTERBOX"]);
    assert.deepEqual(whole("Rename to [NX27-GLITTERBOX] SIGNUP"), ["NX27-GLITTERBOX"]);
  });

  it("the pixel ending, parentheses and all", () => {
    assert.deepEqual(whole("Pixel …4093 is Electric Bristol’s. NX27-GLITTERBOX is at NX Newcastle (…2763)."), [
      "…4093",
      "NX27-GLITTERBOX",
      "(…2763)",
    ]);
    assert.deepEqual(whole("Use …2763"), ["…2763"]);
  });

  it("a domain stays whole; the rest of a link may still break", () => {
    assert.deepEqual(whole("Still points to Paul Van Dyk: paulvandyk-newcastle.com in 6 ads."), ["paulvandyk-newcastle.com"]);
    assert.deepEqual(
      whole("Link isn’t this event’s page: skiddle.com/e/41877 in 12 ads. The event’s page is crqln.com/l/glitterbox-newcastle."),
      ["skiddle.com", "crqln.com"],
    );
    assert.deepEqual(whole("Use the event’s page: https://dod-newcastle.com/tickets"), ["dod-newcastle.com"]);
  });

  it("leaves plain words and lists to break as before", () => {
    assert.deepEqual(whole("Artist-voice caption with no OK from Glitterbox’s team: 4 ads."), []);
    assert.deepEqual(whole("Links in: Lineup Adv+ · Static 1, Static 2, Video 1, Video 2 … and 2 more"), []);
    assert.deepEqual(whole("in 6 ads. The event’s page"), []);
    assert.deepEqual(whole("Primary text in: Artist · teaser-1"), []);
  });

  it("joins back to the same text", () => {
    const text = "Pixel …4093 is X’s. NX27-GLITTERBOX is at Y (…2763). See paulvandyk-newcastle.com/a-b.";
    assert.equal(codeSpans(text).map((span) => span.text).join(""), text);
    assert.deepEqual(codeSpans(""), []);
  });
});
