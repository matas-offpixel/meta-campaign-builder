import type {
  CampaignObjective,
  BenchmarkPercentile,
  BenchmarkTag,
  OptimisationRule,
  OptimisationThreshold,
  RuleMetric,
} from "./types";

// ─── Metric priority mapping per objective ───

export interface ObjectiveMetricPriority {
  primary: RuleMetric;
  primaryLabel: string;
  secondary?: RuleMetric;
  secondaryLabel?: string;
  summaryLine: string;
}

export const OBJECTIVE_METRIC_PRIORITY: Record<CampaignObjective, ObjectiveMetricPriority> = {
  registration: {
    primary: "cpr",
    primaryLabel: "Cost per Registration",
    summaryLine: "Scaling based on registration efficiency",
  },
  traffic: {
    primary: "lpv_cost",
    primaryLabel: "Cost per Landing Page View",
    summaryLine: "Scaling based on LPV efficiency",
  },
  purchase: {
    primary: "cpa",
    primaryLabel: "Cost per Purchase",
    secondary: "roas",
    secondaryLabel: "ROAS",
    summaryLine: "Scaling based on purchase efficiency with ROAS guardrail",
  },
  awareness: {
    primary: "cpm",
    primaryLabel: "Cost per 1,000 Impressions",
    summaryLine: "Scaling based on reach efficiency",
  },
  engagement: {
    primary: "cpc",
    primaryLabel: "Cost per Engagement",
    summaryLine: "Scaling based on engagement efficiency",
  },
};

// ─── Tag helper ───

function tag(metric: RuleMetric, objective: CampaignObjective): BenchmarkTag {
  const prio = OBJECTIVE_METRIC_PRIORITY[objective];
  if (metric === prio.primary) return "primary";
  if (prio.secondary && metric === prio.secondary) return "secondary";
  return "reference";
}

// ─── Mock account benchmarks by objective ───
// Broad set of metrics per objective; tagged by relevance

export const ACCOUNT_BENCHMARKS: Record<CampaignObjective, BenchmarkPercentile[]> = {
  registration: [
    { metric: "cpr", metricLabel: "Cost per Registration", currency: "£", top25: 0.85, median: 1.60, bottom25: 3.20, tag: "primary" },
    { metric: "cpc", metricLabel: "Cost per Click", currency: "£", top25: 0.18, median: 0.35, bottom25: 0.72, tag: "reference" },
    { metric: "cpm", metricLabel: "Cost per 1,000 Impressions", currency: "£", top25: 3.20, median: 5.80, bottom25: 9.50, tag: "reference" },
    { metric: "ctr", metricLabel: "Click-through Rate", top25: 2.8, median: 1.6, bottom25: 0.8, tag: "reference" },
  ],
  traffic: [
    { metric: "lpv_cost", metricLabel: "Cost per Landing Page View", currency: "£", top25: 0.15, median: 0.35, bottom25: 0.70, tag: "primary" },
    { metric: "cpc", metricLabel: "Cost per Click", currency: "£", top25: 0.12, median: 0.28, bottom25: 0.55, tag: "reference" },
    { metric: "cpm", metricLabel: "Cost per 1,000 Impressions", currency: "£", top25: 2.40, median: 4.80, bottom25: 8.60, tag: "reference" },
    { metric: "ctr", metricLabel: "Click-through Rate", top25: 3.2, median: 1.8, bottom25: 0.9, tag: "reference" },
  ],
  purchase: [
    { metric: "cpa", metricLabel: "Cost per Purchase", currency: "£", top25: 8.50, median: 18.00, bottom25: 38.00, tag: "primary" },
    { metric: "roas", metricLabel: "Return on Ad Spend", top25: 6.5, median: 3.2, bottom25: 1.4, tag: "secondary" },
    { metric: "cpc", metricLabel: "Cost per Click", currency: "£", top25: 0.22, median: 0.45, bottom25: 0.90, tag: "reference" },
    { metric: "cpm", metricLabel: "Cost per 1,000 Impressions", currency: "£", top25: 4.50, median: 8.20, bottom25: 14.00, tag: "reference" },
    { metric: "ctr", metricLabel: "Click-through Rate", top25: 2.1, median: 1.2, bottom25: 0.5, tag: "reference" },
  ],
  awareness: [
    { metric: "cpm", metricLabel: "Cost per 1,000 Impressions", currency: "£", top25: 2.80, median: 5.50, bottom25: 9.20, tag: "primary" },
    { metric: "cpc", metricLabel: "Cost per Click", currency: "£", top25: 0.15, median: 0.32, bottom25: 0.65, tag: "reference" },
    { metric: "ctr", metricLabel: "Click-through Rate", top25: 1.8, median: 0.9, bottom25: 0.4, tag: "reference" },
  ],
  engagement: [
    { metric: "cpc", metricLabel: "Cost per Engagement", currency: "£", top25: 0.04, median: 0.10, bottom25: 0.25, tag: "primary" },
    { metric: "cpm", metricLabel: "Cost per 1,000 Impressions", currency: "£", top25: 1.80, median: 3.50, bottom25: 7.00, tag: "reference" },
    { metric: "ctr", metricLabel: "Click-through Rate", top25: 4.5, median: 2.2, bottom25: 1.0, tag: "reference" },
  ],
};

