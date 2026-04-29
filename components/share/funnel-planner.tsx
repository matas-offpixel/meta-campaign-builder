"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  aggregateFunnelData,
  LEEDS_FA_CUP_FUNNEL_DEFAULTS,
  type EventFunnelOverride,
  type FunnelEventLike,
} from "@/lib/dashboard/funnel-aggregations";
import { fmtCurrencyCompact } from "@/lib/dashboard/format";
import type {
  CustomDateRange,
  DatePreset,
  InsightsResult,
  MetaCampaignRow,
} from "@/lib/insights/types";

interface Props {
  events: FunnelEventLike[];
  campaigns: MetaCampaignRow[];
  initialOverride?: EventFunnelOverride | null;
  storageKey?: string;
  overrideEndpoint?: string;
}

type RateKey =
  | "tofu_to_mofu_rate"
  | "mofu_to_bofu_rate"
  | "bofu_to_reg_rate"
  | "reg_to_sale_rate"
  | "organic_lift_rate";

const RATE_META: Array<{
  key: RateKey;
  label: string;
  defaultValue: number | null;
}> = [
  { key: "tofu_to_mofu_rate", label: "TOFU -> MOFU", defaultValue: null },
  { key: "mofu_to_bofu_rate", label: "MOFU -> BOFU", defaultValue: null },
  { key: "bofu_to_reg_rate", label: "BOFU -> REG", defaultValue: 0.1827 },
  { key: "reg_to_sale_rate", label: "REG -> SALE", defaultValue: 0.51 },
  { key: "organic_lift_rate", label: "ORGANIC LIFT", defaultValue: 0.57 },
];

