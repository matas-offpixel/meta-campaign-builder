import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  failedAdLabelsFromSummary,
  isRetryableMetaTransient,
  META_TRANSIENT_RETRY_BACKOFF_MS,
  META_TRANSIENT_RETRY_MAX,
  metaTransientTraceId,
  RETRY_FAILED_ADS_CONFIRM,
  withMetaTransientRetry,
} from "../transient-retry.ts";

describe("isRetryableMetaTransient", () => {
  it("retries code 2, is_transient flag, and the retry-later message", () => {
    assert.equal(isRetryableMetaTransient({ code: 2, message: "Service temporarily unavailable" }), true);
    assert.equal(
      isRetryableMetaTransient({
        code: 1,
        is_transient: true,
        message: "An unexpected error has occurred.",
      }),
      true,
    );
    assert.equal(
      isRetryableMetaTransient({
        code: 1,
        rawErrorData: { is_transient: true },
        message: "An unexpected error has occurred.",
      }),
      true,
    );
    assert.equal(
      isRetryableMetaTransient({
        code: 1,
        message: "An unexpected error has occurred. Please retry your request later.",
      }),
      true,
    );
  });

  it("never retries non-transient errors", () => {
    assert.equal(isRetryableMetaTransient({ code: 100, message: "Invalid parameter" }), false);
    assert.equal(isRetryableMetaTransient({ code: 190, message: "Invalid OAuth access token" }), false);
    assert.equal(isRetryableMetaTransient({ code: 200, message: "Permissions error" }), false);
    assert.equal(isRetryableMetaTransient({ message: "Creative type does not match the objective" }), false);
    assert.equal(isRetryableMetaTransient(null), false);
    assert.equal(isRetryableMetaTransient("string"), false);
  });

  it("never treats rate-limit codes as #856 transient-retryable, even with is_transient", () => {
    for (const code of [4, 17, 32, 341, 613, 80004]) {
      assert.equal(
        isRetryableMetaTransient({
          code,
          is_transient: true,
          message: "Application request limit reached",
        }),
        false,
        `code ${code}`,
      );
    }
    assert.equal(
      isRetryableMetaTransient({
        code: 4,
        subcode: 80004,
        is_transient: true,
        message: "(#80004) Rate limited",
      }),
      false,
    );
    assert.equal(
      isRetryableMetaTransient({
        code: 1,
        rawErrorData: { error_subcode: 2446079, is_transient: true },
        message: "Quota",
      }),
      false,
    );
  });
});

describe("withMetaTransientRetry", () => {
  it("succeeds on a later attempt and sleeps the documented backoff", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const result = await withMetaTransientRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw {
            code: 2,
            message: "Please retry your request later.",
            fbtraceId: `trace_${attempts}`,
          };
        }
        return "ad_1";
      },
      { opKind: "ad_create", label: "Creative A → Prospecting" },
      async (ms) => {
        delays.push(ms);
      },
    );
    assert.equal(result, "ad_1");
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [2_000, 8_000]);
  });

  it("is bounded at 3 retries (4 attempts) and then throws", async () => {
    const delays: number[] = [];
    let attempts = 0;
    await assert.rejects(
      withMetaTransientRetry(
        async () => {
          attempts += 1;
          throw {
            code: 2,
            message: "Please retry your request later.",
            fbtraceId: "AbCd",
          };
        },
        { opKind: "adset_create" },
        async (ms) => {
          delays.push(ms);
        },
      ),
    );
    assert.equal(attempts, META_TRANSIENT_RETRY_MAX + 1);
    assert.deepEqual(delays, [...META_TRANSIENT_RETRY_BACKOFF_MS]);
    assert.equal(delays.length, 3);
  });

  it("does not sleep or retry a #4 rate limit even when is_transient", async () => {
    let attempts = 0;
    const delays: number[] = [];
    await assert.rejects(
      withMetaTransientRetry(
        async () => {
          attempts += 1;
          throw {
            code: 4,
            is_transient: true,
            message: "Application request limit reached",
            fbtraceId: "buc",
          };
        },
        { opKind: "ad_create" },
        async (ms) => {
          delays.push(ms);
        },
      ),
    );
    assert.equal(attempts, 1);
    assert.deepEqual(delays, []);
  });

  it("does not sleep or retry a non-transient failure", async () => {
    let attempts = 0;
    const delays: number[] = [];
    await assert.rejects(
      withMetaTransientRetry(
        async () => {
          attempts += 1;
          throw { code: 100, message: "Invalid parameter", fbtraceId: "nope" };
        },
        { opKind: "ad_create" },
        async (ms) => {
          delays.push(ms);
        },
      ),
    );
    assert.equal(attempts, 1);
    assert.deepEqual(delays, []);
  });

  it("reads the Meta trace id from fbtraceId or rawErrorData", () => {
    assert.equal(metaTransientTraceId({ fbtraceId: "AAA" }), "AAA");
    assert.equal(metaTransientTraceId({ rawErrorData: { fbtrace_id: "BBB" } }), "BBB");
    assert.equal(metaTransientTraceId({ code: 2 }), null);
  });
});

