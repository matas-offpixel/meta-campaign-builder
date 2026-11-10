import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EMPTY_LAB,
  EMPTY_LOOKALIKES,
  FROM_META,
  VERTICAL_OFF,
  barTone,
  borrowedLine,
  buildClusterSection,
  buildLabSection,
  EMPTY_COPY_LINES,
  buildRail,
  collapseShapes,
  shapeFacet,
  tiktokPlatformThin,
  buildSection,
  buildTikTokSections,
  clusterLine,
  fallbackLine,
  generatorAngleFor,
  pctVsBaseline,
  pctWord,
  scopeChain,
  stageForEventStatus,
  stageForFunnelStage,
  stageForTargetUnit,
  thinLine,
  tiktokAgeLabel,
  tiktokGenderLabel,
  valueLabel,
  type ClusterRow,
  type RailContext,
  type ShapeRow,
  type TagRow,
  type TikTokRow,
} from "../model.ts";

const PUZZLE: RailContext = {
  surface: "event",
  title: "Puzzle 4th Birthday",
  clientId: "puzzle",
  clientName: "Puzzle",
  verticalId: "music",
  eventId: "evt",
  stage: "registration",
  objective: null,
  lab: null,
};

function row(dimension: string, valueKey: string, cpr: number | null, baseline: number, shrunk: number | null, confidence: TagRow["confidence"], fundedAds: number): TagRow {
  return { dimension, valueKey, cpr, baselineCpr: baseline, shrunkIndex: shrunk, confidence, fundedAds };
}

/** IR3's table: Puzzle, registration, baseline £4.16 / signup. */
const IR3: TagRow[] = [
  row("messaging_angle", "event_announcement_update", 4.16, 4.16, 1.0, "ok", 25),
  row("messaging_angle", "artist_headliner", 4.17, 4.16, 1.0, "ok", 25),
  row("messaging_angle", "high_energy_atmosphere", 4.6, 4.16, 1.11, "ok", 25),
  row("visual_format", "headline", 3.9, 4.16, 0.94, "ok", 21),
  row("visual_format", "cinematic_b_roll", 4.7, 4.16, 1.11, "ok", 24),
  row("asset_type", "lifestyle_image_with_text", 3.85, 4.16, 0.92, "ok", 25),
  row("asset_type", "high_production", 4.59, 4.16, 1.07, "ok", 30),
  row("asset_type", "ugc", null, 4.16, null, "thin", 0),
  row("hook_tactic", "fomo", 4.16, 4.16, 1.0, "strong", 49),
  row("hook_tactic", "curiosity", 4.3, 4.16, 1.03, "strong", 52),
  row("hook_tactic", "urgency", 5.1, 4.16, 1.0, "thin", 2),
];

