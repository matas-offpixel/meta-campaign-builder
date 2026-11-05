import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { currencyResolver } from "../../learning/currency.ts";
import {
  judgeRound,
  judgingWindow,
  nextRoundPlan,
  type JudgeAdSet,
  type JudgeInput,
  type JudgeRoundAd,
  type RoundPlanInput,
} from "../judge.ts";
import type { JudgeAdDayRow } from "../load.ts";

const ACCT = "act_1058599195559790";
const JUDGED_ON = "2026-11-05";
const BEFORE_WINDOW = "2026-10-20";
const IN_WINDOW = "2026-10-30";
const GBP = currencyResolver(new Map([[ACCT, "GBP"]]));

const ACTION = {
  complete_registration: ["offsite_conversion.fb_pixel_complete_registration", "complete_registration"],
  initiate_checkout: ["offsite_conversion.fb_pixel_initiate_checkout", "initiate_checkout"],
} as const;

type Ad = {
  id: string;
  spend: number;
  impressions: number;
  results?: number;
  /** First delivery; defaults to before the window. */
  from?: string;
};

type SetShape = {
  promotedEvent: string | null;
  objective: string | null;
  goal: string | null;
  metric: keyof typeof ACTION;
};

const SIGNUP: SetShape = {
  promotedEvent: "COMPLETE_REGISTRATION",
  objective: "OUTCOME_LEADS",
  goal: "OFFSITE_CONVERSIONS",
  metric: "complete_registration",
};
const ON_SALE: SetShape = {
  promotedEvent: "INITIATED_CHECKOUT",
  objective: "OUTCOME_SALES",
  goal: "OFFSITE_CONVERSIONS",
  metric: "initiate_checkout",
};

function row(ad: Ad, adSetId: string, shape: SetShape, date: string, spend: number, impressions: number, results: number, account = ACCT): JudgeAdDayRow {
  return {
    ad_account_id: account,
    meta_ad_id: ad.id,
    meta_adset_id: adSetId,
    date,
    ad_name: ad.id,
    campaign_name: null,
    spend,
    impressions,
    link_clicks: 0,
    landing_page_views: 0,
    registrations: 0,
    purchases: 0,
    // Both aliases carry the same count; the judge must not add them.
    actions: results ? ACTION[shape.metric].map((action_type) => ({ action_type, value: String(results) })) : [],
    result_action_type: null,
    campaign_objective: shape.objective,
    optimization_goal: shape.goal,
    promoted_event: shape.promotedEvent,
  };
}

function adSetRows(adSetId: string, shape: SetShape, ads: Ad[], account = ACCT): JudgeAdDayRow[] {
  return ads.flatMap((ad) => {
    const window = row(ad, adSetId, shape, ad.from ?? IN_WINDOW, ad.spend, ad.impressions, ad.results ?? 0, account);
    return ad.from ? [window] : [row(ad, adSetId, shape, BEFORE_WINDOW, 1, 10, 0, account), window];
  });
}

function roundAds(adSetId: string, ads: Ad[], extra: Partial<JudgeRoundAd> = {}): JudgeRoundAd[] {
  return ads.map((ad) => ({ key: ad.id, label: ad.id, launches: [{ metaAdId: ad.id, adSetId }], liveFrom: null, ...extra }));
}

function input(over: Partial<JudgeInput> & Pick<JudgeInput, "rows" | "roundAds">): JudgeInput {
  return {
    judgedOn: JUDGED_ON,
    adSets: new Map(),
    baselines: new Map(),
    currency: GBP,
    dataThrough: "2026-11-04",
    ...over,
  };
}

function verdictOf(result: ReturnType<typeof judgeRound>, key: string) {
  const v = result.verdicts.find((x) => x.key === key);
  assert.ok(v, `no verdict for ${key}`);
  return v;
}

const PRESALE_SET: JudgeAdSet = { phaseAtLaunch: "presale", event: null, clientId: "client-puzzle" };

/** One registration ad set, five ads, £100.50. Fair share 0.2. */
const REG_ADS: Ad[] = [
  { id: "winner", spend: 40, impressions: 4000, results: 20 },
  { id: "dear", spend: 35, impressions: 3500, results: 7 },
  { id: "middle", spend: 20, impressions: 2000, results: 4 },
  { id: "starved", spend: 5, impressions: 1200, results: 0 },
  { id: "unseen", spend: 0.5, impressions: 500, results: 0 },
];

