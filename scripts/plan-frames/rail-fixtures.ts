/**
 * Insights rail fixtures for the IR frames. Every figure is a literal
 * tag_performance-shaped row from the record (IR2: all clients, ticket
 * sale, 7 Nov; IR3: Puzzle, registration, baseline £4.16). The rail's
 * sections are built by lib/insights-rail/model from these rows, so the
 * frames show what the model says, and lib/insights-rail/__tests__
 * asserts the same figures. No Supabase, no Meta.
 */

import type { CreativeLabCardData } from "../../lib/db/creative-lab.ts";
import { railLabFromCard } from "../../lib/insights-rail/lab-summary.ts";
import { buildRail, type RailContext, type RailData, type TagRow, type TagRowsByScope } from "../../lib/insights-rail/model.ts";
import { getFrame } from "./fixtures.ts";
import type { FrameFixture } from "./types.ts";
import { LAB_FRAME_FIXTURES } from "./lab-fixtures.ts";
import type { RailFrameId } from "./rail-ids.ts";

export type RailFrameFixture = {
  kind: "rail";
  id: RailFrameId;
  title: string;
  now: string;
  /** What the rail sits beside. */
  page: { kind: "event"; lab: CreativeLabCardData } | { kind: "canvas"; plan: FrameFixture };
  /** Shoot the rail alone (IR3, IR6), as the record draws it. */
  railOnly: boolean;
  context: RailContext;
  data: RailData;
  open: boolean;
};

export const RAIL_NOW = "2026-11-07T12:00:00.000Z";

function row(dimension: string, valueKey: string, cpr: number | null, baselineCpr: number, shrunkIndex: number | null, confidence: TagRow["confidence"], fundedAds: number): TagRow {
  return { dimension, valueKey, cpr, baselineCpr, shrunkIndex, confidence, fundedAds };
}

/**
 * Every row here is copied, never typed. The source of each figure is the
 * "IR sources" table in scripts/plan-frames/README.md, which
 * lib/plan/__tests__/rail-sources.test.ts checks row by row:
 *   - record IR3 table: Puzzle, registration, baseline £4.16 / signup (cpr,
 *     % and shrunk index as printed; funded ads are the section's
 *     confidence-line minimum, since the record prints only that);
 *   - record IR2 bars: all clients, ticket sale, 7 Nov (cpr as printed;
 *     the stored shrunk index was not published, so the raw index
 *     cpr ÷ baseline stands in, rounded to 3 dp);
 *   - tag_performance, scope all, ticket_sale, 7 Nov, baseline £46.86 /
 *     purchase (the #1102 verdict 9b): the asset type rows, with their
 *     stored shrunk indexes.
 * Hidden rows (beyond the four bars) exist only for the record's "+n
 * more"; their figures are never drawn.
 */
export const IR3_BASELINE = 4.16;
export const IR2_BASELINE = 46.86;

export const PUZZLE_REGISTRATION: TagRow[] = [
  row("messaging_angle", "event_announcement_update", 4.16, IR3_BASELINE, 1.0, "ok", 25),
  row("messaging_angle", "artist_headliner", 4.17, IR3_BASELINE, 1.0, "ok", 25),
  row("messaging_angle", "high_energy_atmosphere", 4.6, IR3_BASELINE, 1.11, "ok", 25),
  row("hook_tactic", "fomo", 4.16, IR3_BASELINE, 1.0, "strong", 49),
  row("hook_tactic", "curiosity", 4.3, IR3_BASELINE, 0.98, "strong", 49),
  row("hook_tactic", "urgency", null, IR3_BASELINE, null, "thin", 2),
  row("visual_format", "headline", 3.9, IR3_BASELINE, 0.94, "ok", 21),
  row("visual_format", "cinematic_b_roll", 4.7, IR3_BASELINE, 1.11, "ok", 21),
  row("asset_type", "lifestyle_image_with_text", 3.85, IR3_BASELINE, 0.92, "ok", 25),
  row("asset_type", "high_production", 4.59, IR3_BASELINE, 1.07, "ok", 25),
  row("asset_type", "ugc", null, IR3_BASELINE, null, "thin", 0),
];

