"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Info } from "lucide-react";

import {
  trustBand,
  coverageBand,
  formatRatio,
  type AttributionBadgeBand,
} from "@/lib/dashboard/real-attribution-bands";

/**
 * components/dashboard/event-report/RealAttributionTile.tsx
 *
 * The PR #423 successor to PR #422's `AttributionGapTile`. Surfaces
 * three numbers per event:
 *
 *   1. Meta-reported PURCHASES — `action_type =
 *      offsite_conversion.fb_pixel_purchase` only. Distinct from
 *      the broader `meta_regs` figure the previous tile compared
 *      against.
 *   2. Off/Pixel-attributed purchases — real ticket sales joined to
 *      a Meta click via email hash / external_id / fbc cookie.
 *      The commercial moat: Off/Pixel sees what Meta can't.
 *   3. Real ticket total (`ticketsTrue` from the canonical resolver).
 *
 * Two badges:
 *   - **Trust** = Y / X (matched / Meta-claimed). Green 0.7–1.3,
 *     amber outside but populated, red when the ratio is missing
 *     entirely. Trust > 1.3 means Meta under-reports — usually a
 *     CAPI issue. Trust < 0.7 means Meta over-reports — usually a
 *     pixel-overlap issue.
 *   - **Coverage** = Y / Z (matched / real total). What share of
 *     real sales we attribute to any paid Meta touchpoint. Drives
 *     the "we know more than Meta" demo line.
 *
 * Render contract:
 *   - The caller is responsible for the feature-flag gate. This
 *     component does NOT consult `process.env` — that would force
 *     every consumer to be a server component. Instead the parent
 *     server-rendered surface (`venue-full-report.tsx`) gates on
 *     `isRealAttributionEnabled()` and only renders this tile when
 *     the flag is on.
 *   - When `metaReportedPurchases === null` we render a labelled
 *     "Meta backfill pending" placeholder for the X column rather
 *     than a hard "—". This is deliberate — the dark build needs
 *     to differentiate "Meta returned zero" (zero) from "we haven't
 *     asked Meta yet" (null). Joe's webhook ships and the backfill
 *     runs and the column flips to a real number.
 *   - When `eventKind === "brand_campaign"` the tile renders null.
 *     Brand campaigns don't have purchase events — surfacing the
 *     tile would be misleading.
 */

interface Props {
  /** Sum of `event_daily_rollups.meta_purchases` for the event_code. */
  metaReportedPurchases: number | null;
  /**
   * Sum of `attribution_order_matches` rows where `match_strategy
   * != 'unmatched'` for the event_code. Always a number; zero is
   * the honest pre-Joe answer.
   */
  offpixelAttributedPurchases: number;
  /** Real total ticket sales (from the canonical resolver). */
  ticketsTrue: number;
  /** `Y / X`. `null` when X = 0 / null. */
  trustRatio: number | null;
  /** `Y / Z`. `null` when Z = 0. */
  coverageRatio: number | null;
  /** Brand-campaign events render null. */
  eventKind?: "event" | "brand_campaign";
}

const NUM = new Intl.NumberFormat("en-GB");

function fmtNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return NUM.format(Math.round(n));
}

const BADGE_COLOURS: Record<AttributionBadgeBand, string> = {
  red: "bg-red-100 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
  amber:
    "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  green:
    "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  neutral: "bg-muted text-muted-foreground border-border",
};

