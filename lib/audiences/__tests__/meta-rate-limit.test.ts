import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  audienceSourceRateLimitBody,
  isMetaAdAccountRateLimitError,
} from "../meta-rate-limit.ts";

describe("isMetaAdAccountRateLimitError", () => {
  it("returns true for MetaApiError-shaped #80004 subcode", () => {
    assert.equal(
      isMetaAdAccountRateLimitError({
        name: "MetaApiError",
        message: "Account request limit reached",
        subcode: 80004,
      }),
      true,
    );
  });

  it("returns false for unrelated errors", () => {
    assert.equal(isMetaAdAccountRateLimitError(new Error("nope")), false);
    assert.equal(
      isMetaAdAccountRateLimitError({
        name: "MetaApiError",
        message: "Other",
        code: 190,
      }),
      false,
    );
  });
});

describe("audienceSourceRateLimitBody", () => {
  it("matches the API contract for source routes", () => {
    const body = audienceSourceRateLimitBody();
    assert.equal(body.error, "rate_limited");
    assert.equal(body.retryAfterMinutes, 30);
    assert.match(body.message, /rate-limit/i);
  });
});
