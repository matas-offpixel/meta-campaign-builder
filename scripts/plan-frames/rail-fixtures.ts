/**
 * Insights rail fixtures for the IR frames. Every figure is a literal row
 * copied from a record or a read of the production tables on 7 Nov 2026
 * (IR2: tag_performance, all clients, ticket sale, the issue-2 data note;
 * IR3: Puzzle, registration, baseline £4.16; IR5: interest_clusters
 * .live_evidence; IR8: tiktok_breakdown_snapshots sums for Puzzle). The
 * rail's sections are built by lib/insights-rail/model from these rows, so
 * the frames show what the model says, and lib/plan/__tests__ asserts the
 * same figures. No Supabase, no Meta, no TikTok at render time.
 */

import type { AddedCluster } from "../../components/insights-rail/add-cluster.ts";
import type { CreativeLabCardData } from "../../lib/db/creative-lab.ts";
import { railLabFromCard } from "../../lib/insights-rail/lab-summary.ts";
import { buildRail, type ClusterRow, type ClusterRowsByScope, type RailContext, type RailData, type TagRow, type TagRowsByScope, type TikTokRow } from "../../lib/insights-rail/model.ts";
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
  page:
    | { kind: "event"; lab: CreativeLabCardData }
    | { kind: "canvas"; plan: FrameFixture }
    | { kind: "audience"; added: AddedCluster[]; stageLabel: string; draftCount: number };
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
 *   - issue 2's data note: tag_performance, scope all, ticket_sale, 7 Nov,
 *     baseline £46.86 / purchase, with the stored shrunk indexes and
 *     funded counts it prints (R12, R13). Where it prints no stored index
 *     (two hook rows) the raw index cpr ÷ baseline stands in, marked.
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
  // Issue 1 printed 0.98 against a cpr 3% over baseline; a stand-in index must agree with its cpr (#1110 verdict item 4), so the raw 4.30 ÷ 4.16 stands in.
  row("hook_tactic", "curiosity", 4.3, IR3_BASELINE, 1.03, "strong", 49),
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

/** All clients, ticket sale, 7 Nov: the issue-2 data note's stored table. */
export const ALL_TICKET_SALE: TagRow[] = [
  row("messaging_angle", "urgency_scarcity_fomo", 34.92, IR2_BASELINE, 0.755, "strong", 255),
  row("messaging_angle", "event_announcement_update", 45.13, IR2_BASELINE, 0.964, "strong", 624),
  row("messaging_angle", "artist_headliner", 47.36, IR2_BASELINE, 1.011, "strong", 591),
  row("messaging_angle", "high_energy_atmosphere", 51.91, IR2_BASELINE, 1.103, "strong", 225),
  row("hook_tactic", "social_proof", 21.47, IR2_BASELINE, 0.543, "strong", 54),
  row("hook_tactic", "curiosity", 38.13, IR2_BASELINE, 0.814, "strong", 121),
  row("hook_tactic", "fomo", 42.22, IR2_BASELINE, 0.901, "strong", 444),
  row("hook_tactic", "urgency", 45.38, IR2_BASELINE, 0.97, "strong", 255),
  row("hook_tactic", "hidden_hook_1", 45.39, IR2_BASELINE, 0.971, "strong", 54),
  row("hook_tactic", "hidden_hook_2", 45.4, IR2_BASELINE, 0.971, "strong", 54),
  row("hook_tactic", "hidden_hook_3", 45.41, IR2_BASELINE, 0.971, "strong", 54),
  row("hook_tactic", "hidden_hook_4", 45.42, IR2_BASELINE, 0.971, "strong", 54),
  row("hook_tactic", "hidden_hook_5", 45.43, IR2_BASELINE, 0.971, "strong", 54),
  row("visual_format", "nostalgia", 29.09, IR2_BASELINE, 0.773, "strong", 15),
  row("visual_format", "headline", 41.38, IR2_BASELINE, 0.886, "strong", 396),
  row("visual_format", "billboard", 44.57, IR2_BASELINE, 0.964, "strong", 27),
  row("visual_format", "pov", 57.57, IR2_BASELINE, 1.186, "strong", 43),
  row("visual_format", "celebrity", 66.77, IR2_BASELINE, 1.324, "strong", 15),
  row("visual_format", "cinematic_b_roll", 62.9, IR2_BASELINE, 1.33, "strong", 15),
  row("visual_format", "listicle", 72.25, IR2_BASELINE, 1.413, "strong", 15),
  row("asset_type", "hybrid", 32.81, IR2_BASELINE, 0.85, "strong", 10),
  row("asset_type", "lifestyle_image_with_text", 42.21, IR2_BASELINE, 0.903, "strong", 445),
  row("asset_type", "ugc", 48.28, IR2_BASELINE, 1.029, "strong", 153),
  row("asset_type", "high_production", 52.61, IR2_BASELINE, 1.114, "strong", 127),
  row("asset_type", "illustration", 118.95, IR2_BASELINE, 2.36, "ok", 10),
];

