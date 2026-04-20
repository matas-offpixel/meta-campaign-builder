import type { Metadata } from "next";

import { loadClientPortalData } from "@/lib/db/client-portal-server";
import { ClientPortal } from "@/components/share/client-portal";
import { ClientPortalUnavailable } from "@/components/share/client-portal-unavailable";

/**
 * Public client-facing ticket-input portal.
 *
 * No authentication: the token IS the credential. Server-side load
 * goes through `loadClientPortalData` which validates the token,
 * bumps the view counter, and returns the client + every event under
 * that client (with each event's latest weekly snapshot + history).
 *
 * Failure modes:
 *   - Unknown / disabled / expired token → "no longer available" page.
 *     Single neutral surface so a probing visitor can't distinguish
 *     "never existed" from "revoked".
 *   - Backend error after token validation → same neutral page.
 *
 * `dynamic = 'force-dynamic'` because the data must reflect the very
 * latest snapshot the client just saved a moment ago — caching here
 * would visibly lag the per-card "Last updated" line.
 */

interface Props {
  params: Promise<{ token: string }>;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({ params: _ }: Props): Promise<Metadata> {
  return {
    title: "Campaign Dashboard · Off Pixel",
    robots: { index: false, follow: false },
  };
}

export default async function ClientPortalPage({ params }: Props) {
  const { token } = await params;
  const result = await loadClientPortalData(token, { bumpView: true });

  if (!result.ok) {
    return <ClientPortalUnavailable />;
  }

  return (
    <ClientPortal
      token={token}
      client={result.client}
      events={result.events}
      londonOnsaleSpend={result.londonOnsaleSpend}
      londonPresaleSpend={result.londonPresaleSpend}
    />
  );
}
