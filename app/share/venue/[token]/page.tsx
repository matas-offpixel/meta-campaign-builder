import type { Metadata } from "next";

import { loadVenuePortalByToken } from "@/lib/db/client-portal-server";
import { VenueFullReport } from "@/components/share/venue-full-report";
import { ClientPortalUnavailable } from "@/components/share/client-portal-unavailable";

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
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Venue Report · Off Pixel",
    robots: { index: false, follow: false },
  };
}

export default async function VenueSharePage({ params }: Props) {
  const { token } = await params;
  const result = await loadVenuePortalByToken(token, { bumpView: true });

  if (!result.ok) {
    return <ClientPortalUnavailable />;
  }

  return (
    <main className="min-h-screen bg-zinc-50 py-6 text-zinc-900">
      <div className="mx-auto max-w-7xl space-y-6 px-4 sm:px-6">
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            Off Pixel · Venue Report
          </p>
          <h1 className="font-heading text-2xl tracking-wide">
            {result.events[0]?.venue_name ?? result.event_code}
          </h1>
          <p className="text-sm text-zinc-600">
            {result.events.length} event
            {result.events.length === 1 ? "" : "s"} under event code{" "}
            <span className="font-mono text-xs">{result.event_code}</span>.
          </p>
        </div>
        <VenueFullReport
          token={token}
          clientId={result.client_id}
          eventCode={result.event_code}
          client={result.client}
          events={result.events}
          dailyEntries={result.dailyEntries}
          dailyRollups={result.dailyRollups}
          additionalSpend={result.additionalSpend}
          weeklyTicketSnapshots={result.weeklyTicketSnapshots}
          londonOnsaleSpend={result.londonOnsaleSpend}
          londonPresaleSpend={result.londonPresaleSpend}
          canEdit={result.can_edit}
        />
      </div>
    </main>
  );
}
