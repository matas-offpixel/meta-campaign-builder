import type { ReactNode } from "react";

import { aspectChipRatio } from "@/lib/viz/aspect-chip";
import {
  emptyMetricDisplay,
  metricChipTone,
  metricChipToneClass,
  type MetricChipBenchmark,
  type VizBenchmarkDirection,
} from "@/lib/viz/metric-chip";
import { VIZ_LINE_TOKEN, VIZ_TYPE, VIZ_TYPE_NUM, type VizLineKind } from "@/lib/viz/tokens";

import { InfoTip } from "./info-tip";
import { ThresholdBand } from "./threshold-band";

const SIZE_CLASS = {
  sm: `rounded-full border border-border bg-muted/40 px-1.5 py-0 ${VIZ_TYPE.micro}`,
  md: `rounded-full border border-border bg-muted/40 px-2 py-0.5 ${VIZ_TYPE_NUM.body}`,
  lg: `rounded-md px-0 py-0 ${VIZ_TYPE.display}`,
} as const;

function Sparkline({ values }: { values: number[] }) {
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = values.length === 1 ? 20 : (index / (values.length - 1)) * 40;
      const y = 12 - ((value - min) / span) * 12;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width="40" height="12" viewBox="0 0 40 12" aria-hidden="true" className="text-foreground">
      <polyline fill="none" stroke="currentColor" strokeWidth="1" points={points} />
    </svg>
  );
}

export function MetricChip({
  label,
  children,
  className = "",
  size = "md",
  value,
  benchmark,
  trend,
  phaseLabel,
  lineKind,
  emptySentence,
  emptyHref,
  direction,
  infoHeader,
}: {
  label: string;
  children?: ReactNode;
  className?: string;
  size?: keyof typeof SIZE_CLASS;
  value?: number | null;
  benchmark?: MetricChipBenchmark;
  trend?: number[];
  phaseLabel?: string;
  lineKind?: VizLineKind;
  emptySentence?: string;
  emptyHref?: string;
  direction?: VizBenchmarkDirection;
  infoHeader?: string;
}) {
  const empty = value == null && emptySentence ? emptyMetricDisplay(emptySentence) : null;
  const showExhibit = Boolean(benchmark || empty || phaseLabel || trend || value != null);

  if (!showExhibit) {
    return (
      <span
        className={`inline-flex items-center gap-1 tabular-nums ${SIZE_CLASS[size]} ${className}`}
        aria-label={label}
        title={label}
      >
        {children}
      </span>
    );
  }

  const kind: VizLineKind = lineKind ?? benchmark?.lineKind ?? (empty ? "not-yet" : "measured");
  const resolvedDirection = direction ?? benchmark?.direction ?? "lower-is-better";
  const tone =
    value != null && benchmark?.band
      ? metricChipTone({ value, band: benchmark.band, direction: resolvedDirection })
      : null;
  const toneClass = metricChipToneClass(tone);
  const display = empty ? empty.display : children;

  return (
    <span className={`inline-flex flex-col items-start gap-1 ${className}`} aria-label={label}>
      {phaseLabel ? <span className={VIZ_TYPE.micro}>{phaseLabel}</span> : null}
      <span
        className={`inline-flex items-baseline gap-1.5 tabular-nums ${SIZE_CLASS.lg} ${
          empty ? "text-foreground/35" : toneClass
        }`}
      >
        {display}
      </span>
      <span className={`block h-px w-full border-b ${VIZ_LINE_TOKEN[kind]}`} />
      {benchmark ? (
        <span className={`${VIZ_TYPE.label} text-foreground/70`}>
          {benchmark.value.toLocaleString("en-GB", { maximumFractionDigits: 2 })}
        </span>
      ) : null}
      {benchmark?.band && (value != null || benchmark.value != null) ? (
        <ThresholdBand
          zonesFrom="client-iqr"
          band={benchmark.band}
          marker={value ?? benchmark.value}
          lineKind={benchmark.lineKind}
          size="md"
        />
      ) : null}
      {trend ? <Sparkline values={trend} /> : null}
      {empty ? (
        <span className={VIZ_TYPE.body}>
          {emptyHref ? (
            <a href={emptyHref} className="underline underline-offset-2">
              {empty.sentence}
            </a>
          ) : (
            empty.sentence
          )}
        </span>
      ) : null}
      {benchmark?.sentence ? (
        <InfoTip
          variant="card"
          header={infoHeader}
          label={
            benchmark.runsUsed.length > 0
              ? `${benchmark.sentence} · ${benchmark.bandWord} · ${benchmark.runsUsed.join(" · ")}`
              : benchmark.sentence
          }
        />
      ) : null}
    </span>
  );
}

export function AspectChip({
  ratio,
}: {
  ratio: string;
}) {
  const label = aspectChipRatio(ratio);
  const shape =
    label === "9:16"
      ? "h-3.5 w-2"
      : label === "1:1"
        ? "h-3 w-3"
        : label === "4:5"
          ? "h-3.5 w-2.5"
          : "h-2.5 w-3.5";
  return (
    <MetricChip label={label} size="sm">
      <span className={`rounded-[1px] border border-current ${shape}`} aria-hidden="true" />
      <span>{label}</span>
    </MetricChip>
  );
}
