"use client";

import {
  type AttributionClassification,
  type AttributionState,
} from "@/lib/dashboard/attribution-state";

/**
 * components/dashboard/client-portal/AttributionGapColumn.tsx
 *
 * Compact attribution badge surfaced in the client-portal events
 * table (one per venue row). Inherits the four-state classifier
 * from `AttributionGapTile` but renders as a single chip — the
 * full explainer lives on the event-report tile.
 *
 * Used purely as a presentational badge. The header cell (and the
 * sort / default-sort wiring) lives in the parent table component
 * where the rest of the column wiring is.
 */

const STATE_LABEL: Record<AttributionState, string> = {
  no_data: "—",
  capi_missing: "CAPI off",
  over_attributed: "Over-attr.",
  tracked: "Tracked",
};

const BADGE_COLOURS: Record<string, string> = {
  red: "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
  amber:
    "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  green:
    "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  neutral: "bg-muted text-muted-foreground border-border",
};

function badgeColour(c: AttributionClassification): string {
  if (c.state === "tracked" && c.band) return BADGE_COLOURS[c.band];
  if (c.state === "capi_missing" || c.state === "over_attributed") {
    return BADGE_COLOURS.red;
  }
  return BADGE_COLOURS.neutral;
}

interface Props {
  attribution: AttributionClassification;
  /**
   * Compact variant used by the campaigns-tab ad-set rows: renders a
   * single coloured dot rather than the labelled pill, since the
   * parent campaign row already carries the explicit badge.
   */
  compact?: boolean;
}

export function AttributionGapColumn({ attribution, compact = false }: Props) {
  const label = STATE_LABEL[attribution.state];
  if (attribution.state === "no_data") {
    return (
      <span
        className="text-muted-foreground"
        data-testid="attribution-column-cell"
        data-attribution-state="no_data"
      >
        —
      </span>
    );
  }
  if (compact) {
    return (
      <span
        className={`inline-block h-2 w-2 rounded-full ${dotColour(attribution)}`}
        data-testid="attribution-column-dot"
        data-attribution-state={attribution.state}
        data-attribution-band={attribution.band ?? ""}
        title={tooltipFor(attribution)}
      />
    );
  }
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${badgeColour(attribution)}`}
      data-testid="attribution-column-cell"
      data-attribution-state={attribution.state}
      data-attribution-band={attribution.band ?? ""}
      title={tooltipFor(attribution)}
    >
      {label}
      {attribution.state === "tracked" && attribution.rate != null
        ? ` · ${(attribution.rate * 100).toFixed(0)}%`
        : null}
    </span>
  );
}

function tooltipFor(c: AttributionClassification): string {
  if (c.state === "tracked" && c.rate != null) {
    return `Meta-reported / ticketsTrue = ${(c.rate * 100).toFixed(0)}%`;
  }
  if (c.state === "capi_missing") {
    return "Meta reported zero conversions while ticketing reports real sales.";
  }
  if (c.state === "over_attributed") {
    return "Meta over-reports conversions vs real ticket sales.";
  }
  return "No attribution data";
}

function dotColour(c: AttributionClassification): string {
  if (c.state === "tracked" && c.band === "green") return "bg-emerald-500";
  if (c.state === "tracked" && c.band === "amber") return "bg-amber-500";
  if (c.state === "tracked" && c.band === "red") return "bg-red-500";
  if (c.state === "capi_missing" || c.state === "over_attributed")
    return "bg-red-500";
  return "bg-muted-foreground/40";
}
