import type { CreativeTagDimension } from "@/lib/db/creative-tags";
import type {
  CreativePatternPhase,
  TileRow,
  CreativePatternDimension,
} from "@/lib/reporting/creative-patterns-cross-event";

export type CreativePatternFunnel = "top" | "mid" | "bottom";

export function parseCreativePatternPhase(
  value: string | undefined | null,
): CreativePatternPhase {
  return value === "registration" ? "registration" : "ticket_sale";
}

export function parseCreativePatternFunnel(
  value: string | undefined | null,
): CreativePatternFunnel {
  if (value === "top" || value === "mid") return value;
  return "bottom";
}

export function primaryMetricValue(
  row: TileRow,
  funnel: CreativePatternFunnel,
  phase: CreativePatternPhase,
): number | null {
  if (funnel === "top") return row.cpm;
  if (funnel === "mid") return row.cpc;
  if (phase === "registration") return row.cpreg;
  return row.cpa;
}

export function sortTilesForView(
  rows: TileRow[],
  funnel: CreativePatternFunnel,
  phase: CreativePatternPhase,
): TileRow[] {
  return [...rows].sort((a, b) => {
    const ma = primaryMetricValue(a, funnel, phase);
    const mb = primaryMetricValue(b, funnel, phase);
    const na = ma == null ? 1 : 0;
    const nb = mb == null ? 1 : 0;
    if (na !== nb) return na - nb;
    if (ma != null && mb != null && ma !== mb) return ma - mb;
    return b.total_spend - a.total_spend;
  });
}

/** Quartile from funnel-primary ranking (1 = strongest). */
export function primaryQuartileForSortedIndex(
  indexInSorted: number,
  length: number,
): 1 | 2 | 3 | 4 {
  if (length <= 1) return 1;
  const q = Math.ceil(((indexInSorted + 1) / length) * 4);
  return Math.min(4, Math.max(1, q)) as 1 | 2 | 3 | 4;
}

export type MetricDirection = "lower" | "higher";

export interface FunnelMiniStatDef {
  key: string;
  label: string;
  direction: MetricDirection;
  pick: (row: TileRow, phase: CreativePatternPhase) => number | null;
  format: (
    value: number,
    phase: CreativePatternPhase,
    fmt: PatternFormatters,
  ) => string;
}

export interface PatternFormatters {
  money0: Intl.NumberFormat;
  money2: Intl.NumberFormat;
  num: Intl.NumberFormat;
}

