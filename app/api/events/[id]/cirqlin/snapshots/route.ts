import { NextResponse } from "next/server";

import { loadCirqlinSnapshotsForEvent } from "@/lib/db/signup-source-snapshots";
import { createClient } from "@/lib/supabase/server";

interface Context {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/events/:id/cirqlin/snapshots
 *
 * Session-authed read of `signup_source_snapshots` for the Daily
 * Tracker REGS column and the REGISTRATIONS card. Counts only.
 */
export async function GET(_req: Request, { params }: Context) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rows = await loadCirqlinSnapshotsForEvent(supabase, id);
    return NextResponse.json({ ok: true, rows });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to load Cirqlin snapshots",
      },
      { status: 500 },
    );
  }
}
