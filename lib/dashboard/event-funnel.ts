/**
 * Per-event funnel reporting (roadmap v2 Phase A.1).
 *
 * Stages: reach → clicks → landing-page views → signups → purchases.
 * Honesty beats completeness: a missing column is "not tracked", a
 * missing first-party pipe is "not instrumented" — never a silent zero.
 *
 * Seeds are industry defaults only. Phase C learns per-client rates;
 * this module only displays the seeds.
 */

export const EVENT_FUNNEL_SEEDS = {
  reachToClick: 0.15,
  clickToLpv: 0.5,
  lpvToPurchase: 0.05,
} as const;

export const EVENT_FUNNEL_SEED_LABEL =
  "industry seed — will become learned per client";

export type FunnelProvenance =
  | "platform-reported"
  | "first-party"
  | "manual entry"
  | "modelled"
  | "not instrumented";

export type FunnelPlatform = "meta" | "tiktok" | "google";

export type EventFunnelStageKey =
  | "reach"
  | "clicks"
  | "lpv"
  | "signups"
  | "purchases";

export interface EventFunnelPlatformSplit {
  platform: FunnelPlatform;
  label: string;
  /** Null when this platform has no column for the stage. */
  value: number | null;
  tracked: boolean;
  spend: number;
}

export interface EventFunnelStage {
  key: EventFunnelStageKey;
  label: string;
  /** Null when the stage is not instrumented. */
  value: number | null;
  provenance: FunnelProvenance;
  provenanceDetail: string;
  conversionFromPrevious: number | null;
  conversionLabel: string | null;
  seedRate: number | null;
  seedLabel: string | null;
  platformSplit: EventFunnelPlatformSplit[] | null;
}

/**
 * Every cost cell is a finite amount or a named state. There is no
 * third case — never Infinity, NaN, or a silent blank.
 */
export type FunnelCostCell =
  | { kind: "amount"; value: number }
  | { kind: "no_impressions_yet" }
  | { kind: "no_reach_yet" }
  | { kind: "no_clicks_yet" }
  | { kind: "no_signups_yet" }
  | { kind: "no_lpv_yet" }
  | { kind: "no_tickets_yet" }
  | { kind: "no_spend_recorded" }
  | { kind: "no_reach_data" }
  | { kind: "not_instrumented" };

export const FUNNEL_COST_CELL_KINDS = [
  "amount",
  "no_impressions_yet",
  "no_reach_yet",
  "no_clicks_yet",
  "no_signups_yet",
  "no_lpv_yet",
  "no_tickets_yet",
  "no_spend_recorded",
  "no_reach_data",
  "not_instrumented",
] as const satisfies ReadonlyArray<FunnelCostCell["kind"]>;

export interface EventFunnelPlatformCosts {
  platform: FunnelPlatform;
  label: string;
  spend: number;
  cpm: FunnelCostCell;
  costPerReach: FunnelCostCell;
  cpc: FunnelCostCell;
}

export interface EventFunnelCosts {
  platforms: EventFunnelPlatformCosts[];
  bestCpm: FunnelPlatform | null;
  bestCostPerReach: FunnelPlatform | null;
  bestCpc: FunnelPlatform | null;
  costPerLpv: FunnelCostCell;
  costPerSignup: FunnelCostCell;
  costPerTicket: FunnelCostCell;
  ticketProvenance: FunnelProvenance;
}

export interface EventFunnelView {
  stages: EventFunnelStage[];
  /** Meta Insights landing_page_view actions — not the first-party LPV stage. */
  metaReportedLpv: number;
  costs: EventFunnelCosts;
}

export interface EventFunnelInput {
  metaReach: number;
  metaImpressions: number;
  metaClicks: number;
  metaSpend: number;
  tiktokReach: number;
  tiktokImpressions: number;
  tiktokClicks: number;
  tiktokSpend: number;
  /** Google has impressions + clicks, no unique-reach column. */
  googleImpressions: number;
  googleClicks: number;
  googleSpend: number;
  /** Meta `landing_page_views` (platform action). Never the first-party stage. */
  metaReportedLpv: number;
  /**
   * First-party `lp_page_views` count. Null = capture not queried /
   * table missing (stage stays not instrumented). 0 is a real zero.
   */
  firstPartyLpv?: number | null;
  signupCount: number;
  purchases: number;
  /** Distinct `ticket_sales_snapshots.source` values for this event. */
  snapshotSources: string[];
}

