import { NextResponse, type NextRequest } from "next/server";

import {
  getOwnerFacebookToken,
  resolveShareByToken,
} from "@/lib/db/report-shares";
import {
  createClient,
  createServiceRoleClient,
} from "@/lib/supabase/server";
import {
  getCachedMetaThumbnailBytes,
  verifyAdAccountForThumbnail,
} from "@/lib/meta/thumbnail-proxy-server";

export const runtime = "nodejs";

const CACHE_CONTROL =
  "public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600";

/**
 * GET /api/meta/thumbnail-proxy
 *
 * Proxies Meta creative thumbnails through app.offpixel.co.uk so card/modal
 * `<img>` tags use stable URLs. Snapshot-stored fbcdn / ads/image URLs expire
 * quickly; this route re-resolves `creative.thumbnail_url` via Graph and
 * caches bytes for 24h (Next `unstable_cache`).
 *
 * Auth (must match before cache):
 * - Cookie session + `client_id` query — operator must own the client.
 * - OR `share_token` (+ optional `event_code` for venue shares) — same model
 *   as venue-creatives / share report.
 */
export async function GET(req: NextRequest) {
  const adId = req.nextUrl.searchParams.get("ad_id")?.trim();
  if (!adId || adId.length > 64) {
    return NextResponse.json({ ok: false, error: "Invalid ad_id" }, { status: 400 });
  }

  const shareToken = req.nextUrl.searchParams.get("share_token")?.trim();
  const eventCodeParam = req.nextUrl.searchParams.get("event_code")?.trim();
  const clientIdParam = req.nextUrl.searchParams.get("client_id")?.trim();

  const admin = createServiceRoleClient();

  let ownerUserId: string;
  let clientAdAccountId: string | null;

  if (shareToken) {
    const resolved = await resolveShareByToken(shareToken, admin);
    if (!resolved.ok) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    const share = resolved.share;
    if (share.scope === "venue") {
      const code = eventCodeParam ?? "";
      if (!code || share.event_code !== code) {
        return NextResponse.json(
          { ok: false, error: "Invalid event_code for this share" },
          { status: 400 },
        );
      }
    }

    const { data: clientRow, error: clientErr } = await admin
      .from("clients")
      .select("meta_ad_account_id")
      .eq("id", share.client_id)
      .maybeSingle();
    if (clientErr) {
      return NextResponse.json(
        { ok: false, error: clientErr.message },
        { status: 500 },
      );
    }
    ownerUserId = share.user_id;
    clientAdAccountId = clientRow?.meta_ad_account_id ?? null;
  } else {
    if (!clientIdParam) {
      return NextResponse.json(
        { ok: false, error: "Missing client_id or share_token" },
        { status: 400 },
      );
    }
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
    }

    const { data: clientRow, error: clientErr } = await supabase
      .from("clients")
      .select("id, user_id, meta_ad_account_id")
      .eq("id", clientIdParam)
      .maybeSingle();
    if (clientErr) {
      return NextResponse.json(
        { ok: false, error: clientErr.message },
        { status: 500 },
      );
    }
    if (!clientRow) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    if (clientRow.user_id !== user.id) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    ownerUserId = user.id;
    clientAdAccountId = clientRow.meta_ad_account_id ?? null;
  }

  if (!clientAdAccountId) {
    return NextResponse.json(
      { ok: false, error: "No Meta ad account on client" },
      { status: 404 },
    );
  }

  const fbToken = await getOwnerFacebookToken(ownerUserId, admin);
  if (!fbToken) {
    return NextResponse.json(
      { ok: false, error: "Facebook not connected or token expired" },
      { status: 503 },
    );
  }

  const allowed = await verifyAdAccountForThumbnail(
    adId,
    fbToken,
    clientAdAccountId,
  );
  if (!allowed) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const { buffer, contentType } = await getCachedMetaThumbnailBytes(
      adId,
      ownerUserId,
    );
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": CACHE_CONTROL,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[thumbnail-proxy] fetch failed", { adId, message: msg });
    return NextResponse.json(
      { ok: false, error: "Thumbnail unavailable" },
      { status: 502 },
    );
  }
}
