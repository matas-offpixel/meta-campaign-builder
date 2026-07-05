import type { CountrySlice, DailyPoint } from "@/lib/admin/insights";
import { formatCountry } from "@/lib/admin/country-names";

/**
 * components/admin/fans-analytics.tsx — Supreme-aesthetic analytics band for
 * the Fans page (OP909 Sprint 2). Server components, zero JS shipped;
 * hand-rolled SVG/div (no-new-deps rule, same call as insight-charts). The
 * fan-facing look: mono labels, 0.5px hairlines, accent-filled bars, Futura
 * numbers via the shared MetricStat. Aggregation is reused from
 * lib/admin/insights.ts.
 */

// ─── Fan growth (daily bars) ─────────────────────────────────────────────────

export function FanGrowthChart({
  series,
  accent,
}: {
  series: DailyPoint[];
  accent: string;
}) {
  const width = 760;
  const height = 160;
  const padBottom = 20;
  const padTop = 16;
  const max = Math.max(1, ...series.map((p) => p.count));
  const slot = width / Math.max(1, series.length);
  const barWidth = Math.max(3, slot - 3);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label={`Fan growth, last ${series.length} days`}
    >
      {series.map((point, i) => {
        const barHeight =
          point.count === 0
            ? 0
            : Math.max(2, ((height - padTop - padBottom) * point.count) / max);
        const x = i * slot + (slot - barWidth) / 2;
        const y = height - padBottom - barHeight;
        const showLabel = i % 5 === 0 || i === series.length - 1;
        return (
          <g key={point.day}>
            <title>{`${point.label}: ${point.count}`}</title>
            <rect
              x={x}
              y={point.count === 0 ? height - padBottom - 2 : y}
              width={barWidth}
              height={point.count === 0 ? 2 : barHeight}
              fill={point.count === 0 ? "#e5e5e5" : accent}
            />
            {showLabel && (
              <text
                x={x + barWidth / 2}
                y={height - 6}
                textAnchor="middle"
                fontSize="9"
                fontFamily="var(--admin-mono)"
                fill="#999"
              >
                {point.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Top locations ───────────────────────────────────────────────────────────

export function TopLocations({
  slices,
  accent,
}: {
  slices: CountrySlice[];
  accent: string;
}) {
  if (slices.length === 0) {
    return (
      <p className="font-[family-name:var(--admin-mono)] text-[12px] text-[#999]">
        No locations yet.
      </p>
    );
  }
  return (
    <ul className="space-y-2.5">
      {slices.map((slice) => {
        const label =
          slice.country === "Unknown" || slice.country === "Other"
            ? slice.country
            : formatCountry(slice.country);
        return (
          <li
            key={slice.country}
            className="flex items-center gap-3 font-[family-name:var(--admin-mono)] text-[12px]"
          >
            <span className="w-44 shrink-0 truncate text-black" title={label}>
              {label}
            </span>
            <span className="relative h-[6px] flex-1 overflow-hidden bg-[#f0f0f0]">
              <span
                className="absolute inset-y-0 left-0"
                style={{ width: `${slice.pct}%`, backgroundColor: accent }}
              />
            </span>
            <span className="w-24 shrink-0 text-right tabular-nums text-[#666]">
              {slice.count.toLocaleString("en-GB")} · {slice.pct}%
            </span>
          </li>
        );
      })}
    </ul>
  );
}
