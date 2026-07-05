import type {
  CountrySlice,
  DailyPoint,
  SocialSplit,
} from "@/lib/admin/insights";

/**
 * components/admin/insight-charts.tsx — hand-rolled SVG/div charts for
 * the insights page (OP909 Phase 6). Server components, zero JS shipped.
 * recharts is NOT in this repo's deps (same call as
 * components/dashboard/events/ticket-pacing-card.tsx) and the no-new-deps
 * rule holds — these are simple enough that a library buys nothing.
 */

const ACCENT = "#4f46e5"; // indigo-600 — admin surface accent, NOT the fan palette
const ACCENT_SOFT = "#c7d2fe"; // indigo-200

// ─── Daily signups bar chart ─────────────────────────────────────────────────

export function DailyBarChart({ series }: { series: DailyPoint[] }) {
  const width = 720;
  const height = 180;
  const padBottom = 22;
  const padTop = 14;
  const max = Math.max(1, ...series.map((p) => p.count));
  const slot = width / Math.max(1, series.length);
  const barWidth = Math.max(4, slot - 4);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label={`Daily signups, last ${series.length} days`}
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
              y={y}
              width={barWidth}
              height={barHeight}
              rx={2}
              fill={point.count === 0 ? ACCENT_SOFT : ACCENT}
              opacity={point.count === 0 ? 0.5 : 1}
            />
            {point.count > 0 && (
              <text
                x={x + barWidth / 2}
                y={y - 4}
                textAnchor="middle"
                fontSize="10"
                fill="#6b7280"
              >
                {point.count}
              </text>
            )}
            {showLabel && (
              <text
                x={x + barWidth / 2}
                y={height - 8}
                textAnchor="middle"
                fontSize="9"
                fill="#9ca3af"
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

// ─── Country share bars ──────────────────────────────────────────────────────

export function CountryBars({ slices }: { slices: CountrySlice[] }) {
  if (slices.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No signups yet.</p>
    );
  }
  return (
    <ul className="space-y-2">
      {slices.map((slice) => (
        <li key={slice.country} className="flex items-center gap-3 text-sm">
          <span className="w-16 shrink-0 font-medium">{slice.country}</span>
          <span className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${slice.pct}%`, backgroundColor: ACCENT }}
            />
          </span>
          <span className="w-24 shrink-0 text-right tabular-nums text-muted-foreground">
            {slice.count.toLocaleString("en-GB")} · {slice.pct}%
          </span>
        </li>
      ))}
    </ul>
  );
}

// ─── Instagram / TikTok donut ────────────────────────────────────────────────

export function SocialDonut({ split }: { split: SocialSplit }) {
  if (split.total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No signups with a social handle yet.
      </p>
    );
  }
  const size = 132;
  const stroke = 18;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const igShare = split.ig / split.total;

  return (
    <div className="flex items-center gap-6">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Instagram ${split.ig}, TikTok ${split.tt}`}
      >
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={ACCENT_SOFT}
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={ACCENT}
            strokeWidth={stroke}
            strokeDasharray={`${circumference * igShare} ${circumference}`}
          />
        </g>
        <text
          x="50%"
          y="50%"
          dominantBaseline="central"
          textAnchor="middle"
          fontSize="18"
          fontWeight="600"
          fill="#111827"
        >
          {split.total.toLocaleString("en-GB")}
        </text>
      </svg>
      <ul className="space-y-2 text-sm">
        <li className="flex items-center gap-2">
          <span
            className="h-3 w-3 rounded-sm"
            style={{ backgroundColor: ACCENT }}
          />
          Instagram — {split.ig.toLocaleString("en-GB")}
          {split.igPct !== null && (
            <span className="text-muted-foreground">({split.igPct}%)</span>
          )}
        </li>
        <li className="flex items-center gap-2">
          <span
            className="h-3 w-3 rounded-sm"
            style={{ backgroundColor: ACCENT_SOFT }}
          />
          TikTok — {split.tt.toLocaleString("en-GB")}
          {split.igPct !== null && (
            <span className="text-muted-foreground">
              ({Math.round((100 - split.igPct) * 10) / 10}%)
            </span>
          )}
        </li>
      </ul>
    </div>
  );
}
