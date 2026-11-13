import { NextResponse } from "next/server";

import { loadPanel } from "@/lib/onsale-refresh/read";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/events/[id]/onsale-refresh
 *
 * The event page's Refresh panel: the latest on-sale refresh proposal per
 * campaign of the event, with its lines (and, P2, the earlier lines still
 * waiting on a write), plus the gates that decide what can be clicked:
 * Live needs ONSALE_REFRESH_APPLY_ENABLED = "1" and the event armed Live.
 * Session auth; the owner's RLS on the refresh tables (migrations 232,
 * 236) does the scoping. Reads only.
 */
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const panel = await loadPanel(supabase, id, process.env);
    return NextResponse.json(panel);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load" }, { status: 500 });
  }
}