describe("insights rail model", () => {
  it("labels come from the map, else Title Case with one warning", () => {
    assert.equal(valueLabel("lifestyle_image_with_text"), "Lifestyle image with text");
    assert.equal(valueLabel("urgency_scarcity_fomo"), "Urgency / scarcity");
    assert.equal(valueLabel("cinematic_b_roll"), "Cinematic B-roll");
    const warnings: string[] = [];
    assert.equal(valueLabel("some_new_key", (message) => warnings.push(message)), "Some new key");
    assert.equal(valueLabel("some_new_key", (message) => warnings.push(message)), "Some new key");
    assert.equal(warnings.length, 1);
    assert.doesNotMatch(valueLabel("some_new_key"), /_/);
  });

  it("stage follows the event status and the plan's target unit (R4)", () => {
    assert.equal(stageForEventStatus("on_sale"), "ticket_sale");
    assert.equal(stageForEventStatus("sold_out"), "ticket_sale");
    assert.equal(stageForEventStatus("announced"), "registration");
    assert.equal(stageForEventStatus("upcoming"), "registration");
    assert.equal(stageForTargetUnit("purchase"), "ticket_sale");
    assert.equal(stageForTargetUnit("reg"), "registration");
  });

  it("colour reads the shrunk index: olive ≤ 0.95 when ok, brick ≥ 1.10 (R6)", () => {
    assert.equal(barTone(0.94, "ok"), "olive");
    assert.equal(barTone(0.94, "thin"), "ink");
    assert.equal(barTone(1.07, "ok"), "ink");
    assert.equal(barTone(1.11, "ok"), "brick");
    assert.equal(pctWord(pctVsBaseline(4.16, 4.16)), "level");
    assert.equal(pctWord(pctVsBaseline(3.9, 4.16)), "6% under");
    assert.equal(pctWord(pctVsBaseline(4.6, 4.16)), "11% over");
    assert.equal(thinLine(2), "Not enough data yet: 2 funded ads");
    assert.equal(thinLine(1), "Not enough data yet: 1 funded ad");
  });

  it("IR3: no clear winner between level angles; Headline and Lifestyle win; thin rows draw no bar", () => {
    const rail = buildRail({ context: PUZZLE, scope: "client", stage: "registration", rows: { client: IR3 } });
    const tags = rail.sections.filter((section) => section.id !== "lab");
    assert.deepEqual(tags.map((section) => section.id), ["messaging_angle", "hook_tactic", "visual_format", "asset_type"]);
    const [angle, hook, visual, eventAsset] = tags;
    assert.equal(eventAsset!.result?.text, "Lifestyle image with text costs 7% less than usual.");
    assert.equal(eventAsset!.confidence, "ok · 25+ funded ads · 90 days · this client");
    assert.equal(angle!.result?.text, "No clear winner between Event announcement and Artist / headliner.");
    assert.equal(angle!.result?.winner, false);
    assert.deepEqual(angle!.bars.map((bar) => [bar.label, bar.note, bar.tone]), [
      ["Event announcement", "level", "ink"],
      ["Artist / headliner", "level", "ink"],
      ["High-energy atmosphere", "11% over", "brick"],
    ]);
    assert.equal(angle!.confidence, "ok · 25+ funded ads · 90 days · this client · £ / signup");
    assert.equal(angle!.action, null);
    // R13: rows sort by stored shrunk index; FOMO (1.0) draws before Curiosity (1.03, the raw stand-in).
    assert.equal(hook!.result?.text, "No clear winner between FOMO and Curiosity.");
    assert.deepEqual(hook!.bars.map((bar) => bar.label), ["FOMO", "Curiosity"]);
    assert.deepEqual(hook!.thin, [{ key: "urgency", label: "Urgency", fundedAds: 2 }]);
    assert.equal(hook!.confidence, "strong · 49+ funded ads · 90 days · this client");
    assert.equal(visual!.result?.text, "Headline costs 6% less than usual.");
    assert.equal(visual!.result?.winner, true);
    assert.deepEqual(visual!.bars.map((bar) => bar.tone), ["olive", "brick"]);
    assert.equal(rail.verticalDisabledReason, VERTICAL_OFF);
    const campaign = buildRail({ context: { ...PUZZLE, surface: "campaign" }, scope: "client", stage: "registration", rows: { client: IR3 } });
    const asset = campaign.sections.find((section) => section.id === "asset_type")!;
    assert.equal(asset.result?.text, "Lifestyle image with text costs 7% less than usual.");
    assert.deepEqual(asset.bars.map((bar) => bar.tone), ["olive", "ink"]);
    assert.deepEqual(asset.thin, [{ key: "ugc", label: "UGC", fundedAds: 0 }]);
    assert.deepEqual(campaign.sections.map((section) => section.id), ["copy-lines", "messaging_angle", "visual_format", "asset_type"]);
    assert.equal(campaign.sections[0]!.empty, "No line has run in two shows yet. Lines appear here, as chips you can drop into the copy, once one does.");
    for (const section of [...rail.sections, ...campaign.sections]) {
      for (const text of [section.result?.text, section.confidence, section.fallback, ...section.bars.map((bar) => bar.label)]) {
        if (text) assert.doesNotMatch(text, /_/, text);
      }
    }
  });

  it("IR2: a section with no ok row at the client falls back to all clients and says why, with the lock line (R5)", () => {
    const client: TagRow[] = [row("messaging_angle", "artist_headliner", null, 46.8, null, "thin", 3)];
    const all: TagRow[] = [
      row("messaging_angle", "urgency_scarcity_fomo", 34.92, 46.8, 0.75, "strong", 255),
      row("messaging_angle", "event_announcement_update", 45.13, 46.8, 0.97, "strong", 300),
      row("messaging_angle", "artist_headliner", 47.36, 46.8, 1.01, "strong", 400),
      row("messaging_angle", "high_energy_atmosphere", 51.91, 46.8, 1.11, "strong", 260),
      row("messaging_angle", "nostalgia", 55, 46.8, 1.15, "ok", 20),
    ];
    const rail = buildRail({ context: { ...PUZZLE, stage: "ticket_sale" }, scope: "client", stage: "ticket_sale", rows: { client, all } });
    const angle = rail.sections.find((section) => section.id === "messaging_angle")!;
    assert.equal(angle.scope, "all");
    assert.equal(angle.scopeLabel, "All clients");
    assert.equal(angle.fallback, "Puzzle has no ticket sales attributed to its ads in the last 90 days. Showing all clients.");
    assert.equal(angle.lock, true);
    assert.equal(angle.result?.text, "Urgency / scarcity costs 25% less than usual.");
    assert.equal(angle.bars.length, 4);
    assert.equal(angle.more, 1);
    // R12d: the funded count is the minimum of the drawn rows (255, 300, 400, 260), not the first row's.
    assert.equal(angle.confidence, "strong · 255+ funded ads · 90 days · all clients · £ / purchase · +1 more");
    assert.deepEqual(angle.action, { kind: "use_angle", angle: "scarcity", label: "Use Scarcity", note: "needs the ticket count that makes it true" });
    assert.deepEqual(scopeChain("client", true), ["client", "all"]);
    assert.deepEqual(scopeChain("client", false), ["client", "vertical", "all"]);
    assert.equal(fallbackLine("Puzzle", "registration", "all"), "Puzzle has no signups attributed to its ads in the last 90 days. Showing all clients.");
    const empty = buildRail({ context: PUZZLE, scope: "client", stage: "ticket_sale", rows: {} });
    assert.ok(empty.sections.every((section) => section.empty));
  });

  it("the Lab section is empty until a round is judged, then leads with the winner's angle (IR6)", () => {
    const empty = buildLabSection(null);
    assert.equal(empty.empty, EMPTY_LAB);
    const rail = buildRail({
      context: {
        ...PUZZLE,
        clientName: "Off Pixel Fixtures",
        lab: {
          roundNo: 1,
          status: "judged",
          angleLine: "Lineup captions beat POV by 33% on Off Pixel Fixtures",
          ads: [
            { name: "Ada North #1 × Lineup", style: "lineup", verdict: "winner", cost: 0.5, results: 40, metric: "complete_registration" },
            { name: "Bea Lowe #1 × POV", style: "pov", verdict: "flagged", cost: 0.75, results: 20, metric: "complete_registration" },
            { name: "Ada North #2 × Lineup", style: "lineup", verdict: "untested", cost: null, results: null, metric: "complete_registration" },
          ],
        },
      },
      scope: "client",
      stage: "registration",
      rows: { client: IR3 },
    });
    const lab = rail.sections[0]!;
    assert.equal(lab.id, "lab");
    assert.equal(lab.scopeLabel, "round 1 · judged");
    assert.equal(lab.result?.text, "Lineup captions beat POV by 33% on Off Pixel Fixtures.");
    assert.deepEqual(lab.bars.map((bar) => [bar.label, bar.cpr, bar.note, bar.tone]), [
      ["Lineup", 0.5, "40 signups", "olive"],
      ["POV", 0.75, "20 signups", "brick"],
    ]);
    assert.deepEqual(lab.labRows, [{ name: "Ada North #1 × Lineup", verdict: "winner" }]);
    assert.equal(lab.confidence, "round 1 · 60 signups · £35 spent");
    assert.deepEqual(lab.action, { kind: "use_angle", angle: "lineup", label: "Use Lineup", note: null });
    const draft = buildRail({ context: { ...PUZZLE, lab: { roundNo: 1, status: "draft", angleLine: null, ads: [] } }, scope: "client", stage: "registration", rows: { client: IR3 } });
    assert.equal(draft.sections.at(-1)!.empty, EMPTY_LAB);
  });

  it("the generator map (R9)", () => {
    assert.equal(generatorAngleFor("messaging_angle", "artist_headliner"), "lineup");
    assert.equal(generatorAngleFor("messaging_angle", "urgency_scarcity_fomo"), "scarcity");
    assert.equal(generatorAngleFor("visual_format", "pov"), "pov");
    assert.equal(generatorAngleFor("visual_format", "headline"), null);
    const noWinner = buildSection({ dimension: "messaging_angle", rows: IR3, stage: "registration", scope: "client", firstSection: true });
    assert.equal(noWinner?.action, null);
  });

  it("R13: non-thin rows sort by stored shrunk index, four draw, '+n more' counts the rest, funded is the drawn minimum (R12)", () => {
    const rows: TagRow[] = [
      row("visual_format", "listicle", 72.25, 46.86, 1.413, "strong", 15),
      row("visual_format", "billboard", 44.57, 46.86, 0.964, "strong", 27),
      row("visual_format", "cinematic_b_roll", 62.9, 46.86, 1.33, "strong", 15),
      row("visual_format", "nostalgia", 29.09, 46.86, 0.773, "strong", 15),
      row("visual_format", "pov", 57.57, 46.86, 1.186, "strong", 43),
      row("visual_format", "headline", 41.38, 46.86, 0.886, "strong", 396),
      row("visual_format", "celebrity", 66.77, 46.86, 1.324, "strong", 15),
      row("visual_format", "offer_first_banner", null, 46.86, null, "thin", 3),
    ];
    const built = buildSection({ dimension: "visual_format", rows, stage: "ticket_sale", scope: "all", firstSection: false })!;
    assert.deepEqual(built.bars.map((bar) => [bar.label, bar.note, bar.tone]), [
      ["Nostalgia", "38% under", "olive"],
      ["Headline", "12% under", "olive"],
      ["Billboard", "5% under", "ink"],
      ["POV", "23% over", "brick"],
    ]);
    assert.equal(built.more, 3);
    assert.equal(built.confidence, "strong · 15+ funded ads · 90 days · all clients · +3 more");
    assert.deepEqual(built.thin, [{ key: "offer_first_banner", label: "Offer-first banner", fundedAds: 3 }]);
    // Ties break by funded ads descending.
    const tied: TagRow[] = [
      row("asset_type", "ugc", 48, 46.86, 1.0, "strong", 10),
      row("asset_type", "hybrid", 47, 46.86, 1.0, "strong", 40),
    ];
    const tie = buildSection({ dimension: "asset_type", rows: tied, stage: "ticket_sale", scope: "all", firstSection: false })!;
    assert.deepEqual(tie.bars.map((bar) => bar.key), ["hybrid", "ugc"]);
    // Colour is the stored index, never cpr ÷ baseline: a cheap row with a high stored index is ink.
    const cheapButShrunk = buildSection({ dimension: "x", rows: [row("x", "a", 30, 46.86, 1.0, "strong", 10)], stage: "ticket_sale", scope: "all", firstSection: false })!;
    assert.equal(cheapButShrunk.bars[0]!.tone, "ink");
    assert.equal(cheapButShrunk.bars[0]!.note, "36% under");
  });

  it("IR5: clusters sort by cprIndex, % is 1 − cprIndex, thin clusters share a line, untried and picked are library facts (R15)", () => {
    const c = (name: string, cpr: number | null, cprIndex: number | null, funded: number, clients: number, confidence: ClusterRow["confidence"], useCount: number, tried: boolean): ClusterRow => ({
      id: name,
      name,
      interests: [],
      cpr,
      cprIndex,
      fundedAdSets: funded,
      clients,
      confidence,
      useCount,
      tried,
    });
    const vertical = [
      c("Electronic music", 2.13, 0.98, 4, 1, "ok", 0, true),
      c("Disc Genre", 1.06, 0.59, 8, 2, "ok", 0, true),
      c("Melodic Techno", 1.44, 0.77, 1, 1, "thin", 0, true),
      c("Latest iPhone users", 2.0, 0.92, 3, 1, "ok", 0, true),
      c("Fashion", 2.22, 0.9, 2, 2, "thin", 0, true),
      c("Music festivals", 0.98, 0.67, 3, 2, "ok", 0, true),
      c("Deep house", null, null, 0, 0, "thin", 0, false),
      c("Artists — EDM", null, null, 0, 0, "thin", 2, false),
    ];
    const all = [...vertical, c("Arsenal", null, null, 0, 0, "thin", 0, false), c("Artists — Metal", null, null, 0, 0, "thin", 1, false)];
    const client = all.map((row) => ({ ...row, cpr: null, cprIndex: null, fundedAdSets: 0, clients: 0, confidence: "thin" as const, tried: false }));
    const section = buildClusterSection({ rows: { client, vertical, all }, scope: "vertical", stage: "registration", clientName: "Puzzle", verticalId: "music", verticalOff: false });
    assert.equal(section.scopeLabel, "music · signup");
    assert.equal(section.result?.text, "Disc Genre costs 41% less than its clients' usual.");
    assert.deepEqual(section.clusters.map((row) => row.name), ["Disc Genre", "Music festivals", "Latest iPhone users", "Electronic music"]);
    assert.equal(section.clusters[0]!.line, "£1.06 / signup · 41% under · 8 funded ad sets · 2 clients · ok");
    assert.equal(section.clusters[1]!.line, "£0.98 / signup · 33% under · 3 funded ad sets · 2 clients · ok");
    assert.equal(section.clusters[3]!.line, "£2.13 / signup · 2% under · 4 funded ad sets · 1 client · ok");
    assert.deepEqual(section.clusterThin, { names: "Melodic Techno, Fashion", note: "Not enough data yet: 1–2 funded ad sets each" });
    assert.deepEqual(section.untried, { count: 4, names: ["Arsenal", "Artists — EDM", "Artists — Metal", "Deep house"] });
    assert.equal(section.picked, 3);
    assert.equal(section.lock, true);
    assert.equal(section.fallback, null);
    assert.equal(clusterLine(c("x", 2.0, 1.0, 1, 1, "ok", 0, true), "ticket_sale"), "£2.00 / purchase · level · 1 funded ad set · 1 client · ok");
    // Puzzle's own scope is empty, so the client scope falls back to the vertical and says why.
    const fromClient = buildClusterSection({ rows: { client, vertical, all }, scope: "client", stage: "registration", clientName: "Puzzle", verticalId: "music", verticalOff: false });
    assert.equal(fromClient.scope, "vertical");
    assert.equal(fromClient.fallback, "Puzzle has no signups attributed to its ads in the last 90 days. Showing its vertical.");
    // The whole rail on the audience builder: clusters, then the R15 sentence; Vertical stays on.
    const rail = buildRail({ context: { ...PUZZLE, surface: "audience_builder", title: "Audience builder" }, scope: "vertical", stage: "registration", rows: {}, clusters: { client, vertical, all } });
    assert.deepEqual(rail.sections.map((section) => section.id), ["interest_clusters", "lookalikes"]);
    assert.equal(rail.sections[1]!.empty, EMPTY_LOOKALIKES);
    assert.equal(rail.verticalDisabledReason, null);
    assert.equal(stageForFunnelStage("retargeting"), "ticket_sale");
    assert.equal(stageForFunnelStage("top_of_funnel"), "registration");
  });

  it("IR8: TikTok's own units — blended baseline, level band, higher-is-better for a rate, the thin threshold (R14)", () => {
    const rows: TikTokRow[] = [
      { dimension: "age", value: "AGE_18_24", spend: 66.3, clicks: 134, impressions: 35857, views2s: 3317 },
      { dimension: "age", value: "AGE_25_34", spend: 35.57, clicks: 71, impressions: 16558, views2s: 1654 },
      { dimension: "age", value: "AGE_35_44", spend: 6.69, clicks: 13, impressions: 2704, views2s: 385 },
      { dimension: "age", value: "NONE", spend: 0, clicks: 0, impressions: 1, views2s: 0 },
      { dimension: "gender", value: "FEMALE", spend: 61.54, clicks: 128, impressions: 31257, views2s: 2861 },
      { dimension: "gender", value: "MALE", spend: 47, clicks: 90, impressions: 23854, views2s: 2494 },
    ];
    const [clicks, watches] = buildTikTokSections(rows, "Puzzle");
    assert.equal(clicks!.kicker, "Who clicks on TikTok");
    assert.equal(clicks!.scopeLabel, "Puzzle · 90 days");
    assert.equal(clicks!.result?.text, "No clear winner between 18–24 and 25–34.");
    assert.deepEqual(clicks!.bars.map((bar) => [bar.label, bar.valueText, bar.note, bar.tone]), [
      ["18–24 · 9.3% watch past 2 s", "£0.49 / click", "level", "ink"],
      ["25–34 · 10.0% watch past 2 s", "£0.50 / click", "level", "ink"],
    ]);
    assert.deepEqual(clicks!.thin, [{ key: "AGE_35_44", label: "35–44", fundedAds: 13, line: "Not enough data yet: £7 spent, 13 clicks" }]);
    assert.equal(clicks!.confidence, "ok · £109 spent · 218 clicks · 90 days · Puzzle · TikTok");
    assert.equal(watches!.kicker, "Who watches");
    assert.equal(watches!.result?.text, "Men watch past 2 s 8% more than usual.");
    assert.deepEqual(watches!.bars.map((bar) => [bar.label, bar.valueText, bar.note, bar.tone]), [
      ["Men", "10.5%", "8% over", "olive"],
      ["Women", "9.2%", "6% under", "brick"],
    ]);
    assert.equal(watches!.confidence, "ok · 2-s views ÷ impressions · 55,111 impressions · 90 days · Puzzle · TikTok");
    for (const section of [clicks!, watches!]) {
      for (const text of [section.result?.text, section.confidence, ...section.bars.map((bar) => bar.label)]) assert.doesNotMatch(text ?? "", /signup|ticket/i);
    }
    // A cheaper age wins when it is olive and clear; a wide level band reads level.
    const cheap = buildTikTokSections([
      { dimension: "age", value: "AGE_18_24", spend: 40, clicks: 100, impressions: 20000, views2s: 2000 },
      { dimension: "age", value: "AGE_25_34", spend: 80, clicks: 100, impressions: 20000, views2s: 2000 },
    ], "Puzzle")[0]!;
    assert.equal(cheap.result?.text, "18–24 costs 33% less than usual.");
    assert.deepEqual(cheap.bars.map((bar) => [bar.note, bar.tone]), [["33% under", "olive"], ["33% over", "brick"]]);
    assert.equal(buildTikTokSections([], "Puzzle")[0]!.empty, "Not enough data yet: no TikTok breakdowns for Puzzle in the last 90 days.");
    // A gender row under 1,000 impressions is thin; the blended figure still counts it.
    const thinGender = buildTikTokSections([
      { dimension: "gender", value: "FEMALE", spend: 50, clicks: 100, impressions: 20000, views2s: 2000 },
      { dimension: "gender", value: "MALE", spend: 2, clicks: 3, impressions: 999, views2s: 150 },
    ], "Puzzle")[1]!;
    assert.deepEqual(thinGender.bars.map((bar) => bar.label), ["Women"]);
    assert.deepEqual(thinGender.thin, [{ key: "MALE", label: "Men", fundedAds: 999, line: "Not enough data yet: £2 spent, 3 clicks" }]);
    assert.equal(thinGender.confidence, "ok · 2-s views ÷ impressions · 20,999 impressions · 90 days · Puzzle · TikTok");
    const thinClicks = buildTikTokSections([
      { dimension: "gender", value: "FEMALE", spend: 50, clicks: 100, impressions: 20000, views2s: 2000 },
      { dimension: "gender", value: "MALE", spend: 2, clicks: 3, impressions: 1000, views2s: 150 },
    ], "Puzzle")[1]!;
    assert.deepEqual(thinClicks.bars.map((bar) => bar.label), ["Women"]);
    assert.equal(thinClicks.thin[0]!.line, "Not enough data yet: £2 spent, 3 clicks");
    assert.equal(tiktokAgeLabel("AGE_55_100"), "55–100");
    assert.equal(tiktokAgeLabel("AGE_55+"), "55+");
    assert.equal(tiktokGenderLabel("FEMALE"), "Women");
  });

  it("the TikTok drawer borrows Meta's mechanisms, labelled, with no asset type and no Use action (R14, R16)", () => {
    const tiktok: TikTokRow[] = [{ dimension: "age", value: "AGE_18_24", spend: 66.3, clicks: 134, impressions: 35857, views2s: 3317 }];
    const rail = buildRail({ context: { ...PUZZLE, surface: "tiktok_campaign", title: "New TikTok campaign" }, scope: "client", stage: "registration", rows: { client: IR3 }, tiktok });
    assert.deepEqual(rail.sections.map((section) => section.id), ["tiktok_clicks", "tiktok_watches", "messaging_angle", "hook_tactic", "visual_format"]);
    assert.equal(rail.sections.length, 5);
    const [, , angle, hook, visual] = rail.sections;
    assert.equal(angle!.borrowed, borrowedLine("Puzzle"));
    assert.equal(angle!.borrowed, "TikTok ads aren't tagged yet. These angles, hooks and formats come from Puzzle's Meta ads; the costs are Meta costs.");
    assert.equal(hook!.borrowed, null);
    assert.equal(visual!.borrowed, null);
    for (const section of [angle!, hook!, visual!]) {
      assert.equal(section.scopeLabel, FROM_META);
      assert.match(section.confidence!, / · Puzzle · (£ \/ signup · )?Meta$/);
      assert.equal(section.action, null);
    }
    assert.equal(visual!.result?.text, "Headline costs 6% less than usual.");
    assert.equal(visual!.bars[0]!.valueText, "£3.90");
    // Only the TikTok surface carries the borrowed line.
    const event = buildRail({ context: PUZZLE, scope: "client", stage: "registration", rows: { client: IR3 } });
    assert.ok(event.sections.every((section) => section.borrowed === null));
    assert.ok(!event.sections.some((section) => section.confidence?.endsWith("Meta")));
  });

  it("R17: a platform-unit row is thin under any of 20 clicks, £10 or 1,000 impressions", () => {
    assert.equal(tiktokPlatformThin({ clicks: 19, spend: 10, impressions: 1000 }), true);
    assert.equal(tiktokPlatformThin({ clicks: 20, spend: 9.99, impressions: 1000 }), true);
    assert.equal(tiktokPlatformThin({ clicks: 20, spend: 10, impressions: 999 }), true);
    assert.equal(tiktokPlatformThin({ clicks: 20, spend: 10, impressions: 1000 }), false);
    const drawn = buildTikTokSections([{ dimension: "age", value: "AGE_18_24", spend: 10, clicks: 20, impressions: 1000, views2s: 100 }], "Puzzle")[0]!;
    assert.equal(drawn.bars.length, 1);
    assert.equal(drawn.thin.length, 0);
    const thin = buildTikTokSections([{ dimension: "age", value: "AGE_18_24", spend: 10, clicks: 19, impressions: 1000, views2s: 100 }], "Puzzle")[0]!;
    assert.equal(thin.bars.length, 0);
    assert.equal(thin.thin[0]!.line, "Not enough data yet: £10 spent, 19 clicks");
  });

  it("R23: labels are capitalised phrases, and a one-line body is not a label", () => {
    assert.equal(shapeFacet("cta_kind", "none"), "No CTA");
    assert.equal(shapeFacet("cta_kind", "sign_up"), "Sign up CTA");
    assert.equal(shapeFacet("scarcity_kind", "countdown"), "Countdown scarcity");
    assert.equal(shapeFacet("scarcity_kind", "pct_sold"), "% sold scarcity");
    assert.equal(shapeFacet("scarcity_kind", "none"), "No scarcity");
    assert.equal(shapeFacet("length_band", "gt_200"), "Very long body");
    assert.equal(shapeFacet("emoji_count_band", "0"), "No emoji");
    assert.equal(shapeFacet("emoji_count_band", "1_2"), "1–2 emoji");
    assert.equal(shapeFacet("opener", "imperative"), "Opener: a command");
    assert.equal(shapeFacet("opener", "name_first"), "Opener: artist name");
    assert.equal(shapeFacet("line_count_band", "1"), null);
    assert.equal(shapeFacet("line_count_band", "2_3"), "2+ lines");
    const row = (feature: string, value: string): ShapeRow => ({
      feature, value, voice: null, index: 0.8, shows: 3, ads: 20, stage: "registration", adsHash: "base", confidence: "ok",
    });
    const dropped = collapseShapes([row("line_count_band", "1")]);
    assert.equal(dropped.length, 0);
    const kept = collapseShapes([row("line_count_band", "1"), row("opener", "question")]);
    assert.equal(kept.length, 1);
    assert.equal(kept[0]!.label, "Opener: a question");
    assert.equal(kept[0]!.facets, "");
  });

  it("R21: equal ads hashes collapse; equal counts with different hashes do not; a null hash never does", () => {
    const row = (feature: string, hash: string | null, ads = 27): ShapeRow => ({
      feature,
      value: feature === "has_date" ? "yes" : feature === "has_price" ? "yes" : "4_plus",
      voice: "promoter",
      index: 0.75,
      shows: 3,
      ads,
      stage: "ticket_sale",
      adsHash: hash,
      confidence: "ok",
    });
    const collapsed = collapseShapes([row("line_count_band", "same"), row("has_date", "same"), row("has_price", "same")]);
    assert.equal(collapsed.length, 1);
    assert.equal(collapsed[0]!.label, "4+ lines");
    assert.equal(collapsed[0]!.facets, "promoter voice · dated · a price");
    const apart = collapseShapes([row("line_count_band", "a"), row("has_date", "b")]);
    assert.equal(apart.length, 2);
    const unhashed = collapseShapes([row("line_count_band", null), row("has_date", null)]);
    assert.equal(unhashed.length, 2);
  });

  it("R22: one proven line shows the chip and Use line; none shows the sentence", () => {
    const empty = buildRail({ context: { ...PUZZLE, surface: "campaign" }, scope: "client", stage: "registration", rows: { client: IR3 } });
    assert.equal(empty.sections.find((section) => section.id === "copy-lines")!.empty, EMPTY_COPY_LINES);
    const filled = buildRail({
      context: { ...PUZZLE, surface: "campaign" },
      scope: "client",
      stage: "registration",
      rows: { client: IR3 },
      copy: { best: [], proven: [{ text: "Doors at 10", cpr: 3, indexVsEvent: 0.8, eventsN: 2, proven: true }] },
    });
    const lines = filled.sections.find((section) => section.id === "copy-lines")!;
    assert.equal(lines.empty, null);
    assert.deepEqual(lines.chips, [{ text: "Doors at 10", action: "Use line" }]);
  });

  it("a 4+ lines winner uses the record's result sentence", () => {
    const row: ShapeRow = {
      feature: "line_count_band",
      value: "4_plus",
      voice: "promoter",
      index: 0.75,
      shows: 3,
      ads: 27,
      stage: "ticket_sale",
      adsHash: "only",
      confidence: "ok",
    };
    const rail = buildRail({
      context: { ...PUZZLE, surface: "campaign" },
      scope: "all",
      stage: "ticket_sale",
      rows: { all: IR3 },
      shapes: { rows: [row], scope: "all" },
    });
    assert.equal(rail.sections[0]!.result?.text, "4+ line bodies cost 25% less than usual.");
  });
});
