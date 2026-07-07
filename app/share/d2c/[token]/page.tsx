import { notFound } from "next/navigation";
import { after } from "next/server";
import { headers } from "next/headers";
import type { Metadata } from "next";

import {
  buildLandingRateLimitKey,
  checkLandingPageRateLimit,
} from "@/lib/landing-pages/rate-limit";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  bumpShareAccess,
  resolveActiveShareByToken,
} from "@/lib/db/d2c-shares";
import { loadD2CEventDashboard } from "@/lib/db/d2c-dashboard";
import { getEventSignupStats, type EventSignupStats } from "@/lib/d2c/stats";
import { isValidD2CShareToken } from "@/lib/d2c/share-token";
import { EventDashboard } from "@/components/dashboard/d2c/event-dashboard";

interface Props {
  params: Promise<{ token: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Campaign dashboard · Off Pixel",
    robots: { index: false, follow: false },
  };
}

/**
 * Public read-only D2C event dashboard. The token IS the credential; the row
 * is resolved via the service-role client (RLS grants no public read). Renders
 * the same dashboard as the operator page with `readOnly` so no approver
 * controls, no share management, and no individual PII ever surface. Rate-
 * limited to 60 req/min per IP (reuses the landing-page limiter).
 */
export default async function D2CSharePage({ params }: Props) {
  const { token } = await params;

  // Rate-limit first — a public URL is a looped-curl target. Mirrors the LP
  // page's throttle posture (60 req/min per IP): a rendered notice rather than
  // a raw Response, since RSC pages can't set arbitrary status codes.
  const h = await headers();
  const key = buildLandingRateLimitKey(h.get("x-forwarded-for"));
  const decision = checkLandingPageRateLimit(`d2c-share:${key}`);
  if (!decision.allowed) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">
          Too many requests — try again in a moment.
        </p>
      </main>
    );
  }

  if (!isValidD2CShareToken(token)) notFound();

  const admin = createServiceRoleClient();
  const share = await resolveActiveShareByToken(admin, token);
  if (!share) notFound();

  const data = await loadD2CEventDashboard(admin, share.event_id);
  if (!data) notFound();

  let stats: EventSignupStats | null = null;
  try {
    stats = await getEventSignupStats(admin, share.event_id);
  } catch {
    stats = null;
  }

  // Bump the access counter after the response is sent (non-blocking).
  after(async () => {
    await bumpShareAccess(admin, share).catch(() => undefined);
  });

  return (
    <main className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto max-w-4xl">
        <p className="mb-6 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Off Pixel · Campaign dashboard
        </p>
        <EventDashboard data={data} stats={stats} readOnly canApprove={false} />
      </div>
    </main>
  );
}
