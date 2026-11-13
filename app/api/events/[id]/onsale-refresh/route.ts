import { NextResponse } from "next/server";

import { loadEventProposals } from "@/lib/onsale-refresh/read";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/events/[id]/onsale-refresh
 *
 * The event page's Refresh panel: the latest on-sale refresh proposal per
 * campaign of the event, with its lines. Session auth; the owner's RLS on
 * onsale_refresh_proposals / _lines (migration 232) does the scoping.
 * Read only: P1 has no Accept, Reject or Apply.
 */
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const proposals = await loadEventProposals(supabase, id);
    return NextResponse.json({ proposals });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load" }, { status: 500 });
  }
}