export function FunnelPlanner({
  events,
  campaigns,
  initialOverride = null,
  storageKey,
  overrideEndpoint,
}: Props) {
  const loadedStorageKey = useRef<string | undefined>(undefined);
  const remoteReady = useRef(false);
  const [override, setOverride] = useState<EventFunnelOverride>(() => {
    if (!storageKey || typeof window === "undefined") return initialOverride ?? {};
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as EventFunnelOverride) : (initialOverride ?? {});
    } catch {
      return initialOverride ?? {};
    }
  });
  useEffect(() => {
    if (!overrideEndpoint) {
      remoteReady.current = true;
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const res = await fetch(overrideEndpoint, {
          cache: "no-store",
          signal: ctrl.signal,
        });
        const json = (await res.json()) as {
          ok?: boolean;
          override?: EventFunnelOverride | null;
        };
        if (!res.ok || !json.ok) throw new Error("Override unavailable");
        if (!cancelled) setOverride(json.override ?? {});
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
      } finally {
        if (!cancelled) remoteReady.current = true;
      }
    };
    void load();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [overrideEndpoint]);

  useEffect(() => {
    if (!storageKey) return;
    if (loadedStorageKey.current !== storageKey) {
      loadedStorageKey.current = storageKey;
      return;
    }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(override));
    } catch {
      // Ignore persistence failures; DB-backed overrides land in a later tier.
    }
  }, [override, storageKey]);

  useEffect(() => {
    if (!overrideEndpoint || !remoteReady.current) return;
    const ctrl = new AbortController();
    const save = async () => {
      try {
        await fetch(overrideEndpoint, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(override),
          signal: ctrl.signal,
        });
      } catch (err) {
        if (!(err instanceof Error && err.name === "AbortError")) {
          console.warn("[funnel-planner] override save failed", err);
        }
      }
    };
    void save();
    return () => ctrl.abort();
  }, [override, overrideEndpoint]);
  const data = useMemo(
    () =>
      aggregateFunnelData(
        events,
        campaigns,
        [],
        override,
        LEEDS_FA_CUP_FUNNEL_DEFAULTS,
      ),
    [campaigns, events, override],
  );
  const required = useMemo(() => requiredVolumes(data), [data]);
  const actualRates = {
    tofu_to_mofu_rate: data.actualTofuToMofu,
    mofu_to_bofu_rate: data.actualMofuToBofu,
    bofu_to_reg_rate: data.actualBofuToReg,
    reg_to_sale_rate:
      data.bofu.regs > 0 ? data.ticketsSold / data.bofu.regs : null,
    organic_lift_rate: null,
  } satisfies Record<RateKey, number | null>;

  return (
    <section className="space-y-4 rounded-md border border-border bg-background p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Funnel planner
          </p>
          <h2 className="font-heading text-lg tracking-wide">
            Sellout target: {fmtInt(data.ticketsTarget)} tickets
          </h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Leeds FA Cup defaults · Meta-only v1
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        {RATE_META.map((rate) => (
          <RateCard
            key={rate.key}
            label={rate.label}
            value={override[rate.key] ?? rate.defaultValue}
            defaultValue={rate.defaultValue}
            actual={actualRates[rate.key]}
            onChange={(value) =>
              setOverride((prev) => ({ ...prev, [rate.key]: value }))
            }
            onReset={() =>
              setOverride((prev) => {
                const next = { ...prev };
                delete next[rate.key];
                return next;
              })
            }
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        <VolumeCard
          label="TOFU"
          volumeLabel="reach needed"
          required={required.tofuReach}
          actual={data.tofu.reach}
          costBasis={data.effectiveCostPerReach ?? data.tofu.costPerReach}
        />
        <VolumeCard
          label="MOFU"
          volumeLabel="reach needed"
          required={required.mofuReach}
          actual={data.mofu.reach}
          costBasis={data.effectiveCostPerReach ?? data.mofu.costPerReach}
        />
        <VolumeCard
          label="BOFU"
          volumeLabel="LPV needed"
          required={required.bofuLpv}
          actual={data.bofu.lpv}
          costBasis={data.effectiveCostPerLpv ?? data.bofu.costPerLpv}
        />
        <VolumeCard
          label="SALE"
          volumeLabel="tickets target"
          required={data.ticketsTarget}
          actual={data.ticketsSold}
          costBasis={null}
        />
      </div>

      <FunnelChart
        tiers={[
          { label: "TOFU", required: required.tofuReach, actual: data.tofu.reach },
          { label: "MOFU", required: required.mofuReach, actual: data.mofu.reach },
          { label: "BOFU", required: required.bofuLpv, actual: data.bofu.lpv },
          { label: "SALE", required: data.ticketsTarget, actual: data.ticketsSold },
        ]}
      />
    </section>
  );
}

export function VenueFunnelPlanner({
  clientId,
  eventCode,
  shareToken,
  datePreset,
  customRange,
  isInternal,
  refreshNonce = 0,
  events,
}: {
  clientId: string;
  eventCode: string;
  shareToken: string;
  datePreset: DatePreset;
  customRange?: CustomDateRange;
  isInternal: boolean;
  refreshNonce?: number;
  events: FunnelEventLike[];
}) {
  const url = useMemo(() => {
    const params = new URLSearchParams();
    params.set("datePreset", datePreset);
    if (datePreset === "custom" && customRange) {
      params.set("since", customRange.since);
      params.set("until", customRange.until);
    }
    if (refreshNonce > 0) {
      params.set("force", "1");
      params.set("nonce", String(refreshNonce));
    }
    const query = params.toString();
    if (isInternal) {
      return `/api/insights/venue/${encodeURIComponent(clientId)}/${encodeURIComponent(eventCode)}?${query}`;
    }
    return `/api/share/venue/${encodeURIComponent(shareToken)}/insights?${query}`;
  }, [
    clientId,
    customRange,
    datePreset,
    eventCode,
    isInternal,
    refreshNonce,
    shareToken,
  ]);
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; campaigns: MetaCampaignRow[] }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const load = async () => {
      setState({ kind: "loading" });
      try {
        const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
        const json = (await res.json()) as InsightsResult | { error?: string };
        if (!res.ok) {
          throw new Error("error" in json && json.error ? String(json.error) : `HTTP ${res.status}`);
        }
        if (!("ok" in json) || !json.ok) {
          const message =
            "ok" in json && !json.ok
              ? json.error.message
              : "Funnel insights unavailable";
          throw new Error(message);
        }
        if (!cancelled) {
          setState({ kind: "ready", campaigns: json.data.campaigns });
        }
      } catch (err) {
        if (cancelled || (err instanceof Error && err.name === "AbortError")) {
          return;
        }
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Funnel planner unavailable",
        });
      }
    };
    void load();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [url]);

  if (state.kind === "loading") return <FunnelPlannerSkeleton />;
  if (state.kind === "error") {
    return <FunnelPlannerMessage message={state.message} />;
  }
  return (
    <FunnelPlanner
      events={events}
      campaigns={state.campaigns}
      storageKey={`funnel-planner:venue:${clientId}:${eventCode}`}
      overrideEndpoint={
        isInternal
          ? `/api/clients/${encodeURIComponent(clientId)}/venues/${encodeURIComponent(eventCode)}/funnel-overrides`
          : `/api/share/venue/${encodeURIComponent(shareToken)}/funnel-overrides`
      }
    />
  );
}

