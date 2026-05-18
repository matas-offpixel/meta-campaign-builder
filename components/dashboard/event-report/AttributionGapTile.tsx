"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Info } from "lucide-react";

import {
  type AttributionClassification,
  type AttributionState,
} from "@/lib/dashboard/attribution-state";

/**
 * components/dashboard/event-report/AttributionGapTile.tsx
 *
 * Client-facing surface for the three-state attribution classifier.
 * Renders on the venue Performance tab (internal + share — same code
 * path) between the Topline Stats Grid and the Daily Trend chart.
 *
 * Thesis (per the prompt that produced this file): the broken
 * `meta_regs` data IS the demo. We do NOT dedup it here; we surface
 * the breakage as labelled, colour-coded states so the client + ops
 * see the gap immediately. Phase 1a (per-order email match) is
 * gated on a separate workstream — the tile is the first artefact
 * that proves the gap exists at all.
 *
 * Render contract:
 *   - `no_data` ⇒ tile renders an empty placeholder ("—") and the
 *      micro-explainer is suppressed entirely.
 *   - `capi_missing` ⇒ red badge + "Server-side CAPI not firing —
 *      Meta sees zero conversions, ticketing reports N." Headline
 *      demo case for WC26-LONDON-SHEPHERDS.
 *   - `over_attributed` ⇒ red badge + "Sibling overlap or
 *      attribution-window leak — Meta over-reports vs ticketing."
 *   - `tracked` ⇒ band-coloured badge + percentage chip + "Meta is
 *      reporting X% of true ticket sales." Sub-banded green ≥80%,
 *      amber 40–79%, red <40%.
 *
 * Caller is responsible for the `event.kind !== 'brand_campaign'`
 * gate — pass `kind: 'brand_campaign'` and the tile renders
 * `null` so the awareness regression-test is honoured (BB26-KAYODE
 * stays clean).
 */

interface Props {
  metaRegs: number | null;
  ticketsTrue: number;
  attribution: AttributionClassification;
  /** Render `null` when the parent event is a brand campaign. */
  eventKind?: "event" | "brand_campaign";
}

const NUM = new Intl.NumberFormat("en-GB");

function fmtNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return NUM.format(Math.round(n));
}

function fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(rate < 0.1 ? 1 : 0)}%`;
}

const STATE_LABEL: Record<AttributionState, string> = {
  no_data: "No data",
  capi_missing: "CAPI not firing",
  over_attributed: "Over-attributed",
  tracked: "Tracked",
};

const STATE_HEADLINE: Record<AttributionState, string> = {
  no_data: "No conversion or ticket data yet for this event.",
  capi_missing:
    "Meta is not receiving any server-side conversion events while ticketing reports real sales — CAPI is missing or misconfigured.",
  over_attributed:
    "Meta is over-reporting registrations vs real ticket sales. Likely sibling-overlap from sharing a pixel across multiple events at this venue, or an attribution-window leak from broader prospecting traffic.",
  tracked: "", // dynamically filled with rate
};

const STATE_DETAIL: Record<AttributionState, string> = {
  no_data:
    "Once Meta starts logging events and the ticketing API begins reporting sales, this tile will populate with a tracked / capi_missing / over_attributed state.",
  capi_missing:
    "Server-side Conversions API is the canonical signal Meta uses for optimisation. Without it the campaign cannot self-improve and reported CPA / ROAS are unreliable. Action: have the developer wire CAPI to fire a Lead / Purchase event for every checkout completion. The tile will switch to the tracked state once events flow.",
  over_attributed:
    "We are intentionally NOT deduping these numbers in this view. The broken signal is informative — it tells you that Meta's attribution window is over-counting and any CPA / ROAS cited from Meta directly will look better than reality. Use the spend-share-allocated CPA on the Campaigns tab as a sanity check.",
  tracked:
    "Tracked means Meta-reported registrations land at or below the canonical ticket count for this event. The percentage chip is the share of real sales Meta saw — closer to 100% means tracking is healthy, lower means real sales are happening that Meta did not see.",
};

const BADGE_COLOURS: Record<string, string> = {
  red: "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
  amber:
    "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  green:
    "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  neutral:
    "bg-muted text-muted-foreground border-border",
};

function badgeColourFor(c: AttributionClassification): string {
  if (c.state === "tracked" && c.band) return BADGE_COLOURS[c.band];
  if (c.state === "capi_missing" || c.state === "over_attributed") {
    return BADGE_COLOURS.red;
  }
  return BADGE_COLOURS.neutral;
}

export function AttributionGapTile({
  metaRegs,
  ticketsTrue,
  attribution,
  eventKind = "event",
}: Props) {
  const [expanded, setExpanded] = useState(false);
  if (eventKind === "brand_campaign") return null;

  const headline =
    attribution.state === "tracked" && attribution.rate != null
      ? `Meta saw ${fmtPct(attribution.rate)} of real ticket sales (${fmtNum(metaRegs)} of ${fmtNum(ticketsTrue)}).`
      : STATE_HEADLINE[attribution.state];

  const noData = attribution.state === "no_data";
  return (
    <section
      className="rounded-md border border-border bg-card p-5"
      data-testid="attribution-gap-tile"
      data-attribution-state={attribution.state}
      data-attribution-band={attribution.band ?? ""}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Attribution health
            </p>
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${badgeColourFor(attribution)}`}
              data-testid="attribution-badge"
            >
              {STATE_LABEL[attribution.state]}
              {attribution.state === "tracked" && attribution.rate != null
                ? ` · ${fmtPct(attribution.rate)}`
                : null}
            </span>
          </div>
          <p className="mt-3 font-heading text-xl tracking-wide tabular-nums text-foreground">
            {noData ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <>
                {fmtNum(metaRegs)}
                <span className="text-sm font-normal text-muted-foreground">
                  {" "}
                  Meta-reported reg
                  {metaRegs === 1 ? "" : "s"}
                </span>
                <span className="text-sm font-normal text-muted-foreground">
                  {" "}
                  · {fmtNum(ticketsTrue)} ticket
                  {ticketsTrue === 1 ? "" : "s"} sold
                </span>
              </>
            )}
          </p>
          {!noData ? (
            <p className="mt-2 max-w-prose text-sm text-foreground/90">
              {headline}
            </p>
          ) : null}
        </div>
        {!noData ? (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded border border-border-strong px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            aria-expanded={expanded}
            data-testid="attribution-explainer-toggle"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <Info className="h-3 w-3" />
            How to read this
          </button>
        ) : null}
      </div>
      {expanded && !noData ? (
        <div
          className="mt-4 rounded-md border border-border bg-background/60 p-4 text-xs text-muted-foreground"
          data-testid="attribution-explainer"
        >
          <p>{STATE_DETAIL[attribution.state]}</p>
        </div>
      ) : null}
    </section>
  );
}
