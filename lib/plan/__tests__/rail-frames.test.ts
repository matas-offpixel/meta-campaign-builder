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
    assert.equal(RAIL_SHOTS.length, 8);
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
    for (const id of ["IR2", "IR3", "IR4", "IR6"] as const) assert.equal(RAIL_FRAME_FIXTURES[id].open, true, id);
    assert.equal(RAIL_FRAME_FIXTURES.IR3.railOnly, true);
    assert.equal(RAIL_FRAME_FIXTURES.IR6.railOnly, true);
  });

  it("IR2: on sale opens on Ticket sale; every tag section falls back to all clients and says why (H5)", () => {
    const { context, data } = RAIL_FRAME_FIXTURES.IR2;
    assert.equal(context.stage, "ticket_sale");
    const tags = data.sections.filter((section) => section.id !== "lab");
    assert.deepEqual(tags.map((section) => section.id), ["messaging_angle", "hook_tactic", "visual_format"]);
    for (const section of tags) {
      assert.equal(section.scope, "all", section.id);
      assert.equal(section.fallback, "Puzzle has no ticket sales attributed to its ads in the last 90 days. Showing all clients.");
      assert.equal(section.lock, true);
    }
    const [angle, hook, visual] = tags;
    assert.equal(angle!.result?.text, "Urgency / scarcity costs 25% less than usual.");
    assert.deepEqual(angle!.bars.map((bar) => [bar.label, bar.cpr, bar.note]), [
      ["Urgency / scarcity", 34.92, "25% under"],
      ["Event announcement", 45.13, "4% under"],
      ["Artist / headliner", 47.36, "1% over"],
      ["High-energy atmosphere", 51.91, "11% over"],
    ]);
    assert.equal(angle!.action?.label, "Use Scarcity");
    assert.equal(hook!.result?.text, "Social proof costs 54% less than usual.");
    assert.equal(hook!.more, 5);
    assert.match(hook!.confidence!, /^strong · 54\+ funded ads · 90 days · all clients · \+5 more$/);
    assert.equal(visual!.result?.text, "Nostalgia costs 38% less than usual.");
    assert.equal(visual!.more, 5);
    assert.equal(data.sections.at(-1)!.id, "lab");
    assert.equal(data.sections.at(-1)!.empty, "No round judged yet. Approve a caption and propose round 1.");
  });

  it("IR3: Puzzle's own rows, two 'No clear winner' sections and two thin rows (H4)", () => {
    const { data } = RAIL_FRAME_FIXTURES.IR3;
    const [angle, hook, visual] = data.sections.filter((section) => section.id !== "lab");
    assert.equal(angle!.scope, "client");
    assert.equal(angle!.scopeLabel, "Puzzle");
    assert.equal(angle!.fallback, null);
    assert.equal(angle!.result?.text, "No clear winner between Event announcement and Artist / headliner.");
    assert.equal(hook!.result?.text, "No clear winner between FOMO and Curiosity.");
    assert.deepEqual(hook!.thin.map((row) => [row.label, row.fundedAds]), [["Urgency", 2]]);
    assert.equal(visual!.result?.text, "Headline costs 6% less than usual.");
    assert.equal(data.sections.some((section) => section.action), false);
    assert.equal(data.verticalDisabledReason, "Vertical is off until the music rollup stops including other verticals.");
  });

  it("IR4: copy leads on campaign creation, both empty with the record's sentences (H9)", () => {
    const { context, data } = RAIL_FRAME_FIXTURES.IR4;
    assert.equal(context.surface, "campaign");
    assert.equal(context.stage, "registration");
    assert.equal(context.objective, "Leads");
    assert.deepEqual(data.sections.map((section) => section.id), ["best-lines", "proven", "messaging_angle", "visual_format", "asset_type"]);
    assert.equal(data.sections[0]!.empty, "Lines are scored overnight. None are scored yet, so the first examples arrive after tonight's run.");
    assert.equal(data.sections[1]!.empty, "No line is proven yet. Proven lines appear here as chips you can drop into the copy.");
    assert.equal(data.sections[4]!.result?.text, "Lifestyle image with text costs 7% less than usual.");
    assert.equal(data.sections.some((section) => section.action), false);
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

  it("the frames page mounts rail fixtures", () => {
    const page = readFileSync(new URL("../../../app/(dev)/frames/[id]/page.tsx", import.meta.url), "utf8");
    assert.match(page, /RAIL_FRAME_IDS/);
    assert.match(page, /getRailFrame/);
  });
});
