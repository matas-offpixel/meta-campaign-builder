/**
 * The Insights rail, as data (docs/design-record/2026-11-07-insights-rail.html).
 *
 * Pure. Readers hand in tag_performance-shaped rows per scope and this
 * module decides the scope each section uses (R5), the bar colours (R6),
 * the result sentence (R7), the confidence line (R8), the action (R9) and
 * the labels (R10). The rail component only draws what comes out.
 */

export type RailSurface = "event" | "campaign" | "audience" | "page";
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
};

export type TagRowsByScope = Partial<Record<RailScope, TagRow[]>>;

export type Bar = {
  key: string;
  label: string;
  /** £ per result. */
  cpr: number;
  /** cpr ÷ baseline − 1, in whole points. 0 is level. */
  pct: number;
  /** The words after the £ figure: "25% under", "level", "40 signups". */
  note: string;
  /** Bar length as a share of the section's scale, 0..1. */
  width: number;
  tone: "olive" | "ink" | "brick";
  confidence: RailConfidence;
  fundedAds: number;
};

export type ThinRow = { key: string; label: string; fundedAds: number };

export type RailAction = { kind: "use_angle"; angle: GeneratorAngle; label: string; note: string | null };

export type GeneratorAngle = "lineup" | "artist_first_person" | "pov" | "scarcity";

