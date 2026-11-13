import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { quoteStyleVersion } from "../../../src/remotion/caption-style/quote-profile.ts";
import { wantsFiling } from "../filing.ts";

describe("old quote renders are not filed", () => {
  it("skips a render whose style_version is the quote profile", async () => {
    const version = await quoteStyleVersion();
    const now = new Date("2026-11-13T12:00:00Z");
    const row = {
      status: "done" as const,
      drive_status: null,
      drive_next_attempt_at: null,
      drive_render_attempt: null,
      attempt: 1,
      style_version: version,
    };
    assert.equal(wantsFiling(row, now, version), false);
    assert.equal(wantsFiling({ ...row, style_version: "caption-style" }, now, version), true);
  });
});