const SOURCE_PRIORITY: Record<string, number> = {
  eventbrite: 1,
  foursomething: 2,
  fourthefans: 2,
  xlsx_import: 3,
  manual: 4,
};

const PLATFORM_LABEL: Record<FunnelPlatform, string> = {
  meta: "Meta",
  tiktok: "TikTok",
  google: "Google Ads",
};

export function winningSnapshotSource(sources: string[]): string | null {
  let best: string | null = null;
  let bestPri = -1;
  for (const raw of sources) {
    const source = raw.trim();
    if (!source) continue;
    const pri = SOURCE_PRIORITY[source] ?? 0;
    if (pri > bestPri) {
      best = source;
      bestPri = pri;
    }
  }
  return best;
}

export function provenanceForPurchaseSource(
  source: string | null,
): FunnelProvenance {
  if (source === "manual" || source === "xlsx_import") return "manual entry";
  return "first-party";
}

function n(value: number | null | undefined): number {
  const v = Number(value ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function rate(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null) return null;
  if (denominator <= 0) return null;
  return numerator / denominator;
}

function split(
  platform: FunnelPlatform,
  value: number | null,
  tracked: boolean,
  spend: number,
): EventFunnelPlatformSplit {
  return {
    platform,
    label: PLATFORM_LABEL[platform],
    value: tracked ? n(value) : null,
    tracked,
    spend: n(spend),
  };
}

function visibleSplits(
  rows: EventFunnelPlatformSplit[],
): EventFunnelPlatformSplit[] {
  return rows.filter((r) => r.spend > 0 || (r.tracked && (r.value ?? 0) > 0));
}

export function isAmountCell(
  cell: FunnelCostCell,
): cell is { kind: "amount"; value: number } {
  return cell.kind === "amount" && Number.isFinite(cell.value);
}

/**
 * Spend / metric (optionally × scale). Named states instead of
 * Infinity/NaN. 0/0 is treated as an absent pair (no_spend_recorded)
 * so callers never leak a third case.
 */
export function costPerUnit(
  spend: number,
  metric: number,
  zeroMetricKind:
    | "no_impressions_yet"
    | "no_reach_yet"
    | "no_clicks_yet"
    | "no_signups_yet"
    | "no_lpv_yet"
    | "no_tickets_yet",
  scale = 1,
): FunnelCostCell {
  const s = n(spend);
  const m = n(metric);
  if (s > 0 && m <= 0) return { kind: zeroMetricKind };
  if (s <= 0 && m > 0) return { kind: "no_spend_recorded" };
  if (s <= 0 && m <= 0) return { kind: "no_spend_recorded" };
  const value = (s / m) * scale;
  if (!Number.isFinite(value)) return { kind: zeroMetricKind };
  return { kind: "amount", value };
}

export function funnelCostLabel(cell: FunnelCostCell): string {
  switch (cell.kind) {
    case "amount":
      return Number.isFinite(cell.value) ? String(cell.value) : "—";
    case "no_impressions_yet":
      return "no impressions yet";
    case "no_reach_yet":
      return "no reach yet";
    case "no_clicks_yet":
      return "no clicks yet";
    case "no_signups_yet":
      return "no signups yet";
    case "no_lpv_yet":
      return "no landing-page views yet";
    case "no_tickets_yet":
      return "no tickets yet";
    case "no_spend_recorded":
      return "no spend recorded";
    case "no_reach_data":
      return "no reach data";
    case "not_instrumented":
      return "not instrumented yet — Phase B";
  }
}

function pickBestCost(
  rows: EventFunnelPlatformCosts[],
  key: "cpm" | "costPerReach" | "cpc",
): FunnelPlatform | null {
  const scored = rows.filter((r) => isAmountCell(r[key]));
  if (scored.length < 2) return null;
  return scored.reduce((best, row) => {
    const a = best[key];
    const b = row[key];
    if (!isAmountCell(a) || !isAmountCell(b)) return best;
    return b.value < a.value ? row : best;
  }).platform;
}

function platformHasSignal(args: {
  spend: number;
  impressions: number;
  reach: number;
  reachTracked: boolean;
  clicks: number;
}): boolean {
  return (
    args.spend > 0 ||
    args.impressions > 0 ||
    args.clicks > 0 ||
    (args.reachTracked && args.reach > 0)
  );
}

function buildPlatformCosts(
  platform: FunnelPlatform,
  spend: number,
  impressions: number,
  reach: number,
  reachTracked: boolean,
  clicks: number,
): EventFunnelPlatformCosts | null {
  const s = n(spend);
  const imps = n(impressions);
  const r = n(reach);
  const c = n(clicks);
  if (!platformHasSignal({ spend: s, impressions: imps, reach: r, reachTracked, clicks: c })) {
    return null;
  }
  return {
    platform,
    label: PLATFORM_LABEL[platform],
    spend: s,
    cpm: costPerUnit(s, imps, "no_impressions_yet", 1000),
    costPerReach: reachTracked
      ? costPerUnit(s, r, "no_reach_yet")
      : { kind: "no_reach_data" },
    cpc: costPerUnit(s, c, "no_clicks_yet"),
  };
}

export function platformCostsFromFunnelInput(
  input: EventFunnelInput,
): EventFunnelPlatformCosts[] {
  return [
    buildPlatformCosts(
      "meta",
      input.metaSpend,
      input.metaImpressions,
      input.metaReach,
      true,
      input.metaClicks,
    ),
    buildPlatformCosts(
      "tiktok",
      input.tiktokSpend,
      input.tiktokImpressions,
      input.tiktokReach,
      true,
      input.tiktokClicks,
    ),
    buildPlatformCosts(
      "google",
      input.googleSpend,
      input.googleImpressions,
      0,
      false,
      input.googleClicks,
    ),
  ].filter((row): row is EventFunnelPlatformCosts => row != null);
}

function buildEventFunnelCosts(
  input: EventFunnelInput,
  purchaseProvenance: FunnelProvenance,
): EventFunnelCosts {
  const platforms = platformCostsFromFunnelInput(input);

  const totalSpend =
    n(input.metaSpend) + n(input.tiktokSpend) + n(input.googleSpend);

  return {
    platforms,
    bestCpm: pickBestCost(platforms, "cpm"),
    bestCostPerReach: pickBestCost(platforms, "costPerReach"),
    bestCpc: pickBestCost(platforms, "cpc"),
    costPerLpv:
      input.firstPartyLpv == null
        ? { kind: "not_instrumented" }
        : costPerUnit(totalSpend, n(input.firstPartyLpv), "no_lpv_yet"),
    costPerSignup: costPerUnit(totalSpend, n(input.signupCount), "no_signups_yet"),
    costPerTicket: costPerUnit(totalSpend, n(input.purchases), "no_tickets_yet"),
    ticketProvenance: purchaseProvenance,
  };
}

export function buildEventFunnelView(input: EventFunnelInput): EventFunnelView {
  const metaSpend = n(input.metaSpend);
  const tiktokSpend = n(input.tiktokSpend);
  const googleSpend = n(input.googleSpend);

  const reachSplit = visibleSplits([
    split("meta", input.metaReach, true, metaSpend),
    split("tiktok", input.tiktokReach, true, tiktokSpend),
    split("google", null, false, googleSpend),
  ]);
  const clickSplit = visibleSplits([
    split("meta", input.metaClicks, true, metaSpend),
    split("tiktok", input.tiktokClicks, true, tiktokSpend),
    split("google", input.googleClicks, true, googleSpend),
  ]);

  const reach = n(input.metaReach) + n(input.tiktokReach);
  const clicks =
    n(input.metaClicks) + n(input.tiktokClicks) + n(input.googleClicks);
  const purchases = n(input.purchases);
  const signups = n(input.signupCount);
  const firstPartyLpv =
    input.firstPartyLpv == null ? null : n(input.firstPartyLpv);
  const winning = winningSnapshotSource(input.snapshotSources);
  const purchaseProvenance = provenanceForPurchaseSource(winning);

  const reachToClick = rate(clicks, reach);
  const clickToLpv = rate(firstPartyLpv, clicks);
  const lpvToSignup = rate(signups, firstPartyLpv);
  const lpvToPurchase = rate(purchases, firstPartyLpv);

  const stages: EventFunnelStage[] = [
    {
      key: "reach",
      label: "Reach",
      value: reach,
      provenance: "platform-reported",
      provenanceDetail:
        "Meta `meta_reach` + TikTok `tiktok_reach` summed across days (daily unique reach, not lifetime-deduped). Google Ads has impressions but no reach column — shown as not tracked.",
      conversionFromPrevious: null,
      conversionLabel: null,
      seedRate: null,
      seedLabel: null,
      platformSplit: reachSplit.length > 0 ? reachSplit : null,
    },
    {
      key: "clicks",
      label: "Clicks",
      value: clicks,
      provenance: "platform-reported",
      provenanceDetail:
        "Meta `link_clicks` + TikTok `tiktok_clicks` + Google `google_ads_clicks`. A platform with spend and a clicks column can be zero; a platform without a clicks column would be not tracked.",
      conversionFromPrevious: reachToClick,
      conversionLabel: "Reach → click",
      seedRate: EVENT_FUNNEL_SEEDS.reachToClick,
      seedLabel: EVENT_FUNNEL_SEED_LABEL,
      platformSplit: clickSplit.length > 0 ? clickSplit : null,
    },
    {
      key: "lpv",
      label: "Landing-page views",
      value: firstPartyLpv,
      provenance: firstPartyLpv == null ? "not instrumented" : "first-party",
      provenanceDetail:
        firstPartyLpv == null
          ? "not instrumented yet — landing-page adoption is Phase B. `page_events` is the LP config row, not a pageview rollup. Meta `landing_page_views` is a platform action and is not this stage."
          : "page views (unfiltered) — first-party `lp_page_views` count for this event. Obvious bots (HEAD, known crawler UAs) are dropped; we do not claim bot-free. Meta `landing_page_views` is a platform action and is not this stage.",
      conversionFromPrevious: clickToLpv,
      conversionLabel: "Click → LPV",
      seedRate: EVENT_FUNNEL_SEEDS.clickToLpv,
      seedLabel: EVENT_FUNNEL_SEED_LABEL,
      platformSplit: null,
    },
    {
      key: "signups",
      label: "Signups",
      value: signups,
      provenance: "first-party",
      provenanceDetail:
        "Count of `event_signups` for this event (soft-deletes excluded). Pipeline is live; near-empty is expected until ads point at our landing pages.",
      conversionFromPrevious: lpvToSignup,
      conversionLabel: "LPV → signup",
      seedRate: null,
      seedLabel: null,
      platformSplit: null,
    },
    {
      key: "purchases",
      label: "Purchases",
      value: purchases,
      provenance: purchaseProvenance,
      provenanceDetail: winning
        ? `SUM(event_daily_rollups.tickets_sold). Winning snapshot source is ${winning} (manual > xlsx_import > fourthefans/foursomething > eventbrite). Per-day source is not stored on the rollup; this is the event-level label from ticket_sales_snapshots.`
        : "SUM(event_daily_rollups.tickets_sold). No ticket_sales_snapshots rows — source cannot be labelled beyond the rollup pipe.",
      conversionFromPrevious: lpvToPurchase,
      conversionLabel: "LPV → purchase",
      seedRate: EVENT_FUNNEL_SEEDS.lpvToPurchase,
      seedLabel: EVENT_FUNNEL_SEED_LABEL,
      platformSplit: null,
    },
  ];

  return {
    stages,
    metaReportedLpv: n(input.metaReportedLpv),
    costs: buildEventFunnelCosts(input, purchaseProvenance),
  };
}

/** Inclusive UTC calendar days used by E.3-lite comparisons. */
export const CROSS_PLATFORM_WINDOW_DAYS = 7;

/**
 * A cheaper platform must be at least this many times cheaper, and the
 * absolute gap must clear the metric floor, before we recommend a shift.
 * Recommend-only — never auto-applied.
 */
export const STAGE_COST_GAP = {
  ratio: 1.8,
  cpcAbs: 0.2,
  cpmAbs: 2,
  costPerReachAbs: 0.01,
} as const;

export type FunnelDiagnosticProvenance = "computed-from-event_daily_rollups";

export interface FunnelDiagnosticEvidence {
  metric: "cpc" | "cpm" | "costPerReach";
  cheaperPlatform: FunnelPlatform;
  dearerPlatform: FunnelPlatform;
  cheaperValue: number;
  dearerValue: number;
  ratio: number;
  windowDays: number;
}

export interface FunnelDiagnosticRow {
  recommendation: string;
  evidence: FunnelDiagnosticEvidence;
  createdAt: string;
  provenance: FunnelDiagnosticProvenance;
  /** Always false in this run — diagnostics never write budgets. */
  autoApply: false;
}

export interface CrossPlatformComparison {
  windowDays: number;
  sinceDate: string;
  platforms: EventFunnelPlatformCosts[];
  bestCpm: FunnelPlatform | null;
  bestCostPerReach: FunnelPlatform | null;
  bestCpc: FunnelPlatform | null;
  diagnostics: FunnelDiagnosticRow[];
  emptyReason: string | null;
}

export function utcDateDaysAgo(daysBack: number, now = new Date()): string {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

function gbp(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function gapDiagnostic(
  platforms: EventFunnelPlatformCosts[],
  metric: FunnelDiagnosticEvidence["metric"],
  absFloor: number,
  windowDays: number,
  createdAt: string,
): FunnelDiagnosticRow | null {
  const scored = platforms.filter((row) => isAmountCell(row[metric]));
  if (scored.length < 2) return null;
  const ranked = [...scored].sort((a, b) => {
    const left = a[metric];
    const right = b[metric];
    if (!isAmountCell(left) || !isAmountCell(right)) return 0;
    return left.value - right.value;
  });
  const cheapest = ranked[0];
  const dearest = ranked[ranked.length - 1];
  const cheapCell = cheapest[metric];
  const dearCell = dearest[metric];
  if (!isAmountCell(cheapCell) || !isAmountCell(dearCell)) return null;
  if (cheapCell.value <= 0) return null;
  const ratio = dearCell.value / cheapCell.value;
  const gap = dearCell.value - cheapCell.value;
  if (ratio < STAGE_COST_GAP.ratio || gap < absFloor) return null;
  const metricLabel =
    metric === "cpc" ? "CPC" : metric === "cpm" ? "CPM" : "cost-per-reach";
  return {
    recommendation: `${cheapest.label} ${metricLabel} ${gbp(cheapCell.value)} vs ${dearest.label} ${gbp(dearCell.value)} over ${windowDays} days — consider shifting spend`,
    evidence: {
      metric,
      cheaperPlatform: cheapest.platform,
      dearerPlatform: dearest.platform,
      cheaperValue: cheapCell.value,
      dearerValue: dearCell.value,
      ratio,
      windowDays,
    },
    createdAt,
    provenance: "computed-from-event_daily_rollups",
    autoApply: false,
  };
}

/**
 * 7-day (or caller window) per-platform CPM/CPC/cost-per-reach plus
 * recommend-only rows. One platform is an honest empty, not a fake compare.
 */
export function buildCrossPlatformComparison(
  input: EventFunnelInput,
  args: { windowDays?: number; sinceDate: string; createdAt: string },
): CrossPlatformComparison {
  const windowDays = args.windowDays ?? CROSS_PLATFORM_WINDOW_DAYS;
  const platforms = platformCostsFromFunnelInput(input);
  const emptyReason =
    platforms.length === 0
      ? `No paid-channel spend or metrics in the last ${windowDays} days.`
      : platforms.length === 1
        ? `Only ${platforms[0].label} has signal in the last ${windowDays} days — nothing to compare.`
        : null;

  const diagnostics =
    emptyReason == null
      ? (
          [
            gapDiagnostic(
              platforms,
              "cpc",
              STAGE_COST_GAP.cpcAbs,
              windowDays,
              args.createdAt,
            ),
            gapDiagnostic(
              platforms,
              "cpm",
              STAGE_COST_GAP.cpmAbs,
              windowDays,
              args.createdAt,
            ),
            gapDiagnostic(
              platforms,
              "costPerReach",
              STAGE_COST_GAP.costPerReachAbs,
              windowDays,
              args.createdAt,
            ),
          ] as Array<FunnelDiagnosticRow | null>
        ).filter((row): row is FunnelDiagnosticRow => row != null)
      : [];

  return {
    windowDays,
    sinceDate: args.sinceDate,
    platforms,
    bestCpm: pickBestCost(platforms, "cpm"),
    bestCostPerReach: pickBestCost(platforms, "costPerReach"),
    bestCpc: pickBestCost(platforms, "cpc"),
    diagnostics,
    emptyReason,
  };
}