export function funnelMiniStatDefs(
  funnel: CreativePatternFunnel,
  phase: CreativePatternPhase,
): FunnelMiniStatDef[] {
  if (funnel === "top") {
    return [
      {
        key: "cpm",
        label: "CPM",
        direction: "lower",
        pick: (row) => row.cpm,
        format: (v, _p, f) => f.money2.format(v),
      },
      {
        key: "ctr",
        label: "CTR",
        direction: "higher",
        pick: (row) => row.ctr,
        format: (v) => `${v.toFixed(2)}%`,
      },
      {
        key: "reach",
        label: "Reach",
        direction: "higher",
        pick: (row) =>
          row.total_reach > 0 ? row.total_reach : null,
        format: (v, _p, f) => f.num.format(Math.round(v)),
      },
      {
        key: "frequency",
        label: "Frequency",
        direction: "lower",
        pick: (row) => row.frequency,
        format: (v) => v.toFixed(2),
      },
      {
        key: "spend",
        label: "Spend",
        direction: "higher",
        pick: (row) => row.total_spend,
        format: (v, _p, f) => f.money0.format(v),
      },
      {
        key: "clicks",
        label: "Clicks",
        direction: "higher",
        pick: (row) =>
          row.total_clicks > 0 ? row.total_clicks : null,
        format: (v, _p, f) => f.num.format(Math.round(v)),
      },
    ];
  }

  if (funnel === "mid") {
    return [
      {
        key: "cpc",
        label: "CPC",
        direction: "lower",
        pick: (row) => row.cpc,
        format: (v, _p, f) => f.money2.format(v),
      },
      {
        key: "cplpv",
        label: "CPLPV",
        direction: "lower",
        pick: (row) => row.cplpv,
        format: (v, _p, f) => f.money2.format(v),
      },
      {
        key: "ctr",
        label: "CTR",
        direction: "higher",
        pick: (row) => row.ctr,
        format: (v) => `${v.toFixed(2)}%`,
      },
      {
        key: "lpv",
        label: "LPV",
        direction: "higher",
        pick: (row) =>
          row.lpv_count > 0 ? row.lpv_count : null,
        format: (v, _p, f) => f.num.format(Math.round(v)),
      },
      {
        key: "spend",
        label: "Spend",
        direction: "higher",
        pick: (row) => row.total_spend,
        format: (v, _p, f) => f.money0.format(v),
      },
      {
        key: "clicks",
        label: "Clicks",
        direction: "higher",
        pick: (row) =>
          row.total_clicks > 0 ? row.total_clicks : null,
        format: (v, _p, f) => f.num.format(Math.round(v)),
      },
    ];
  }

  const acquisitionMetric: FunnelMiniStatDef =
    phase === "registration"
      ? {
          key: "cpreg",
          label: "CPReg",
          direction: "lower",
          pick: (row) => row.cpreg,
          format: (v, _p, f) => f.money2.format(v),
        }
      : {
          key: "cpa",
          label: "CPA",
          direction: "lower",
          pick: (row) => row.cpa,
          format: (v, _p, f) => f.money2.format(v),
        };

  const acquisitionCount: FunnelMiniStatDef =
    phase === "registration"
      ? {
          key: "regs",
          label: "Registrations",
          direction: "higher",
          pick: (row) =>
            row.total_regs > 0 ? row.total_regs : null,
          format: (v, _p, f) => f.num.format(Math.round(v)),
        }
      : {
          key: "purchases",
          label: "Purchases",
          direction: "higher",
          pick: (row) =>
            row.total_purchases > 0 ? row.total_purchases : null,
          format: (v, _p, f) => f.num.format(Math.round(v)),
        };

  return [
    acquisitionMetric,
    {
      key: "cpp",
      label: "CPP",
      direction: "lower",
      pick: (row) => row.cpp,
      format: (v, _p, f) => f.money2.format(v),
    },
    {
      key: "roas",
      label: "ROAS",
      direction: "higher",
      pick: (row) => row.roas,
      format: (v) => v.toFixed(2),
    },
    acquisitionCount,
    {
      key: "spend",
      label: "Spend",
      direction: "higher",
      pick: (row) => row.total_spend,
      format: (v, _p, f) => f.money0.format(v),
    },
    {
      key: "clicks",
      label: "Clicks",
      direction: "higher",
      pick: (row) =>
        row.total_clicks > 0 ? row.total_clicks : null,
      format: (v, _p, f) => f.num.format(Math.round(v)),
    },
  ];
}

export function computeMetricPerfByKey(
  rows: TileRow[],
  defs: FunnelMiniStatDef[],
  phase: CreativePatternPhase,
): Map<string, Record<string, { ratio: number; quartile: 1 | 2 | 3 | 4 }>> {
  const byTile = new Map<
    string,
    Record<string, { ratio: number; quartile: 1 | 2 | 3 | 4 }>
  >();

  for (const row of rows) {
    byTile.set(row.value_key, {});
  }

  for (const def of defs) {
    const entries = rows.map((row) => ({
      row,
      value: def.pick(row, phase),
    }));
    const valid = entries.filter(
      (e): e is typeof e & { value: number } =>
        e.value != null && Number.isFinite(e.value),
    );
    const sorted =
      def.direction === "lower"
        ? [...valid].sort((a, b) => a.value - b.value)
        : [...valid].sort((a, b) => b.value - a.value);

    let best: number | null = null;
    if (sorted.length > 0) {
      best = sorted[0].value;
    }

    for (const row of rows) {
      const raw = def.pick(row, phase);
      const bucket = byTile.get(row.value_key)!;
      if (raw == null || !Number.isFinite(raw) || best == null) {
        bucket[def.key] = { ratio: 0, quartile: 4 };
        continue;
      }

      const idx = sorted.findIndex((e) => e.row.value_key === row.value_key);
      const quartile =
        idx >= 0
          ? primaryQuartileForSortedIndex(idx, sorted.length)
          : 4;

      let ratio: number;
      if (def.direction === "lower") {
        ratio = best > 0 ? Math.min(1, best / raw) : 0;
      } else {
        ratio = best > 0 ? Math.min(1, raw / best) : 0;
      }

      bucket[def.key] = { ratio, quartile };
    }
  }

  return byTile;
}