export type InsightSection = {
  id: string;
  kicker: string;
  /** The scope the section ended up on, as its header shows. */
  scopeLabel: string;
  scope: RailScope | null;
  /** Ochre line when the section fell back (R5). */
  fallback: string | null;
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

// ── Bars and results (R6, R7) ───────────────────────────────────────────

export const OLIVE_AT = 0.95;
export const BRICK_AT = 1.1;
export const CLEAR_WINNER_GAP = 0.05;
export const MAX_BARS = 4;

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

const SCALE_HEADROOM = 1.4;

type Built = Pick<InsightSection, "result" | "bars" | "thin" | "baselineAt" | "more" | "confidence" | "action"> & { winnerKey: string | null };

/**
 * One dimension's rows at one scope. Bars in cost order, four at most;
 * thin rows draw no bar. The winner is the best shrunk index when it is
 * olive and clear of the runner-up by 0.05.
 */
export function buildSection(args: {
  dimension: string;
  rows: readonly TagRow[];
  stage: RailStage;
  scope: RailScope;
  firstSection: boolean;
}): Built | null {
  const rows = args.rows.filter((row) => row.dimension === args.dimension);
  if (!rows.length) return null;
  const confident = rows.filter((row) => row.confidence !== "thin" && row.cpr != null && row.baselineCpr != null && row.baselineCpr > 0);
  const thinRows = rows.filter((row) => !confident.includes(row));
  if (!confident.length) return null;
  const baseline = confident[0]!.baselineCpr!;
  const byCost = [...confident].sort((a, b) => a.cpr! - b.cpr! || a.valueKey.localeCompare(b.valueKey));
  const shown = byCost.slice(0, MAX_BARS);
  const scale = Math.max(baseline, ...shown.map((row) => row.cpr!)) * SCALE_HEADROOM;
  const bars: Bar[] = shown.map((row) => ({
    key: row.valueKey,
    label: valueLabel(row.valueKey),
    cpr: row.cpr!,
    pct: pctVsBaseline(row.cpr!, baseline),
    note: pctWord(pctVsBaseline(row.cpr!, baseline)),
    width: row.cpr! / scale,
    tone: barTone(row.shrunkIndex, row.confidence),
    confidence: row.confidence,
    fundedAds: row.fundedAds,
  }));
  const byShrunk = [...confident].sort((a, b) => (a.shrunkIndex ?? 9) - (b.shrunkIndex ?? 9) || a.cpr! - b.cpr!);
  const best = byShrunk[0]!;
  const runnerUp = byShrunk[1] ?? null;
  const bestTone = barTone(best.shrunkIndex, best.confidence);
  // The gap is read at 3 dp, so 0.90 − 0.85 is the margin and not a float hair under it.
  const gap = runnerUp == null ? Infinity : Math.round(((runnerUp.shrunkIndex ?? 9) - (best.shrunkIndex ?? 9)) * 1000) / 1000;
  const clear = gap >= CLEAR_WINNER_GAP;
  let result: InsightSection["result"];
  let winnerKey: string | null = null;
  if (bestTone === "olive" && clear) {
    result = { text: `${valueLabel(best.valueKey)} costs ${-pctVsBaseline(best.cpr!, baseline)}% less than usual.`, winner: true };
    winnerKey = best.valueKey;
  } else {
    const [a, b] = byCost;
    result = b ? { text: `No clear winner between ${valueLabel(a!.valueKey)} and ${valueLabel(b.valueKey)}.`, winner: false } : { text: `No clear winner yet.`, winner: false };
  }
  const minFunded = Math.min(...shown.map((row) => row.fundedAds));
  const parts = [weakest(shown), `${minFunded}+ funded ads`, "90 days", scopeWord(args.scope)];
  if (args.firstSection) parts.push(`£ / ${resultUnit(args.stage)}`);
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
 * The sections a surface leads with (H4), as dimensions. Lab and copy are
 * added around them. The event page runs caption angle, hook, visual
 * format, asset type, then the Lab (the #1102 verdict's ruling).
 */
export const SURFACE_DIMENSIONS: Record<RailSurface, string[]> = {
  event: ["messaging_angle", "hook_tactic", "visual_format", "asset_type"],
  campaign: ["messaging_angle", "visual_format", "asset_type"],
  audience: [],
  page: ["messaging_angle", "hook_tactic", "visual_format"],
};

export const EMPTY_LAB = "No round judged yet. Approve a caption and propose round 1.";
export const EMPTY_BEST_LINES = "Lines are scored overnight. None are scored yet, so the first examples arrive after tonight's run.";
export const EMPTY_PROVEN = "No line is proven yet. Proven lines appear here as chips you can drop into the copy.";

export type CopyLine = { text: string; cpr: number | null; indexVsEvent: number | null; eventsN: number; proven: boolean };

/**
 * The whole rail for one page: the surface's sections at the chosen
 * scope, each falling back on its own (R5), with the Lab first once a
 * round is judged (IR6) and copy first on campaign creation (IR4).
 */
export function buildRail(args: {
  context: RailContext;
  scope: RailScope;
  stage: RailStage;
  rows: TagRowsByScope;
  copy?: { best: CopyLine[]; proven: CopyLine[] } | null;
  verticalOff?: boolean;
}): RailData {
  const verticalOff = args.verticalOff ?? true;
  const sections: InsightSection[] = [];
  const clientName = args.context.clientName;

  if (args.context.surface === "campaign") {
    sections.push(copySection("best-lines", "Best lines", args.copy?.best ?? [], EMPTY_BEST_LINES));
    sections.push(copySection("proven", "Proven elsewhere", args.copy?.proven ?? [], EMPTY_PROVEN));
  }

  const lab = args.context.lab;
  const labSection = args.context.surface === "event" ? buildLabSection(lab) : null;
  if (labSection && !labSection.empty) sections.push(labSection);

  let first = true;
  for (const dimension of SURFACE_DIMENSIONS[args.context.surface]) {
    let built: Built | null = null;
    let used: RailScope | null = null;
    for (const scope of scopeChain(args.scope, verticalOff)) {
      const candidate = buildSection({ dimension, rows: args.rows[scope] ?? [], stage: args.stage, scope, firstSection: first });
      if (candidate) {
        built = candidate;
        used = scope;
        break;
      }
    }
    const kicker = DIMENSION_KICKERS[dimension] ?? valueLabel(dimension);
    if (!built || !used) {
      sections.push({
        id: dimension,
        kicker,
        scopeLabel: scopeHeader(args.scope, clientName),
        scope: args.scope,
        fallback: null,
        result: null,
        bars: [],
        thin: [],
        baselineAt: null,
        more: 0,
        confidence: null,
        lock: false,
        empty: "Not enough data yet.",
        action: null,
        labRows: [],
      });
      continue;
    }
    first = false;
    const { winnerKey, ...rest } = built;
    sections.push({
      id: dimension,
      kicker,
      scopeLabel: scopeHeader(used, clientName),
      scope: used,
      fallback: used !== args.scope ? fallbackLine(clientName, args.stage, used) : null,
      lock: used !== "client",
      empty: null,
      labRows: [],
      ...rest,
      // The event page is the only surface with a generator to act on (R9).
      action: args.context.surface === "event" && winnerKey ? rest.action : null,
    });
  }

  if (labSection && labSection.empty) sections.push(labSection);

  return { sections, verticalDisabledReason: verticalOff ? VERTICAL_OFF : null };
}

function copySection(id: string, kicker: string, lines: CopyLine[], empty: string): InsightSection {
  return {
    id,
    kicker,
    scopeLabel: "",
    scope: null,
    fallback: null,
    result: null,
    bars: [],
    thin: [],
    baselineAt: null,
    more: 0,
    confidence: null,
    lock: false,
    empty: lines.length ? null : empty,
    action: null,
    labRows: lines.slice(0, 3).map((line) => ({ name: line.text, verdict: line.proven ? "winner" : null })),
  };
}

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
    return {
      id: "lab",
      kicker: "In the Lab",
      scopeLabel: "",
      scope: null,
      fallback: null,
      result: null,
      bars: [],
      thin: [],
      baselineAt: null,
      more: 0,
      confidence: null,
      lock: false,
      empty: EMPTY_LAB,
      action: null,
      labRows: [],
    };
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
    id: "lab",
    kicker: "In the Lab",
    scopeLabel: `round ${lab.roundNo} · judged`,
    scope: "client",
    fallback: null,
    result: lab.angleLine ? { text: lab.angleLine.endsWith(".") ? lab.angleLine : `${lab.angleLine}.`, winner: true } : null,
    bars: pooled.map((row, index) => ({
      key: row.style,
      label: STYLE_LABELS[row.style] ?? valueLabel(row.style),
      cpr: row.cpr,
      pct: 0,
      note: `${row.results} ${unit}${row.results === 1 ? "" : "s"}`,
      width: row.cpr / scale,
      tone: index === 0 && pooled.length > 1 ? "olive" : index === pooled.length - 1 && pooled.length > 1 ? "brick" : "ink",
      confidence: "ok",
      fundedAds: row.results,
    })),
    thin: [],
    baselineAt: null,
    more: 0,
    confidence: `round ${lab.roundNo} · ${totalResults} ${unit}${totalResults === 1 ? "" : "s"} · £${totalSpend.toFixed(0)} spent`,
    lock: false,
    empty: null,
    action: angle ? angleAction(angle) : null,
    labRows: winner ? [{ name: winner.name, verdict: winner.verdict }] : [],
  };
}
