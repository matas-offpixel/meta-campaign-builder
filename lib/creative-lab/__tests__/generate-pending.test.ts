import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { generateButtonLabel } from "../surface.ts";

const source = readFileSync(new URL("../../../components/dashboard/events/creative-lab/captions.tsx", import.meta.url), "utf8");

describe("Generate's pending label", () => {
  it("reads Writing… only while that call is in flight, not while the card is busy", () => {
    assert.equal(generateButtonLabel(false), "Generate");
    assert.equal(generateButtonLabel(true), "Writing…");
    assert.match(source, /disabled=\{busy\}/);
    assert.match(source, /generateButtonLabel\(writing\)/);
    assert.equal(source.includes("generateButtonLabel(busy)"), false);
    const click = source.slice(source.indexOf('action: "generate"') - 400, source.indexOf('action: "generate"') + 500);
    assert.match(click, /setWriting\(true\)/);
    assert.match(click, /\.finally\(\(\) => setWriting\(false\)\)/);
    assert.equal(source.split("setWriting(true)").length - 1, 1);
  });
});
