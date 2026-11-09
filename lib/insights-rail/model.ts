/**
 * The Insights rail, as data (docs/design-record/2026-11-07-insights-rail.html,
 * issue 2: 2026-11-08-insights-rail-2.html, issue 3:
 * 2026-11-09-insights-rail-3.html).
 *
 * Pure. Readers hand in tag_performance-shaped rows per scope, interest
 * cluster rows per scope and TikTok breakdown rows, and this module
 * decides the scope each section uses (R5), the row order (R13), the bar
 * colours (R6, R14), the result sentence (R7), the confidence line (R8,
 * R12d), the action (R9) and the labels (R10). The rail component only
 * draws what comes out.
 */

export type RailSurface = "event" | "campaign" | "audience_builder" | "tiktok_campaign" | "page";
export type RailStage = "registration" | "ticket_sale";
export type RailScope = "client" | "vertical" | "all";
export type RailConfidence = "thin" | "ok" | "strong";

/** What a page declares (R4). */
export type RailContext = {
  surface: RailSurface;
  /** The page's own title, for the context line. */
  title: string;
  clientId: string | null;
  clientName: string | null;
  verticalId: string | null;
  eventId: string | null;
  stage: RailStage;
  /** "Leads", "Sales": the drawer's objective, when there is one. */
  objective: string | null;
  /** The event page's Lab, when a round exists. */
  lab: RailLab | null;
};

export type RailLab = {
  roundNo: number;
  status: string;
  /** whatsWorking's angle sentence, e.g. "Lineup captions beat POV by 33% on Puzzle". */
  angleLine: string | null;
  ads: { name: string; style: string; verdict: string | null; cost: number | null; results: number | null; metric: string | null }[];
};

/** One tag_performance row, as the readers hand it in. */
export type TagRow = {
  dimension: string;
  valueKey: string;
  fundedAds: number;
  cpr: number | null;
  baselineCpr: number | null;
  shrunkIndex: number | null;
  confidence: RailConfidence;
  /**
   * Fixture only (R17). A raw index stands in where no stored shrunk
   * index exists. Colour and order never read this.
   */
  raw?: boolean;
};

export type TagRowsByScope = Partial<Record<RailScope, TagRow[]>>;

/**
 * One interest cluster at one scope (IR5): its live_evidence pooled over
 * the scope's clients, or the client's own perClient entry. `tried` is
 * false for a cluster no ad set has run yet.
 */
export type ClusterRow = {
  id: string;
  name: string;
  interests: { id: string; name: string }[];
  cpr: number | null;
  /** The cluster's CPR ÷ its clients' usual (live_evidence.cprIndex). */
  cprIndex: number | null;
  fundedAdSets: number;
  clients: number;
  confidence: RailConfidence;
  useCount: number;
  tried: boolean;
};

export type ClusterRowsByScope = Partial<Record<RailScope, ClusterRow[]>>;

/** One tiktok_breakdown_snapshots sum for one client (IR8): age or gender, 90 days. */
export type TikTokRow = {
  dimension: "age" | "gender";
  value: string;
  spend: number;
  clicks: number;
  impressions: number;
  views2s: number;
};

export type Bar = {
  key: string;
  label: string;
  /** £ per result, or the platform's own figure (a rate for "Who watches"). */
  cpr: number;
  /** figure ÷ baseline − 1, in whole points. 0 is level. */
  pct: number;
  /** The words after the figure: "25% under", "level", "40 signups". */
  note: string;
  /** The figure as drawn: "£34.92", "£0.49 / click", "10.5%". */
  valueText: string;
  /** Bar length as a share of the section's scale, 0..1. */
  width: number;
  tone: "olive" | "ink" | "brick";
  confidence: RailConfidence;
  fundedAds: number;
  /** Facets after the label, in ink-3 (R21). Absent on a tag bar. */
  facets?: string;
  /** "3 shows · 27 ads · ticket sale". Absent on a tag bar. */
  detail?: string;
  /** The same sub-line without the stage, for the sheet. */
  detailNarrow?: string;
};

export type ThinRow = { key: string; label: string; fundedAds: number; /** The sentence under the label when it is not the funded-ads one. */ line?: string };

export type GeneratorAngle = "lineup" | "artist_first_person" | "pov" | "scarcity";

export type RailAction = { kind: "use_angle"; angle: GeneratorAngle; label: string; note: string | null };

/** A cluster row as drawn (IR5): name, its line, and the Add cluster action. */
export type ClusterRowView = {
  id: string;
  name: string;
  line: string;
  interests: { id: string; name: string }[];
};

export type InsightSection = {
  id: string;
  kicker: string;
  /** The scope the section ended up on, as its header shows. */
  scopeLabel: string;
  scope: RailScope | null;
  /** Ochre line when the section fell back (R5). */
  fallback: string | null;
  /** Ochre line above the section: learnings borrowed from another platform (R14). */
  borrowed: string | null;
  result: { text: string; winner: boolean } | null;
  bars: Bar[];
  thin: ThinRow[];
  /** The baseline tick, as a share of the scale. */
  baselineAt: number | null;
  more: number;
  confidence: string | null;
  lock: boolean;
  /** Empty-state sentence (rule 8). */
  empty: string | null;
  action: RailAction | null;
  /** A row per Lab ad (IR6). */
  labRows: { name: string; verdict: string | null }[];
  /** Cluster rows with Add cluster (IR5). */
  clusters: ClusterRowView[];
  /** The thin clusters in one line (IR5). */
  clusterThin: { names: string; note: string } | null;
  /** "n clusters not tried yet · show" (IR5). */
  untried: { count: number; names: string[] } | null;
  /** "picked n times so far" (IR5). */
  picked: number | null;
  /** A proven line and its Use line (R22). Absent until one qualifies. */
  chips?: { text: string; action: string }[];
};

export type RailData = {
  sections: InsightSection[];
  /** Why Vertical is off (H6). */
  verticalDisabledReason: string | null;
};

// ── Labels (R10) ────────────────────────────────────────────────────────

export const VALUE_LABELS: Record<string, string> = {
  lifestyle_image_with_text: "Lifestyle image with text",
  urgency_scarcity_fomo: "Urgency / scarcity",
  event_announcement_update: "Event announcement",
  cinematic_b_roll: "Cinematic B-roll",
  artist_headliner: "Artist / headliner",
  high_energy_atmosphere: "High-energy atmosphere",
  social_proof: "Social proof",
  fomo: "FOMO",
  ugc: "UGC",
  pov: "POV",
  high_production: "High production",
  b_roll: "B-roll",
  offer_first_banner: "Offer-first banner",
};

