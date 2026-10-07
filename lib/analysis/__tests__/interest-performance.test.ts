import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildClusters,
  chooseAccountActionType,
  clientBaselineCpr,
  clusterEvidence,
  clusterKey,
  interestsOfTargeting,
  joinFirstParty,
  parseUtmCsv,
  rankClusters,
  regActionsOf,
  registrationReason,
  type AggregateContext,
  type AnalysisAdSet,
  type InterestReportJson,
} from "../interest-performance.ts";

const REPORT: InterestReportJson = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../docs/analysis/interest-performance-2026-10-06.json"), "utf8"),
);

function adSet(overrides: Partial<AnalysisAdSet> = {}): AnalysisAdSet {
  return {
    id: "1",
    name: "Set",
    accountId: "acc",
    accountName: "Acc",
    currency: "GBP",
    campaignId: "c1",
    campaignName: "[EV1] Signup",
    campaignObjective: "OUTCOME_SALES",
    optimizationGoal: "OFFSITE_CONVERSIONS",
    customEventType: "COMPLETE_REGISTRATION",
    effectiveStatus: "PAUSED",
    startTime: "2026-01-01T00:00:00+0000",
    endTime: null,
    interests: [{ id: "b", name: "B" }, { id: "a", name: "A" }],
    interestsAcrossFlexGroups: false,
    customAudienceCount: 0,
    excludedCustomAudienceCount: 0,
    advantageAudience: false,
    spend: 100,
    impressions: 1000,
    reach: 800,
    linkClicks: 20,
    regActions: { complete_registration: 50 },
    hasInsights: true,
    hasAnyActions: true,
    launched: null,
    clientName: "Client",
    ...overrides,
  };
}

const ctx = (firstParty: AggregateContext["firstParty"] = {}): AggregateContext => ({
  fx: { GBP: 1, EUR: 0.85 },
  chosenType: { acc: "complete_registration" },
  firstParty,
});

