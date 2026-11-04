import { NextResponse, type NextRequest } from "next/server";

import { loadVenueTikTokCreatives } from "@/lib/dashboard/venue-tiktok-creatives";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

/**
 * GET /api/internal/clients/[clientId]/venue-tiktok-creatives/[event_code]
 *
 * Session-authenticated twin of
 * `/api/share/client/[token]/venue-tiktok-creatives/[event_code]`, for the
 * venue "Top creatives" section on the operator dashboard. Same ownership
 * check as `../venue-creatives/[event_code]` (`clients.user_id`); the
 * snapshot reads run on the service-role client after it passes.
 */

export const revalidate = 0;
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string; event_code: string }> },
) {
  const { clientId, event_code } = await params;
  if (!clientId || clientId.length > 64) {
    return NextResponse.json(
      { ok: false, error: "Invalid client id" },
      { status: 400 },
    );
  }
  const eventCode = decodeURIComponent(event_code ?? "");
  if (!eventCode || eventCode.length > 128) {
    return NextResponse.json(
      { ok: false, error: "Invalid event_code" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  const { data: clientRow, error: clientErr } = await supabase
    .from("clients")
    .select("id, user_id")
    .eq("id", clientId)
    .maybeSingle();
  if (clientErr) {
    return NextResponse.json(
      { ok: false, error: clientErr.message },
      { status: 500 },
    );
  }
  if (!clientRow) {
    return NextResponse.json(
      { ok: false, error: "Client not found" },
      { status: 404 },
    );
  }
  if (clientRow.user_id !== user.id) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const groups = await loadVenueTikTokCreatives(createServiceRoleClient(), {
      clientId,
      eventCode,
    });
    return NextResponse.json({ ok: true, groups });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[internal venue-tiktok-creatives] load failed", {
      clientId,
      eventCode,
      error: message,
    });
    return NextResponse.json(
      { ok: false, error: message || "TikTok creatives unavailable" },
      { status: 500 },
    );
  }
}
