import { Settings } from "lucide-react";

import { FunnelCreativePacing } from "@/components/dashboard/clients/funnel-creative-pacing";
import { FunnelPacingVenueView } from "@/components/dashboard/clients/funnel-pacing-venue-view";
import { FunnelStageCard } from "@/components/dashboard/clients/funnel-stage-card";
import {
  buildClientFunnelPacing,
  type FunnelPacingResult,
} from "@/lib/reporting/funnel-pacing";
import type { VenueCanonicalFunnel } from "@/lib/dashboard/venue-canonical-funnel";
import type { CreativePatternRegionFilter } from "@/lib/reporting/creative-patterns-cross-event";

/**
 * Funnel Pacing tab entry point.
 *
 * When `venueCanonical` is supplied the section renders the new
 * canonical view (PR-B of issue #467). The page-level computes the
 * struct once from portal data and the Performance tab consumes the
 * SAME engagement numbers via the lifetime cache fields — shared
 * input + pure helper = surfaces cannot drift.
 *
 * For client-region scope (dashboard tabs, cross-venue rollups) the
 * legacy `buildClientFunnelPacing` flow is preserved.
 */
export async function FunnelPacingSection({
  clientId,
  regionFilter,
  isShared = false,
  venueCanonical,
  venueLabel,
  venueEventCode,
}: {
  clientId: string;
  regionFilter?: CreativePatternRegionFilter;
  isShared?: boolean;
  /**
   * Pre-built canonical struct for venue-scope (the venue page passes
   * this; share/venue page does the same). When present the legacy
   * `buildClientFunnelPacing` path is bypassed.
   */
  venueCanonical?: VenueCanonicalFunnel;
  /** Display label for the venue (used as the header on the new view). */
  venueLabel?: string;
  /** Event code for the venue — used to look up the live Meta daily budget. */
  venueEventCode?: string;
}) {
  if (venueCanonical) {
    return (
      <FunnelPacingVenueView
        pacing={venueCanonical}
        venueLabel={venueLabel ?? "Venue"}
        clientId={clientId}
        eventCode={venueEventCode ?? ""}
      />
    );
  }

  const pacing = await buildClientFunnelPacing(clientId, {
    regionFilter,
    sinceDays: 90,
    useServiceRole: isShared,
  });

  return <FunnelPacingView pacing={pacing} />;
}

function FunnelPacingView({ pacing }: { pacing: FunnelPacingResult }) {
  return (
    <section className="space-y-5">
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Funnel Pacing
            </p>
            <h2 className="mt-1 font-heading text-2xl tracking-wide">
              Auto-derived campaign pacing
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {sourceCopy(pacing)}
            </p>
          </div>
          <button
            type="button"
            title="Manual benchmark override will be enabled in the next iteration."
            className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground"
          >
            <Settings className="h-3.5 w-3.5" />
            Settings
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {pacing.stages.map((stage) => (
          <div key={stage.key} className="space-y-2">
            <FunnelStageCard stage={stage} />
            <FunnelCreativePacing />
          </div>
        ))}
      </div>
    </section>
  );
}

function sourceCopy(pacing: FunnelPacingResult): string {
  if (pacing.target.source === "manual") return "Manual override active.";
  if (pacing.target.source === "derived") {
    return `Benchmarks derived from ${
      pacing.sourceEventName ?? "your most recent sold-out event"
    }.`;
  }
  return "Fallback benchmarks are active until this scope has a sold-out event in the last 180 days.";
}
