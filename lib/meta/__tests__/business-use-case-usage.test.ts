import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  BUC_PRELAUNCH_WARN_PERCENT,
  formatBusinessUseCaseLimitMessage,
  isBucPrelaunchWarning,
  parseBusinessUseCaseUsageHeader,
  pickAdsManagementBucket,
  resumeAtIsoFromEtaMinutes,
} from "../app-usage.ts";
import {
  buildRateLimitUiState,
  classifyRateLimitShape,
  formatCooldownLabel,
  isMetaRateLimitCode,
  remainingCooldownMs,
  uiStateFromBucket,
} from "../rate-limit-ui.ts";
import { classifyLaunchMetaCode } from "../launch-error-classify.ts";
import { classifyMetaCode } from "../meta-error-classify.ts";

const DOD_HEADER = JSON.stringify({
  act_606252931141334: [
    {
      type: "ads_management",
      call_count: 100,
      total_cputime: 72,
      total_time: 55,
      estimated_time_to_regain_access: 47,
    },
  ],
});

describe("parseBusinessUseCaseUsageHeader", () => {
  it("parses a present ads_management bucket with ETA", () => {
    const snap = parseBusinessUseCaseUsageHeader(DOD_HEADER);
    assert.ok(snap);
    assert.equal(snap.buckets.length, 1);
    const b = snap.buckets[0];
    assert.equal(b.adAccountId, "act_606252931141334");
    assert.equal(b.type, "ads_management");
    assert.equal(b.callCountPercent, 100);
    assert.equal(b.totalCpuTimePercent, 72);
    assert.equal(b.totalTimePercent, 55);
    assert.equal(b.maxPercent, 100);
    assert.equal(b.estimatedTimeToRegainAccessMinutes, 47);
  });

  it("returns null when the header is absent or malformed", () => {
    assert.equal(parseBusinessUseCaseUsageHeader(null), null);
    assert.equal(parseBusinessUseCaseUsageHeader(undefined), null);
    assert.equal(parseBusinessUseCaseUsageHeader(""), null);
    assert.equal(parseBusinessUseCaseUsageHeader("not json"), null);
    assert.equal(parseBusinessUseCaseUsageHeader("[]"), null);
    assert.equal(parseBusinessUseCaseUsageHeader("{}"), null);
  });

  it("keeps multiple ad-account entries and prefixes bare ids", () => {
    const snap = parseBusinessUseCaseUsageHeader(
      JSON.stringify({
        "606252931141334": [
          { type: "ads_management", call_count: 90, total_cputime: 10, total_time: 10 },
        ],
        act_999: [
          {
            type: "ads_insights",
            call_count: 40,
            total_cputime: 40,
            total_time: 40,
            estimated_time_to_regain_access: 5,
          },
        ],
      }),
    );
    assert.ok(snap);
    assert.equal(snap.buckets.length, 2);
    assert.equal(snap.buckets[0].adAccountId, "act_606252931141334");
    assert.equal(snap.buckets[1].adAccountId, "act_999");
    assert.equal(snap.buckets[0].estimatedTimeToRegainAccessMinutes, null);
  });

  it("coerces numeric strings and keeps a missing ETA as null", () => {
    const snap = parseBusinessUseCaseUsageHeader(
      JSON.stringify({
        act_1: [
          {
            type: "ads_management",
            call_count: "81",
            total_cputime: "20",
            total_time: "30",
          },
        ],
      }),
    );
    assert.ok(snap);
    assert.equal(snap.buckets[0].callCountPercent, 81);
    assert.equal(snap.buckets[0].estimatedTimeToRegainAccessMinutes, null);
  });

  it("skips entries with no type", () => {
    assert.equal(
      parseBusinessUseCaseUsageHeader(
        JSON.stringify({ act_1: [{ call_count: 100 }] }),
      ),
      null,
    );
  });
});

describe("formatBusinessUseCaseLimitMessage + prelaunch threshold", () => {
  it("names account, bucket, percent, and Meta's ETA — never 'few minutes'", () => {
    const snap = parseBusinessUseCaseUsageHeader(DOD_HEADER);
    const bucket = pickAdsManagementBucket(snap, "act_606252931141334");
    assert.ok(bucket);
    const msg = formatBusinessUseCaseLimitMessage(bucket, "NX Promoter");
    assert.equal(msg, "NX Promoter ads_management at 100% — access returns in ~47 min");
    assert.doesNotMatch(msg, /few minutes/i);
  });

  it("falls back to act_ id and no invented ETA when Meta omitted it", () => {
    const snap = parseBusinessUseCaseUsageHeader(
      JSON.stringify({
        act_1: [{ type: "ads_management", call_count: 100, total_cputime: 0, total_time: 0 }],
      }),
    );
    const bucket = pickAdsManagementBucket(snap);
    assert.ok(bucket);
    const msg = formatBusinessUseCaseLimitMessage(bucket);
    assert.match(msg, /act_1 ads_management at 100%/);
    assert.doesNotMatch(msg, /few minutes/i);
    assert.doesNotMatch(msg, /access returns in/);
  });

  it("warns at 80% and not at 79%", () => {
    assert.equal(BUC_PRELAUNCH_WARN_PERCENT, 80);
    assert.equal(isBucPrelaunchWarning(80), true);
    assert.equal(isBucPrelaunchWarning(100), true);
    assert.equal(isBucPrelaunchWarning(79), false);
  });

  it("resumeAtIsoFromEtaMinutes is null when ETA is missing or 0", () => {
    assert.equal(resumeAtIsoFromEtaMinutes(null), null);
    assert.equal(resumeAtIsoFromEtaMinutes(0), null);
    const now = Date.parse("2026-08-28T10:00:00.000Z");
    assert.equal(resumeAtIsoFromEtaMinutes(47, now), "2026-08-28T10:47:00.000Z");
  });
});

