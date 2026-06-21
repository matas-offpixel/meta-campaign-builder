import type { Metadata } from "next";

import { loadClientPortalData } from "@/lib/db/client-portal-server";
import { resolveShareByToken } from "@/lib/db/report-shares";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { DashboardTabs } from "@/components/dashboard/dashboard-tabs";
import { ClientPortalUnavailable } from "@/components/share/client-portal-unavailable";

const APP_BASE_URL = "https://app.offpixel.co.uk";

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
  searchParams: Promise<{ region?: string; tab?: string; past?: string; cancelled?: string }>;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Dynamic OG metadata — resolve the token to the client name so that
 * sharing the URL in Slack/WhatsApp/etc. shows a rich preview card:
 * "IRONWORKS · Off Pixel Dashboard" + a branded 1200×630 image.
 *
 * We intentionally do NOT bump the view counter here (bumpView: false).
 * `generateMetadata` is called by the bot/crawler that fetches the page
 * to generate the link preview — counting that as a page view would
 * inflate the `view_count` shown on the dashboard.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;

  // Lightweight path: resolve just the client_id from the token, then
  // fetch the client name. Falls back to a generic title on any failure.
  let clientName: string | null = null;
  try {
    const resolved = await resolveShareByToken(token);
    if (resolved.ok && resolved.share.scope === "client") {
      const supabase = createServiceRoleClient();
      const { data } = await supabase
        .from("clients")
        .select("name")
        .eq("id", resolved.share.client_id)
        .maybeSingle();
      clientName = data?.name ?? null;
    }
  } catch {
    // Non-fatal — fall through to generic title
  }

  const title = clientName
    ? `${clientName} · Off Pixel Dashboard`
    : "Campaign Dashboard · Off Pixel";
  const description = clientName
    ? `Live campaign performance dashboard for ${clientName}`
    : "Live campaign performance dashboard";
  const ogImageUrl = `${APP_BASE_URL}/api/og/client?name=${encodeURIComponent(clientName ?? "Client")}`;

  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description,
      type: "website",
      siteName: "Off Pixel",
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function ClientPortalPage({ params, searchParams }: Props) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const result = await loadClientPortalData(token, { bumpView: true });

  if (!result.ok) {
    return <ClientPortalUnavailable />;
  }

  return (
    <DashboardTabs
      clientId={result.client.id}
      token={token}
      client={result.client}
      events={result.events}
      londonOnsaleSpend={result.londonOnsaleSpend}
      londonPresaleSpend={result.londonPresaleSpend}
      dailyEntries={result.dailyEntries}
      dailyRollups={result.dailyRollups}
      additionalSpend={result.additionalSpend}
      weeklyTicketSnapshots={result.weeklyTicketSnapshots}
      trendTicketSnapshots={result.trendTicketSnapshots}
      trendDailyHistory={result.trendDailyHistory}
      lifetimeMetaByEventCode={result.lifetimeMetaByEventCode}
      showCreativeInsights={result.shareVisibility.showCreativeInsights}
      showFunnelPacing={result.shareVisibility.showFunnelPacing}
      isShared
      activeTab={sp.tab}
      activeRegion={sp.region}
      initialPastExpanded={sp.past === "1"}
      initialCancelledExpanded={sp.cancelled === "1"}
    />
  );
}
