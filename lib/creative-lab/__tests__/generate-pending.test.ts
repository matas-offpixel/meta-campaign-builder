import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { generateButtonLabel, generateFailureSentence } from "../surface.ts";

const source = readFileSync(new URL("../../../components/dashboard/events/creative-lab/captions.tsx", import.meta.url), "utf8");

describe("Generate's pending label", () => {
  it("reads Writing… only while that call is in flight, not while the card is busy", () => {
    assert.equal(generateButtonLabel(false, 3), "Write 3");
    assert.equal(generateButtonLabel(true, 3), "Writing…");
    assert.match(source, /disabled=\{busy \|\| writing\}/);
    assert.match(source, /generateButtonLabel\(true, count\)/);
    assert.equal(source.includes("generateButtonLabel(busy)"), false);
    assert.equal(source.includes("Loader2"), false);
    const click = source.slice(source.indexOf('action: "generate"') - 400, source.indexOf('action: "generate"') + 500);
    assert.match(click, /setWriting\(true\)/);
    assert.match(click, /\.finally\(\(\) => setWriting\(false\)\)/);
    assert.equal(source.split("setWriting(true)").length - 1, 1);
    assert.match(click, /\.catch\(\(\) =>/);
    assert.match(source, /generateFailureSentence/);
    assert.equal(generateFailureSentence("TypeError: Failed to fetch"), "The captions didn't write — try again.");
    assert.equal(generateFailureSentence("Headliners aren't set."), "Headliners aren't set.");
  });
});
