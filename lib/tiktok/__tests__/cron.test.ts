import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyTikTokRetry } from "../client.ts";

describe("TikTok active creatives cron retry policy", () => {
  it("retries TikTok 50001 once before surfacing failure to the cron event loop", () => {
    assert.deepEqual(
      classifyTikTokRetry({ httpStatus: 200, code: 50001, attempt: 0 }),
      { kind: "rate_limit", retry: true, delayMs: 10_000 },
    );
    assert.deepEqual(
      classifyTikTokRetry({ httpStatus: 200, code: 50001, attempt: 1 }),
      { kind: "rate_limit", retry: false, delayMs: 10_000 },
    );
  });
});
