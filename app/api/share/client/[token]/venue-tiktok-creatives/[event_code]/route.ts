import { NextResponse, type NextRequest } from "next/server";

import { loadVenueTikTokCreatives } from "@/lib/dashboard/venue-tiktok-creatives";
import { resolveShareByToken } from "@/lib/db/report-shares";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * GET /api/share/client/[token]/venue-tiktok-creatives/[event_code]
 *
 * TikTok twin of `../venue-creatives/[event_code]` for the venue "Top
 * creatives" section. Same token auth: scope `client` or `venue` (a venue
 * share only for its own event_code), and the event_code must belong to
 * `share.client_id`. Reads stored snapshots only.
 */

export const revalidate = 0;
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string; event_code: string }> },
) {
  const { token, event_code } = await params;
  if (!token || token.length > 64) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  const eventCode = decodeURIComponent(event_code ?? "");
  if (!eventCode || eventCode.length > 128) {
    return NextResponse.json(
      { ok: false, error: "Invalid event_code" },
      { status: 400 },
    );
  }

  const admin = createServiceRoleClient();
  const resolved = await resolveShareByToken(token, admin);
  if (
    !resolved.ok ||
    (resolved.share.scope !== "client" && resolved.share.scope !== "venue")
  ) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  const share = resolved.share;
  if (share.scope === "venue" && share.event_code !== eventCode) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }
  if (!share.client_id) {
    return NextResponse.json(
      { ok: false, error: "Share missing client_id" },
      { status: 500 },
    );
  }

  try {
    const groups = await loadVenueTikTokCreatives(admin, {
      clientId: share.client_id,
      eventCode,
    });
    return NextResponse.json({ ok: true, groups });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[venue-tiktok-creatives] load failed", {
      token,
      eventCode,
      error: message,
    });
    return NextResponse.json(
      { ok: false, error: message || "TikTok creatives unavailable" },
      { status: 500 },
    );
  }
}