describe("dialog UI state names account + bucket + ETA", () => {
  it("buildRateLimitUiState prefers the BUC header over a generic #4", () => {
    const snap = parseBusinessUseCaseUsageHeader(DOD_HEADER);
    const state = buildRateLimitUiState({
      code: 4,
      buc: snap,
      adAccountId: "606252931141334",
      accountLabel: "NX Promoter",
      nowMs: Date.parse("2026-08-28T10:00:00.000Z"),
    });
    assert.equal(state.kind, "business_use_case");
    assert.equal(state.bucket, "ads_management");
    assert.equal(state.adAccountId, "act_606252931141334");
    assert.equal(state.estimatedTimeToRegainAccessMinutes, 47);
    assert.equal(state.resumeAt, "2026-08-28T10:47:00.000Z");
    assert.equal(
      state.message,
      "NX Promoter ads_management at 100% — access returns in ~47 min",
    );
  });

  it("uiStateFromBucket is the dialog body source", () => {
    const snap = parseBusinessUseCaseUsageHeader(DOD_HEADER);
    const bucket = pickAdsManagementBucket(snap);
    assert.ok(bucket);
    const state = uiStateFromBucket(bucket, { accountLabel: "NX Promoter" });
    assert.match(state.message, /NX Promoter/);
    assert.match(state.message, /ads_management/);
    assert.match(state.message, /~47 min/);
  });

  it("cooldown helpers format remaining time", () => {
    assert.equal(formatCooldownLabel(47 * 60_000), "47m 00s");
    assert.equal(formatCooldownLabel(5_000), "5s");
    assert.equal(
      remainingCooldownMs("2026-08-28T10:47:00.000Z", Date.parse("2026-08-28T10:00:00.000Z")),
      47 * 60_000,
    );
  });
});

/**
 * Inventory of every distinct rate-limit shape the launch path can receive
 * and how it is classified after this PR. Anything previously "other" or
 * "session expired" for these codes is a regression.
 */
describe("launch-path rate-limit inventory", () => {
  const rows: Array<{
    shape: string;
    code?: number;
    subcode?: number;
    kind: "rate_limit";
    ui: ReturnType<typeof classifyRateLimitShape>;
  }> = [
    { shape: "code 4 (app / BUC envelope)", code: 4, kind: "rate_limit", ui: "app" },
    { shape: "code 4 + sub 80004", code: 4, subcode: 80004, kind: "rate_limit", ui: "ad_account" },
    { shape: "code 80004", code: 80004, kind: "rate_limit", ui: "ad_account" },
    { shape: "code 17", code: 17, kind: "rate_limit", ui: "user" },
    { shape: "code 32", code: 32, kind: "rate_limit", ui: "page" },
    { shape: "code 341", code: 341, kind: "rate_limit", ui: "app" },
    { shape: "code 613", code: 613, kind: "rate_limit", ui: "ad_account" },
    { shape: "subcode 2446079", subcode: 2446079, kind: "rate_limit", ui: "app" },
  ];

  for (const row of rows) {
    it(`${row.shape} → named rate_limit, never auth/session-expired`, () => {
      if (typeof row.code === "number") {
        assert.equal(classifyLaunchMetaCode(row.code), "rate_limit", row.shape);
        assert.equal(classifyMetaCode(row.code), "rate_limit", row.shape);
      }
      assert.equal(isMetaRateLimitCode(row.code, row.subcode), true, row.shape);
      assert.equal(classifyRateLimitShape(row.code, row.subcode), row.ui, row.shape);
    });
  }

  it("auth codes stay auth (reconnect), not rate_limit", () => {
    assert.equal(classifyLaunchMetaCode(190), "auth");
    assert.equal(classifyLaunchMetaCode(102), "auth");
    assert.equal(isMetaRateLimitCode(190), false);
  });
});

describe("parent-sha falsify: BUC header was unread", () => {
  const PARENT = "3cc60c2";

  it("parent app-usage.ts has no parseBusinessUseCaseUsageHeader", () => {
    const parent = execFileSync("git", ["show", `${PARENT}:lib/meta/app-usage.ts`], {
      encoding: "utf8",
    });
    assert.doesNotMatch(parent, /parseBusinessUseCaseUsageHeader/);
    assert.doesNotMatch(parent, /X-Business-Use-Case-Usage/);
  });

  it("this tree reads x-business-use-case-usage on every graph helper", () => {
    const client = readFileSync("lib/meta/client.ts", "utf8");
    assert.match(client, /x-business-use-case-usage/);
    assert.match(client, /parseBusinessUseCaseUsageHeader/);
    assert.match(client, /recordUsageHeaders/);
    const review = readFileSync("components/steps/review-launch.tsx", "utf8");
    assert.match(review, /buc-prelaunch-warning/);
    assert.match(review, /launch-error-message/);
    assert.match(review, /Retry in \$\{/);
    const usage = readFileSync("app/api/meta/usage/route.ts", "utf8");
    assert.match(usage, /fields: "name"/);
    assert.match(usage, /pickAdsManagementBucket/);
    const launch = readFileSync("app/api/meta/launch-campaign/route.ts", "utf8");
    assert.match(launch, /rateLimitJsonResponse/);
    assert.match(launch, /status: 429/);
    const hook = readFileSync("lib/hooks/useLaunchCampaign.ts", "utf8");
    assert.match(hook, /!errBody.rateLimited && \(errBody.tokenExpired/);
  });
});