export const DIMENSION_LABELS: Record<CreativeTagDimension, string> = {
  asset_type: "Asset Type",
  hook_tactic: "Hook Tactic",
  messaging_angle: "Messaging Theme",
  intended_audience: "Intended Audience",
  visual_format: "Visual Format",
  headline_tactic: "Headline Tactic",
  offer_type: "Offer Type",
  seasonality: "Seasonality",
};

export function computeBestDimensionByFunnel(
  dimensions: CreativePatternDimension[],
  funnel: CreativePatternFunnel,
  phase: CreativePatternPhase,
): { dimension: CreativeTagDimension; label: string; metricLabel: string } | null {
  let best: {
    dimension: CreativeTagDimension;
    label: string;
    metricLabel: string;
    value: number;
  } | null = null;

  const metricTitle =
    funnel === "top"
      ? "Cheapest CPM dimension"
      : funnel === "mid"
        ? "Lowest CPC dimension"
        : phase === "registration"
          ? "Lowest CPReg dimension"
          : "Lowest CPA dimension";

  for (const dim of dimensions) {
    if (dim.values.length === 0) continue;
    const sorted = sortTilesForView(dim.values, funnel, phase);
    const top = sorted.find(
      (r) => primaryMetricValue(r, funnel, phase) != null,
    );
    const v = top ? primaryMetricValue(top, funnel, phase) : null;
    if (v == null) continue;
    if (!best || v < best.value) {
      best = {
        dimension: dim.dimension,
        label: DIMENSION_LABELS[dim.dimension],
        metricLabel: metricTitle,
        value: v,
      };
    }
  }

  return best
    ? {
        dimension: best.dimension,
        label: best.label,
        metricLabel: best.metricLabel,
      }
    : null;
}

export function quartileStripeClass(q: 1 | 2 | 3 | 4): string {
  if (q === 1) return "border-l-green-500";
  if (q === 2) return "border-l-amber-400";
  if (q === 3) return "border-l-orange-500";
  return "border-l-red-500";
}

export function quartileBadge(q: 1 | 2 | 3 | 4): { emoji: string; label: string } {
  if (q === 1) return { emoji: "🟢", label: "Strong (Q1)" };
  if (q === 2) return { emoji: "🟡", label: "OK (Q2)" };
  if (q === 3) return { emoji: "🟠", label: "Watch (Q3)" };
  return { emoji: "🔴", label: "Weak (Q4)" };
}

export function barColorClass(quartile: 1 | 2 | 3 | 4): string {
  if (quartile === 1) return "bg-green-500";
  if (quartile === 2 || quartile === 3) return "bg-amber-500";
  return "bg-red-500";
}

export type CreativePatternsInsightsLinkCtx =
  | {
      surface: "dashboard";
      clientId: string;
      region?: string;
      token?: string;
      isShared?: boolean;
      phase: CreativePatternPhase;
      funnel: CreativePatternFunnel;
    }
  | {
      surface: "venue";
      clientId: string;
      eventCode: string;
      /** Venue-scoped share token; required when isShared is true. */
      token?: string;
      isShared?: boolean;
      phase: CreativePatternPhase;
      funnel: CreativePatternFunnel;
    };

/** Insights tab URL with stable phase + funnel query params (dashboard or venue scope). */
export function buildCreativePatternsInsightsHref(
  ctx: CreativePatternsInsightsLinkCtx,
): string {
  const sp = new URLSearchParams();
  sp.set("tab", "insights");
  if (ctx.surface === "dashboard" && ctx.region) {
    sp.set("region", ctx.region);
  }
  sp.set("phase", ctx.phase);
  sp.set("funnel", ctx.funnel);

  if (ctx.surface === "dashboard") {
    const base =
      ctx.isShared && ctx.token
        ? `/share/client/${encodeURIComponent(ctx.token)}`
        : `/clients/${ctx.clientId}/dashboard`;
    return `${base}?${sp.toString()}`;
  }

  // Venue surface: keep share viewers on /share/venue/[token]. Falling back to
  // the internal /clients/[id]/venues/[event_code] route puts the request
  // behind the proxy's default-deny and bounces them to /login.
  const base =
    ctx.isShared && ctx.token
      ? `/share/venue/${encodeURIComponent(ctx.token)}`
      : `/clients/${ctx.clientId}/venues/${encodeURIComponent(ctx.eventCode)}`;
  return `${base}?${sp.toString()}`;
}