/** Puzzle, ticket sale: every stored row is thin (0 results), so each section falls back. Never drawn. */
export const PUZZLE_TICKET_SALE: TagRow[] = [
  row("messaging_angle", "artist_headliner", null, IR2_BASELINE, null, "thin", 0),
  row("hook_tactic", "fomo", null, IR2_BASELINE, null, "thin", 0),
  row("visual_format", "headline", null, IR2_BASELINE, null, "thin", 0),
  row("asset_type", "high_production", null, IR2_BASELINE, null, "thin", 0),
];

/** All clients, ticket sale, 7 Nov. */
export const ALL_TICKET_SALE: TagRow[] = [
  row("messaging_angle", "urgency_scarcity_fomo", 34.92, IR2_BASELINE, 0.745, "strong", 255),
  row("messaging_angle", "event_announcement_update", 45.13, IR2_BASELINE, 0.963, "strong", 255),
  row("messaging_angle", "artist_headliner", 47.36, IR2_BASELINE, 1.011, "strong", 255),
  row("messaging_angle", "high_energy_atmosphere", 51.91, IR2_BASELINE, 1.108, "strong", 255),
  row("hook_tactic", "social_proof", 21.47, IR2_BASELINE, 0.458, "strong", 54),
  row("hook_tactic", "curiosity", 38.13, IR2_BASELINE, 0.814, "strong", 54),
  row("hook_tactic", "fomo", 42.22, IR2_BASELINE, 0.901, "strong", 54),
  row("hook_tactic", "urgency", 45.38, IR2_BASELINE, 0.968, "strong", 54),
  row("hook_tactic", "hidden_hook_1", 45.39, IR2_BASELINE, 0.969, "strong", 54),
  row("hook_tactic", "hidden_hook_2", 45.4, IR2_BASELINE, 0.969, "strong", 54),
  row("hook_tactic", "hidden_hook_3", 45.41, IR2_BASELINE, 0.969, "strong", 54),
  row("hook_tactic", "hidden_hook_4", 45.42, IR2_BASELINE, 0.969, "strong", 54),
  row("hook_tactic", "hidden_hook_5", 45.43, IR2_BASELINE, 0.97, "strong", 54),
  row("visual_format", "nostalgia", 29.09, IR2_BASELINE, 0.621, "strong", 15),
  row("visual_format", "headline", 41.38, IR2_BASELINE, 0.883, "strong", 15),
  row("visual_format", "billboard", 44.57, IR2_BASELINE, 0.951, "strong", 15),
  row("visual_format", "cinematic_b_roll", 62.9, IR2_BASELINE, 1.342, "strong", 15),
  row("visual_format", "hidden_visual_1", 62.91, IR2_BASELINE, 1.343, "strong", 15),
  row("visual_format", "hidden_visual_2", 62.92, IR2_BASELINE, 1.343, "strong", 15),
  row("visual_format", "hidden_visual_3", 62.93, IR2_BASELINE, 1.343, "strong", 15),
  row("visual_format", "hidden_visual_4", 62.94, IR2_BASELINE, 1.343, "strong", 15),
  row("visual_format", "hidden_visual_5", 62.95, IR2_BASELINE, 1.343, "strong", 15),
  row("asset_type", "hybrid", 32.81, IR2_BASELINE, 0.85, "strong", 10),
  row("asset_type", "lifestyle_image_with_text", 42.21, IR2_BASELINE, 0.9, "strong", 10),
  row("asset_type", "ugc", 48.28, IR2_BASELINE, 1.03, "strong", 10),
  row("asset_type", "high_production", 52.61, IR2_BASELINE, 1.11, "strong", 10),
  row("asset_type", "illustration", 118.95, IR2_BASELINE, 2.538, "ok", 10),
];

const PUZZLE: RailContext = {
  surface: "event",
  title: "Puzzle 4th Birthday",
  clientId: "fixture-puzzle",
  clientName: "Puzzle",
  verticalId: "music",
  eventId: "fixture-event-puzzle",
  stage: "ticket_sale",
  objective: null,
  lab: null,
};

const TICKET_ROWS: TagRowsByScope = { client: PUZZLE_TICKET_SALE, all: ALL_TICKET_SALE };
const SIGNUP_ROWS: TagRowsByScope = { client: PUZZLE_REGISTRATION, all: ALL_TICKET_SALE };