// ─── Helpers ───

function tid(): string {
  return crypto.randomUUID();
}

function rid(): string {
  return crypto.randomUUID();
}

// ─── Predefined rule sets per objective ───

function registrationRules(): OptimisationRule[] {
  return [
    {
      id: rid(),
      name: "Primary Rule Set — Cost per Registration",
      metric: "cpr",
      timeWindow: "24h",
      enabled: true,
      priority: "primary",
      thresholds: [
        { id: tid(), operator: "below", value: 1, action: "increase_budget", actionValue: 30, label: "Below £1 CPR → scale aggressively (+30%)" },
        { id: tid(), operator: "between", value: 1, valueTo: 2, action: "increase_budget", actionValue: 10, label: "£1–£2 CPR → scale moderately (+10%)" },
        { id: tid(), operator: "between", value: 2, valueTo: 3, action: "decrease_budget", actionValue: 0, label: "£2–£3 CPR → maintain" },
        { id: tid(), operator: "between", value: 3, valueTo: 5, action: "decrease_budget", actionValue: 25, label: "£3–£5 CPR → reduce (-25%)" },
        { id: tid(), operator: "above", value: 5, action: "pause", label: "Above £5 CPR → pause ad set" },
      ],
    },
  ];
}

function trafficRules(): OptimisationRule[] {
  return [
    {
      id: rid(),
      name: "Primary Rule Set — Cost per Landing Page View",
      metric: "lpv_cost",
      timeWindow: "24h",
      enabled: true,
      priority: "primary",
      thresholds: [
        { id: tid(), operator: "below", value: 0.20, action: "increase_budget", actionValue: 30, label: "Below £0.20 CPLPV → scale aggressively (+30%)" },
        { id: tid(), operator: "between", value: 0.20, valueTo: 0.35, action: "increase_budget", actionValue: 10, label: "£0.20–£0.35 CPLPV → scale moderately (+10%)" },
        { id: tid(), operator: "between", value: 0.35, valueTo: 0.55, action: "decrease_budget", actionValue: 0, label: "£0.35–£0.55 CPLPV → maintain" },
        { id: tid(), operator: "between", value: 0.55, valueTo: 0.70, action: "decrease_budget", actionValue: 25, label: "£0.55–£0.70 CPLPV → reduce (-25%)" },
        { id: tid(), operator: "above", value: 0.70, action: "pause", label: "Above £0.70 CPLPV → pause ad set" },
      ],
    },
  ];
}