export function RealAttributionTile({
  metaReportedPurchases,
  offpixelAttributedPurchases,
  ticketsTrue,
  trustRatio,
  coverageRatio,
  eventKind = "event",
}: Props) {
  const [expanded, setExpanded] = useState(false);
  if (eventKind === "brand_campaign") return null;

  const trust = trustBand(trustRatio);
  const coverage = coverageBand(coverageRatio);

  const headline = buildHeadline({
    metaReportedPurchases,
    offpixelAttributedPurchases,
    ticketsTrue,
  });

  return (
    <section
      className="rounded-md border border-border bg-card p-5"
      data-testid="real-attribution-tile"
      data-trust-band={trust}
      data-coverage-band={coverage}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Real attribution
            </p>
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${BADGE_COLOURS[trust]}`}
              data-testid="real-attribution-trust-badge"
              data-band={trust}
            >
              Trust · {formatRatio(trustRatio)}
            </span>
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${BADGE_COLOURS[coverage]}`}
              data-testid="real-attribution-coverage-badge"
              data-band={coverage}
            >
              Coverage · {formatRatio(coverageRatio)}
            </span>
          </div>

          <div
            className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3"
            data-testid="real-attribution-three-numbers"
          >
            <NumberCell
              label="Meta claims"
              value={
                metaReportedPurchases == null
                  ? null
                  : fmtNum(metaReportedPurchases)
              }
              hint={
                metaReportedPurchases == null
                  ? "Meta backfill pending"
                  : "Purchase events Meta says it drove"
              }
              testId="real-attribution-meta-claims"
            />
            <NumberCell
              label="We verified"
              value={fmtNum(offpixelAttributedPurchases)}
              hint="Real buyers we joined back to a Meta click"
              testId="real-attribution-we-verified"
              accent="primary"
            />
            <NumberCell
              label="Real total"
              value={fmtNum(ticketsTrue)}
              hint="Ticket sales from the venue's ticketing source"
              testId="real-attribution-real-total"
            />
          </div>

          <p className="mt-3 max-w-prose text-sm text-foreground/90">
            {headline}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="inline-flex items-center gap-1 rounded border border-border-strong px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          aria-expanded={expanded}
          data-testid="real-attribution-explainer-toggle"
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          <Info className="h-3 w-3" />
          How to read this
        </button>
      </div>

      {expanded ? (
        <div
          className="mt-4 space-y-2 rounded-md border border-border bg-background/60 p-4 text-xs text-muted-foreground"
          data-testid="real-attribution-explainer"
        >
          <p>
            <span className="font-medium text-foreground">Meta claims</span>{" "}
            is what Meta self-reports as Purchase events fired against
            this event&apos;s pixel. Off/Pixel doesn&apos;t control this
            number — Meta does.
          </p>
          <p>
            <span className="font-medium text-foreground">We verified</span>{" "}
            is the count of real ticket buyers we matched back to a Meta
            click via hashed email, external id, or fbc cookie. Off/Pixel
            sees these joins because we ingest both sides; Meta sees only
            its side.
          </p>
          <p>
            <span className="font-medium text-foreground">Real total</span>{" "}
            is total ticket sales from the venue&apos;s ticketing source.
            Coverage is the share of those real sales we attribute to a
            paid Meta touchpoint — anything above 50% is a healthy paid
            channel; below 20% means most sales are organic or coming
            from somewhere other than Meta.
          </p>
        </div>
      ) : null}
    </section>
  );
}

interface NumberCellProps {
  label: string;
  /** Pre-formatted string. `null` renders the placeholder hint instead. */
  value: string | null;
  hint: string;
  testId: string;
  accent?: "primary" | "default";
}

function NumberCell({ label, value, hint, testId, accent = "default" }: NumberCellProps) {
  return (
    <div
      className="rounded-md border border-border-strong bg-background/40 p-3"
      data-testid={testId}
    >
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 font-heading text-2xl tabular-nums ${
          accent === "primary" ? "text-primary" : "text-foreground"
        }`}
        data-value={value ?? "pending"}
      >
        {value ?? <span className="text-muted-foreground text-base">—</span>}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function buildHeadline(args: {
  metaReportedPurchases: number | null;
  offpixelAttributedPurchases: number;
  ticketsTrue: number;
}): string {
  const x = args.metaReportedPurchases;
  const y = args.offpixelAttributedPurchases;
  const z = args.ticketsTrue;
  if (x == null) {
    return `Off/Pixel verified ${NUM.format(y)} of ${NUM.format(z)} real ticket sales as paid-Meta-driven. Meta&rsquo;s own purchase count is pending — once the Meta backfill runs, the trust badge will populate.`
      .replace("&rsquo;", "\u2019");
  }
  if (z === 0 && x === 0) {
    return "No purchase data yet on either side.";
  }
  if (x === 0 && y === 0 && z > 0) {
    return `Meta sees zero purchases and Off/Pixel hasn\u2019t matched any of the ${NUM.format(z)} real sales — likely the Meta pixel isn\u2019t firing Purchase events.`;
  }
  return `Meta claims ${NUM.format(x)} purchases · Off/Pixel verified ${NUM.format(y)} · Real total ${NUM.format(z)}.`;
}