// ── IR5: interest_clusters.live_evidence, 7 Nov ─────────────────────────

function cluster(name: string, vertical: string, cpr: number | null, cprIndex: number | null, fundedAdSets: number, clients: number, confidence: ClusterRow["confidence"], useCount: number, adSets: number): ClusterRow & { vertical: string } {
  const id = `fixture-cluster-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  return { id, name, vertical, interests: [], cpr, cprIndex, fundedAdSets, clients, confidence, useCount, tried: adSets > 0 };
}

/** The 36 clusters on 7 Nov: 8 with spend (the record's data note), 28 never tried. */
export const CLUSTERS: (ClusterRow & { vertical: string })[] = [
  cluster("Disc Genre", "music", 1.06, 0.59, 8, 2, "ok", 0, 12),
  cluster("Music festivals", "music", 0.98, 0.67, 3, 2, "ok", 0, 3),
  cluster("Melodic Techno", "music", 1.44, 0.77, 1, 1, "thin", 0, 1),
  cluster("Fashion", "music", 2.22, 0.9, 2, 2, "thin", 0, 2),
  cluster("Latest iPhone users", "music", 2.0, 0.92, 3, 1, "ok", 0, 5),
  cluster("Electronic music", "music", 2.13, 0.98, 4, 1, "ok", 0, 4),
  cluster("Streaming — full", "music", 0.96, 1.03, 2, 2, "thin", 0, 3),
  cluster("Streaming", "music", 2.24, 1.03, 2, 1, "thin", 0, 4),
  cluster("Arsenal", "football", null, null, 0, 0, "thin", 0, 0),
  cluster("Artists — Business Techno", "music", null, null, 0, 0, "thin", 3, 0),
  cluster("Artists — EDM", "music", null, null, 0, 0, "thin", 2, 0),
  cluster("Artists — Genres", "music", null, null, 0, 0, "thin", 1, 0),
  cluster("Artists — Melodic", "music", null, null, 0, 0, "thin", 0, 0),
  cluster("Artists — Metal", "music", null, null, 0, 0, "thin", 1, 0),
  cluster("Artists — POP ARTISTS", "music", null, null, 0, 0, "thin", 0, 0),
  cluster("Artists — Punk", "music", null, null, 0, 0, "thin", 0, 0),
  cluster("Artists — Trance", "music", null, null, 0, 0, "thin", 0, 0),
  cluster("Artists — Trance Genre", "music", null, null, 0, 0, "thin", 0, 0),
  cluster("Deep house", "music", null, null, 0, 0, "thin", 0, 0),
  cluster("Festival Commercial", "music", null, null, 0, 0, "thin", 0, 0),
  cluster("Festivals Venues — Headsy / Wide Ranging", "music", null, null, 0, 0, "thin", 0, 0),
  cluster("Festivals Venues — Tech House", "music", null, null, 0, 0, "thin", 0, 0),
  cluster("Football interests", "football", null, null, 0, 0, "thin", 0, 0),
  cluster("Football Prospecting", "football", null, null, 0, 0, "thin", 0, 0),
  cluster("High end jewellers", "lifestyle", null, null, 0, 0, "thin", 0, 0),
  cluster("Lifestyle", "lifestyle", null, null, 0, 0, "thin", 0, 0),
  cluster("Luxury", "music", null, null, 0, 0, "thin", 0, 0),
  cluster("Other — Commercial Radio", "music", null, null, 0, 0, "thin", 0, 0),
  cluster("Other — Radio", "music", null, null, 0, 0, "thin", 0, 0),
  cluster("Other — Record Shops", "music", null, null, 0, 0, "thin", 0, 0),
  cluster("Other — Wide radio", "music", null, null, 0, 0, "thin", 0, 0),
  cluster("Other — Wider Electronic", "music", null, null, 0, 0, "thin", 0, 0),
  cluster("Prospecting - Fashionistas", "lifestyle", null, null, 0, 0, "thin", 0, 0),
  cluster("Prospecting - Luxury fashion", "lifestyle", null, null, 0, 0, "thin", 0, 0),
  cluster("Publications", "music", null, null, 0, 0, "thin", 0, 0),
  cluster("Radio + music news", "music", null, null, 0, 0, "thin", 0, 0),
];

/** Puzzle has no perClient entry on any cluster, so the client scope is every cluster untried. */
export const CLUSTER_ROWS: ClusterRowsByScope = {
  client: CLUSTERS.map((row) => ({ ...row, cpr: null, cprIndex: null, fundedAdSets: 0, clients: 0, confidence: "thin", tried: false })),
  vertical: CLUSTERS.filter((row) => row.vertical === "music"),
  all: CLUSTERS,
};

// ── IR8: tiktok_breakdown_snapshots, Puzzle, latest window per event, 7 Nov ──

function tt(dimension: TikTokRow["dimension"], value: string, spend: number, clicks: number, impressions: number, views2s: number): TikTokRow {
  return { dimension, value, spend, clicks, impressions, views2s };
}

/**
 * Puzzle's two events summed (Puzzle at Circuit, window to 24 Oct; Puzzle
 * 4th Birthday, window to 7 Nov). The record's data note prints these
 * rounded: £66 / 134 clicks / 9.3 %, £36 / 71 / 10.0 %, £7 / 13; women
 * 9.2 % of 31,257, men 10.5 % of 23,854.
 */
export const PUZZLE_TIKTOK: TikTokRow[] = [
  tt("age", "AGE_18_24", 66.3, 134, 35857, 3317),
  tt("age", "AGE_25_34", 35.57, 71, 16558, 1654),
  tt("age", "AGE_35_44", 6.69, 13, 2704, 385),
  tt("gender", "FEMALE", 61.54, 128, 31257, 2861),
  tt("gender", "MALE", 47.0, 90, 23854, 2494),
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

const AUDIENCE_BUILDER: RailContext = {
  surface: "audience_builder",
  title: "Audience builder",
  clientId: "fixture-puzzle",
  clientName: "Puzzle",
  verticalId: "music",
  eventId: null,
  stage: "registration",
  objective: null,
  lab: null,
};

const TIKTOK_CAMPAIGN: RailContext = {
  surface: "tiktok_campaign",
  title: "New TikTok campaign",
  clientId: "fixture-puzzle",
  clientName: "Puzzle",
  verticalId: "music",
  eventId: "fixture-event-puzzle",
  stage: "registration",
  objective: null,
  lab: null,
};

/** The cluster the rail added before the IR5 shot, as the record draws it on the page. */
const DISC_GENRE_ADDED: AddedCluster[] = [{ id: CLUSTERS[0]!.id, name: CLUSTERS[0]!.name, interests: [], addedAt: RAIL_NOW }];

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
  IR5: {
    kind: "rail",
    id: "IR5",
    title: "Audience builder: interest clusters at the vertical, lookalikes not measured yet",
    now: RAIL_NOW,
    page: { kind: "audience", added: DISC_GENRE_ADDED, stageLabel: "Signup", draftCount: 3 },
    railOnly: false,
    context: AUDIENCE_BUILDER,
    data: buildRail({ context: AUDIENCE_BUILDER, scope: "vertical", stage: "registration", rows: {}, clusters: CLUSTER_ROWS }),
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
  IR8: {
    kind: "rail",
    id: "IR8",
    title: "TikTok drawer: who clicks and who watches on TikTok, then Puzzle's Meta learnings, labelled",
    now: RAIL_NOW,
    page: { kind: "canvas", plan: canvasPlan() },
    railOnly: false,
    context: TIKTOK_CAMPAIGN,
    data: buildRail({ context: TIKTOK_CAMPAIGN, scope: "client", stage: "registration", rows: SIGNUP_ROWS, tiktok: PUZZLE_TIKTOK }),
    open: true,
  },
};

export function getRailFrame(id: string): RailFrameFixture | undefined {
  return RAIL_FRAME_FIXTURES[id as RailFrameId];
}
