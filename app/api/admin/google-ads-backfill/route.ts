import { NextResponse, type NextRequest } from "next/server";

import { runGoogleAdsRollupLeg } from "@/lib/dashboard/google-ads-rollup-leg";
import { upsertGoogleAdsRollups } from "@/lib/db/event-daily-rollups";
import { getGoogleAdsCredentials } from "@/lib/google-ads/credentials";
import { fetchGoogleAdsDailyRollupInsights } from "@/lib/google-ads/rollup-insights";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface RequestBody {
  event_id?: unknown;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function POST(req: NextRequest) {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (typeof body.event_id !== "string" || body.event_id.length === 0) {
    return NextResponse.json(
      { ok: false, error: "event_id is required" },
      { status: 400 },
    );
  }
  const eventId = body.event_id;

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Service-role client unavailable",
      },
      { status: 500 },
    );
  }

  const { data: event, error: eventErr } = await admin
    .from("events")
    .select(
      "id, user_id, event_code, event_timezone, event_date, client_id, tiktok_account_id, google_ads_account_id, client:clients ( meta_ad_account_id, tiktok_account_id, google_ads_account_id )",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (eventErr) {
    return NextResponse.json(
      { ok: false, error: eventErr.message },
      { status: 500 },
    );
  }
  if (!event) {
    return NextResponse.json(
      { ok: false, error: "Event not found" },
      { status: 404 },
    );
  }

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }
  if (user.id !== event.user_id) {
    return NextResponse.json(
      { ok: false, error: "Forbidden" },
      { status: 403 },
    );
  }

  const clientRel = event.client as
    | {
        meta_ad_account_id: string | null;
        tiktok_account_id: string | null;
        google_ads_account_id: string | null;
      }
    | Array<{
        meta_ad_account_id: string | null;
        tiktok_account_id: string | null;
        google_ads_account_id: string | null;
      }>
    | null;
  const clientGoogleAdsAccountId = Array.isArray(clientRel)
    ? (clientRel[0]?.google_ads_account_id ?? null)
    : (clientRel?.google_ads_account_id ?? null);

  const until = new Date();
  const since = new Date(until);
  since.setDate(since.getDate() - 59);
  const result = await runGoogleAdsRollupLeg({
    supabase: admin,
    eventId: event.id,
    userId: event.user_id,
    eventCode: (event.event_code as string | null) ?? null,
    googleAdsAccountId:
      ((event.google_ads_account_id as string | null) ?? null) ??
      clientGoogleAdsAccountId,
    since: ymd(since),
    until: ymd(until),
    deps: {
      getCredentials: getGoogleAdsCredentials,
      fetchDailyInsights: fetchGoogleAdsDailyRollupInsights,
      upsertRollups: upsertGoogleAdsRollups,
    },
  });

  return NextResponse.json(
    {
      ok: result.ok,
      eventId,
      googleAds: result,
      window: {
        since: ymd(since),
        until: ymd(until),
      },
    },
    { status: 200 },
  );
}
