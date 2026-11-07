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

/** IR3's table: Puzzle, registration, baseline £4.16 / signup. */
export const PUZZLE_REGISTRATION: TagRow[] = [
  row("messaging_angle", "event_announcement_update", 4.16, 4.16, 1.0, "ok", 25),
  row("messaging_angle", "artist_headliner", 4.17, 4.16, 1.0, "ok", 28),
  row("messaging_angle", "high_energy_atmosphere", 4.6, 4.16, 1.11, "ok", 25),
  row("hook_tactic", "fomo", 4.16, 4.16, 1.0, "strong", 49),
  row("hook_tactic", "curiosity", 4.3, 4.16, 0.98, "strong", 52),
  row("hook_tactic", "urgency", 5.1, 4.16, 1.0, "thin", 2),
  row("visual_format", "headline", 3.9, 4.16, 0.94, "ok", 21),
  row("visual_format", "cinematic_b_roll", 4.7, 4.16, 1.11, "ok", 24),
  row("asset_type", "lifestyle_image_with_text", 3.85, 4.16, 0.92, "ok", 25),
  row("asset_type", "high_production", 4.59, 4.16, 1.07, "ok", 30),
  row("asset_type", "ugc", null, 4.16, null, "thin", 0),
];

/** Puzzle, ticket sale: every row thin (0 results), so each section falls back. */
export const PUZZLE_TICKET_SALE: TagRow[] = [
  row("messaging_angle", "artist_headliner", null, 46.8, null, "thin", 6),
  row("hook_tactic", "fomo", null, 46.8, null, "thin", 4),
  row("visual_format", "headline", null, 46.8, null, "thin", 5),
  row("asset_type", "high_production", null, 46.8, null, "thin", 6),
];

/** All clients, ticket sale, as drawn in IR2 (baseline £46.80 / purchase). */
export const ALL_TICKET_SALE: TagRow[] = [
  row("messaging_angle", "urgency_scarcity_fomo", 34.92, 46.8, 0.75, "strong", 255),
  row("messaging_angle", "event_announcement_update", 45.13, 46.8, 0.97, "strong", 310),
  row("messaging_angle", "artist_headliner", 47.36, 46.8, 1.01, "strong", 420),
  row("messaging_angle", "high_energy_atmosphere", 51.91, 46.8, 1.11, "strong", 260),
  row("hook_tactic", "social_proof", 21.47, 46.8, 0.46, "strong", 54),
  row("hook_tactic", "curiosity", 38.13, 46.8, 0.82, "strong", 120),
  row("hook_tactic", "fomo", 42.22, 46.8, 0.9, "strong", 210),
  row("hook_tactic", "urgency", 45.38, 46.8, 0.97, "strong", 180),
  row("hook_tactic", "question", 48.1, 46.8, 1.03, "ok", 30),
  row("hook_tactic", "shock", 49.2, 46.8, 1.04, "ok", 24),
  row("hook_tactic", "humour", 50.4, 46.8, 1.06, "ok", 22),
  row("hook_tactic", "nostalgia", 52.0, 46.8, 1.08, "ok", 20),
  row("hook_tactic", "challenge", 55.3, 46.8, 1.12, "ok", 18),
  row("visual_format", "nostalgia", 29.09, 46.8, 0.62, "strong", 15),
  row("visual_format", "headline", 41.38, 46.8, 0.88, "strong", 140),
  row("visual_format", "billboard", 44.57, 46.8, 0.95, "strong", 90),
  row("visual_format", "cinematic_b_roll", 62.9, 46.8, 1.34, "strong", 60),
  row("visual_format", "pov", 64.0, 46.8, 1.3, "ok", 20),
  row("visual_format", "lifestyle", 66.0, 46.8, 1.3, "ok", 25),
  row("visual_format", "testimonial", 68.0, 46.8, 1.35, "ok", 18),
  row("visual_format", "montage", 70.0, 46.8, 1.4, "ok", 16),
  row("visual_format", "split_screen", 72.0, 46.8, 1.4, "ok", 15),
  row("asset_type", "lifestyle_image_with_text", 32.3, 46.8, 0.7, "strong", 120),
  row("asset_type", "high_production", 48.9, 46.8, 1.04, "strong", 210),
  row("asset_type", "ugc", 58.5, 46.8, 1.22, "ok", 40),
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