function purchaseRules(): OptimisationRule[] {
  return [
    {
      id: rid(),
      name: "Primary Rule Set — Cost per Purchase",
      metric: "cpa",
      timeWindow: "3d",
      enabled: true,
      priority: "primary",
      thresholds: [
        { id: tid(), operator: "below", value: 10, action: "increase_budget", actionValue: 30, label: "Below £10 CPP → scale aggressively (+30%)" },
        { id: tid(), operator: "between", value: 10, valueTo: 18, action: "increase_budget", actionValue: 10, label: "£10–£18 CPP → scale moderately (+10%)" },
        { id: tid(), operator: "between", value: 18, valueTo: 30, action: "decrease_budget", actionValue: 0, label: "£18–£30 CPP → maintain" },
        { id: tid(), operator: "between", value: 30, valueTo: 45, action: "decrease_budget", actionValue: 25, label: "£30–£45 CPP → reduce (-25%)" },
        { id: tid(), operator: "above", value: 45, action: "pause", label: "Above £45 CPP → pause ad set" },
      ],
    },
    {
      id: rid(),
      name: "Secondary Rule Set — ROAS",
      metric: "roas",
      timeWindow: "3d",
      enabled: true,
      priority: "secondary",
      thresholds: [
        { id: tid(), operator: "above", value: 5, action: "increase_budget", actionValue: 15, label: "ROAS above 5× → scale (+15%)" },
        { id: tid(), operator: "between", value: 3, valueTo: 5, action: "decrease_budget", actionValue: 0, label: "ROAS 3–5× → maintain" },
        { id: tid(), operator: "below", value: 1.5, action: "decrease_budget", actionValue: 30, label: "ROAS below 1.5× → reduce (-30%)" },
        { id: tid(), operator: "below", value: 0.8, action: "pause", label: "ROAS below 0.8× → pause" },
      ],
    },
  ];
}

function awarenessRules(): OptimisationRule[] {
  return [
    {
      id: rid(),
      name: "Primary Rule Set — CPM",
      metric: "cpm",
      timeWindow: "24h",
      enabled: true,
      priority: "primary",
      thresholds: [
        { id: tid(), operator: "below", value: 3, action: "increase_budget", actionValue: 20, label: "Below £3 CPM → scale (+20%)" },
        { id: tid(), operator: "between", value: 3, valueTo: 6, action: "decrease_budget", actionValue: 0, label: "£3–£6 CPM → maintain" },
        { id: tid(), operator: "above", value: 8, action: "decrease_budget", actionValue: 25, label: "Above £8 CPM → reduce (-25%)" },
      ],
    },
  ];
}

function engagementRules(): OptimisationRule[] {
  return [
    {
      id: rid(),
      name: "Primary Rule Set — Cost per Engagement",
      metric: "cpc",
      timeWindow: "24h",
      enabled: true,
      priority: "primary",
      thresholds: [
        { id: tid(), operator: "below", value: 0.05, action: "increase_budget", actionValue: 25, label: "Below £0.05 CPE → scale aggressively (+25%)" },
        { id: tid(), operator: "between", value: 0.05, valueTo: 0.12, action: "increase_budget", actionValue: 10, label: "£0.05–£0.12 CPE → scale (+10%)" },
        { id: tid(), operator: "between", value: 0.12, valueTo: 0.25, action: "decrease_budget", actionValue: 0, label: "£0.12–£0.25 CPE → maintain" },
        { id: tid(), operator: "above", value: 0.25, action: "decrease_budget", actionValue: 30, label: "Above £0.25 CPE → reduce (-30%)" },
      ],
    },
  ];
}

export function getAccountBenchmarkMedian(objective: CampaignObjective, metric: RuleMetric): number | undefined {
  const benchmarks = ACCOUNT_BENCHMARKS[objective];
  return benchmarks?.find((b) => b.metric === metric)?.median;
}

function attachBenchmarks(rules: OptimisationRule[], objective: CampaignObjective): OptimisationRule[] {
  return rules.map((rule) => ({
    ...rule,
    accountBenchmarkValue: getAccountBenchmarkMedian(objective, rule.metric),
    useOverride: false,
  }));
}