function judgeReg(over: Partial<JudgeInput> = {}, extra: Partial<JudgeRoundAd> = {}) {
  return judgeRound(
    input({
      rows: adSetRows("as-reg", SIGNUP, REG_ADS),
      roundAds: roundAds("as-reg", REG_ADS, extra),
      adSets: new Map([["as-reg", PRESALE_SET]]),
      ...over,
    }),
  );
}

describe("creative lab judge: window", () => {
  it("is the seven days ending three days before the judging day", () => {
    assert.deepEqual(judgingWindow(JUDGED_ON), { start: "2026-10-27", end: "2026-11-02" });
  });
});

describe("creative lab judge: verdicts", () => {
  it("winner: funded past its fair share at a cost per result under the pooled rest", () => {
    const v = verdictOf(judgeReg(), "winner");
    assert.equal(v.verdict, "winner");
    assert.equal(v.resultMetric, "complete_registration");
    assert.equal(v.results, 20);
    assert.equal(v.fairShare, 0.2);
    assert.equal(v.spendShare, 0.398);
    assert.equal(v.costPerResult, 2);
    assert.equal(v.anchorSource, "pooled");
    assert.equal(v.anchorCpr, 5.5);
    assert.equal(v.confirmed, false);
  });

  it("loser: Meta starved it under half its fair share", () => {
    const v = verdictOf(judgeReg(), "starved");
    assert.equal(v.verdict, "loser");
    assert.match(v.reason, /starved/);
  });

  it("flagged: funded but its cost per result is over 1.5× the anchor", () => {
    const v = verdictOf(judgeReg(), "dear");
    assert.equal(v.verdict, "flagged");
    assert.equal(v.costPerResult, 5);
    assert.ok(v.anchorCpr != null && v.costPerResult > 1.5 * v.anchorCpr);
  });

  it("untested: under 1,000 impressions in the window", () => {
    assert.equal(verdictOf(judgeReg(), "unseen").verdict, "untested");
  });

  it("no verdict between half and full fair share", () => {
    const v = verdictOf(judgeReg(), "middle");
    assert.equal(v.verdict, null);
    assert.match(v.reason, /between half and full/);
  });

  it("thin: insights stop short of the window's end", () => {
    const result = judgeReg({ dataThrough: "2026-11-01" });
    for (const key of ["winner", "dear", "middle", "starved"]) assert.equal(verdictOf(result, key).verdict, "thin", key);
    assert.equal(verdictOf(result, "unseen").verdict, "untested");
  });

  it("thin: the ad went live after the window started", () => {
    const ads: Ad[] = [...REG_ADS.slice(0, 4), { id: "late", spend: 30, impressions: 3000, results: 9, from: IN_WINDOW }];
    const result = judgeRound(input({ rows: adSetRows("as-reg", SIGNUP, ads), roundAds: roundAds("as-reg", ads), adSets: new Map([["as-reg", PRESALE_SET]]) }));
    const v = verdictOf(result, "late");
    assert.equal(v.verdict, "thin");
    assert.match(v.reason, /live from 2026-10-30/);
  });

  it("thin: the ad sets spent under £20 in the window", () => {
    const ads: Ad[] = [
      { id: "a", spend: 12, impressions: 2400, results: 5 },
      { id: "b", spend: 6, impressions: 1500, results: 1 },
    ];
    const result = judgeRound(input({ rows: adSetRows("as-small", SIGNUP, ads), roundAds: roundAds("as-small", ads) }));
    assert.equal(verdictOf(result, "a").verdict, "thin");
    assert.match(verdictOf(result, "a").reason, /£18\.00/);
  });

  it("confirmed: a second winning round as the re-test of a winner, on ≥ 10 results", () => {
    assert.equal(verdictOf(judgeReg({}, { retestOfVerdict: "winner" }), "winner").confirmed, true);
    assert.equal(verdictOf(judgeReg({}, { retestOfVerdict: "flagged" }), "winner").confirmed, false);
  });
});