const warned = new Set<string>();

/** The label map first; otherwise Title Case, and a warning once per key. */
export function valueLabel(valueKey: string, warn: (message: string) => void = console.warn): string {
  const mapped = VALUE_LABELS[valueKey];
  if (mapped) return mapped;
  if (!warned.has(valueKey)) {
    warned.add(valueKey);
    warn(`insights rail: no label for value key "${valueKey}"`);
  }
  return valueKey
    .split("_")
    .filter(Boolean)
    .map((word, index) => (index === 0 ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(" ");
}

export const DIMENSION_KICKERS: Record<string, string> = {
  messaging_angle: "Caption angle",
  hook_tactic: "Hook",
  visual_format: "Visual format",
  asset_type: "Asset type",
};

export const SCOPE_LABELS: Record<RailScope, string> = { client: "This client", vertical: "Vertical", all: "All clients" };
export const STAGE_LABELS: Record<RailStage, string> = { registration: "Signup", ticket_sale: "Ticket sale" };

export const VERTICAL_OFF = "Vertical is off until the music rollup stops including other verticals.";
export const LOCK_LINE = "🔒 Across clients · Matas only";

/** The result unit per stage, for "£ / signup". */
export function resultUnit(stage: RailStage): string {
  return stage === "ticket_sale" ? "purchase" : "signup";
}

// ── Stage (R4) ──────────────────────────────────────────────────────────

/** An event that is on sale sells tickets; anything before that signs people up. */
export function stageForEventStatus(status: string | null | undefined): RailStage {
  const value = (status ?? "").trim().toLowerCase();
  return value === "on_sale" || value === "sold_out" || value === "completed" ? "ticket_sale" : "registration";
}

/** The plan's target unit: purchases sell tickets; everything else signs people up. */
export function stageForTargetUnit(unit: string | null | undefined): RailStage {
  return unit === "purchase" ? "ticket_sale" : "registration";
}

/** The audience builder's draft: bottom-funnel and retargeting audiences sell tickets. */
export function stageForFunnelStage(stage: string | null | undefined): RailStage {
  return stage === "bottom_funnel" || stage === "retargeting" ? "ticket_sale" : "registration";
}

/** The Meta objective word for the context line. */
export function objectiveWord(unit: string | null | undefined): string {
  switch (unit) {
    case "purchase":
      return "Sales";
    case "reg":
      return "Leads";
    case "click":
    case "lpv":
      return "Traffic";
    case "view":
      return "Awareness";
    default:
      return "Leads";
  }
}

// ── Actions (R9) ────────────────────────────────────────────────────────

const ANGLE_MAP: Record<string, GeneratorAngle> = {
  "messaging_angle|artist_headliner": "lineup",
  "messaging_angle|urgency_scarcity_fomo": "scarcity",
  "visual_format|pov": "pov",
};

export const GENERATOR_ANGLE_LABELS: Record<GeneratorAngle, string> = {
  lineup: "Lineup",
  artist_first_person: "Artist, first person",
  pov: "POV",
  scarcity: "Scarcity",
};

export function generatorAngleFor(dimension: string, valueKey: string): GeneratorAngle | null {
  return ANGLE_MAP[`${dimension}|${valueKey}`] ?? null;
}

function angleAction(angle: GeneratorAngle): RailAction {
  return {
    kind: "use_angle",
    angle,
    label: `Use ${GENERATOR_ANGLE_LABELS[angle]}`,
    note: angle === "scarcity" ? "needs the ticket count that makes it true" : null,
  };
}

// ── Bars and results (R6, R7, R13) ──────────────────────────────────────

export const OLIVE_AT = 0.95;
export const BRICK_AT = 1.1;
export const CLEAR_WINNER_GAP = 0.05;
export const MAX_BARS = 4;

/** Colour reads the stored shrunk index only, never cpr ÷ baseline (R12b). */
export function barTone(shrunkIndex: number | null, confidence: RailConfidence): Bar["tone"] {
  if (shrunkIndex == null) return "ink";
  if (shrunkIndex <= OLIVE_AT && confidence !== "thin") return "olive";
  if (shrunkIndex >= BRICK_AT) return "brick";
  return "ink";
}

export function pctVsBaseline(cpr: number, baseline: number): number {
  return Math.round((cpr / baseline - 1) * 100);
}

/** "25% under", "11% over", "level". */
export function pctWord(pct: number): string {
  if (pct === 0) return "level";
  return pct < 0 ? `${-pct}% under` : `${pct}% over`;
}

export function money(value: number): string {
  return `£${value.toFixed(2)}`;
}

function confRank(confidence: RailConfidence): number {
  return confidence === "strong" ? 2 : confidence === "ok" ? 1 : 0;
}

function weakest(rows: readonly { confidence: RailConfidence }[]): RailConfidence {
  return rows.reduce<RailConfidence>((acc, row) => (confRank(row.confidence) < confRank(acc) ? row.confidence : acc), "strong");
}

/** The gap between two indexes, read at 3 dp so 0.90 − 0.85 is the margin and not a float hair under it. */
function gapOf(best: number | null, runnerUp: number | null | undefined): number {
  if (runnerUp == null) return Infinity;
  return Math.round(((runnerUp ?? 9) - (best ?? 9)) * 1000) / 1000;
}

const SCALE_HEADROOM = 1.4;

type Built = Pick<InsightSection, "result" | "bars" | "thin" | "baselineAt" | "more" | "confidence" | "action"> & { winnerKey: string | null };

/**
 * One dimension's rows at one scope. Non-thin rows sort by stored shrunk
 * index ascending, ties by funded ads descending (R13); the first four
 * draw and the rest are "+n more". Thin rows never take a slot. The
 * winner is the best shrunk index when it is olive and clear of the
 * runner-up by 0.05. The confidence line's count is the minimum of the
 * drawn rows (R12d).
 */
export function buildSection(args: {
  dimension: string;
  rows: readonly TagRow[];
  stage: RailStage;
  scope: RailScope;
  firstSection: boolean;
  /** The scope word when it is the client's name ("Puzzle") rather than "this client". */
  clientWord?: string | null;
  /** "Meta" on a surface that borrows these learnings (R14). */
  platform?: string | null;
}): Built | null {
  const rows = args.rows.filter((row) => row.dimension === args.dimension);
  if (!rows.length) return null;
  const confident = rows.filter((row) => row.confidence !== "thin" && row.cpr != null && row.baselineCpr != null && row.baselineCpr > 0);
  const thinRows = rows.filter((row) => !confident.includes(row));
  if (!confident.length) return null;
  const baseline = confident[0]!.baselineCpr!;
  const byShrunk = [...confident].sort(
    (a, b) => (a.shrunkIndex ?? 9) - (b.shrunkIndex ?? 9) || b.fundedAds - a.fundedAds || a.cpr! - b.cpr! || a.valueKey.localeCompare(b.valueKey),
  );
  const shown = byShrunk.slice(0, MAX_BARS);
  const scale = Math.max(baseline, ...shown.map((row) => row.cpr!)) * SCALE_HEADROOM;
  const bars: Bar[] = shown.map((row) => ({
    key: row.valueKey,
    label: valueLabel(row.valueKey),
    cpr: row.cpr!,
    pct: pctVsBaseline(row.cpr!, baseline),
    note: pctWord(pctVsBaseline(row.cpr!, baseline)),
    valueText: money(row.cpr!),
    width: row.cpr! / scale,
    tone: barTone(row.shrunkIndex, row.confidence),
    confidence: row.confidence,
    fundedAds: row.fundedAds,
  }));
  const best = byShrunk[0]!;
  const runnerUp = byShrunk[1] ?? null;
  const bestTone = barTone(best.shrunkIndex, best.confidence);
  const clear = gapOf(best.shrunkIndex, runnerUp?.shrunkIndex) >= CLEAR_WINNER_GAP;
  let result: InsightSection["result"];
  let winnerKey: string | null = null;
  if (bestTone === "olive" && clear) {
    result = { text: `${valueLabel(best.valueKey)} costs ${-pctVsBaseline(best.cpr!, baseline)}% less than usual.`, winner: true };
    winnerKey = best.valueKey;
  } else {
    result = runnerUp
      ? { text: `No clear winner between ${valueLabel(best.valueKey)} and ${valueLabel(runnerUp.valueKey)}.`, winner: false }
      : { text: `No clear winner yet.`, winner: false };
  }
  const minFunded = Math.min(...shown.map((row) => row.fundedAds));
  const parts = [weakest(shown), `${minFunded}+ funded ads`, "90 days", args.scope === "client" && args.clientWord ? args.clientWord : scopeWord(args.scope)];
  if (args.firstSection) parts.push(`£ / ${resultUnit(args.stage)}`);
  if (args.platform) parts.push(args.platform);
  const more = Math.max(0, confident.length - shown.length);
  if (more) parts.push(`+${more} more`);
  const angle = winnerKey ? generatorAngleFor(args.dimension, winnerKey) : null;
  return {
    result,
    bars,
    thin: thinRows.sort((a, b) => b.fundedAds - a.fundedAds).map((row) => ({ key: row.valueKey, label: valueLabel(row.valueKey), fundedAds: row.fundedAds })),
    baselineAt: baseline / scale,
    more,
    confidence: parts.join(" · "),
    action: angle ? angleAction(angle) : null,
    winnerKey,
  };
}

function scopeWord(scope: RailScope): string {
  return scope === "all" ? "all clients" : scope === "vertical" ? "vertical" : "this client";
}

/** "Not enough data yet: 2 funded ads" */
export function thinLine(fundedAds: number): string {
  return `Not enough data yet: ${fundedAds} funded ad${fundedAds === 1 ? "" : "s"}`;
}

// ── Scope fallback (R5) ─────────────────────────────────────────────────

const SCOPE_ORDER: RailScope[] = ["client", "vertical", "all"];

/** The scopes a section tries, from the chosen one outward, skipping Vertical while it is off. */
export function scopeChain(chosen: RailScope, verticalOff: boolean): RailScope[] {
  const from = SCOPE_ORDER.indexOf(chosen);
  return SCOPE_ORDER.slice(from).filter((scope) => !(verticalOff && scope === "vertical"));
}

export function fallbackLine(clientName: string | null, stage: RailStage, to: RailScope): string {
  const who = clientName ?? "This client";
  const what = stage === "ticket_sale" ? "ticket sales" : "signups";
  const where = to === "all" ? "all clients" : "its vertical";
  return `${who} has no ${what} attributed to its ads in the last 90 days. Showing ${where}.`;
}

function scopeHeader(scope: RailScope, clientName: string | null): string {
  if (scope === "client") return clientName ?? "This client";
  return SCOPE_LABELS[scope];
}

/**
 * The sections a surface leads with (H4, R12a, R14), as dimensions. Lab,
 * copy, clusters and the TikTok sections are added around them. The
 * event page runs caption angle, hook, visual format, asset type, then
 * the Lab. A TikTok surface borrows caption angle, hook and visual
 * format from Meta; asset type does not carry (TikTok is video only).
 */
export const SURFACE_DIMENSIONS: Record<RailSurface, string[]> = {
  event: ["messaging_angle", "hook_tactic", "visual_format", "asset_type"],
  campaign: ["messaging_angle", "visual_format", "asset_type"],
  audience_builder: [],
  tiktok_campaign: ["messaging_angle", "hook_tactic", "visual_format"],
  page: ["messaging_angle", "hook_tactic", "visual_format"],
};

export const EMPTY_LAB = "No round judged yet. Approve a caption and propose round 1.";
export const EMPTY_BEST_LINES = "Lines are scored overnight. None are scored yet, so the first examples arrive after tonight's run.";
export const EMPTY_PROVEN = "No line is proven yet. Proven lines appear here as chips you can drop into the copy.";
/** R22, word for word. */
export const EMPTY_COPY_LINES = "No line has run in two shows yet. Lines appear here, as chips you can drop into the copy, once one does.";
/** R15, word for word. */
export const EMPTY_LOOKALIKES =
  "Not measured yet. Appears once results are stored per audience (source, lookalike range, cost per result), from the next nightly run after that job ships.";

/** R14, word for word, with the client's name. */
export function borrowedLine(clientName: string | null): string {
  const who = clientName ?? "this client";
  return `TikTok ads aren't tagged yet. These angles, hooks and formats come from ${who}'s Meta ads; the costs are Meta costs.`;
}

export const FROM_META = "from Meta ads";

export type CopyLine = { text: string; cpr: number | null; indexVsEvent: number | null; eventsN: number; proven: boolean };

/** One feature value (R20). adsHash null never collapses (R21). */
export type ShapeRow = {
  feature: string;
  value: string;
  voice: "promoter" | "artist" | "unknown" | null;
  index: number;
  shows: number;
  ads: number;
  stage: RailStage;
  adsHash: string | null;
  confidence: RailConfidence;
};

function emptySection(id: string, kicker: string, scopeLabel: string, empty: string | null, extra?: Partial<InsightSection>): InsightSection {
  return {
    id,
    kicker,
    scopeLabel,
    scope: null,
    fallback: null,
    borrowed: null,
    result: null,
    bars: [],
    thin: [],
    baselineAt: null,
    more: 0,
    confidence: null,
    lock: false,
    empty,
    action: null,
    labRows: [],
    clusters: [],
    clusterThin: null,
    untried: null,
    picked: null,
    ...extra,
  };
}

/**
 * The whole rail for one page: the surface's sections at the chosen
 * scope, each falling back on its own (R5), with the Lab first once a
 * round is judged (IR6), copy first on campaign creation (IR4), clusters
 * on the audience builder (IR5) and TikTok's own sections then the
 * borrowed Meta ones on the TikTok drawer (IR8).
 */
export function buildRail(args: {
  context: RailContext;
  scope: RailScope;
  stage: RailStage;
  rows: TagRowsByScope;
  copy?: { best: CopyLine[]; proven: CopyLine[] } | null;
  /** Feature rows for Best copy shapes (R20). Omitted when there are none. */
  shapes?: { rows: ShapeRow[]; scope: RailScope } | null;
  clusters?: ClusterRowsByScope | null;
  tiktok?: TikTokRow[] | null;
  verticalOff?: boolean;
}): RailData {
  const surface = args.context.surface;
  // Cluster verticals are the clusters' own column, not the rollup, so Vertical stays on there.
  const verticalOff = args.verticalOff ?? surface !== "audience_builder";
  const sections: InsightSection[] = [];
  const clientName = args.context.clientName;

  const shapes = args.shapes?.rows.length
    ? buildShapeSection({ rows: args.shapes.rows, scope: args.shapes.scope, chosen: args.scope, clientName, stage: args.stage, surface })
    : null;
  if (surface === "campaign") {
    if (shapes) sections.push(shapes);
    sections.push(buildCopyLines(args.copy?.proven ?? []));
  }

  if (surface === "audience_builder") {
    sections.push(buildClusterSection({ rows: args.clusters ?? {}, scope: args.scope, stage: args.stage, clientName, verticalId: args.context.verticalId, verticalOff }));
    sections.push(emptySection("lookalikes", "Lookalikes and retargeting", clientName ?? "This client", EMPTY_LOOKALIKES));
    return { sections, verticalDisabledReason: null };
  }

  if (surface === "tiktok_campaign") {
    sections.push(...buildTikTokSections(args.tiktok ?? [], clientName));
  }

  const lab = args.context.lab;
  const labSection = surface === "event" ? buildLabSection(lab) : null;
  if (labSection && !labSection.empty) sections.push(labSection);

  let first = true;
  let borrowedPending = surface === "tiktok_campaign";
  for (const dimension of SURFACE_DIMENSIONS[surface]) {
    let built: Built | null = null;
    let used: RailScope | null = null;
    for (const scope of scopeChain(args.scope, verticalOff)) {
      const candidate = buildSection({
        dimension,
        rows: args.rows[scope] ?? [],
        stage: args.stage,
        scope,
        firstSection: first,
        clientWord: surface === "tiktok_campaign" ? clientName : null,
        platform: surface === "tiktok_campaign" ? "Meta" : null,
      });
      if (candidate) {
        built = candidate;
        used = scope;
        break;
      }
    }
    const kicker = DIMENSION_KICKERS[dimension] ?? valueLabel(dimension);
    const borrowed = borrowedPending ? borrowedLine(clientName) : null;
    borrowedPending = false;
    if (!built || !used) {
      sections.push(
        emptySection(dimension, kicker, surface === "tiktok_campaign" ? FROM_META : scopeHeader(args.scope, clientName), "Not enough data yet.", {
          scope: args.scope,
          borrowed,
        }),
      );
      continue;
    }
    first = false;
    const { winnerKey, ...rest } = built;
    sections.push({
      ...emptySection(dimension, kicker, surface === "tiktok_campaign" ? FROM_META : scopeHeader(used, clientName), null),
      scope: used,
      fallback: used !== args.scope ? fallbackLine(clientName, args.stage, used) : null,
      borrowed,
      lock: used !== "client",
      ...rest,
      // The event page is the only surface with a generator to act on (R9).
      action: surface === "event" && winnerKey ? rest.action : null,
    });
  }

  if (labSection && labSection.empty) sections.push(labSection);
  if (surface === "page" && shapes) sections.push(shapes);

  return { sections, verticalDisabledReason: verticalOff ? VERTICAL_OFF : null };
}

function buildCopyLines(lines: readonly CopyLine[]): InsightSection {
  const proven = lines.filter((line) => line.proven || line.eventsN >= 2);
  if (!proven.length) return emptySection("copy-lines", "Copy lines", "", EMPTY_COPY_LINES);
  return emptySection("copy-lines", "Copy lines", "", null, {
    chips: proven.slice(0, 3).map((line) => ({ text: line.text, action: "Use line" })),
  });
}

/** Thin under 2 shows or under 10 ads (Invented in issue 3). */
export const SHAPE_THIN_MIN_SHOWS = 2;
export const SHAPE_THIN_MIN_ADS = 10;

const SHAPE_RANK = ["line_count_band", "opener", "scarcity_kind", "length_band", "cta_kind", "emoji_count_band", "has_lineup_list", "has_date", "has_price"];

const SHAPE_VALUE: Record<string, Record<string, string>> = {
  opener: { question: "question", statement: "statement", imperative: "imperative", name_first: "artist name", number_first: "number" },
  cta_kind: { sign_up: "Sign up", book_now: "Book now", tag_a_mate: "Tag a mate", link_in_bio: "Link in bio", none: "None" },
  scarcity_kind: { final_x: "final tickets", pct_sold: "percent sold", price_rise: "price rise", countdown: "countdown", sold_out_rollcall: "sold out", none: "none" },
  length_band: { le_60: "short", "61_120": "medium", "121_200": "long", gt_200: "longer" },
  emoji_count_band: { "0": "no", "1_2": "1–2", "3_plus": "3+" },
  line_count_band: { "1": "1", "2_3": "2", "4_plus": "4" },
};

function shapeRank(feature: string): number {
  const at = SHAPE_RANK.indexOf(feature);
  return at === -1 ? SHAPE_RANK.length : at;
}

/** R23. Feature keys never show. */
export function shapeFacet(feature: string, value: string): string {
  if (feature === "has_lineup_list") return value === "yes" ? "lineup listed" : "no lineup";
  if (feature === "has_date") return value === "yes" ? "dated" : "undated";
  if (feature === "has_price") return value === "yes" ? "a price" : "no price";
  const word = SHAPE_VALUE[feature]?.[value] ?? value.replaceAll("_", " ");
  if (feature === "opener") return `Opener: ${word}`;
  if (feature === "cta_kind") return `${word} CTA`;
  if (feature === "scarcity_kind") return `${word} scarcity`;
  if (feature === "length_band") return `${word} body`;
  if (feature === "emoji_count_band") return word === "no" ? "no emoji" : `${word} emoji`;
  if (feature === "line_count_band") return `${word}+ lines`;
  return word;
}

type CollapsedShape = {
  key: string;
  label: string;
  facets: string;
  index: number;
  shows: number;
  ads: number;
  stage: RailStage;
  confidence: RailConfidence;
  voice: ShapeRow["voice"];
  features: { feature: string; value: string }[];
};

function collapseOne(group: readonly ShapeRow[]): CollapsedShape {
  const ordered = [...group].sort((a, b) => shapeRank(a.feature) - shapeRank(b.feature) || a.feature.localeCompare(b.feature));
  const primary = ordered[0]!;
  const voice = ordered.find((row) => row.voice === "promoter" || row.voice === "artist")?.voice ?? primary.voice;
  const voiceFacet = voice === "promoter" ? "promoter voice" : voice === "artist" ? "artist voice" : null;
  const rest = ordered.slice(1).map((row) => shapeFacet(row.feature, row.value));
  return {
    key: primary.adsHash ?? `${primary.feature}:${primary.value}:${primary.stage}`,
    label: shapeFacet(primary.feature, primary.value),
    facets: [voiceFacet, ...rest].filter((facet): facet is string => Boolean(facet)).join(" · "),
    index: primary.index,
    shows: primary.shows,
    ads: primary.ads,
    stage: primary.stage,
    confidence: ordered.reduce<RailConfidence>((min, row) => (confRank(row.confidence) < confRank(min) ? row.confidence : min), "strong"),
    voice,
    features: ordered.map((row) => ({ feature: row.feature, value: row.value })),
  };
}

/** Equal ads_hash is one line. A null hash never collapses. Equal counts with different hashes stay apart (R21). */
export function collapseShapes(rows: readonly ShapeRow[]): CollapsedShape[] {
  const byHash = new Map<string, ShapeRow[]>();
  const alone: ShapeRow[][] = [];
  for (const row of rows) {
    if (!row.adsHash) {
      alone.push([row]);
      continue;
    }
    const group = byHash.get(row.adsHash);
    if (group) group.push(row);
    else byHash.set(row.adsHash, [row]);
  }
  return [...byHash.values(), ...alone].map((group) => collapseOne(group));
}

function shapeThin(row: CollapsedShape): boolean {
  return row.shows < SHAPE_THIN_MIN_SHOWS || row.ads < SHAPE_THIN_MIN_ADS;
}

function shapeStage(stage: RailStage): string {
  return stage === "ticket_sale" ? "ticket sale" : "registration";
}

function shapeResultName(group: CollapsedShape): { name: string; verb: "cost" | "costs" } {
  if (group.features.some((row) => row.feature === "line_count_band" && row.value === "4_plus") && group.label === "4+ lines") {
    return { name: "4+ line bodies", verb: "cost" };
  }
  return { name: group.label, verb: "costs" };
}

function shapeAction(drawn: readonly CollapsedShape[]): RailAction | null {
  const mapped = drawn.find((group) => group.voice === "artist" || group.features.some((row) => row.feature === "has_lineup_list" && row.value === "yes"));
  if (!mapped) return null;
  if (mapped.voice === "artist") {
    return { kind: "use_angle", angle: "artist_first_person", label: "Use shape", note: "artist voice → Angle: Artist, first person" };
  }
  return { kind: "use_angle", angle: "lineup", label: "Use shape", note: "lineup listed → Angle: Lineup" };
}

function buildShapeSection(args: {
  rows: readonly ShapeRow[];
  scope: RailScope;
  chosen: RailScope;
  clientName: string | null;
  stage: RailStage;
  surface: RailSurface;
}): InsightSection | null {
  const collapsed = collapseShapes(args.rows);
  if (!collapsed.length) return null;
  const confident = collapsed.filter((row) => !shapeThin(row)).sort((a, b) => a.index - b.index || b.ads - a.ads || a.label.localeCompare(b.label));
  const thinRows = collapsed.filter((row) => shapeThin(row));
  const shown = confident.slice(0, MAX_BARS);
  const scale = Math.max(1, ...shown.map((row) => row.index), 1) * SCALE_HEADROOM;
  const bars: Bar[] = shown.map((row) => {
    const pct = Math.round((row.index - 1) * 100);
    const counts = `${plural(row.shows, "show")} · ${plural(row.ads, "ad")}`;
    return {
      key: row.key,
      label: row.label,
      facets: row.facets || undefined,
      cpr: row.index,
      pct,
      note: pctWord(pct),
      valueText: row.index.toFixed(2),
      width: row.index / scale,
      tone: barTone(row.index, row.confidence),
      confidence: row.confidence,
      fundedAds: row.ads,
      detail: `${counts} · ${shapeStage(row.stage)}`,
      detailNarrow: counts,
    };
  });
  const best = shown[0] ?? null;
  const runnerUp = confident[1] ?? null;
  const clear = best ? gapOf(best.index, runnerUp?.index) >= CLEAR_WINNER_GAP : false;
  const named = best ? shapeResultName(best) : null;
  const result = !best
    ? null
    : barTone(best.index, best.confidence) === "olive" && clear && named
      ? { text: `${named.name} ${named.verb} ${-Math.round((best.index - 1) * 100)}% less than usual.`, winner: true }
      : runnerUp
        ? { text: `No clear winner between ${best.label} and ${runnerUp.label}.`, winner: false }
        : { text: "No clear winner yet.", winner: false };
  const more = Math.max(0, confident.length - shown.length);
  const minAds = shown.length ? Math.min(...shown.map((row) => row.ads)) : 0;
  const minShows = shown.length ? Math.min(...shown.map((row) => row.shows)) : 0;
  const weakestConf = shown.reduce<RailConfidence>((min, row) => (confRank(row.confidence) < confRank(min) ? row.confidence : min), "strong");
  const scopeWord = args.scope === "all" ? "All clients" : args.scope === "client" ? "this client" : "this vertical";
  const parts = shown.length ? [weakestConf, `${minAds}+ ads`, `${minShows}+ shows`, "90 days", scopeWord] : [];
  if (more) parts.push(`+${more} more`);
  const who = args.clientName ?? "This client";
  return {
    ...emptySection("copy-shapes", "Best copy shapes", SCOPE_LABELS[args.scope], shown.length || thinRows.length ? null : "Not enough data yet."),
    scope: args.scope,
    fallback: args.scope !== args.chosen && args.scope === "all" ? `${who} has no copy shape with enough shows yet. Showing all clients.` : null,
    result,
    bars,
    thin: thinRows.map((row) => ({ key: row.key, label: row.label, fundedAds: row.ads, line: `Not enough data yet: ${plural(row.shows, "show")}` })),
    baselineAt: shown.length ? 1 / scale : null,
    more,
    confidence: parts.length ? parts.join(" · ") : null,
    lock: args.scope !== "client",
    action: args.surface === "campaign" ? shapeAction(shown) : null,
  };
}

// ── Interest clusters (IR5) ─────────────────────────────────────────────

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** "£1.06 / signup · 41% under · 8 funded ad sets · 2 clients · ok" */
export function clusterLine(row: ClusterRow, stage: RailStage): string {
  const parts: string[] = [];
  if (row.cpr != null) parts.push(`${money(row.cpr)} / ${resultUnit(stage)}`);
  if (row.cprIndex != null) parts.push(pctWord(Math.round((row.cprIndex - 1) * 100)));
  parts.push(plural(row.fundedAdSets, "funded ad set"), plural(row.clients, "client"), row.confidence);
  return parts.join(" · ");
}

/**
 * The Interest clusters section (IR5, R15). Tried, non-thin clusters sort
 * by cprIndex ascending (R13), four draw, each with Add cluster; thin
 * clusters share one line; every cluster never tried is behind "show".
 * The % is 1 − cprIndex. Falls back along the scope chain like a tag
 * section (R5).
 */
export function buildClusterSection(args: {
  rows: ClusterRowsByScope;
  scope: RailScope;
  stage: RailStage;
  clientName: string | null;
  verticalId: string | null;
  verticalOff: boolean;
}): InsightSection {
  const kicker = "Interest clusters";
  const stageWord = STAGE_LABELS[args.stage].toLowerCase();
  const header = (scope: RailScope) => (scope === "vertical" ? `${args.verticalId ?? "vertical"} · ${stageWord}` : scope === "client" ? (args.clientName ?? "This client") : `all clients · ${stageWord}`);
  // Untried and picked are facts of the operator's library, not of a scope.
  // The widest scope's row wins: a cluster other clients ran is tried, whatever this client did.
  const every = new Map<string, ClusterRow>();
  for (const scope of [...SCOPE_ORDER].reverse()) for (const row of args.rows[scope] ?? []) if (!every.has(row.id)) every.set(row.id, row);
  const untriedRows = [...every.values()].filter((row) => !row.tried).sort((a, b) => a.name.localeCompare(b.name));
  const untried = { count: untriedRows.length, names: untriedRows.map((row) => row.name) };
  const picked = [...every.values()].reduce((sum, row) => sum + row.useCount, 0);

  for (const scope of scopeChain(args.scope, args.verticalOff)) {
    const tried = (args.rows[scope] ?? []).filter((row) => row.tried);
    const confident = tried.filter((row) => row.confidence !== "thin" && row.cpr != null && row.cprIndex != null);
    if (!confident.length) continue;
    // Thin clusters in index order too, the ones with no index last.
    const thinRows = tried.filter((row) => !confident.includes(row)).sort((a, b) => (a.cprIndex ?? 9) - (b.cprIndex ?? 9) || b.fundedAdSets - a.fundedAdSets || a.name.localeCompare(b.name));
    const byIndex = [...confident].sort((a, b) => a.cprIndex! - b.cprIndex! || b.fundedAdSets - a.fundedAdSets || a.name.localeCompare(b.name));
    const shown = byIndex.slice(0, MAX_BARS);
    const best = shown[0]!;
    const runnerUp = byIndex[1] ?? null;
    const clear = gapOf(best.cprIndex, runnerUp?.cprIndex) >= CLEAR_WINNER_GAP;
    const result =
      best.cprIndex! <= OLIVE_AT && clear
        ? { text: `${best.name} costs ${Math.round((1 - best.cprIndex!) * 100)}% less than its clients' usual.`, winner: true }
        : runnerUp
          ? { text: `No clear winner between ${best.name} and ${runnerUp.name}.`, winner: false }
          : { text: "No clear winner yet.", winner: false };
    const funded = thinRows.map((row) => row.fundedAdSets);
    const lo = Math.min(...funded);
    const hi = Math.max(...funded);
    const clusterThin = thinRows.length
      ? { names: thinRows.map((row) => row.name).join(", "), note: `Not enough data yet: ${lo === hi ? plural(lo, "funded ad set") : `${lo}–${hi} funded ad sets`} each` }
      : null;
    return {
      ...emptySection("interest_clusters", kicker, header(scope), null),
      scope,
      fallback: scope !== args.scope ? fallbackLine(args.clientName, args.stage, scope) : null,
      lock: scope !== "client",
      result,
      more: Math.max(0, confident.length - shown.length),
      clusters: shown.map((row) => ({ id: row.id, name: row.name, line: clusterLine(row, args.stage), interests: row.interests })),
      clusterThin,
      untried,
      picked,
    };
  }
  return {
    ...emptySection("interest_clusters", kicker, header(args.scope), "Not enough data yet."),
    scope: args.scope,
    untried: untried.count ? untried : null,
    picked,
  };
}

// ── TikTok's own units (IR8, R14) ───────────────────────────────────────

/** Within ±5 % of the client's blended figure reads "level" (invented in issue 2). */
export const LEVEL_BAND = 5;
/** A platform-unit row is thin under any of these (R17). */
export const TIKTOK_THIN_MIN_CLICKS = 20;
export const TIKTOK_THIN_MIN_SPEND = 10;
export const TIKTOK_THIN_MIN_IMPRESSIONS = 1000;

export function tiktokPlatformThin(row: Pick<TikTokRow, "clicks" | "spend" | "impressions">): boolean {
  return row.clicks < TIKTOK_THIN_MIN_CLICKS || row.spend < TIKTOK_THIN_MIN_SPEND || row.impressions < TIKTOK_THIN_MIN_IMPRESSIONS;
}
/** Strong at the learning loop's spend bar (lib/learning/shrink STRONG_MIN_SPEND_GBP). */
export const TIKTOK_STRONG_SPEND = 500;

export function tiktokAgeLabel(value: string): string {
  const match = /^AGE_(\d+)_(\d+)$/.exec(value);
  if (match) return `${match[1]}–${match[2]}`;
  const open = /^AGE_(\d+)\+?$/.exec(value) ?? /^AGE_(\d+)_?(?:PLUS|UP)$/.exec(value);
  if (open) return `${open[1]}+`;
  return value;
}

export function tiktokGenderLabel(value: string): string {
  if (value === "MALE") return "Men";
  if (value === "FEMALE") return "Women";
  return value;
}

function levelWord(pct: number): string {
  return Math.abs(pct) <= LEVEL_BAND ? "level" : pctWord(pct);
}

function pct1(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function tiktokConfidence(spend: number): RailConfidence {
  return spend >= TIKTOK_STRONG_SPEND ? "strong" : "ok";
}

function noTikTok(clientName: string | null): string {
  return `Not enough data yet: no TikTok breakdowns for ${clientName ?? "this client"} in the last 90 days.`;
}

/**
 * Who clicks on TikTok (£ / click by age, the 2-s view rate on the label)
 * and Who watches (2-s views ÷ impressions by gender). The baseline tick
 * is the client's blended figure over the same rows. For a cost the R6
 * direction holds; for a rate higher is better. Nothing here says
 * "signup" or "ticket" (R14).
 */
export function buildTikTokSections(rows: readonly TikTokRow[], clientName: string | null): InsightSection[] {
  const who = clientName ?? "this client";
  const scopeLabel = `${clientName ?? "This client"} · 90 days`;
  const tail = ["90 days", who, "TikTok"];
  const ages = rows.filter((row) => row.dimension === "age" && row.value !== "NONE");
  const genders = rows.filter((row) => row.dimension === "gender" && row.value !== "NONE");

  // Who clicks on TikTok.
  let clicks: InsightSection;
  const spend = ages.reduce((sum, row) => sum + row.spend, 0);
  const clickTotal = ages.reduce((sum, row) => sum + row.clicks, 0);
  if (!ages.length || clickTotal === 0) {
    clicks = emptySection("tiktok_clicks", "Who clicks on TikTok", scopeLabel, noTikTok(clientName));
  } else {
    const blended = spend / clickTotal;
    const confident = ages.filter((row) => !tiktokPlatformThin(row));
    const thinRows = ages.filter((row) => !confident.includes(row));
    const indexed = confident
      .map((row) => ({ row, cpc: row.spend / row.clicks, index: row.spend / row.clicks / blended }))
      .sort((a, b) => a.index - b.index || b.row.clicks - a.row.clicks);
    const shown = indexed.slice(0, MAX_BARS);
    const scale = Math.max(blended, ...shown.map((item) => item.cpc)) * SCALE_HEADROOM;
    const bars: Bar[] = shown.map(({ row, cpc, index }) => {
      const pct = Math.round((index - 1) * 100);
      const rate = row.impressions > 0 ? ` · ${pct1(row.views2s / row.impressions)} watch past 2 s` : "";
      return {
        key: row.value,
        label: `${tiktokAgeLabel(row.value)}${rate}`,
        cpr: cpc,
        pct,
        note: levelWord(pct),
        valueText: `${money(cpc)} / click`,
        width: cpc / scale,
        tone: index <= OLIVE_AT ? "olive" : index >= BRICK_AT ? "brick" : "ink",
        confidence: tiktokConfidence(row.spend),
        fundedAds: row.clicks,
      };
    });
    const best = shown[0] ?? null;
    const runnerUp = indexed[1] ?? null;
    const clear = best ? gapOf(best.index, runnerUp?.index) >= CLEAR_WINNER_GAP : false;
    const result = !best
      ? null
      : best.index <= OLIVE_AT && clear
        ? { text: `${tiktokAgeLabel(best.row.value)} costs ${-Math.round((best.index - 1) * 100)}% less than usual.`, winner: true }
        : runnerUp
          ? { text: `No clear winner between ${tiktokAgeLabel(best.row.value)} and ${tiktokAgeLabel(runnerUp.row.value)}.`, winner: false }
          : { text: "No clear winner yet.", winner: false };
    clicks = {
      ...emptySection("tiktok_clicks", "Who clicks on TikTok", scopeLabel, shown.length ? null : "Not enough data yet."),
      scope: "client",
      result,
      bars,
      thin: thinRows
        .sort((a, b) => b.clicks - a.clicks)
        .map((row) => ({ key: row.value, label: tiktokAgeLabel(row.value), fundedAds: row.clicks, line: `Not enough data yet: £${Math.round(row.spend)} spent, ${plural(row.clicks, "click")}` })),
      baselineAt: blended / scale,
      more: Math.max(0, indexed.length - shown.length),
      confidence: [tiktokConfidence(spend), `£${Math.round(spend)} spent`, plural(clickTotal, "click"), ...tail].join(" · "),
    };
  }

  // Who watches.
  let watches: InsightSection;
  const impressions = genders.reduce((sum, row) => sum + row.impressions, 0);
  const views = genders.reduce((sum, row) => sum + row.views2s, 0);
  if (!genders.length || impressions === 0) {
    watches = emptySection("tiktok_watches", "Who watches", scopeLabel, noTikTok(clientName));
  } else {
    const blended = views / impressions;
    const confident = genders.filter((row) => !tiktokPlatformThin(row));
    const thinRows = genders.filter((row) => !confident.includes(row));
    const indexed = confident
      .map((row) => ({ row, rate: row.views2s / row.impressions, index: blended > 0 ? row.views2s / row.impressions / blended : 1 }))
      .sort((a, b) => b.index - a.index || b.row.impressions - a.row.impressions);
    const shown = indexed.slice(0, MAX_BARS);
    const scale = Math.max(blended, ...shown.map((item) => item.rate)) * SCALE_HEADROOM;
    const bars: Bar[] = shown.map(({ row, rate, index }) => {
      const pct = Math.round((index - 1) * 100);
      return {
        key: row.value,
        label: tiktokGenderLabel(row.value),
        cpr: rate,
        pct,
        note: levelWord(pct),
        valueText: pct1(rate),
        width: rate / scale,
        // A rate: higher is better (R14).
        tone: index >= 1 + (1 - OLIVE_AT) ? "olive" : index <= OLIVE_AT ? "brick" : "ink",
        confidence: tiktokConfidence(row.spend),
        fundedAds: row.impressions,
      };
    });
    const best = shown[0] ?? null;
    const runnerUp = indexed[1] ?? null;
    // Higher is better here, so the gap runs the other way.
    const clear = best ? (runnerUp ? Math.round((best.index - runnerUp.index) * 1000) / 1000 >= CLEAR_WINNER_GAP : true) : false;
    const result = !best
      ? null
      : best.index >= 1 + (1 - OLIVE_AT) && clear
        ? { text: `${tiktokGenderLabel(best.row.value)} watch past 2 s ${Math.round((best.index - 1) * 100)}% more than usual.`, winner: true }
        : runnerUp
          ? { text: `No clear winner between ${tiktokGenderLabel(best.row.value)} and ${tiktokGenderLabel(runnerUp.row.value)}.`, winner: false }
          : { text: "No clear winner yet.", winner: false };
    const spendAll = genders.reduce((sum, row) => sum + row.spend, 0);
    watches = {
      ...emptySection("tiktok_watches", "Who watches", scopeLabel, shown.length ? null : "Not enough data yet."),
      scope: "client",
      result,
      bars,
      thin: thinRows
        .sort((a, b) => b.impressions - a.impressions)
        .map((row) => ({ key: row.value, label: tiktokGenderLabel(row.value), fundedAds: row.impressions, line: `Not enough data yet: £${Math.round(row.spend)} spent, ${plural(row.clicks, "click")}` })),
      baselineAt: blended / scale,
      more: Math.max(0, indexed.length - shown.length),
      confidence: [tiktokConfidence(spendAll), "2-s views ÷ impressions", `${impressions.toLocaleString("en-GB")} impressions`, ...tail].join(" · "),
    };
  }

  return [clicks, watches];
}

// ── The Lab (IR6) ───────────────────────────────────────────────────────

const STYLE_LABELS: Record<string, string> = { lineup: "Lineup", artist_first_person: "Artist, first person", pov: "POV", scarcity: "Scarcity" };

function isGeneratorAngle(style: string): style is GeneratorAngle {
  return style in STYLE_LABELS;
}

/**
 * The event's own round, pooled per caption style: cost per result and
 * results. The winning ad names the angle the generator pre-selects.
 */
export function buildLabSection(lab: RailLab | null): InsightSection {
  const judged = lab && lab.status === "judged" && lab.ads.some((ad) => ad.verdict === "winner" || ad.verdict === "loser" || ad.verdict === "flagged");
  if (!lab || !judged) {
    return emptySection("lab", "In the Lab", "", EMPTY_LAB);
  }
  const byStyle = new Map<string, { spend: number; results: number }>();
  for (const ad of lab.ads) {
    if (ad.cost == null || !ad.results) continue;
    const at = byStyle.get(ad.style) ?? { spend: 0, results: 0 };
    at.spend += ad.cost * ad.results;
    at.results += ad.results;
    byStyle.set(ad.style, at);
  }
  const unit = lab.ads.find((ad) => ad.metric)?.metric === "purchase" ? "purchase" : "signup";
  const pooled = [...byStyle.entries()].map(([style, at]) => ({ style, cpr: at.spend / at.results, results: at.results, spend: at.spend }));
  pooled.sort((a, b) => a.cpr - b.cpr);
  const scale = Math.max(...pooled.map((row) => row.cpr)) * SCALE_HEADROOM;
  const winner = lab.ads.find((ad) => ad.verdict === "winner") ?? null;
  const totalSpend = pooled.reduce((sum, row) => sum + row.spend, 0);
  const totalResults = pooled.reduce((sum, row) => sum + row.results, 0);
  const angle = winner && isGeneratorAngle(winner.style) ? winner.style : null;
  return {
    ...emptySection("lab", "In the Lab", `round ${lab.roundNo} · judged`, null),
    scope: "client",
    result: lab.angleLine ? { text: lab.angleLine.endsWith(".") ? lab.angleLine : `${lab.angleLine}.`, winner: true } : null,
    bars: pooled.map((row, index) => ({
      key: row.style,
      label: STYLE_LABELS[row.style] ?? valueLabel(row.style),
      cpr: row.cpr,
      pct: 0,
      note: `${row.results} ${unit}${row.results === 1 ? "" : "s"}`,
      valueText: money(row.cpr),
      width: row.cpr / scale,
      tone: index === 0 && pooled.length > 1 ? "olive" : index === pooled.length - 1 && pooled.length > 1 ? "brick" : "ink",
      confidence: "ok",
      fundedAds: row.results,
    })),
    confidence: `round ${lab.roundNo} · ${totalResults} ${unit}${totalResults === 1 ? "" : "s"} · £${totalSpend.toFixed(0)} spent`,
    action: angle ? angleAction(angle) : null,
    labRows: winner ? [{ name: winner.name, verdict: winner.verdict }] : [],
  };
}
