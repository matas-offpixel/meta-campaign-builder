import { NextResponse, type NextRequest } from "next/server";

import { getOwnerFacebookToken, resolveShareByToken } from "@/lib/db/report-shares";
import {
  createClient,
  createServiceRoleClient,
} from "@/lib/supabase/server";
import {
  CREATIVE_THUMB_CACHE_SEC,
  metaPlaceholderSvgBytes,
  resolveThumbnailBytes,
} from "@/lib/meta/creative-thumbnail-cache";
import {
  verifyAdAccountForThumbnail,
} from "@/lib/meta/thumbnail-proxy-server";

export const CREATIVE_THUMB_CACHE_CONTROL = `public, max-age=${CREATIVE_THUMB_CACHE_SEC}, s-maxage=${CREATIVE_THUMB_CACHE_SEC}, stale-while-revalidate=86400`;

function placeholderResponse(label: string): NextResponse {
  const buf = metaPlaceholderSvgBytes(label);
  return svgResponse(buf);
}

function svgResponse(buf: Buffer): NextResponse {
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

function streamImageResponse(
  buffer: Buffer,
  contentType: string,
): NextResponse {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    },
  });
  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": CREATIVE_THUMB_CACHE_CONTROL,
    },
  });
}

/**
 * Shared GET handler for `/api/proxy/creative-thumbnail` and legacy
 * `/api/meta/thumbnail-proxy`.
 */
export async function handleCreativeThumbnailGet(
  req: NextRequest,
): Promise<NextResponse> {
  const url = req.nextUrl;
  const adIdRaw = url.searchParams.get("ad_id")?.trim() ?? "";
  const cacheKeyRaw = url.searchParams.get("cache_key")?.trim() ?? "";
  const fallbackLabel =
    url.searchParams.get("fallback_label")?.trim() ||
    url.searchParams.get("label")?.trim() ||
    "Creative";

  const admin = createServiceRoleClient();

  // ── cache_key path: opaque Storage object (no Meta round-trip) ────────
  if (cacheKeyRaw && !adIdRaw) {
    if (!/^[a-zA-Z0-9._-]{8,160}$/.test(cacheKeyRaw)) {
      return NextResponse.json(
        { ok: false, error: "Invalid cache_key" },
        { status: 400 },
      );
    }
    const { data, error } = await admin.storage
      .from("creative-thumbnails")
      .download(cacheKeyRaw);
    if (!error && data) {
      const arr = new Uint8Array(await data.arrayBuffer());
      const ct =
        cacheKeyRaw.endsWith(".png")
          ? "image/png"
          : cacheKeyRaw.endsWith(".webp")
            ? "image/webp"
            : cacheKeyRaw.endsWith(".gif")
              ? "image/gif"
              : "image/jpeg";
      return streamImageResponse(Buffer.from(arr), ct);
    }
    return placeholderResponse(fallbackLabel);
  }

  const adId = adIdRaw;
  if (!adId || adId.length > 64) {
    return NextResponse.json({ ok: false, error: "Invalid ad_id" }, { status: 400 });
  }

  const shareToken = url.searchParams.get("share_token")?.trim();
  const eventCodeParam = url.searchParams.get("event_code")?.trim();
  const clientIdParam = url.searchParams.get("client_id")?.trim();

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
    return placeholderResponse(fallbackLabel);
  }

  const fbToken = await getOwnerFacebookToken(ownerUserId, admin);
  if (!fbToken) {
    return placeholderResponse(fallbackLabel);
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
    const resolved = await resolveThumbnailBytes({
      admin,
      adId,
      fbToken,
    });
    return streamImageResponse(resolved.buffer, resolved.contentType);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[creative-thumbnail-get] fetch failed", { adId, message: msg });
    return placeholderResponse(fallbackLabel);
  }
}