export function generateRulesForObjective(objective: CampaignObjective): OptimisationRule[] {
  let rules: OptimisationRule[];
  switch (objective) {
    case "registration": rules = registrationRules(); break;
    case "traffic": rules = trafficRules(); break;
    case "purchase": rules = purchaseRules(); break;
    case "awareness": rules = awarenessRules(); break;
    case "engagement": rules = engagementRules(); break;
    default: rules = registrationRules();
  }
  return attachBenchmarks(rules, objective);
}

/**
 * Regenerate threshold bands around a target value for a given metric.
 * For cost-based metrics (lower = better): bands fan out above the target.
 * For ROAS (higher = better): bands fan out below the target.
 */
export function regenerateThresholdsFromTarget(
  metric: RuleMetric,
  target: number,
): OptimisationThreshold[] {
  const isInverse = metric === "roas";
  const sym = isInverse ? "" : "£";
  const label = METRIC_LABELS[metric] ?? metric;

  if (isInverse) {
    const high = round(target * 1.8);
    const midHigh = round(target * 1.3);
    const midLow = round(target * 0.7);
    const low = round(target * 0.4);
    return [
      { id: tid(), operator: "above", value: high, action: "increase_budget", actionValue: 30, label: `${label} above ${high}× → scale aggressively (+30%)` },
      { id: tid(), operator: "between", value: midHigh, valueTo: high, action: "increase_budget", actionValue: 15, label: `${label} ${midHigh}–${high}× → scale moderately (+15%)` },
      { id: tid(), operator: "between", value: midLow, valueTo: midHigh, action: "decrease_budget", actionValue: 0, label: `${label} ${midLow}–${midHigh}× → maintain` },
      { id: tid(), operator: "below", value: midLow, action: "decrease_budget", actionValue: 30, label: `${label} below ${midLow}× → reduce (-30%)` },
      { id: tid(), operator: "below", value: low, action: "pause", label: `${label} below ${low}× → pause` },
    ];
  }

  const veryLow = round(target * 0.4);
  const low = round(target * 0.65);
  const midLow = round(target * 0.85);
  const midHigh = round(target * 1.25);
  const high = round(target * 1.75);

  return [
    { id: tid(), operator: "below", value: veryLow, action: "increase_budget", actionValue: 30, label: `Below ${sym}${fmt(veryLow)} ${label} → scale aggressively (+30%)` },
    { id: tid(), operator: "between", value: veryLow, valueTo: low, action: "increase_budget", actionValue: 15, label: `${sym}${fmt(veryLow)}–${sym}${fmt(low)} ${label} → scale moderately (+15%)` },
    { id: tid(), operator: "between", value: low, valueTo: midHigh, action: "decrease_budget", actionValue: 0, label: `${sym}${fmt(low)}–${sym}${fmt(midHigh)} ${label} → maintain` },
    { id: tid(), operator: "between", value: midHigh, valueTo: high, action: "decrease_budget", actionValue: 25, label: `${sym}${fmt(midHigh)}–${sym}${fmt(high)} ${label} → reduce (-25%)` },
    { id: tid(), operator: "above", value: high, action: "pause", label: `Above ${sym}${fmt(high)} ${label} → pause` },
  ];
}

function round(v: number): number {
  if (v >= 100) return Math.round(v);
  if (v >= 10) return Math.round(v * 10) / 10;
  return Math.round(v * 100) / 100;
}

function fmt(v: number): string {
  if (v >= 100) return String(Math.round(v));
  if (v >= 1) return v.toFixed(2).replace(/\.?0+$/, "");
  return v.toFixed(2);
}

export const METRIC_LABELS: Record<string, string> = {
  cpr: "CPR",
  cpc: "CPC",
  cpa: "CPP",
  roas: "ROAS",
  cpm: "CPM",
  lpv_cost: "CPLPV",
  ctr: "CTR",
};

export const TIME_WINDOW_LABELS: Record<string, string> = {
  "24h": "24 hours",
  "3d": "3 days",
  "7d": "7 days",
};
