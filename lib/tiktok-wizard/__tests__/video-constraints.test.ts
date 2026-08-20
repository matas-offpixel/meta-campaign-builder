import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TIKTOK_VIDEO_MAX_BYTES,
  validateTikTokVideoFile,
} from "../video-constraints.ts";

describe("validateTikTokVideoFile", () => {
  it("names the actual extension when the file is rejected", () => {
    const result = validateTikTokVideoFile({ name: "show.mkv", size: 12_000_000 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /\.mkv/);
  });

  it("names the actual size when the file is over 500 MB", () => {
    const result = validateTikTokVideoFile({
      name: "huge.mp4",
      size: TIKTOK_VIDEO_MAX_BYTES + 1024 * 1024,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /501\.0 MB/);
      assert.match(result.error, /500 MB/);
    }
  });

  it("accepts a documented video type under the size cap", () => {
    assert.deepEqual(
      validateTikTokVideoFile({ name: "clip.mov", size: 40 * 1024 * 1024 }),
      { ok: true },
    );
  });
});