describe("retry surface copy and wiring", () => {
  it("lists failed ads by creative → ad set and includes the DOD confirm sentence", () => {
    const labels = failedAdLabelsFromSummary({
      adSetsFailed: [{ name: "Lookalike 1%" }],
      creativesCreated: [
        {
          name: "Kayode 9x16",
          adsFailed: [{ adSetName: "Prospecting" }, { adSetName: "Retargeting" }],
        },
      ],
    });
    assert.deepEqual(labels, [
      "Ad set: Lookalike 1%",
      "Kayode 9x16 → Prospecting",
      "Kayode 9x16 → Retargeting",
    ]);
    assert.match(RETRY_FAILED_ADS_CONFIRM, /manually in Ads Manager/);
    assert.match(RETRY_FAILED_ADS_CONFIRM, /duplicate/);
    assert.match(RETRY_FAILED_ADS_CONFIRM, /DOD/);
  });

  it("retry surface is absent when nothing failed", () => {
    assert.deepEqual(failedAdLabelsFromSummary({ creativesCreated: [], adSetsFailed: [] }), []);
    const review = readFileSync("components/steps/review-launch.tsx", "utf8");
    assert.match(review, /RetryFailedAdsPanel/);
    assert.match(review, /failedLedgerCount === 0/);
    assert.match(review, /RETRY_FAILED_ADS_CONFIRM/);
  });

  it("launch route retries ad and ad-set creates inside the ledger wrap", () => {
    const route = readFileSync("app/api/meta/launch-campaign/route.ts", "utf8");
    assert.match(route, /withMetaTransientRetry/);
    assert.match(route, /adset_create|ad_create/);
    assert.match(route, /withMetaWriteIdempotency/);
    assert.match(
      route,
      /opKind === "adset_create" \|\| opKind === "ad_create"/,
    );
  });

  it("exposes a session-auth ledger inventory for the retry surface", () => {
    const route = readFileSync("app/api/meta/launch-retry/route.ts", "utf8");
    assert.match(route, /listFailedMetaWrites/);
    assert.match(route, /draftId/);
    assert.match(route, /Unauthorised/);
  });

  it("#856 retry re-enters launch-campaign's shared prepare/validator — no parallel CA check", () => {
    const wizard = readFileSync("components/wizard/wizard-shell.tsx", "utf8");
    const review = readFileSync("components/steps/review-launch.tsx", "utf8");
    const launch = readFileSync("app/api/meta/launch-campaign/route.ts", "utf8");
    const retry = readFileSync("app/api/meta/launch-retry/route.ts", "utf8");
    assert.match(wizard, /onRetryFailedAds=\{handleLaunch\}/);
    assert.match(review, /RetryFailedAdsPanel/);
    assert.match(launch, /prepareAdSetPayloadForCreate/);
    assert.match(launch, /receiptAudienceIds/);
    assert.doesNotMatch(retry, /fetchCustomAudienceAvailability|prepareAdSetPayloadForCreate/);
  });
});
