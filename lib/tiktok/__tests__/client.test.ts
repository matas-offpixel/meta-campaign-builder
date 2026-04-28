import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { classifyTikTokRetry } from "../client.ts";

describe("classifyTikTokRetry", () => {
  it("retries TikTok 50001 rate limits exactly once with a 10s delay", () => {
    assert.deepEqual(
      classifyTikTokRetry({ httpStatus: 200, code: 50001, attempt: 0 }),
      { kind: "rate_limit", retry: true, delayMs: 10_000 },
    );
    assert.deepEqual(
      classifyTikTokRetry({ httpStatus: 200, code: 50001, attempt: 1 }),
      { kind: "rate_limit", retry: false, delayMs: 10_000 },
    );
  });

  it("retries 5xx responses through the transient budget", () => {
    assert.equal(
      classifyTikTokRetry({ httpStatus: 503, attempt: 0 }).retry,
      true,
    );
    assert.equal(
      classifyTikTokRetry({ httpStatus: 503, attempt: 1 }).retry,
      true,
    );
    assert.equal(
      classifyTikTokRetry({ httpStatus: 503, attempt: 2 }).retry,
      false,
    );
  });

  it("does not retry auth or validation 4xx responses", () => {
    assert.deepEqual(
      classifyTikTokRetry({ httpStatus: 401, code: 40100, attempt: 0 }),
      { kind: "none", retry: false, delayMs: 0 },
    );
    assert.deepEqual(
      classifyTikTokRetry({ httpStatus: 400, code: 40002, attempt: 0 }),
      { kind: "none", retry: false, delayMs: 0 },
    );
  });
});
