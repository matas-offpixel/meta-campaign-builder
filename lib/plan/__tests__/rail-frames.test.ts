import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { RAIL_FRAME_IDS, RAIL_FRAME_WIDTHS, RAIL_GUARD_PATHS } from "../../../scripts/plan-frames/rail-ids.ts";
import { RAIL_FRAME_FIXTURES, getRailFrame } from "../../../scripts/plan-frames/rail-fixtures.ts";
import { RAIL_FRAME_WIDTHS as SHOT_WIDTHS, RAIL_GUARD_PATHS as SHOT_GUARDS, RAIL_SHOTS } from "../../../scripts/plan-frames/rail-shots.mjs";

function railTexts(fixture: (typeof RAIL_FRAME_FIXTURES)[keyof typeof RAIL_FRAME_FIXTURES]): string[] {
  return fixture.data.sections.flatMap((section) => [
    section.kicker,
    section.scopeLabel,
    section.result?.text ?? "",
    section.confidence ?? "",
    section.fallback ?? "",
    section.empty ?? "",
    section.action?.label ?? "",
    ...section.bars.map((bar) => `${bar.label} ${bar.note}`),
    ...section.thin.map((row) => row.label),
  ]);
}

describe("Insights rail frame catalog (IR)", () => {
  it("the runner shoots every IR id at the record's widths, and checks the record's guard paths", () => {
    assert.deepEqual(SHOT_WIDTHS, RAIL_FRAME_WIDTHS);
    assert.deepEqual([...SHOT_GUARDS], [...RAIL_GUARD_PATHS]);
    assert.equal(RAIL_SHOTS.length, 13);
    for (const shot of RAIL_SHOTS as { id: string; frame: string; width: number }[]) {
      assert.equal(shot.id, `${shot.frame}-${shot.width}`);
      assert.ok((RAIL_FRAME_IDS as readonly string[]).includes(shot.frame), shot.frame);
    }
    assert.ok(RAIL_GUARD_PATHS.some((path) => path.startsWith("/admin/")));
    assert.ok(RAIL_GUARD_PATHS.some((path) => path.startsWith("/share/")));
    assert.ok(RAIL_GUARD_PATHS.some((path) => path.startsWith("/l/")));
  });

  it("every id has a fixture and no rail text carries a raw key (H7)", () => {
    for (const id of RAIL_FRAME_IDS) {
      const fixture = getRailFrame(id);
      assert.ok(fixture, id);
      assert.equal(fixture.id, id);
      assert.equal(fixture.kind, "rail");
      for (const text of railTexts(fixture)) assert.doesNotMatch(text, /_/, `${id}: ${text}`);
      assert.doesNotMatch(JSON.stringify(fixture.context), /https?:\/\//, id);
    }
  });

  it("IR1 and IR7 rest collapsed; the open frames open", () => {
    assert.equal(RAIL_FRAME_FIXTURES.IR1.open, false);
    assert.equal(RAIL_FRAME_FIXTURES.IR7.open, false);
    for (const id of ["IR2", "IR3", "IR4", "IR5", "IR6", "IR8", "IR9"] as const) assert.equal(RAIL_FRAME_FIXTURES[id].open, true, id);
    assert.equal(RAIL_FRAME_FIXTURES.IR3.railOnly, true);
    assert.equal(RAIL_FRAME_FIXTURES.IR6.railOnly, true);
  });

  it("IR2: on sale opens on Ticket sale; every tag section falls back to all clients and says why (H5); R12/R13 corrections (H11)", () => {
    const { context, data } = RAIL_FRAME_FIXTURES.IR2;
    assert.equal(context.stage, "ticket_sale");
    const tags = data.sections.filter((section) => section.id !== "lab");
    assert.deepEqual(tags.map((section) => section.id), ["messaging_angle", "hook_tactic", "visual_format", "asset_type"]);
    for (const section of tags) {
      assert.equal(section.scope, "all", section.id);
      assert.equal(section.fallback, "Puzzle has no ticket sales attributed to its ads in the last 90 days. Showing all clients.");
      assert.equal(section.lock, true);
    }
    const [angle, hook, visual, asset] = tags;
    // R12c/d, R13: Billboard ink from its stored index, POV fourth, "+3 more", the drawn minimum 15.
    assert.equal(visual!.result?.text, "Nostalgia costs 38% less than usual.");
    assert.deepEqual(visual!.bars.map((bar) => [bar.label, bar.cpr, bar.note, bar.tone]), [
      ["Nostalgia", 29.09, "38% under", "olive"],
      ["Headline", 41.38, "12% under", "olive"],
      ["Billboard", 44.57, "5% under", "ink"],
      ["POV", 57.57, "23% over", "brick"],
    ]);
    assert.equal(visual!.more, 3);
    assert.equal(visual!.confidence, "strong · 15+ funded ads · 90 days · all clients · +3 more");
    assert.equal(asset!.result?.text, "Hybrid costs 30% less than usual.");
    assert.deepEqual(asset!.bars.map((bar) => [bar.label, bar.cpr, bar.note, bar.tone]), [
      ["Hybrid", 32.81, "30% under", "olive"],
      ["Lifestyle image with text", 42.21, "10% under", "olive"],
      ["UGC", 48.28, "3% over", "ink"],
      ["High production", 52.61, "12% over", "brick"],
    ]);
    assert.equal(asset!.more, 1);
    assert.equal(asset!.confidence, "strong · 10+ funded ads · 90 days · all clients · +1 more");
    assert.equal(angle!.result?.text, "Urgency / scarcity costs 25% less than usual.");
    assert.deepEqual(angle!.bars.map((bar) => [bar.label, bar.cpr, bar.note]), [
      ["Urgency / scarcity", 34.92, "25% under"],
      ["Event announcement", 45.13, "4% under"],
      ["Artist / headliner", 47.36, "1% over"],
      ["High-energy atmosphere", 51.91, "11% over"],
    ]);
    assert.equal(angle!.confidence, "strong · 225+ funded ads · 90 days · all clients · £ / purchase");
    assert.equal(angle!.action?.label, "Use Scarcity");
    assert.equal(hook!.result?.text, "Social proof costs 54% less than usual.");
    assert.equal(hook!.more, 5);
    assert.equal(hook!.confidence, "strong · 54+ funded ads · 90 days · all clients · +5 more");
    assert.equal(data.sections.at(-1)!.id, "lab");
    assert.equal(data.sections.at(-1)!.empty, "No round judged yet. Approve a caption and propose round 1.");
  });

  it("IR3: Puzzle's own rows, two 'No clear winner' sections and two thin rows (H4)", () => {
    const { data } = RAIL_FRAME_FIXTURES.IR3;
    const [angle, hook, visual, asset] = data.sections.filter((section) => section.id !== "lab");
    assert.equal(asset!.result?.text, "Lifestyle image with text costs 7% less than usual.");
    assert.deepEqual(asset!.thin.map((row) => [row.label, row.fundedAds]), [["UGC", 0]]);
    assert.equal(data.sections.at(-1)!.id, "lab");
    assert.equal(angle!.scope, "client");
    assert.equal(angle!.scopeLabel, "Puzzle");
    assert.equal(angle!.fallback, null);
    assert.equal(angle!.result?.text, "No clear winner between Event announcement and Artist / headliner.");
    // R13 sorts by stored shrunk index; Curiosity's stand-in is the raw 1.03, so FOMO (1.0) draws first.
    assert.equal(hook!.result?.text, "No clear winner between FOMO and Curiosity.");
    assert.deepEqual(hook!.bars.map((bar) => [bar.label, bar.note]), [["FOMO", "level"], ["Curiosity", "3% over"]]);
    assert.deepEqual(hook!.thin.map((row) => [row.label, row.fundedAds]), [["Urgency", 2]]);
    assert.equal(visual!.result?.text, "Headline costs 6% less than usual.");
    assert.equal(data.sections.some((section) => section.action), false);
    assert.equal(data.verticalDisabledReason, "Vertical is off until the music rollup stops including other verticals.");
  });

  it("IR4: best copy shapes lead, copy lines stay empty (H18, H19)", () => {
    const { context, data } = RAIL_FRAME_FIXTURES.IR4;
    assert.equal(context.surface, "campaign");
    assert.equal(context.stage, "registration");
    assert.equal(context.objective, "Leads");
    assert.deepEqual(data.sections.map((section) => section.id), ["copy-shapes", "copy-lines", "messaging_angle", "visual_format", "asset_type"]);
    const shapes = data.sections[0]!;
    assert.equal(shapes.kicker, "Best copy shapes");
    assert.equal(shapes.scopeLabel, "All clients");
    assert.equal(shapes.fallback, "Puzzle has no copy shape with enough shows yet. Showing all clients.");
    assert.equal(shapes.bars[0]!.label, "Opener: artist name");
    assert.equal(shapes.bars[0]!.facets, "artist voice · undated");
    assert.equal(shapes.bars[0]!.valueText, "0.65");
    assert.equal(shapes.bars[1]!.label, "4+ lines");
    assert.equal(shapes.bars[1]!.facets, "promoter voice · dated · a price");
    assert.equal(shapes.bars[1]!.valueText, "0.75");
    assert.equal(shapes.bars[1]!.detail, "3 shows · 27 ads · ticket sale");
    assert.equal(shapes.result?.text, "Opener: artist name costs 35% less than usual.");
    assert.equal(shapes.bars[2]!.label, "1–2 emoji");
    assert.equal(shapes.bars[3]!.label, "Countdown scarcity");
    assert.equal(shapes.confidence, "ok · 22+ ads · 3+ shows · 90 days · all clients · +14 more");
    assert.equal(shapes.lock, true);
    assert.equal(shapes.action?.label, "Use shape");
    assert.equal(shapes.action?.note, "artist voice → Angle: Artist, first person");
    assert.equal(data.sections[1]!.kicker, "Copy lines");
    assert.equal(data.sections[1]!.empty, "No line has run in two shows yet. Lines appear here, as chips you can drop into the copy, once one does.");
    assert.equal(data.sections[4]!.result?.text, "Lifestyle image with text costs 7% less than usual.");
  });

  it("IR6: the CL6 Lab leads, with its figures and Use Lineup (H8)", () => {
    const { data } = RAIL_FRAME_FIXTURES.IR6;
    const lab = data.sections[0]!;
    assert.equal(lab.id, "lab");
    assert.equal(lab.result?.text, "Lineup captions beat POV by 33% on Off Pixel Fixtures.");
    assert.deepEqual(lab.bars.map((bar) => [bar.label, bar.cpr, bar.note]), [["Lineup", 0.5, "40 signups"], ["POV", 0.75, "20 signups"]]);
    assert.equal(lab.confidence, "round 1 · 60 signups · £35 spent");
    assert.deepEqual(lab.labRows, [{ name: "Ada North #1 × Lineup", verdict: "winner" }]);
    assert.equal(lab.action?.label, "Use Lineup");
  });

  it("IR5: the audience builder opens on the vertical; clusters as the data note, the R15 sentence (H12)", () => {
    const { context, data, page } = RAIL_FRAME_FIXTURES.IR5;
    assert.equal(context.surface, "audience_builder");
    assert.equal(context.stage, "registration");
    assert.deepEqual(data.sections.map((section) => section.id), ["interest_clusters", "lookalikes"]);
    const [clusters, lookalikes] = data.sections;
    assert.equal(clusters!.scope, "vertical");
    assert.equal(clusters!.scopeLabel, "music · signup");
    assert.equal(clusters!.result?.text, "Disc Genre costs 41% less than its clients' usual.");
    assert.deepEqual(clusters!.clusters.map((row) => [row.name, row.line]), [
      ["Disc Genre", "£1.06 / signup · 41% under · 8 funded ad sets · 2 clients · ok"],
      ["Music festivals", "£0.98 / signup · 33% under · 3 funded ad sets · 2 clients · ok"],
      ["Latest iPhone users", "£2.00 / signup · 8% under · 3 funded ad sets · 1 client · ok"],
      ["Electronic music", "£2.13 / signup · 2% under · 4 funded ad sets · 1 client · ok"],
    ]);
    assert.equal(clusters!.clusterThin?.names, "Melodic Techno, Fashion, Streaming, Streaming — full");
    assert.equal(clusters!.clusterThin?.note, "Not enough data yet: 1–2 funded ad sets each");
    assert.equal(clusters!.untried?.count, 28);
    assert.equal(clusters!.picked, 7);
    assert.equal(clusters!.more, 0);
    assert.equal(lookalikes!.kicker, "Lookalikes and retargeting");
    assert.equal(lookalikes!.empty, "Not measured yet. Appears once results are stored per audience (source, lookalike range, cost per result), from the next nightly run after that job ships.");
    assert.equal(data.verticalDisabledReason, null);
    assert.equal(page.kind, "audience");
    if (page.kind === "audience") assert.deepEqual(page.added.map((row) => row.name), ["Disc Genre"]);
  });

  it("IR8: TikTok's own two sections, the borrowed line, three Meta sections, no asset type, no Use (H13, H14)", () => {
    const { context, data } = RAIL_FRAME_FIXTURES.IR8;
    assert.equal(context.surface, "tiktok_campaign");
    assert.equal(context.title, "New TikTok campaign");
    assert.deepEqual(data.sections.map((section) => section.id), ["tiktok_clicks", "tiktok_watches", "messaging_angle", "hook_tactic", "visual_format"]);
    const [clicks, watches, angle, hook, visual] = data.sections;
    assert.equal(clicks!.result?.text, "No clear winner between 18–24 and 25–34.");
    assert.deepEqual(clicks!.bars.map((bar) => [bar.label, bar.valueText, bar.note, bar.tone]), [
      ["18–24 · 9.3% watch past 2 s", "£0.49 / click", "level", "ink"],
      ["25–34 · 10.0% watch past 2 s", "£0.50 / click", "level", "ink"],
    ]);
    assert.deepEqual(clicks!.thin.map((row) => [row.label, row.line]), [["35–44", "Not enough data yet: £7 spent, 13 clicks"]]);
    assert.equal(clicks!.confidence, "ok · £109 spent · 218 clicks · 90 days · Puzzle · TikTok");
    assert.equal(watches!.result?.text, "Men watch past 2 s 8% more than usual.");
    assert.deepEqual(watches!.bars.map((bar) => [bar.label, bar.valueText, bar.note, bar.tone]), [
      ["Men", "10.5%", "8% over", "olive"],
      ["Women", "9.2%", "6% under", "brick"],
    ]);
    assert.equal(watches!.confidence, "ok · 2-s views ÷ impressions · 55,111 impressions · 90 days · Puzzle · TikTok");
    assert.equal(angle!.borrowed, "TikTok ads aren't tagged yet. These angles, hooks and formats come from Puzzle's Meta ads; the costs are Meta costs.");
    for (const section of [angle!, hook!, visual!]) {
      assert.equal(section.scopeLabel, "from Meta ads");
      assert.match(section.confidence!, /Puzzle · (£ \/ signup · )?Meta$/);
      assert.equal(section.action, null);
    }
    assert.equal(visual!.result?.text, "Headline costs 6% less than usual.");
    assert.equal(data.sections.some((section) => section.id === "asset_type"), false);
    for (const section of [clicks!, watches!]) {
      for (const text of [section.result?.text ?? "", section.confidence ?? "", ...section.bars.map((bar) => bar.label)]) assert.doesNotMatch(text, /signup|ticket/i);
    }
  });

  it("the frames page mounts rail fixtures", () => {
    const page = readFileSync(new URL("../../../app/(dev)/frames/[id]/page.tsx", import.meta.url), "utf8");
    assert.match(page, /RAIL_FRAME_IDS/);
    assert.match(page, /getRailFrame/);
  });
});
