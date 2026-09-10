import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { logUnmatchedCandidates } from "../unmatched-candidates.ts";

describe("logUnmatchedCandidates", () => {
  it("errors when no alternate matched", () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      logUnmatchedCandidates("/identity/get/ avatar", [
        "profile_image",
        "avatar_url",
      ]);
    } finally {
      console.error = original;
    }
    assert.equal(lines.length, 1);
    assert.equal(
      lines[0],
      "[tiktok/unmatched] /identity/get/ avatar none of [profile_image, avatar_url] matched",
    );
  });
});
