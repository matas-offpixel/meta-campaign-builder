import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { videoPickerAutoSelectSignature } from "../video-picker-auto-select.ts";

describe("video source picker auto-select signature", () => {
  it("changes when campaign key or video ids change", () => {
    const a = videoPickerAutoSelectSignature("c1,c2", ["v1", "v2"]);
    const b = videoPickerAutoSelectSignature("c1,c2", ["v1", "v2"]);
    assert.equal(a, b);
    assert.notEqual(
      a,
      videoPickerAutoSelectSignature("c1", ["v1", "v2"]),
    );
    assert.notEqual(
      a,
      videoPickerAutoSelectSignature("c1,c2", ["v1"]),
    );
  });
});