describe("interest-performance", () => {
  it("clusters by the sorted interest id set across targeting.interests and flexible_spec", () => {
    const { interests, acrossFlexGroups } = interestsOfTargeting({
      interests: [{ id: "9", name: "Nine" }],
      flexible_spec: [{ interests: [{ id: "3", name: "Three" }] }, { interests: [{ id: "1" }, { id: "9" }] }],
    });
    assert.deepEqual(interests.map((i) => i.id), ["1", "3", "9"]);
    assert.equal(acrossFlexGroups, true);
    assert.equal(clusterKey(["9", "1", "3", "1"]), "1,3,9");
  });

  it("classifies registration ad sets and excludes purchase", () => {
    assert.equal(registrationReason(adSet()), "promoted_object");
    assert.equal(
      registrationReason(adSet({ customEventType: null, optimizationGoal: "LEAD_GENERATION", campaignObjective: "OUTCOME_LEADS" })),
      "optimization_goal",
    );
    assert.equal(
      registrationReason(adSet({ customEventType: "PURCHASE", launched: { phaseAtLaunch: "signup" } as AnalysisAdSet["launched"] })),
      "phase_at_launch",
    );
    assert.equal(registrationReason(adSet({ customEventType: "PURCHASE" })), null);
  });

  it("picks one action type per account by total and never sums", () => {
    const rows = [
      adSet({ id: "1", regActions: { lead: 10 } }),
      adSet({ id: "2", regActions: { lead: 5 } }),
      adSet({ id: "3", regActions: { complete_registration: 40, "offsite_conversion.fb_pixel_complete_registration": 40 } }),
    ];
    const f = chooseAccountActionType("acc", "Acc", rows);
    assert.equal(f.chosen, "complete_registration");
    assert.equal(f.otherTypeOnly, 2);
    assert.deepEqual(regActionsOf([{ action_type: "lead", value: "3" }, { action_type: "link_click", value: "9" }]), { lead: 3 });
  });

  it("marks thin clusters and ranks non-thin by CPR then regs per £100", () => {
    const rows = [
      adSet({ id: "1" }),
      adSet({ id: "2" }),
      adSet({ id: "3" }),
      adSet({ id: "4", interests: [{ id: "z", name: "Z" }], spend: 20, regActions: { complete_registration: 40 } }),
    ];
    const clusters = buildClusters(rows, ctx());
    const ab = clusters.find((c) => c.key === "a,b")!;
    const z = clusters.find((c) => c.key === "z")!;
    assert.equal(ab.thin, false);
    assert.equal(ab.cpr, 2);
    assert.equal(ab.cprSource, "pixel");
    assert.equal(z.thin, true);
    const ranked = rankClusters([
      { key: "x", cpr: 2, regsPer100Gbp: 40, spendGbp: 200 },
      { key: "y", cpr: 2, regsPer100Gbp: 50, spendGbp: 200 },
      { key: "n", cpr: null, regsPer100Gbp: 0, spendGbp: 500 },
    ]);
    assert.deepEqual(ranked.map((r) => r.key), ["y", "x", "n"]);
  });

  it("uses first-party CPR only when measured spend covers the cluster", () => {
    const rows = [adSet({ id: "1" }), adSet({ id: "2" }), adSet({ id: "3" })];
    const full = buildClusters(rows, ctx({ "1": { signups: 40 }, "2": { signups: 40 }, "3": { signups: 40 } }))[0];
    assert.equal(full.cprSource, "first_party");
    assert.equal(full.cpr, 2.5);
    const partial = buildClusters(rows, ctx({ "1": { signups: 40 } }))[0];
    assert.equal(partial.cprSource, "pixel");
  });

  it("joins utm_campaign to campaigns and credits ad sets only when the ratio is plausible", () => {
    const rows = [
      adSet({ id: "11", name: "Disco", campaignId: "c1", campaignName: "[EV1] Signup", regActions: { complete_registration: 100 } }),
      adSet({ id: "12", name: "House", campaignId: "c1", campaignName: "[EV1] Signup", regActions: { complete_registration: 0 } }),
      adSet({ id: "21", name: "Disco", campaignId: "c2", campaignName: "[EV2] Signup", regActions: { complete_registration: 2 } }),
      adSet({ id: "31", name: "Wide", campaignId: "c3", campaignName: "[EV3] Signup", regActions: { complete_registration: 10 } }),
    ];
    const csv = [
      "page_slug,crm_base_tag,utm_campaign,utm_content,meta_sourced,count,first_seen,last_seen",
      "p,t,[ev1] signup,Disco,true,95,,",
      "p,t,[EV2] Signup,Disco,true,90,,",
      "p,t,c3,,true,11,,",
      "p,t,Unknown,x,true,4,,",
    ].join("\n");
    const result = joinFirstParty(rows, parseUtmCsv(csv), { chosenType: { acc: "complete_registration" } });
    const byId = new Map(result.campaigns.map((c) => [c.campaignId, c]));
    assert.equal(byId.get("c1")!.adSetLevel, "per_ad_set");
    assert.deepEqual(result.adSets["11"], { signups: 95 });
    assert.deepEqual(result.adSets["12"], { signups: 0 });
    assert.equal(byId.get("c2")!.ratioOutOfRange, true);
    assert.equal(result.adSets["21"], undefined);
    assert.equal(byId.get("c3")!.matchedBy, "campaign_id");
    assert.equal(byId.get("c3")!.adSetLevel, "campaign-level only");
    assert.equal(result.unmatchedPaidSignups, 4);
  });

  it("thin counts only ad sets with at least £5 spend", () => {
    const funded = [adSet({ id: "1", spend: 100 }), adSet({ id: "2", spend: 100 })];
    const [twoPlusCrumb] = buildClusters([...funded, adSet({ id: "3", spend: 1.44 })], ctx());
    assert.equal(twoPlusCrumb.adSets, 3);
    assert.equal(twoPlusCrumb.fundedAdSets, 2);
    assert.equal(twoPlusCrumb.thin, true);
    const [three] = buildClusters([...funded, adSet({ id: "3", spend: 5 })], ctx());
    assert.equal(three.fundedAdSets, 3);
    assert.equal(three.thin, false);
  });

  it("client baseline is pooled spend ÷ registrations, thin clusters included", () => {
    const rows = [adSet({ id: "1", spend: 100 }), adSet({ id: "2", spend: 2, regActions: { complete_registration: 10 } })];
    assert.deepEqual(clientBaselineCpr(rows, ctx()), { spendGbp: 102, registrations: 60, baselineCpr: 1.7 });
    assert.equal(clientBaselineCpr([adSet({ regActions: {} })], ctx()).baselineCpr, null);

    const dhb = REPORT.perClient.find((p) => p.client === "Deep House Bible")!;
    assert.ok(Math.abs(dhb.spendGbp - dhb.clusters.reduce((n, c) => n + c.spendGbp, 0)) < 0.05);
    assert.equal(dhb.registrations, dhb.clusters.reduce((n, c) => n + c.registrations, 0));
    assert.equal(dhb.baselineCpr, Math.round((dhb.spendGbp / dhb.registrations) * 100) / 100);
    assert.equal(dhb.baselineCpr, 1.34);
    const fashion = "467691106721833,6003030212255,6003154507633,6003266266843,6003351852600,6003359659004,6003359784404,6003392552125,6003552041427,6003739371891";
    const ev = clusterEvidence(REPORT, fashion, { client: "Deep House Bible" })!.evidence;
    assert.equal(ev.clientBaselineCpr, 1.34);
    assert.equal(ev.cprIndex, Math.round((ev.cprPixel! / 1.34) * 100) / 100);
    assert.equal(ev.confidence, "thin");
  });

  it("cprIndex divides pixel CPR even when the headline CPR is first-party", () => {
    const discGenre = "6003155409305,6003320931941";
    const { cluster, evidence } = clusterEvidence(REPORT, discGenre)!;
    assert.equal(evidence.cprSource, "first_party");
    assert.equal(evidence.cpr, cluster.cprFirstPartyGbp);
    assert.equal(evidence.cprPixel, cluster.cprPixelGbp);
    assert.notEqual(evidence.cpr, evidence.cprPixel);
    assert.equal(evidence.cprIndex, Math.round((cluster.cprPixelGbp! / evidence.clientBaselineCpr!) * 100) / 100);
  });
});
