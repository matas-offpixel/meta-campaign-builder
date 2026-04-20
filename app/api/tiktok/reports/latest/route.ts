/**
 * GET /api/tiktok/reports/latest?event_id=<uuid>
 *
 * Returns the most recently imported `tiktok_manual_reports` row for the
 * given event (ordered by `imported_at` desc), or null when none exist.
 * `report: null` is the canonical empty-state response — not an error —
 * so the dashboard can render its empty UI without parsing error reasons.
 *
 * RLS guarantees the row belongs to the calling user; we additionally
 * verify event ownership so a 404 surfaces clearly when the caller
 * supplies someone else's event id.
 */

import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { TikTokManualReportSnapshot } from "@/lib/types/tiktok";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface LatestReportPayload {
  id: string;
  campaign_name: string;
  date_range_start: string;
  date_range_end: string;
  imported_at: string;
  snapshot: TikTokManualReportSnapshot;
}

type LatestResponse =
  | { ok: true; report: LatestReportPayload | null }
  | { ok: false; error: string };

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json<LatestResponse>(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  const event_id = req.nextUrl.searchParams.get("event_id")?.trim() ?? "";
  if (!event_id || !UUID_RE.test(event_id)) {
    return NextResponse.json<LatestResponse>(
      { ok: false, error: "event_id query param required (uuid)" },
      { status: 400 },
    );
  }

  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select("id, user_id")
    .eq("id", event_id)
    .maybeSingle();

  if (eventErr) {
    console.warn("[tiktok/reports/latest] event lookup failed:", eventErr.message);
    return NextResponse.json<LatestResponse>(
      { ok: false, error: "Event lookup failed" },
      { status: 500 },
    );
  }
  if (!event) {
    return NextResponse.json<LatestResponse>(
      { ok: false, error: "Event not found" },
      { status: 404 },
    );
  }
  if (event.user_id !== user.id) {
    return NextResponse.json<LatestResponse>(
      { ok: false, error: "Forbidden" },
      { status: 403 },
    );
  }

  const { data: row, error } = await supabase
    .from("tiktok_manual_reports")
    .select(
      "id, campaign_name, date_range_start, date_range_end, imported_at, snapshot_json",
    )
    .eq("event_id", event_id)
    .order("imported_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[tiktok/reports/latest] read failed:", error.message);
    return NextResponse.json<LatestResponse>(
      { ok: false, error: "Failed to read report" },
      { status: 500 },
    );
  }

  if (!row) {
    return NextResponse.json<LatestResponse>(
      { ok: true, report: null },
      { status: 200 },
    );
  }

  return NextResponse.json<LatestResponse>(
    {
      ok: true,
      report: {
        id: row.id,
        campaign_name: row.campaign_name,
        date_range_start: row.date_range_start,
        date_range_end: row.date_range_end,
        imported_at: row.imported_at,
        snapshot: row.snapshot_json as unknown as TikTokManualReportSnapshot,
      },
    },
    { status: 200 },
  );
}
