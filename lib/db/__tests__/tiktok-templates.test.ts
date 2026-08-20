import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { throwIfTikTokTemplateDeleteFailed } from "../tiktok-template-delete.ts";

describe("throwIfTikTokTemplateDeleteFailed", () => {
  it("propagates a delete failure instead of resolving", () => {
    assert.throws(
      () => throwIfTikTokTemplateDeleteFailed({ message: "RLS denied" }),
      /RLS denied/,
    );
  });

  it("does not throw when delete succeeded", () => {
    assert.doesNotThrow(() => throwIfTikTokTemplateDeleteFailed(null));
  });
});