function FunnelPlannerSkeleton() {
  return <FunnelPlannerMessage message="Loading Funnel Planner..." />;
}

function FunnelPlannerMessage({ message }: { message: string }) {
  return (
    <section className="rounded-md border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
      {message}
    </section>
  );
}

function RateCard({
  label,
  value,
  defaultValue,
  actual,
  onChange,
  onReset,
}: {
  label: string;
  value: number | null;
  defaultValue: number | null;
  actual: number | null;
  onChange: (value: number | null) => void;
  onReset: () => void;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <input
        className="mt-2 w-full rounded border border-border bg-background px-2 py-1 text-sm tabular-nums"
        inputMode="decimal"
        placeholder="TBC"
        value={value == null ? "" : String(Math.round(value * 10000) / 100)}
        onChange={(event) => {
          const raw = event.currentTarget.value.trim();
          onChange(raw === "" ? null : Number(raw) / 100);
        }}
      />
      <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
        <p>Leeds default: {fmtPct(defaultValue)}</p>
        <p>Your actual: {fmtPct(actual)}</p>
        <button
          type="button"
          className="text-foreground underline-offset-2 hover:underline"
          onClick={onReset}
        >
          Reset to default
        </button>
      </div>
    </div>
  );
}

function VolumeCard({
  label,
  volumeLabel,
  required,
  actual,
  costBasis,
}: {
  label: string;
  volumeLabel: string;
  required: number | null;
  actual: number;
  costBasis: number | null;
}) {
  const pct = required && required > 0 ? Math.min(100, (actual / required) * 100) : null;
  const status = pct == null ? "TBC" : pct >= 100 ? "AHEAD" : pct >= 75 ? "ON TRACK" : "BEHIND";
  const spendNeeded = required != null && costBasis != null ? required * costBasis : null;
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-heading text-base tracking-wide">{label}</p>
        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          {status}
        </span>
      </div>
      <p className="mt-3 font-heading text-xl tracking-wide tabular-nums">
        {required == null ? "TBC" : fmtInt(Math.ceil(required))}
      </p>
      <p className="text-xs text-muted-foreground">{volumeLabel}</p>
      <p className="mt-2 text-sm tabular-nums text-muted-foreground">
        {spendNeeded == null ? "Budget TBC" : `${fmtCurrencyCompact(spendNeeded)} budget`}
      </p>
      <p className="text-[11px] text-muted-foreground">
        {costBasis == null ? "Cost basis TBC" : `${fmtCurrencyCompact(costBasis)} / unit`}
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${pct ?? 0}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
        Actual {fmtInt(actual)} {pct == null ? "" : `· ${pct.toFixed(0)}%`}
      </p>
    </div>
  );
}

