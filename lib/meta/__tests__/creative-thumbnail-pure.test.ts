import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  metaPlaceholderSvgBytes,
  storagePathForAd,
} from "../creative-thumbnail-pure.ts";

describe("creative-thumbnail-cache", () => {
  it("storagePathForAd maps jpeg content-type to jpg extension", () => {
    assert.equal(storagePathForAd("123456789", "image/jpeg"), "123456789.jpg");
    assert.equal(storagePathForAd("123456789", "image/png"), "123456789.png");
  });

  it("metaPlaceholderSvgBytes produces SVG xml with Meta blue fill", () => {
    const buf = metaPlaceholderSvgBytes("Test Campaign");
    const s = buf.toString("utf-8");
    assert.ok(s.includes("<?xml"));
    assert.ok(s.includes("#1877F2"));
    assert.ok(s.includes("Test Campaign"));
  });

  it("metaPlaceholderSvgBytes strips unsafe characters from label", () => {
    const buf = metaPlaceholderSvgBytes("<script>x</script>");
    const s = buf.toString("utf-8");
    assert.ok(!s.includes("<script>"));
  });
});
