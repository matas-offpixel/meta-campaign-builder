import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { codeSpans } from "../code-spans.ts";

const codes = (text: string) => codeSpans(text).filter((span) => span.code).map((span) => span.text);

describe("codeSpans (an event code never breaks)", () => {
  it("finds the codes in RC-C-393's lines", () => {
    assert.deepEqual(codes("The campaign name says EBR27-GLITTERBOX. This event is NX27-GLITTERBOX."), [
      "EBR27-GLITTERBOX",
      "NX27-GLITTERBOX",
    ]);
    assert.deepEqual(codes("[EBR27-GLITTERBOX] SIGNUP"), ["EBR27-GLITTERBOX"]);
    assert.deepEqual(codes("Rename to [NX27-GLITTERBOX] SIGNUP"), ["NX27-GLITTERBOX"]);
  });

  it("leaves links, pixels and plain words to break as before", () => {
    assert.deepEqual(codes("Still points to Paul Van Dyk: paulvandyk-newcastle.com in 6 ads."), []);
    assert.deepEqual(codes("Pixel …4093 is Electric Bristol’s."), []);
    assert.deepEqual(codes("Artist-voice caption with no OK"), []);
  });

  it("joins back to the same text", () => {
    const text = "Account X isn’t NX Newcastle’s. NX27-GLITTERBOX runs on NX Promoter (NX Newcastle).";
    assert.equal(codeSpans(text).map((span) => span.text).join(""), text);
    assert.deepEqual(codeSpans(""), []);
  });
});