describe("creative lab judge: the live P26 shape", () => {
  // [P26-BDAY] On Sale ad set: nine ads, £36.35 in the window, optimising
  // for INITIATED_CHECKOUT, no purchases anywhere.
  const P26: Ad[] = [
    { id: "ugc3", spend: 22.87, impressions: 3730, results: 12 },
    { id: "ugc1", spend: 3, impressions: 620 },
    { id: "ugc2", spend: 4, impressions: 810, results: 2 },
    { id: "ugc4", spend: 1.5, impressions: 300 },
    { id: "enzo1", spend: 2.98, impressions: 590, results: 1 },
    { id: "enzo2", spend: 1, impressions: 210 },
    { id: "static1", spend: 0.5, impressions: 110 },
    { id: "static2", spend: 0.3, impressions: 70 },
    { id: "static3", spend: 0.2, impressions: 40 },
  ];

  it("a 63% share with 12 checkouts and no purchases is a winner on initiate_checkout, not a loser", () => {
    const result = judgeRound(input({ rows: adSetRows("as-p26", ON_SALE, P26), roundAds: roundAds("as-p26", P26) }));
    assert.deepEqual(
      result.adSets.map((s) => [s.stage, s.resultMetric, s.ads, s.spendGbp, s.results]),
      [["ticket_sale", "initiate_checkout", 9, 36.35, 15]],
    );
    const v = verdictOf(result, "ugc3");
    assert.equal(v.verdict, "winner");
    assert.equal(v.resultMetric, "initiate_checkout");
    assert.equal(v.results, 12);
    assert.equal(v.spendShare, 0.6292);
    assert.equal(v.fairShare, 0.1111);
    assert.equal(v.anchorSource, "pooled");
    assert.equal(verdictOf(result, "static3").verdict, "untested");
  });

  it("with no optimisation event the fallback is purchases, and the same ad is a funded loser", () => {
    const shape = { ...ON_SALE, promotedEvent: null, objective: null, goal: null };
    const result = judgeRound(
      input({
        rows: adSetRows("as-p26", shape, P26),
        roundAds: roundAds("as-p26", P26),
        adSets: new Map([["as-p26", { phaseAtLaunch: "on_sale", event: null, clientId: "client-puzzle" }]]),
      }),
    );
    const v = verdictOf(result, "ugc3");
    assert.deepEqual([v.resultMetric, v.results, v.verdict, v.reason], ["purchase", 0, "loser", "funded, no purchase"]);
  });

  it("a cost per purchase baseline never anchors a cost per checkout", () => {
    const thin = P26.map((ad) => (ad.id === "ugc2" ? { ...ad, results: 1 } : ad));
    const result = judgeRound(
      input({
        rows: adSetRows("as-p26", ON_SALE, thin),
        roundAds: roundAds("as-p26", thin),
        adSets: new Map([["as-p26", { phaseAtLaunch: "on_sale", event: null, clientId: "client-puzzle" }]]),
        baselines: new Map([["client-puzzle|ticket_sale", 50]]),
      }),
    );
    const v = verdictOf(result, "ugc3");
    assert.deepEqual([v.verdict, v.anchorSource, v.reason], ["flagged", null, "funded, no CPR anchor"]);
  });
});

