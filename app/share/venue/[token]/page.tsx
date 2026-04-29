import type { Metadata } from "next";

import { loadVenuePortalByToken } from "@/lib/db/client-portal-server";
import { VenueFullReport } from "@/components/share/venue-full-report";
import { ClientPortalUnavailable } from "@/components/share/client-portal-unavailable";
import {
  DATE_PRESETS,
  type CustomDateRange,
  type DatePreset,
} from "@/lib/insights/types";

/**
 * app/share/venue/[token]/page.tsx
 *
 * Public venue full-report page. Mirrors `/share/client/[token]` but
 * scopes to a single (client_id, event_code) pair — one venue group —
 * rather than the whole client roll-up.
 *
 * Token contract (migration 052):
 *   - scope='venue', client_id NOT NULL, event_code NOT NULL
 *   - can_edit gates additional-spend CRUD on the public surface
 *     (consumed by PR 4's venue-level additional spend card).
 *
 * Failure modes (collapsed to the neutral unavailable page):
 *   - Unknown / disabled / expired / malformed token.
 *   - Token resolves to a non-venue scope (event/client).
 *   - Token resolves but no events match the pinned event_code
 *     (rename / delete after mint). Rare but guarded.
 *
 * `dynamic = 'force-dynamic'` because the payload must reflect the
 * latest snapshot the client just saved — caching would visibly lag
 * the "Last updated" line.
 */

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Venue Report · Off Pixel",
    robots: { index: false, follow: false },
  };
}

export default async function VenueSharePage({ params, searchParams }: Props) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const datePreset = parseDatePreset(sp.tf);
  const customRange = parseCustomRange(
    datePreset,
    pickQueryParam(sp.from),
    pickQueryParam(sp.to),
  );
  const result = await loadVenuePortalByToken(token, { bumpView: true });

  if (!result.ok) {
    return <ClientPortalUnavailable />;
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-5">
          <p className="font-heading text-base tracking-[0.2em] text-foreground">
            OFF / PIXEL
          </p>
          <p className="max-w-[40ch] truncate text-xs text-muted-foreground">
            Venue Report
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <section className="space-y-2">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Venue Report
          </p>
          <h1 className="font-heading text-2xl tracking-wide text-foreground">
            {result.events[0]?.venue_name ?? result.event_code}
          </h1>
          <p className="text-sm text-muted-foreground">
            {result.events.length} event
            {result.events.length === 1 ? "" : "s"} under event code{" "}
            <span className="font-mono text-xs text-foreground">
              {result.event_code}
            </span>
            .
          </p>
        </section>
        <VenueFullReport
          token={token}
          clientId={result.client_id}
          eventCode={result.event_code}
          events={result.events}
          dailyEntries={result.dailyEntries}
          dailyRollups={result.dailyRollups}
          additionalSpend={result.additionalSpend}
          weeklyTicketSnapshots={result.weeklyTicketSnapshots}
          londonOnsaleSpend={result.londonOnsaleSpend}
          londonPresaleSpend={result.londonPresaleSpend}
          canEdit={result.can_edit}
          datePreset={datePreset}
          customRange={customRange}
        />
      </div>
    </main>
  );
}

function parseDatePreset(value: string | string[] | undefined): DatePreset {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "custom") return "custom";
  if (raw && (DATE_PRESETS as readonly string[]).includes(raw)) {
    return raw as DatePreset;
  }
  return "maximum";
}

function pickQueryParam(
  value: string | string[] | undefined,
): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function parseCustomRange(
  preset: DatePreset,
  from: string | null,
  to: string | null,
): CustomDateRange | undefined {
  if (preset !== "custom") return undefined;
  if (!from || !to) return undefined;
  return { since: from, until: to };
}