function FunnelChart({
  tiers,
}: {
  tiers: Array<{ label: string; required: number | null; actual: number }>;
}) {
  const chartWidth = 920;
  const tierHeight = 80;
  const gap = 10;
  const maxRequired = Math.max(
    1,
    ...tiers.map((tier) => tier.required ?? 0),
  );

  return (
    <section className="rounded-md border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-heading text-base tracking-wide">Visual funnel</h3>
        <p className="text-xs text-muted-foreground">
          Fill shows actual progress toward required volume
        </p>
      </div>
      <svg
        viewBox={`0 0 ${chartWidth} ${tiers.length * (tierHeight + gap) - gap}`}
        role="img"
        aria-label="Required funnel volumes versus actual progress"
        className="h-auto w-full overflow-visible"
      >
        {tiers.map((tier, index) => {
          const y = index * (tierHeight + gap);
          const topWidth = widthForTier(tier.required, maxRequired, chartWidth);
          const nextRequired = tiers[index + 1]?.required ?? tier.required;
          const bottomWidth = widthForTier(nextRequired, maxRequired, chartWidth);
          const progress =
            tier.required && tier.required > 0
              ? Math.min(1, tier.actual / tier.required)
              : 0;
          const topFill = topWidth * progress;
          const bottomFill = bottomWidth * progress;
          const center = chartWidth / 2;
          const bgPoints = trapezoidPoints(center, y, topWidth, bottomWidth, tierHeight);
          const fillPoints = trapezoidPoints(center, y, topFill, bottomFill, tierHeight);
          const pct = tier.required && tier.required > 0 ? progress * 100 : null;
          return (
            <g key={tier.label}>
              <polygon points={bgPoints} className="fill-muted stroke-border" />
              <polygon points={fillPoints} className={fillClass(pct)} />
              <text
                x={center}
                y={y + 34}
                textAnchor="middle"
                className="fill-foreground font-heading text-[20px] tracking-wide"
              >
                {tier.label} · {tier.required == null ? "TBC" : fmtInt(Math.ceil(tier.required))}
              </text>
              <text
                x={center}
                y={y + 58}
                textAnchor="middle"
                className="fill-muted-foreground text-[14px]"
              >
                Actual {fmtInt(tier.actual)}
                {pct == null ? "" : ` · ${pct.toFixed(0)}%`}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}

function widthForTier(
  required: number | null,
  maxRequired: number,
  chartWidth: number,
): number {
  if (required == null || required <= 0) return chartWidth * 0.36;
  const ratio = required / maxRequired;
  return chartWidth * (0.36 + ratio * 0.58);
}

function trapezoidPoints(
  center: number,
  y: number,
  topWidth: number,
  bottomWidth: number,
  height: number,
): string {
  const topLeft = center - topWidth / 2;
  const topRight = center + topWidth / 2;
  const bottomLeft = center - bottomWidth / 2;
  const bottomRight = center + bottomWidth / 2;
  return `${topLeft},${y} ${topRight},${y} ${bottomRight},${y + height} ${bottomLeft},${y + height}`;
}

function fillClass(pct: number | null): string {
  if (pct == null) return "fill-muted-foreground/20";
  if (pct >= 100) return "fill-emerald-500/70";
  if (pct >= 75) return "fill-amber-500/70";
  return "fill-red-500/70";
}

function requiredVolumes(data: ReturnType<typeof aggregateFunnelData>): {
  regs: number;
  bofuLpv: number | null;
  mofuReach: number | null;
  tofuReach: number | null;
} {
  const regs = data.ticketsTarget * (1 - data.effectiveOrganicLift);
  const bofuLpv =
    data.effectiveBofuToReg > 0 ? regs / data.effectiveBofuToReg : null;
  const mofuReach =
    bofuLpv != null && data.effectiveMofuToBofu && data.effectiveMofuToBofu > 0
      ? bofuLpv / data.effectiveMofuToBofu
      : null;
  const tofuReach =
    mofuReach != null && data.effectiveTofuToMofu && data.effectiveTofuToMofu > 0
      ? mofuReach / data.effectiveTofuToMofu
      : null;
  return { regs, bofuLpv, mofuReach, tofuReach };
}

function fmtPct(value: number | null): string {
  return value == null ? "TBC" : `${(value * 100).toFixed(2)}%`;
}

function fmtInt(value: number): string {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(
    value,
  );
}
