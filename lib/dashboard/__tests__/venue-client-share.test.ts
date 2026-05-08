import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { shouldShowVenueClientShare } from "../venue-client-share.ts";

describe("shouldShowVenueClientShare", () => {
  it("shows when internal flag is set and client id is present", () => {
    assert.equal(shouldShowVenueClientShare("abc", true), true);
  });

  it("hides when not internal", () => {
    assert.equal(shouldShowVenueClientShare("abc", false), false);
  });

  it("hides when client id missing", () => {
    assert.equal(shouldShowVenueClientShare(null, true), false);
    assert.equal(shouldShowVenueClientShare("", true), false);
  });
});
