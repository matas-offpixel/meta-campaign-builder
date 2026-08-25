import { NextResponse } from "next/server";

import { getLandingPageContext } from "@/lib/db/landing-pages";
import { geoFromHeaders } from "@/lib/landing-pages/geo";
import {
  processPageView,
  type PageViewInsert,
} from "@/lib/landing-pages/page-view-handler";
import {
  buildPageViewRateLimitKey,
  checkPageViewRateLimit,
} from "@/lib/landing-pages/rate-limit";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Public first-party LP view capture. `/api/l/` is already in
 * PUBLIC_PREFIXES. Service-role insert: lp_page_views has no write
 * policies. Never 500s to the fan.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function insertView(row: PageViewInsert): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceRoleClient() as any;
  const { error } = await db.from("lp_page_views").insert({
    event_id: row.eventId,
    occurred_at: row.occurredAt,
    utm: row.utm,
    geo_country: row.geoCountry,
    geo_region: row.geoRegion,
    geo_city: row.geoCity,
    referrer: row.referrer,
  });
  if (error) throw new Error(error.message);
}

async function handle(
  request: Request,
  params: Promise<{ clientSlug: string; eventSlug: string }>,
) {
  const { clientSlug, eventSlug } = await params;

  let body: unknown = {};
  const contentType = request.headers.get("content-type") ?? "";
  if (request.method === "POST" && contentType.includes("json")) {
    try {
      const text = await request.text();
      body = text.length > 0 ? JSON.parse(text) : {};
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON body." },
        { status: 400 },
      );
    }
  } else if (request.method === "POST") {
    try {
      const text = await request.text();
      body = text.length > 0 ? JSON.parse(text) : {};
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON body." },
        { status: 400 },
      );
    }
  }

  const result = await processPageView(
    {
      resolveContext: getLandingPageContext,
      checkRateLimit: (key) => checkPageViewRateLimit(key),
      buildRateLimitKey: buildPageViewRateLimitKey,
      insertView,
      now: () => new Date(),
    },
    {
      clientSlug,
      eventSlug,
      method: request.method,
      body,
      xForwardedFor: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
      geo: geoFromHeaders(request.headers),
    },
  );

  if (result.status === 204) {
    return new NextResponse(null, { status: 204 });
  }
  return NextResponse.json(result.json, { status: result.status });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ clientSlug: string; eventSlug: string }> },
) {
  try {
    return await handle(request, context.params);
  } catch (error) {
    console.error("[landing-pages] page-view route failed:", error);
    return new NextResponse(null, { status: 204 });
  }
}

export async function GET() {
  return NextResponse.json(
    { ok: false, error: "Method not allowed." },
    { status: 405, headers: { allow: "POST" } },
  );
}

export async function HEAD() {
  return new NextResponse(null, { status: 405, headers: { allow: "POST" } });
}
