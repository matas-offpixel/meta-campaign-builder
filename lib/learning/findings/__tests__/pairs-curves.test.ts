import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { curveRows, phaseCurve } from "../phase-curve.ts";
import { hasPhaseData, phaseOf, phaseStartDay } from "../phase.ts";
import { normaliseName, readAxis, siblingAxis } from "../variant-axes.ts";
import { PAIRS, campaignEventCode, compare, findPairs, pairRow, type PairAdDay } from "../variant-pairs.ts";
import { AD_DAYS, EVENTS, GLITTERBOX_DAYS } from "./pairs-fixtures.ts";

const events = new Map(Object.entries(EVENTS));
const ctx = { eventId: "e1", clientId: "c1", gbpRate: 1, currency: "GBP", computedAt: "2026-11-23T04:15:00.000Z" };

describe("phaseOf: events.announcement_at / presale_at / general_sale_at, London days", () => {
  const ewan = EVENTS["NX27-EWANMCVICAR"]!;
  const glitter = EVENTS["EBR27-GLITTERBOX"]!;

  it("a mid-day boundary takes effect the next London day", () => {
    assert.equal(phaseStartDay("2026-11-18 17:00:00+00"), "2026-11-19");
    assert.equal(phaseOf(ewan, "2026-11-16"), "teaser");
    assert.equal(phaseOf(ewan, "2026-11-18"), "teaser");
    assert.equal(phaseOf(ewan, "2026-11-19"), "announced");
    assert.equal(phaseOf(glitter, "2026-11-17"), "teaser");
    assert.equal(phaseOf(glitter, "2026-11-18"), "announced");
  });

  it("presale and general sale on the same day leave presale with no day, never an error", () => {
    assert.equal(phaseOf(ewan, "2026-11-20"), "announced");
    assert.equal(phaseOf(ewan, "2026-11-21"), "general_sale");
    assert.equal(phaseOf(glitter, "2026-11-19"), "announced");
    assert.equal(phaseOf(glitter, "2026-11-20"), "general_sale");
    for (const day of ["2026-11-12", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-30"]) assert.notEqual(phaseOf(ewan, day), "presale");
  });

  it("a presale on its own day reads presale", () => {
    const ipc = { announcement_at: "2026-08-11T16:00:00+00:00", presale_at: "2026-08-13T11:00:00+00:00", general_sale_at: "2026-08-14T11:00:00+00:00" };
    assert.equal(phaseOf(ipc, "2026-08-13"), "announced");
    assert.equal(phaseOf(ipc, "2026-08-14"), "presale");
    assert.equal(phaseOf(ipc, "2026-08-15"), "general_sale");
  });

  it("a boundary at 00:00 London is that day's, in GMT and in BST", () => {
    assert.equal(phaseStartDay("2026-11-20T00:00:00Z"), "2026-11-20");
    assert.equal(phaseStartDay("2026-07-01T23:00:00Z"), "2026-07-02");
    assert.equal(phaseStartDay("2026-07-01T23:30:00Z"), "2026-07-03");
  });

  it("no announcement_at is unknown, whatever else is set: never guessed", () => {
    for (const code of ["P26-BDAY", "NX26-ROBBIEDOHERTY", "NX26-SCHAK", "I26-NYC"]) {
      assert.equal(hasPhaseData(EVENTS[code]), false, code);
      assert.equal(phaseOf(EVENTS[code], "2026-11-20"), "unknown", code);
    }
    assert.equal(phaseOf(null, "2026-11-20"), "unknown");
  });

  it("a missing presale goes straight from announced to general sale; a boundary before the one it follows is ignored", () => {
    const noPresale = { announcement_at: "2026-11-01T10:00:00Z", presale_at: null, general_sale_at: "2026-11-05T10:00:00Z" };
    assert.equal(phaseOf(noPresale, "2026-11-04"), "announced");
    assert.equal(phaseOf(noPresale, "2026-11-06"), "general_sale");
    const backwards = { announcement_at: "2026-11-10T10:00:00Z", presale_at: "2026-11-01T10:00:00Z", general_sale_at: "2026-11-12T10:00:00Z" };
    assert.equal(phaseOf(backwards, "2026-11-11"), "announced");
    assert.equal(phaseOf(backwards, "2026-11-13"), "general_sale");
  });
});

describe("variant axes: the brief's vocabulary", () => {
  it("normalises double spaces and strips a copy marker", () => {
    assert.equal(normaliseName("NX Loves  - Static"), "nx loves - static");
    assert.equal(normaliseName("[AB-B] Promo Vid - No Text – Copy 2"), "[ab-b] promo vid - no text");
    assert.equal(normaliseName("Static – Copy"), "static");
  });

  it("finds the one axis two names differ on", () => {
    assert.deepEqual(siblingAxis("NX Loves  - Static", "NX Loves  - Static with date"), { axis: "date", sideA: "no_date", sideB: "with_date" });
    assert.deepEqual(siblingAxis("Glitterbox  - static", "Glitterbox  - static - date"), { axis: "date", sideA: "no_date", sideB: "with_date" });
    assert.deepEqual(siblingAxis("Artist - Static", "Artist - Static - date"), { axis: "date", sideA: "no_date", sideB: "with_date" });
    assert.deepEqual(siblingAxis("NX Loves  - Promo vid", "NX Loves  - Promo vid no text"), { axis: "text", sideA: "with_text", sideB: "no_text" });
    assert.deepEqual(siblingAxis("Puzzle - Static CTA", "Puzzle - Static no CTA"), { axis: "cta", sideA: "cta", sideB: "no_cta" });
    assert.deepEqual(siblingAxis("Teaser - Static", "Teaser - Video"), { axis: "format", sideA: "static", sideB: "video" });
    assert.deepEqual(siblingAxis("[AB-A] Venue - UGC 1", "[AB-B] Venue - UGC 1"), { axis: "ab", sideA: "ab_a", sideB: "ab_b" });
  });

  it("never pairs names that differ on two axes, a copy of the same ad, or a word inside a word", () => {
    assert.equal(siblingAxis("NX Loves  - Promo vid no text", "NX Loves  - Promo vid with date"), null);
    assert.equal(siblingAxis("NX Loves - Static", "NX Loves - Static – Copy"), null);
    assert.equal(siblingAxis("Puzzle - Static CTA", "Puzzle - Static"), null);
    assert.equal(siblingAxis("Context ad", "Con ad"), null);
    assert.equal(readAxis("Glitterbox  - static - date", "date").rest, "glitterbox - static");
  });
});

describe("variant pairs: like with like (23 Nov acceptance)", () => {
  const { pairs, notCompared } = findPairs({ days: AD_DAYS, events });
  const reason = (adsetName: string, axis: string) => notCompared.filter((n) => n.adsetName === adsetName && n.axis === axis).map((n) => n.reason);

  it("NX27-EWANMCVICAR Tech House Pages: Promo vid vs Promo vid no text, teaser, 16–18 Nov", () => {
    assert.equal(pairs.length, 1);
    const p = pairs[0]!;
    assert.deepEqual([p.eventCode, p.adsetName, p.axis, p.axisSource, p.phase, p.stage, p.result], ["NX27-EWANMCVICAR", "Tech House Pages", "text", "name", "teaser", "registration", "complete_registration"]);
    assert.deepEqual(p.overlapDays, ["2026-11-16", "2026-11-17", "2026-11-18"]);
    // Arm a is the axis's first side (no text); only the overlap days count (19–20 Nov left out).
    assert.deepEqual([p.a.label, p.a.side, p.a.spend, p.a.results], ["NX Loves - Promo vid no text", "no_text", 18.58, 25]);
    assert.deepEqual([p.b.label, p.b.side, p.b.spend, p.b.results], ["NX Loves - Promo vid", "with_text", 22.97, 36]);
    assert.equal(p.ratio, 1.1648);
    assert.equal(p.ratioBound, "exact");
    assert.equal(p.verdict, "with_text_cheaper");
    assert.equal(p.confidence, "ok");
    const row = pairRow(p, ctx);
    assert.equal(row.kind, "variant_pair");
    assert.equal(row.subject, "120252630584870755|text|nx loves - promo vid no text|nx loves - promo vid");
    assert.equal(row.week_start, "2026-11-16");
    assert.deepEqual([row.value_a, row.value_b, row.spend_gbp, row.results, row.n_pairs], [0.7432, 0.6381, 41.55, 61, 1]);
    assert.equal((row.evidence as { axis_source: string }).axis_source, "name");
  });

  it("NEGATIVE: NX Loves Static (17–18) vs Static with date (18–19) is not compared", () => {
    assert.deepEqual(reason("Data", "date"), ["1 overlapping delivery day (needs 3)"]);
  });

  it("NEGATIVE: Glitterbox static (12–17) vs static - date (17–19) is not compared", () => {
    assert.deepEqual(reason("Lifestyle", "date").filter((r) => r.startsWith("1 ")), ["1 overlapping delivery day (needs 3)"]);
    assert.ok(!pairs.some((p) => p.eventCode === "EBR27-GLITTERBOX"));
  });

  it("NEGATIVE: LP Rhythm Artist - Static vs Artist - Static - date is not compared", () => {
    assert.deepEqual(reason("Wide", "date"), ["1 overlapping delivery day (needs 3)"]);
  });

  it("an arm under £10 on the overlap days is not compared (Ewan Lifestyle)", () => {
    assert.deepEqual(reason("Lifestyle", "text"), ["under £10 on the overlap days (NX Loves - Promo vid no text £5.79, NX Loves - Promo vid £8.31)"]);
    assert.equal(PAIRS.minArmSpendGbp, 10);
  });

  it("a pair whose overlap crosses a phase boundary is not compared", () => {
    // Tech House Pages' arms moved a day later: 17–19 Nov runs teaser → announced.
    const shifted = AD_DAYS.filter((d) => d.adset_name === "Tech House Pages").map((d) => ({ ...d, date: d.date.replace(/-(\d\d)$/, (_m, dd: string) => `-${String(Number(dd) + 1).padStart(2, "0")}`), spend: Number(d.spend) + 10 }));
    const out = findPairs({ days: shifted, events });
    assert.equal(out.pairs.length, 0);
    assert.deepEqual(out.notCompared.map((n) => n.reason), ["phase changed on the overlap days (teaser → announced)"]);
  });

  it("a show with no phase data is not compared; nor is a campaign with no event code", () => {
    const asP26 = AD_DAYS.filter((d) => d.adset_name === "Tech House Pages").map((d) => ({ ...d, campaign_name: "[P26-BDAY] Puzzle - Signup" }));
    assert.deepEqual(findPairs({ days: asP26, events }).notCompared.map((n) => n.reason), ["no phase data (no announcement_at)"]);
    const noCode = AD_DAYS.filter((d) => d.adset_name === "Tech House Pages").map((d) => ({ ...d, campaign_name: "Signup" }));
    assert.deepEqual(findPairs({ days: noCode, events }).notCompared.map((n) => n.reason), ["no event code in the campaign name"]);
  });

  it("ad sets in show test campaigns are RP1's, never pairs", () => {
    const test: PairAdDay[] = AD_DAYS.filter((d) => d.adset_name === "Tech House Pages").map((d) => ({ ...d, campaign_name: "NX27-EWANMCVICAR · AB copy test" }));
    assert.deepEqual(findPairs({ days: test, events }), { pairs: [], notCompared: [] });
  });

  it("a copy of an ad is the same arm", () => {
    const copied = AD_DAYS.filter((d) => d.adset_name === "Tech House Pages").map((d) => (d.ad_name === "NX Loves  - Promo vid" && d.date === "2026-11-18" ? { ...d, meta_ad_id: "copy", ad_name: "NX Loves  - Promo vid – Copy" } : d));
    const p = findPairs({ days: copied, events }).pairs[0]!;
    assert.deepEqual(p.b.adIds, ["120252630591910755", "copy"]);
    assert.equal(p.b.spend, 22.97);
  });

  it("an arm with no results gets a spend-only bound and stays thin", () => {
    assert.deepEqual(compare({ side: "with_date", spend: 12, results: 0, cost: null }, { side: "no_date", spend: 20, results: 10, cost: 2 }), { ratio: 6, ratioBound: "at_least", confidence: "thin", verdict: "no_date_cheaper" });
    assert.deepEqual(compare({ side: "with_date", spend: 12, results: 0, cost: null }, { side: "no_date", spend: 20, results: 1, cost: 20 }), { ratio: 0.6, ratioBound: "at_least", confidence: "thin", verdict: "not_yet" });
    assert.deepEqual(compare({ side: "a", spend: 20, results: 10, cost: 2 }, { side: "b", spend: 15, results: 0, cost: null }), { ratio: 0.1333, ratioBound: "at_most", confidence: "thin", verdict: "a_cheaper" });
    assert.deepEqual(compare({ side: "a", spend: 12, results: 0, cost: null }, { side: "b", spend: 15, results: 0, cost: null }), { ratio: null, ratioBound: null, confidence: "thin", verdict: "no_results" });
    // Both arms with results but under 10 each: thin too (shrink.ts's THIN_MIN_RESULTS).
    assert.equal(compare({ side: "a", spend: 12, results: 3, cost: 4 }, { side: "b", spend: 15, results: 5, cost: 3 }).confidence, "thin");
  });

  it("reads the show from the first [CODE] in the campaign name", () => {
    assert.equal(campaignEventCode("261204 Kream | [EBR26-KREAM] KREAM - On Sale"), "EBR26-KREAM");
    assert.equal(campaignEventCode("[NX27-EWANMCVICAR] Signup"), "NX27-EWANMCVICAR");
    assert.equal(campaignEventCode("NYC DATA COLLECT | TRAFFIC 1"), null);
  });
});

describe("phase curves", () => {
  it("EBR27-GLITTERBOX: cost per stage result per phase, main campaigns only, ratio to teaser", () => {
    const curve = phaseCurve({ eventCode: "EBR27-GLITTERBOX", event: EVENTS["EBR27-GLITTERBOX"]!, days: GLITTERBOX_DAYS });
    assert.equal(curve.state, "curve");
    const at = (phase: string, stage: string) => curve.points.find((p) => p.phase === phase && p.stage === stage)!;
    assert.deepEqual([at("teaser", "registration").firstDay, at("teaser", "registration").lastDay, at("teaser", "registration").spend, at("teaser", "registration").results], ["2026-11-12", "2026-11-17", 989.22, 1293]);
    assert.equal(at("teaser", "registration").cost, 0.7651);
    assert.deepEqual([at("announced", "registration").spend, at("announced", "registration").results, at("announced", "registration").cost, at("announced", "registration").ratioToTeaser], [336.45, 447, 0.7527, 0.9838]);
    assert.deepEqual([at("general_sale", "registration").spend, at("general_sale", "registration").results], [665.03, 796]);
    // Retargeting is out (TF5's set): 5.33 + 11.81 + 14.74 + 12.40, never the 0.65 of "- RETARGETING".
    assert.deepEqual([at("announced", "ticket_sale").spend, at("announced", "ticket_sale").results], [5.33, 11]);
    assert.deepEqual([at("general_sale", "ticket_sale").spend, at("general_sale", "ticket_sale").results, at("general_sale", "ticket_sale").ratioToTeaser], [38.95, 34, null]);
    // Presale opened and general sale followed on 19 Nov: no presale row.
    assert.ok(!curve.points.some((p) => p.phase === "presale"));
    const rows = curveRows(curve, ctx);
    assert.deepEqual(rows.map((r) => [r.subject, r.stage, r.verdict]), [
      ["teaser", "registration", "teaser"],
      ["announced", "registration", "announced"],
      ["announced", "ticket_sale", "announced"],
      ["general_sale", "registration", "general_sale"],
      ["general_sale", "ticket_sale", "general_sale"],
    ]);
    assert.equal(rows[1]!.value_b, 0.7651);
    assert.equal(rows[0]!.week_start, null);
  });

  it("shows with no announcement_at: one no_phase_data row each", () => {
    for (const code of ["P26-BDAY", "NX26-ROBBIEDOHERTY", "NX26-SCHAK", "I26-NYC"]) {
      const curve = phaseCurve({ eventCode: code, event: EVENTS[code]!, days: GLITTERBOX_DAYS });
      assert.equal(curve.state, "no_phase_data", code);
      const rows = curveRows(curve, ctx);
      assert.equal(rows.length, 1);
      assert.deepEqual([rows[0]!.kind, rows[0]!.subject, rows[0]!.verdict, rows[0]!.stage], ["phase_curve", "no_phase_data", "no_phase_data", null]);
    }
  });

  it("ignores another show's campaigns", () => {
    const curve = phaseCurve({ eventCode: "ES27-LPRHYTHM", event: EVENTS["ES27-LPRHYTHM"]!, days: GLITTERBOX_DAYS });
    assert.deepEqual(curve.points, []);
  });
});
