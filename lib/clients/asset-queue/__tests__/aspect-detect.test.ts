import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseAspectFromFilename } from "../aspect-detect.ts";

describe("parseAspectFromFilename", () => {
  it("maps pixel dimensions to standard ratios", () => {
    assert.equal(parseAspectFromFilename("Bournemouth Generic 1080x1350.jpg"), "4:5");
    assert.equal(parseAspectFromFilename("Bournemouth Generic 1080x1920.jpg"), "9:16");
    assert.equal(parseAspectFromFilename("square-1080x1080.png"), "1:1");
  });

  it("reads literal ratio tokens", () => {
    assert.equal(parseAspectFromFilename("hero-4:5-feed.jpg"), "4:5");
    assert.equal(parseAspectFromFilename("story-9:16.mp4"), "9:16");
  });

  it("maps placement hints", () => {
    assert.equal(parseAspectFromFilename("Bournemouth vertical reel.mp4"), "9:16");
    assert.equal(parseAspectFromFilename("Bournemouth feed post.jpg"), "4:5");
  });

  it("reads compact ratio tokens in filenames", () => {
    assert.equal(parseAspectFromFilename("Hendry4x5.png"), "4:5");
    assert.equal(parseAspectFromFilename("Hendry9x16.png"), "9:16");
  });
});