describe("creative lab judge: anchors, ad sets, currency", () => {
  it("uses the client's stage baseline when the rest of the ad set has under three results", () => {
    const ads: Ad[] = [
      { id: "lab", spend: 30, impressions: 3000, results: 6 },
      { id: "x", spend: 12, impressions: 1500, results: 1 },
      { id: "y", spend: 8, impressions: 1100 },
    ];
    const base = { rows: adSetRows("as-base", SIGNUP, ads), roundAds: roundAds("as-base", ads), adSets: new Map([["as-base", PRESALE_SET]]) };
    const withBaseline = verdictOf(judgeRound(input({ ...base, baselines: new Map([["client-puzzle|registration", 6]]) })), "lab");
    assert.deepEqual([withBaseline.verdict, withBaseline.anchorSource, withBaseline.anchorCpr], ["winner", "baseline", 6]);
    const without = verdictOf(judgeRound(input(base)), "lab");
    assert.deepEqual([without.verdict, without.anchorSource], ["flagged", null]);
  });

  it("judges one round ad across every ad set it runs in: spend-weighted fair share, pooled cost", () => {
    const setA: Ad[] = [
      { id: "lab-a", spend: 40, impressions: 4000, results: 10 },
      { id: "a2", spend: 30, impressions: 3000, results: 6 },
      { id: "a3", spend: 20, impressions: 2000, results: 4 },
      { id: "a4", spend: 10, impressions: 1000, results: 2 },
    ];
    const setB: Ad[] = [
      { id: "lab-b", spend: 30, impressions: 3000, results: 6 },
      { id: "b2", spend: 20, impressions: 2000, results: 3 },
    ];
    const lab: JudgeRoundAd = {
      key: "round-ad-1",
      label: "LUKEDEAN-clip01_cap-lineup1",
      liveFrom: "2026-10-20",
      launches: [
        { metaAdId: "lab-a", adSetId: "as-a" },
        { metaAdId: "lab-b", adSetId: "as-b" },
      ],
    };
    const result = judgeRound(input({ rows: [...adSetRows("as-a", SIGNUP, setA), ...adSetRows("as-b", SIGNUP, setB)], roundAds: [lab] }));
    const v = verdictOf(result, "round-ad-1");
    assert.equal(v.adSets, 2);
    assert.equal(v.spendGbp, 70);
    assert.equal(v.adSetSpendGbp, 150);
    assert.equal(v.spendShare, 0.4667);
    assert.equal(v.fairShare, 0.3333);
    assert.equal(v.results, 16);
    assert.equal(v.costPerResult, 4.375);
    assert.equal(v.anchorCpr, 5.3333);
    assert.equal(v.verdict, "winner");
  });

  it("counts a launched ad that never delivered as one of the ad set's ads", () => {
    const ads: Ad[] = [
      { id: "p", spend: 30, impressions: 3000, results: 6 },
      { id: "q", spend: 30, impressions: 3000, results: 6 },
    ];
    const silent: JudgeRoundAd = { key: "silent", label: "silent", liveFrom: "2026-10-20", launches: [{ metaAdId: "never", adSetId: "as-s" }] };
    const result = judgeRound(input({ rows: adSetRows("as-s", SIGNUP, ads), roundAds: [...roundAds("as-s", ads), silent] }));
    assert.equal(result.adSets[0].ads, 3);
    assert.deepEqual([verdictOf(result, "silent").verdict, verdictOf(result, "silent").impressions], ["untested", 0]);
  });

  it("converts spend to GBP before shares and costs", () => {
    const eur = "act_999";
    const ads: Ad[] = [
      { id: "e1", spend: 100, impressions: 5000, results: 10 },
      { id: "e2", spend: 50, impressions: 2500, results: 3 },
    ];
    const result = judgeRound(
      input({ rows: adSetRows("as-eur", SIGNUP, ads, eur), roundAds: roundAds("as-eur", ads), currency: currencyResolver(new Map([[eur, "EUR"]])) }),
    );
    assert.equal(verdictOf(result, "e1").spendGbp, 84.88);
    assert.equal(result.adSets[0].spendGbp, 127.32);
  });
});

describe("creative lab judge: next round", () => {
  it("keeps winning and undecided clips and captions, drops the rest, re-tests unconfirmed winners", () => {
    const ads: RoundPlanInput[] = [
      { clipId: "clip1", captionId: "lineup1", verdict: "winner", confirmed: false },
      { clipId: "clip1", captionId: "question1", verdict: "loser", confirmed: false },
      { clipId: "clip2", captionId: "lineup1", verdict: "flagged", confirmed: false },
      { clipId: "clip2", captionId: "question1", verdict: "loser", confirmed: false },
      { clipId: "clip3", captionId: "scarcity1", verdict: "thin", confirmed: false },
      { clipId: "clip4", captionId: "lineup1", verdict: "winner", confirmed: true },
    ];
    assert.deepEqual(nextRoundPlan(ads), {
      keepClips: ["clip1", "clip3", "clip4"],
      keepCaptions: ["lineup1", "scarcity1"],
      newCaptionsOn: ["clip1", "clip4"],
      newClipsWith: ["lineup1"],
      retest: [{ clipId: "clip1", captionId: "lineup1" }],
      dropClips: ["clip2"],
      dropCaptions: ["question1"],
    });
  });
});
