import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { listOverviewEvents } from "@/lib/db/overview-server";
import type { OverviewFilter } from "@/lib/types/overview";

/**
 * Authenticated GET — campaign overview rows for the current user.
 *
 * `?filter=future|past` (default future). Mirrors the same data the
 * /overview server page loads on first paint; this route exists for
 * the sortable client table to refresh after a filter flip without a
 * full server-component reload.
 *
 * Spend columns are intentionally null on this payload — the client
 * fans out to /api/overview/stats when the user clicks Load Stats.
 */

export const dynamic = "force-dynamic";

function parseFilter(value: string | null): OverviewFilter {
  return value === "past" ? "past" : "future";
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorised" },
      { status: 401 },
    );
  }

  const filter = parseFilter(req.nextUrl.searchParams.get("filter"));
  const rows = await listOverviewEvents(user.id, filter);
  return NextResponse.json({ ok: true, rows, filter });
}
