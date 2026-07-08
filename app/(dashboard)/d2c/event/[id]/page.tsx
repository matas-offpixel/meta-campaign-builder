import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isD2CApprover } from "@/lib/auth/operator-allowlist";
import { loadD2CEventDashboard } from "@/lib/db/d2c-dashboard";
import { getActiveShareForEvent } from "@/lib/db/d2c-shares";
import { getEventSignupStats, type EventSignupStats } from "@/lib/d2c/stats";
import { buildD2CShareUrl } from "@/lib/d2c/dashboard-view";
import { EventDashboard } from "@/components/dashboard/d2c/event-dashboard";

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * D2C event dashboard (operator). Reads via the service-role client so an
 * approver can view an event created by another operator — the previous
 * `getEventByIdServer` ran under the viewer's RLS session and 404'd for any
 * non-owner (root cause of the Throwback 404). Authorisation is enforced here:
 * the viewer must be the event owner OR a D2C approver.
 */
export default async function D2CEventPage({ params }: Props) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    notFound();
  }

  const data = await loadD2CEventDashboard(admin, id);
  if (!data) notFound();

  // Owner OR approver may view. Anyone else gets the same generic 404 so the
  // dashboard doesn't leak the existence of another operator's event.
  const isApprover = isD2CApprover(user.id);
  if (!isApprover && data.event.user_id !== user.id) notFound();

  let stats: EventSignupStats | null = null;
  try {
    stats = await getEventSignupStats(admin, id);
  } catch (e) {
    console.warn(
      "[d2c/event] stats failed:",
      e instanceof Error ? e.message : String(e),
    );
  }

  const activeShare = await getActiveShareForEvent(admin, id);
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const origin = host ? `${proto}://${host}` : "";
  const shareUrl = activeShare ? buildD2CShareUrl(origin, activeShare.token) : null;

  return (
    <main className="flex-1 px-6 py-6">
      <div className="mx-auto max-w-4xl">
        <EventDashboard
          data={data}
          stats={stats}
          readOnly={false}
          canApprove={isApprover}
          share={{ url: shareUrl, id: activeShare?.id ?? null }}
          signupStatsEndpoint={`/api/d2c/event/${id}/signup-stats`}
        />
      </div>
    </main>
  );
}