/** The event page beside the rail: the CL3 Lab (clips and one proposed caption), renamed to Puzzle. */
function puzzlePage(): CreativeLabCardData {
  const base = LAB_FRAME_FIXTURES.CL3.lab;
  return { ...base, eventName: "Puzzle 4th Birthday", clientName: "Puzzle", eventStatus: "on_sale", paydayLabel: "Friday, 27 November 2026", daysToEvent: 50 };
}

const CL6 = LAB_FRAME_FIXTURES.CL6.lab;
const FIXTURE_NIGHT: RailContext = {
  surface: "event",
  title: CL6.eventName,
  clientId: "fixture-client",
  clientName: CL6.clientName,
  verticalId: "music",
  eventId: CL6.eventId,
  stage: "ticket_sale",
  objective: null,
  lab: railLabFromCard(CL6),
};

function canvasPlan(): FrameFixture {
  const plan = getFrame("A1");
  if (!plan) throw new Error("plan fixture A1 is missing");
  return plan;
}

const CAMPAIGN: RailContext = {
  surface: "campaign",
  title: "New Meta campaign",
  clientId: "fixture-puzzle",
  clientName: "Puzzle",
  verticalId: "music",
  eventId: "fixture-event-puzzle",
  stage: "registration",
  objective: "Leads",
  lab: null,
};

export const RAIL_FRAME_FIXTURES: Record<RailFrameId, RailFrameFixture> = {
  IR1: {
    kind: "rail",
    id: "IR1",
    title: "Event page, rail collapsed",
    now: RAIL_NOW,
    page: { kind: "event", lab: puzzlePage() },
    railOnly: false,
    context: PUZZLE,
    data: buildRail({ context: PUZZLE, scope: "client", stage: "ticket_sale", rows: TICKET_ROWS }),
    open: false,
  },
  IR2: {
    kind: "rail",
    id: "IR2",
    title: "Event page on sale: ticket sale, client thin, sections fall back to all clients",
    now: RAIL_NOW,
    page: { kind: "event", lab: puzzlePage() },
    railOnly: false,
    context: PUZZLE,
    data: buildRail({ context: PUZZLE, scope: "client", stage: "ticket_sale", rows: TICKET_ROWS }),
    open: true,
  },
  IR3: {
    kind: "rail",
    id: "IR3",
    title: "Event page, Signup: Puzzle's own rows, no clear winner and thin rows",
    now: RAIL_NOW,
    page: { kind: "event", lab: puzzlePage() },
    railOnly: true,
    context: { ...PUZZLE, stage: "registration" },
    data: buildRail({ context: { ...PUZZLE, stage: "registration" }, scope: "client", stage: "registration", rows: SIGNUP_ROWS }),
    open: true,
  },
  IR4: {
    kind: "rail",
    id: "IR4",
    title: "Campaign creation: copy first, both empty",
    now: RAIL_NOW,
    page: { kind: "canvas", plan: canvasPlan() },
    railOnly: false,
    context: CAMPAIGN,
    data: buildRail({ context: CAMPAIGN, scope: "client", stage: "registration", rows: SIGNUP_ROWS, copy: { best: [], proven: [] } }),
    open: true,
  },
  IR6: {
    kind: "rail",
    id: "IR6",
    title: "Event page with Lab verdicts (CL6): the Lab leads, Use Lineup",
    now: RAIL_NOW,
    page: { kind: "event", lab: CL6 },
    railOnly: true,
    context: { ...FIXTURE_NIGHT, stage: "registration" },
    data: buildRail({ context: { ...FIXTURE_NIGHT, stage: "registration" }, scope: "client", stage: "registration", rows: SIGNUP_ROWS }),
    open: true,
  },
  IR7: {
    kind: "rail",
    id: "IR7",
    title: "393 rest state: the pill in the header",
    now: RAIL_NOW,
    page: { kind: "event", lab: puzzlePage() },
    railOnly: false,
    context: PUZZLE,
    data: buildRail({ context: PUZZLE, scope: "client", stage: "ticket_sale", rows: TICKET_ROWS }),
    open: false,
  },
};

export function getRailFrame(id: string): RailFrameFixture | undefined {
  return RAIL_FRAME_FIXTURES[id as RailFrameId];
}
