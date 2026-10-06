import { NextRequest, NextResponse } from "next/server";

import { markInterestClusterUsed } from "@/lib/db/interest-clusters";
import { createClient } from "@/lib/supabase/server";

/** Records a pick: use_count + 1, last_used_at = now. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { id?: unknown };
  if (typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  }
  const result = await markInterestClusterUsed(supabase, user.id, body.id);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, tableMissing: result.tableMissing ?? false },
      { status: result.status },
    );
  }
  return NextResponse.json({ ok: true, cluster: result.value });
}
