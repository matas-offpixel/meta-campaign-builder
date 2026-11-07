import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EMPTY_LAB,
  VERTICAL_OFF,
  barTone,
  buildLabSection,
  buildRail,
  buildSection,
  fallbackLine,
  generatorAngleFor,
  pctVsBaseline,
  pctWord,
  scopeChain,
  stageForEventStatus,
  stageForTargetUnit,
  thinLine,
  valueLabel,
  type RailContext,
  type TagRow,
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
  row("messaging_angle", "artist_headliner", 4.17, 4.16, 1.0, "ok", 28),
  row("messaging_angle", "high_energy_atmosphere", 4.6, 4.16, 1.11, "ok", 25),
  row("visual_format", "headline", 3.9, 4.16, 0.94, "ok", 21),
  row("visual_format", "cinematic_b_roll", 4.7, 4.16, 1.11, "ok", 24),
  row("asset_type", "lifestyle_image_with_text", 3.85, 4.16, 0.92, "ok", 25),
  row("asset_type", "high_production", 4.59, 4.16, 1.07, "ok", 30),
  row("asset_type", "ugc", null, 4.16, null, "thin", 0),
  row("hook_tactic", "fomo", 4.16, 4.16, 1.0, "strong", 49),
  row("hook_tactic", "curiosity", 4.3, 4.16, 0.98, "strong", 52),
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
    assert.equal(hook!.result?.text, "No clear winner between FOMO and Curiosity.");
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
    assert.deepEqual(campaign.sections.map((section) => section.id), ["best-lines", "proven", "messaging_angle", "visual_format", "asset_type"]);
    assert.equal(campaign.sections[0]!.empty, "Lines are scored overnight. None are scored yet, so the first examples arrive after tonight's run.");
    assert.equal(campaign.sections[1]!.empty, "No line is proven yet. Proven lines appear here as chips you can drop into the copy.");
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
});
