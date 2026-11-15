import { NextResponse } from "next/server";

import { countToReview } from "@/lib/onsale-refresh/read";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/events/[id]/onsale-refresh/count → { count }
 *
 * The MML canvas chip ("Refresh · {n} to review", R4): lines still To
 * review on the event's latest proposals. Session auth, owner RLS. Reads
 * only. Before migration 232 is applied, or with no proposal, 0.
 */
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ count: await countToReview(supabase, id) });
  } catch {
    return NextResponse.json({ count: 0 });
  }
}
