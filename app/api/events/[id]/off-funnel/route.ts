import { NextResponse, type NextRequest } from "next/server";

import { loadOffFunnelAuditForEvent } from "@/lib/db/off-funnel-audit-load";
import { getEventByIdServer } from "@/lib/db/events-server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/events/[id]/off-funnel
 *
 * Operator-only audit of live campaigns pointing off-funnel while
 * this event has a landing page. Snapshot reads only.
 */

function publicOriginFrom(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  if (host) return `${proto}://${host.replace(/\/+$/, "")}`;
  return "";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const event = await getEventByIdServer(id);
  if (!event) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  try {
    const rows = await loadOffFunnelAuditForEvent(
      supabase,
      id,
      publicOriginFrom(req),
    );
    return NextResponse.json({ ok: true, rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : "off-funnel load failed";
    console.warn("[api/events/off-funnel]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
