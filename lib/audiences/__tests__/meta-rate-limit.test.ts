import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  audienceSourceRateLimitBody,
  isMetaAdAccountRateLimitError,
} from "../meta-rate-limit.ts";

/** Minimal duck-type matching MetaApiError fields used by meta-rate-limit.ts */
function metaErr(props: {
  message: string;
  code?: number;
  subcode?: number;
}): Record<string, unknown> {
  return { name: "MetaApiError", ...props };
}

describe("isMetaAdAccountRateLimitError", () => {
  it("detects per-account subcode 80004", () => {
    assert.ok(
      isMetaAdAccountRateLimitError(
        metaErr({ message: "(#80004) Rate limited", code: 4, subcode: 80004 }),
      ),
    );
  });

  it("detects per-user code 17", () => {
    assert.ok(
      isMetaAdAccountRateLimitError(
        metaErr({ message: "(17) User request limit reached", code: 17 }),
      ),
    );
  });

  it("detects per-app code 4", () => {
    assert.ok(
      isMetaAdAccountRateLimitError(
        metaErr({
          message: "(4) Application request limit reached",
          code: 4,
        }),
      ),
    );
  });

  it("detects User request limit from message when code omitted", () => {
    assert.ok(
      isMetaAdAccountRateLimitError(metaErr({ message: "User request limit reached" })),
    );
  });

  it("detects Application request limit from message", () => {
    assert.ok(
      isMetaAdAccountRateLimitError(
        metaErr({ message: "Application request limit reached" }),
      ),
    );
  });

  it("detects subcode 2446079", () => {
    assert.ok(
      isMetaAdAccountRateLimitError(
        metaErr({ message: "Quota", code: 4, subcode: 2446079 }),
      ),
    );
  });

  it("returns false for unrelated Meta errors", () => {
    assert.equal(
      isMetaAdAccountRateLimitError(metaErr({ message: "Invalid OAuth token", code: 190 })),
      false,
    );
  });

  it("returns false for non-Meta errors", () => {
    assert.equal(isMetaAdAccountRateLimitError(new Error("network")), false);
  });
});

describe("audienceSourceRateLimitBody", () => {
  it("scopes message to user account for code 17", () => {
    const body = audienceSourceRateLimitBody(
      metaErr({ message: "(17) User request limit reached", code: 17 }),
    );
    assert.match(body.message, /user account/i);
    assert.match(body.message, /30-60/);
  });

  it("scopes message to app for code 4 without ad-account subcode", () => {
    const body = audienceSourceRateLimitBody(
      metaErr({
        message: "(4) Application request limit reached",
        code: 4,
      }),
    );
    assert.match(body.message, /this app/i);
  });

  it("prefers ad account when code 4 is paired with subcode 80004", () => {
    const body = audienceSourceRateLimitBody(
      metaErr({ message: "(#80004)", code: 4, subcode: 80004 }),
    );
    assert.match(body.message, /ad account/i);
  });

  it("defaults to ad account when err omitted", () => {
    const body = audienceSourceRateLimitBody();
    assert.match(body.message, /ad account/i);
  });
});
