import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { parseGoogleAdsError } from "../retry.ts";

class BrokenGoogleAdsError extends Error {
  readonly requestId = "request-1";

  constructor() {
    super("undefined undefined: undefined");
  }
}

describe("parseGoogleAdsError", () => {
  it("replaces google-ads-api's broken undefined template message", () => {
    const parsed = parseGoogleAdsError(new BrokenGoogleAdsError());

    assert.equal(parsed.message.includes("undefined undefined: undefined"), false);
    assert.equal(parsed.message.includes("BrokenGoogleAdsError"), true);
  });
});
