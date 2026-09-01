/**
 * Unmatched [CODE] guard — FOLMAOUR / FOLAMOUR class.
 * Run: node --test lib/insights/__tests__/unmatched-campaign-code.test.ts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { notify, type NotifyDeps, type NotifyResult } from "../../notify/slack.ts";
import { parseBracketedEventCode } from "../meta-event-code-match.ts";
import {
  UNMATCHED_CAMPAIGN_SPEND_FLOOR_MAJOR,
  evaluateUnmatchedCampaigns,
  nearestEventCodes,
  notifyUnmatchedCampaigns,
  unmatchedCampaignDedupeKey,
  type CampaignSpendRow,
  type EventCodeCatalogRow,
} from "../unmatched-campaign-code.ts";

const PARENT = "c581a4f";

const CATALOG: EventCodeCatalogRow[] = [
  { eventCode: "NX26-FOLAMOUR", status: "on_sale" },
  { eventCode: "NX26-DOD", status: "live" },
  { eventCode: "IPC-NEWCASTLE", status: "upcoming" },
  { eventCode: "OLD-DONE", status: "completed" },
];

const FOLMAOUR: CampaignSpendRow = {
  campaignId: "camp_folmaour",
  campaignName: "[NX26-FOLMAOUR] FOLMAOUR - Signup",
  adAccountId: "act_123",
  spendMajor: 541.36,
};

function notifyDeps(overrides: Partial<NotifyDeps> = {}): {
  deps: NotifyDeps;
  posts: { count: number };
  keys: string[];
} {
  const firedAt = new Map<string, number>();
  const keys: string[] = [];
  const posts = { count: 0 };
  const now = new Date("2026-09-01T12:00:00Z");
  const deps: NotifyDeps = {
    now,
    isMasterKillswitchOn: () => true,
    isChannelEnabled: () => true,
    getWebhookUrl: () => "https://hooks.slack.test/unmatched",
    postToSlack: async () => {
      posts.count += 1;
      return { ok: true, status: 200 };
    },
    checkDedupe: async (key, windowMs, at) => {
      const last = firedAt.get(key);
      if (last != null && at.getTime() - last < windowMs) {
        return { shouldSkip: true, reason: "deduped" };
      }
      return { shouldSkip: false };
    },
    recordFire: async (key) => {
      keys.push(key);
      firedAt.set(key, now.getTime());
    },
    ...overrides,
  };
  return { deps, posts, keys };
}

describe("parse + evaluate unmatched campaigns", () => {
  it("parses the FOLMAOUR typo prefix", () => {
    assert.equal(parseBracketedEventCode(FOLMAOUR.campaignName), "NX26-FOLMAOUR");
  });

  it("unmatched-with-spend above the floor produces one finding", () => {
    const findings = evaluateUnmatchedCampaigns([FOLMAOUR], CATALOG);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.parsedCode, "NX26-FOLMAOUR");
    assert.equal(findings[0]!.spendMajor, 541.36);
    assert.equal(findings[0]!.campaignId, "camp_folmaour");
  });

  it("matched campaigns produce none", () => {
    const matched: CampaignSpendRow = {
      campaignId: "camp_ok",
      campaignName: "[NX26-FOLAMOUR] FOLAMOUR - Signup",
      adAccountId: "act_123",
      spendMajor: 541.36,
    };
    assert.deepEqual(evaluateUnmatchedCampaigns([matched], CATALOG), []);
  });

  it("campaigns with spend but no [CODE] stay silent", () => {
    assert.deepEqual(
      evaluateUnmatchedCampaigns(
        [
          {
            campaignId: "camp_plain",
            campaignName: "FOLMAOUR - Signup",
            adAccountId: "act_123",
            spendMajor: 541.36,
          },
        ],
        CATALOG,
      ),
      [],
    );
  });

  it("zero-spend unmatched stays silent", () => {
    assert.deepEqual(
      evaluateUnmatchedCampaigns([{ ...FOLMAOUR, spendMajor: 0 }], CATALOG),
      [],
    );
  });

  it("spend below the named floor stays silent", () => {
    assert.equal(UNMATCHED_CAMPAIGN_SPEND_FLOOR_MAJOR, 25);
    assert.deepEqual(
      evaluateUnmatchedCampaigns([{ ...FOLMAOUR, spendMajor: 12 }], CATALOG),
      [],
    );
  });

  it("code that only matches a completed event is unmatched", () => {
    const findings = evaluateUnmatchedCampaigns(
      [
        {
          campaignId: "camp_old",
          campaignName: "[OLD-DONE] leftover",
          adAccountId: "act_123",
          spendMajor: 80,
        },
      ],
      CATALOG,
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.parsedCode, "OLD-DONE");
  });
});

describe("near-miss ranking", () => {
  it("ranks NX26-FOLAMOUR first for the FOLMAOUR/FOLAMOUR shape", () => {
    const ranked = nearestEventCodes("NX26-FOLMAOUR", CATALOG);
    assert.equal(ranked[0], "NX26-FOLAMOUR");
  });
});

describe("notify + dedupe", () => {
  it("unmatched-with-spend produces exactly one alarm per dedupe window", async () => {
    const findings = evaluateUnmatchedCampaigns([FOLMAOUR], CATALOG);
    const { deps, posts, keys } = notifyDeps();
    const results: NotifyResult[] = [];
    const notifyFn = async (opts: Parameters<typeof notify>[0]) => {
      const result = await notify(opts, deps);
      results.push(result);
      return result;
    };

    const first = await notifyUnmatchedCampaigns(findings, notifyFn);
    const second = await notifyUnmatchedCampaigns(findings, notifyFn);

    assert.equal(first.alarmed, 1);
    assert.equal(second.alarmed, 1);
    assert.equal(results[0]?.sent, true, JSON.stringify(results));
    assert.equal(results[1]?.reason, "deduped");
    assert.equal(first.sent, 1);
    assert.equal(second.sent, 0);
    assert.equal(posts.count, 1);
    assert.deepEqual(keys, [
      unmatchedCampaignDedupeKey("camp_folmaour", "NX26-FOLMAOUR"),
    ]);
  });

  it("matched campaigns produce no notify call", async () => {
    const findings = evaluateUnmatchedCampaigns(
      [
        {
          campaignId: "camp_ok",
          campaignName: "[NX26-FOLAMOUR] FOLAMOUR - Signup",
          adAccountId: "act_123",
          spendMajor: 541.36,
        },
      ],
      CATALOG,
    );
    const calls: unknown[] = [];
    await notifyUnmatchedCampaigns(findings, async (opts) => {
      calls.push(opts);
      return { sent: true } satisfies NotifyResult;
    });
    assert.equal(findings.length, 0);
    assert.equal(calls.length, 0);
  });
});

describe("parent-sha falsify + observer-only", () => {
  it("parent sha has no unmatched-campaign alarm", () => {
    const parentTick = execFileSync("git", ["show", `${PARENT}:app/api/cron/rollup-sync-events/route.ts`], {
      encoding: "utf8",
    });
    assert.doesNotMatch(parentTick, /unmatchedCampaign|unmatched-campaign-code/);
    let missing = false;
    try {
      execFileSync("git", ["show", `${PARENT}:lib/insights/unmatched-campaign-code.ts`], {
        encoding: "utf8",
      });
    } catch {
      missing = true;
    }
    assert.equal(missing, true);
  });

  it("this tree observes and reports — no Meta write, no rename", () => {
    const scan = readFileSync("lib/dashboard/unmatched-campaign-code-scan.ts", "utf8");
    assert.doesNotMatch(scan, /graphPost|daily_budget|rename|POST \//);
    const route = readFileSync("app/api/cron/rollup-sync-events/route.ts", "utf8");
    assert.match(route, /runUnmatchedCampaignCodeGuard/);
    const unmatched = readFileSync("lib/insights/unmatched-campaign-code.ts", "utf8");
    assert.match(unmatched, /notifyUnmatchedCampaigns/);
    assert.match(unmatched, /channel: "ads_ops"/);
    const match = readFileSync("lib/insights/meta-event-code-match.ts", "utf8");
    assert.match(match, /export function campaignMatchesBracketedEventCode/);
  });
});
